import type { IncomingMessage, ServerResponse } from "node:http";

import { jwtVerify } from "jose";

import {
  configureEventsServerDependencies,
  createEvent,
  deleteEvent,
  deleteEventTicketDesign,
  deleteEventTicketType,
  getEvent,
  getEventModulePreferences,
  getEventTicketDesign,
  getPublicEvent,
  joinEventWaitlist,
  isEventSlugAvailable,
  issueComplimentaryTicket,
  listCheckedInAttendees,
  listEventAttendees,
  listEventScans,
  listEvents,
  listEventTemplates,
  listEventTicketDesigns,
  listEventTicketDesignTemplates,
  listEventTicketTypes,
  promoteEventWaitlist,
  saveEvent,
  saveEventModulePreferences,
  saveEventTicketDesign,
  saveEventTicketDesignTemplate,
  saveEventTicketType,
  transferEventTicket,
  verifyPublicEventInvitation,
  verifyPublicEventPassword,
  voidEventTicket,
} from "../src/lib/events";
import { issueStoredEventTicket } from "./event-tickets";
import { resolveOwnedProjectId } from "./projects-data";
import { configureFormsDataRuntime } from "./forms-data";
import {
  cancelEventMeeting,
  createEventMeeting,
  listEventMeetingProviders,
  syncEventMeeting,
} from "./event-integrations";
import {
  sendEventAttendeeEmailsNow,
  sendEventCancellationEmailsNow,
  sendEventReminderEmailsNow,
  sendEventUpdateEmailsNow,
  sendEventWaitlistEmailNow,
  listEventMailSettings,
  setEventReminderHours,
  toggleEventMailSetting,
} from "./event-mail";
import type { EventMeetingProvider } from "./scheduling-oauth";
import {
  deactivateEventTicketPaymentProductServer,
  hasConnectedPaymentProviderServer,
  syncEventTicketPaymentProductServer,
} from "./payment-data";
import { workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type RecordValue = Record<string, unknown>;

class EventsDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "events_error",
  ) {
    super(message);
  }
}

configureFormsDataRuntime();
configureEventsServerDependencies({
  deactivateTicketProduct: deactivateEventTicketPaymentProductServer,
  hasConnectedPaymentProvider: hasConnectedPaymentProviderServer,
  issueStoredTicket: issueStoredEventTicket,
  syncTicketProduct: syncEventTicketPaymentProductServer,
  createMeeting: async (userId, eventId, provider, previousIntegration) => createEventMeeting(userId, eventId, provider, previousIntegration),
  cancelMeeting: async (userId, eventId, previousIntegration) => cancelEventMeeting(userId, eventId, previousIntegration),
  sendEventCancellationEmails: sendEventCancellationEmailsNow,
  sendEventAttendeeEmails: sendEventAttendeeEmailsNow,
  sendEventReminderEmails: sendEventReminderEmailsNow,
  sendEventUpdateEmails: sendEventUpdateEmailsNow,
  sendEventWaitlistEmail: sendEventWaitlistEmailNow,
});

const text = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new EventsDataError(
      "Events are temporarily unavailable. Please try again.",
      503,
      "events_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new EventsDataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        userId,
      )
    ) {
      throw new Error("Invalid user");
    }
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof EventsDataError) throw error;
    throw new EventsDataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 6_000_000) {
      throw new EventsDataError("This events update is too large.", 413);
    }
  }
  try {
    const parsed = body ? (JSON.parse(body) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid body");
    }
    return parsed as RecordValue;
  } catch {
    throw new EventsDataError("The events update could not be read.");
  }
};

const argsFrom = (body: RecordValue) =>
  body.args && typeof body.args === "object" && !Array.isArray(body.args)
    ? (body.args as RecordValue)
    : ({} as RecordValue);

