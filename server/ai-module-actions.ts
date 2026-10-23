/**
 * Actions MaxAI can apply to the owning workspace modules.
 *
 * These functions deliberately call the same module services as the regular
 * dashboard. The assistant supplies the workspace owner id from the server
 * session; no tool argument can choose a different workspace or existing
 * record.
 */
import { createEvent, deleteEvent, saveEvent } from "../src/lib/events";
import { createWorkspaceForm } from "../src/lib/forms";
import {
  formFieldTypes,
  type FormField,
} from "../src/components/forms/form-types";
import {
  saveAppointmentForAssistant,
  saveBookingPageForAssistant,
} from "./appointments-data";
import type { WorkspaceContext } from "./workspace-access";

type RecordValue = Record<string, unknown>;

export type WorkspaceChange = {
  module: "forms" | "events" | "appointments";
  action: "created";
  recordId: string;
  label: string;
};

const text = (value: unknown, maximum: number) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const boundedNumber = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
};

const asBoolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const normaliseFormFields = (value: unknown): FormField[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 40).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const item = entry as RecordValue;
    const requestedType = text(item.type, 40);
    const type = (formFieldTypes as readonly string[]).includes(requestedType)
      ? requestedType
      : "shortText";
    const label = text(item.label, 180) || `Question ${index + 1}`;
    const field: FormField = {
      id: text(item.id, 80) || `ai-field-${index + 1}`,
      type: type as FormField["type"],
      label,
      placeholder: text(item.placeholder, 300) || undefined,
      helpText: text(item.helpText, 500) || undefined,
      required: item.required === true,
      options: Array.isArray(item.options)
        ? item.options
            .filter((option): option is string => typeof option === "string")
            .map((option) => option.trim().slice(0, 180))
            .filter(Boolean)
            .slice(0, 50)
        : undefined,
      width: item.width === "half" ? "half" : "full",
    };
    return [field];
  });
};

const formFieldSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["shortText", "longText", "email", "phone", "number", "date", "dropdown", "radio", "checkboxes", "yesNo"],
      description: "The field control type.",
    },
    label: { type: "string", description: "The question or field label." },
    placeholder: { type: "string" },
    helpText: { type: "string" },
    required: { type: "boolean" },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Choices for dropdown, radio, or checkbox fields.",
    },
  },
  required: ["label"],
  additionalProperties: false,
};

export const createFormForAssistant = async (
  input: RecordValue,
  context: WorkspaceContext,
) => {
  const title = text(input.title, 255) || "Untitled form";
  const form = await createWorkspaceForm(context.workspaceId, {
    title,
    description: text(input.description, 2_000),
    fields: normaliseFormFields(input.fields),
  });
  return {
    form,
    workspaceChange: {
      module: "forms",
      action: "created",
      recordId: form.id,
      label: form.title,
    } satisfies WorkspaceChange,
  };
};

export const createEventForAssistant = async (
  input: RecordValue,
  context: WorkspaceContext,
) => {
  const title = text(input.title, 255) || "Untitled event";
  const currency = (text(input.currency, 3) || "USD").toUpperCase();
  const timezone = text(input.timezone, 80) || "UTC";
  const ticketingEnabled = asBoolean(input.ticketingEnabled);

  const created = await createEvent(context.workspaceId, {
    title,
    currency,
    timezone,
    ticketingEnabled,
  });

  try {
    const saved = await saveEvent(
      context.workspaceId,
      {
        ...created,
        description: text(input.description, 4_000),
        eventDate: text(input.eventDate, 10),
        startTime: text(input.startTime, 10),
        endTime: text(input.endTime, 10),
        timezone,
        capacityTotal:
          Number(input.capacity) > 0
            ? boundedNumber(input.capacity, 0, 1, 10_000_000)
            : null,
      },
      { syncRegistration: true },
    );
    return {
      event: saved,
      workspaceChange: {
        module: "events",
        action: "created",
        recordId: saved.id,
        label: saved.title,
      } satisfies WorkspaceChange,
    };
  } catch (error) {
    // Keep a partially-created event plus its registration form from being
    // left behind if the shared save/normalisation path rejects the details.
    await deleteEvent(context.workspaceId, created).catch(() => undefined);
    throw error;
  }
};

export const createBookingPageForAssistant = async (
  input: RecordValue,
  context: WorkspaceContext,
) => {
  const name = text(input.name, 160) || "Untitled booking page";
  const result = await saveBookingPageForAssistant(context.workspaceId, {
    name,
    description: text(input.description, 2_000),
    durationMinutes: boundedNumber(input.durationMinutes, 30, 5, 1_440),
    locationType: text(input.locationType, 30) || "video",
    locationDetail: text(input.locationDetail, 500),
    schedulingType: text(input.schedulingType, 30) || "single",
    capacity: boundedNumber(input.capacity, 1, 1, 10_000),
    currency: (text(input.currency, 8) || "USD").toUpperCase(),
    priceCents: boundedNumber(input.priceCents, 0, 0, 100_000_000),
    color: text(input.color, 16) || "#635BFF",
    status: "draft",
    questions: [],
    branding: {},
    hosts: [],
  });
  return {
    bookingPage: result,
    workspaceChange: {
      module: "appointments",
      action: "created",
      recordId: result.id,
      label: result.name,
    } satisfies WorkspaceChange,
  };
};

export const createAppointmentForAssistant = async (
  input: RecordValue,
  context: WorkspaceContext,
) => {
  const startsAt = text(input.startsAt, 40);
  const endsAt = text(input.endsAt, 40);
  if (!startsAt || !endsAt) {
    throw new Error("An appointment needs a start and end time.");
  }
  const result = await saveAppointmentForAssistant(context.workspaceId, {
    bookingPageId: text(input.bookingPageId, 64),
    routingFormId: text(input.routingFormId, 64),
    inviteeName: text(input.inviteeName, 200),
    inviteeEmail: text(input.inviteeEmail, 320),
    inviteeTimezone: text(input.inviteeTimezone, 64) || "UTC",
    hostName: text(input.hostName, 200),
    hostEmail: text(input.hostEmail, 320),
    startsAt,
    endsAt,
    status: text(input.status, 24) || "confirmed",
    locationType: text(input.locationType, 30) || "video",
    meetingUrl: text(input.meetingUrl, 800),
    answers: input.answers && typeof input.answers === "object" ? input.answers : {},
    paymentStatus: text(input.paymentStatus, 32) || "not_required",
    amountCents: boundedNumber(input.amountCents, 0, 0, 100_000_000),
    currency: (text(input.currency, 8) || "USD").toUpperCase(),
  });
  return {
    appointment: result.appointment,
    notification: result.notification,
    workspaceChange: {
      module: "appointments",
      action: "created",
      recordId: result.appointment.id,
      label: result.appointment.inviteeName || "Appointment",
    } satisfies WorkspaceChange,
  };
};

export const __testing = {
  normaliseFormFields,
};

export { formFieldSchema };