const executeEventsOperation = async (
  operation: string,
  args: RecordValue,
  userId: string | null,
) => {
  const authenticatedId = () => {
    if (!userId) {
      throw new EventsDataError(
        "Your session has expired. Sign in and try again.",
        401,
        "authentication_required",
      );
    }
    return userId;
  };
  switch (operation) {
    case "isEventSlugAvailable":
      return isEventSlugAvailable(text(args.slug), text(args.eventId));
    case "listEventTemplates":
      return listEventTemplates();
    case "listEventTicketDesignTemplates":
      return listEventTicketDesignTemplates(authenticatedId());
    case "saveEventTicketDesignTemplate":
      return saveEventTicketDesignTemplate(
        authenticatedId(),
        args.template as Parameters<
          typeof saveEventTicketDesignTemplate
        >[1],
      );
    case "getEventModulePreferences":
      return getEventModulePreferences(
        authenticatedId(),
        text(args.timezone) || "UTC",
      );
    case "saveEventModulePreferences":
      return saveEventModulePreferences(
        authenticatedId(),
        args.preferences as Parameters<
          typeof saveEventModulePreferences
        >[1],
      );
    case "listEvents":
      return listEvents(authenticatedId());
    case "getEvent":
      return getEvent(authenticatedId(), text(args.eventId));
    case "createEvent": {
      const owner = authenticatedId();
      const requested = args.input as Parameters<typeof createEvent>[1];
      // Resolved against what this user may actually file into, so a crafted
      // project id cannot drop an event into someone else's folder.
      const saved = await createEvent(owner, {
        ...requested,
        projectId: await resolveOwnedProjectId(owner, requested?.projectId),
      });
      try {
        await dispatchWorkspaceWorkflowEvent(
          owner,
          "event_created",
          { id: saved.id, event: saved as unknown as RecordValue },
          `event_created:${saved.id}`,
        );
      } catch {
        // Workflow delivery must never make an event save fail.
      }
      return saved;
    }
    case "saveEvent": {
      const owner = authenticatedId();
      const saved = await saveEvent(
        owner,
        args.event as Parameters<typeof saveEvent>[1],
        args.options as Parameters<typeof saveEvent>[2],
      );
      try {
        const eventType = ["published", "on_sale", "sold_out"].includes(saved.status)
          ? "event_published"
          : "event_updated";
        await dispatchWorkspaceWorkflowEvent(
          owner,
          eventType,
          { id: saved.id, event: saved as unknown as RecordValue },
          `${eventType}:${saved.id}:${saved.updatedAt || Date.now()}`,
        );
      } catch {
        // Workflow delivery must never make an event save fail.
      }
      return saved;
    }
    case "listEventMeetingProviders":
      return listEventMeetingProviders(authenticatedId());
    case "createEventMeeting":
      return createEventMeeting(
        authenticatedId(),
        text(args.eventId),
        text(args.provider) as EventMeetingProvider,
      );
    case "syncEventMeeting":
      return syncEventMeeting(authenticatedId(), text(args.eventId));
    case "cancelEventMeeting":
      return cancelEventMeeting(authenticatedId(), text(args.eventId));
    case "listEventMailSettings":
      return listEventMailSettings(authenticatedId(), text(args.eventId));
    case "toggleEventMailSetting":
      return toggleEventMailSetting(authenticatedId(), text(args.eventId), text(args.key), args.enabled === true);
    case "setEventReminderHours":
      return setEventReminderHours(authenticatedId(), text(args.eventId), Number(args.hoursBefore || 24));
    case "deleteEvent":
      return deleteEvent(
        authenticatedId(),
        args.event as Parameters<typeof deleteEvent>[1],
      );
    case "listEventTicketTypes":
      return listEventTicketTypes(authenticatedId(), text(args.eventId));
    case "saveEventTicketType":
      return saveEventTicketType(
        authenticatedId(),
        args.ticket as Parameters<typeof saveEventTicketType>[1],
      );
    case "deleteEventTicketType":
      return deleteEventTicketType(
        authenticatedId(),
        text(args.eventId),
        text(args.ticketTypeId),
      );
    case "getEventTicketDesign":
      return getEventTicketDesign(
        authenticatedId(),
        text(args.eventId),
        args.ticketTypeId == null ? null : text(args.ticketTypeId),
      );
    case "listEventTicketDesigns":
      return listEventTicketDesigns(authenticatedId(), text(args.eventId));
    case "saveEventTicketDesign":
      return saveEventTicketDesign(
        authenticatedId(),
        args.design as Parameters<typeof saveEventTicketDesign>[1],
      );
    case "deleteEventTicketDesign":
      return deleteEventTicketDesign(
        authenticatedId(),
        text(args.eventId),
        args.ticketTypeId == null ? null : text(args.ticketTypeId),
      );
    case "listEventAttendees":
      return listEventAttendees(authenticatedId(), text(args.eventId));
    case "listCheckedInAttendees":
      return listCheckedInAttendees(
        authenticatedId(),
        text(args.eventId),
        Number(args.page || 1),
        Number(args.pageSize || 10),
      );
    case "issueComplimentaryTicket":
      return issueComplimentaryTicket(
        authenticatedId(),
        args.input as Parameters<typeof issueComplimentaryTicket>[1],
      );
    case "transferEventTicket":
      return transferEventTicket(
        authenticatedId(),
        args.attendee as Parameters<typeof transferEventTicket>[1],
        args.input as Parameters<typeof transferEventTicket>[2],
      );
    case "voidEventTicket":
      return voidEventTicket(
        authenticatedId(),
        text(args.attendeeId),
        text(args.reason),
      );
    case "listEventScans":
      return listEventScans(authenticatedId(), text(args.eventId));
    case "getPublicEvent":
      return getPublicEvent(
        text(args.slug),
        text(args.workspaceId) || undefined,
      );
    case "joinEventWaitlist":
      return joinEventWaitlist(args.input as Parameters<typeof joinEventWaitlist>[0]);
    case "promoteEventWaitlist":
      return promoteEventWaitlist(authenticatedId(), text(args.waitlistId));
    case "verifyPublicEventPassword":
      return verifyPublicEventPassword(
        text(args.slug),
        text(args.password),
        text(args.workspaceId) || undefined,
      );
    case "verifyPublicEventInvitation":
      return verifyPublicEventInvitation(
        text(args.slug),
        text(args.inviteToken),
        text(args.workspaceId) || undefined,
      );
    default:
      throw new EventsDataError("This events action is not available.", 404);
  }
};

export async function handleEventsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "POST") {
      json(response, 405, { error: "Use POST for events data." });
      return;
    }
    const body = await readBody(request);
    const operation = text(body.operation);
    const publicOperation =
      operation === "getPublicEvent" ||
      operation === "verifyPublicEventPassword" ||
      operation === "verifyPublicEventInvitation" ||
      operation === "joinEventWaitlist";
    const userId = publicOperation
      ? null
      : await authenticatedUserId(request);
    const value = await executeEventsOperation(
      operation,
      argsFrom(body),
      userId,
    );
    json(response, 200, { value });
  } catch (error) {
    if (error instanceof EventsDataError) {
      json(response, error.status, {
        code: error.code,
        error: error.message,
      });
      return;
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "unknown")
        : "unknown";
    console.error("[events-data] unexpected request failure", {
      code,
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "events_unavailable",
      error: "Events could not be updated. Please try again.",
    });
  }
}
