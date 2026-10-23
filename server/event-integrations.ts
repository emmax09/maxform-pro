import { query } from "../src/lib/db";
import {
  cancelSchedulingMeeting,
  createSchedulingMeeting,
  updateSchedulingMeeting,
  type EventMeetingProvider,
} from "./scheduling-oauth";

type DatabaseRow = Record<string, unknown>;

const text = (value: unknown) => value == null ? "" : String(value);
const json = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

const meetingProviderMeta: Record<EventMeetingProvider, { label: string; setupProviderKey: string; calendar: string }> = {
  google_meet: { label: "Google Meet", setupProviderKey: "google_workspace", calendar: "Google Calendar is updated automatically." },
  teams: { label: "Microsoft Teams", setupProviderKey: "microsoft_365", calendar: "Teams calendar sync is used when the connected account grants calendar access." },
  zoom: { label: "Zoom", setupProviderKey: "zoom", calendar: "The meeting date and time are sent to Zoom." },
};

export type EventMeetingProviderOption = {
  key: EventMeetingProvider;
  label: string;
  setupProviderKey: string;
  connected: boolean;
  accountLabel: string;
  connectedProvider: string;
  calendarDescription: string;
};

export const listEventMeetingProviders = async (userId: string): Promise<EventMeetingProviderOption[]> => {
  const rows = await query(`
    SELECT provider, account_label, status, health_ok
    FROM scheduling_tool_connections
    WHERE user_id = $1 AND provider IN ('google_meet', 'google_calendar', 'teams', 'zoom')
    ORDER BY updated_at DESC
  `, [userId]);
  const connected = new Map<string, { accountLabel: string; status: string }>();
  for (const row of rows.rows as DatabaseRow[]) {
    const provider = text(row.provider);
    if (!connected.has(provider)) connected.set(provider, { accountLabel: text(row.account_label), status: text(row.status) });
  }
  return (Object.keys(meetingProviderMeta) as EventMeetingProvider[]).map((key) => {
    const candidates = key === "google_meet" ? ["google_meet", "google_calendar"] : [key];
    const account = candidates.map((candidate) => connected.get(candidate)).find((item) => item?.status === "connected") || null;
    const source = candidates.map((candidate) => connected.get(candidate)).find(Boolean);
    return {
      key,
      label: meetingProviderMeta[key].label,
      setupProviderKey: meetingProviderMeta[key].setupProviderKey,
      connected: Boolean(account),
      accountLabel: account?.accountLabel || source?.accountLabel || "Not connected",
      connectedProvider: account ? candidates.find((candidate) => connected.get(candidate) === account) || key : "",
      calendarDescription: meetingProviderMeta[key].calendar,
    };
  });
};

const timeParts = (value: unknown) => {
  const normalized = text(value).slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : "";
};

const offsetFor = (timestamp: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  return localAsUtc - timestamp;
};

const zonedToUtc = (date: string, time: string, timezone: string) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid event timezone before creating a meeting."); }
  const localAsUtc = Date.parse(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(localAsUtc)) throw new Error("Add a valid event date before creating a meeting.");
  let guess = localAsUtc;
  for (let index = 0; index < 4; index += 1) guess = localAsUtc - offsetFor(guess, timezone);
  return new Date(guess);
};

const eventSchedule = (row: DatabaseRow) => {
  const scheduleType = text(row.schedule_type) || "single_day";
  const rangeMode = text(row.range_schedule_mode) || "continuous";
  const daily = json<Array<{ date?: string; startTime?: string; endTime?: string; start_time?: string; end_time?: string }>>(row.daily_schedule, []);
  const firstDaily = daily.find((item) => text(item.date)) || {};
  const lastDaily = [...daily].reverse().find((item) => text(item.date)) || {};
  const startDate = scheduleType === "date_range" ? text(row.range_start_date) : text(row.event_date);
  const endDate = scheduleType === "date_range" ? text(row.range_end_date) : startDate;
  const startTime = rangeMode === "daily" && firstDaily.date ? timeParts(firstDaily.startTime || firstDaily.start_time) : timeParts(row.schedule_start_time);
  const endTime = rangeMode === "daily" && lastDaily.date ? timeParts(lastDaily.endTime || lastDaily.end_time) : timeParts(row.schedule_end_time);
  if (!startDate || !startTime) throw new Error("Add the event date and start time before creating a meeting link.");
  const startsAt = zonedToUtc(startDate, startTime, text(row.timezone) || "UTC");
  const endsAt = endDate && endTime ? zonedToUtc(endDate, endTime, text(row.timezone) || "UTC") : new Date(startsAt.getTime() + 60 * 60 * 1000);
  if (endsAt.getTime() <= startsAt.getTime()) throw new Error("The event end must be after its start before creating a meeting link.");
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
};

export const createEventMeeting = async (
  userId: string,
  eventId: string,
  provider: EventMeetingProvider,
  previousIntegration?: DatabaseRow | null,
) => {
  const meta = meetingProviderMeta[provider];
  if (!meta) throw new Error("That meeting provider is not available.");
  const result = await query(`
    SELECT id, title, description, location_type, event_date, range_start_date,
      range_end_date, range_schedule_mode, schedule_start_time, schedule_end_time,
      daily_schedule, timezone, online_url, settings
    FROM events
    WHERE id = $1 AND created_by = $2
    LIMIT 1
  `, [eventId, userId]);
  const event = result.rows[0] as DatabaseRow | undefined;
  if (!event) throw new Error("Event was not found.");
  if (!["online", "hybrid"].includes(text(event.location_type))) throw new Error("Choose Online or Hybrid event type before creating a meeting link.");
  const settings = json<Record<string, unknown>>(event.settings, {});
  const storedCurrent = settings.meetingIntegration && typeof settings.meetingIntegration === "object"
    ? settings.meetingIntegration as DatabaseRow
    : {};
  // A live event can be autosaved while the editor is holding a freshly
  // selected provider with no link yet. Reuse the previous provider record in
  // that same-provider case so an autosave never creates a duplicate meeting.
  const current = previousIntegration &&
    text(previousIntegration.provider) === provider &&
    text(storedCurrent.provider) === provider &&
    !text(storedCurrent.joinUrl) &&
    !text(storedCurrent.externalMeetingId) &&
    !text(storedCurrent.calendarEventId)
    ? previousIntegration
    : storedCurrent;
  const schedule = eventSchedule(event);
  const scheduleFingerprint = JSON.stringify({
    ...schedule,
    title: text(event.title),
    description: text(event.description),
    timezone: text(event.timezone) || "UTC",
  });
  if (text(current.provider) === provider && text(current.joinUrl) && text(current.scheduleFingerprint) === scheduleFingerprint) return {
    eventId,
    provider,
    reused: true,
    joinUrl: text(current.joinUrl),
    hostUrl: text(current.hostUrl || current.joinUrl),
    externalMeetingId: text(current.externalMeetingId),
    calendarEventId: text(current.calendarEventId),
    calendarSynced: current.calendarSynced === true,
  };
  const hasExternalRecord = Boolean(text(current.externalMeetingId) || text(current.calendarEventId));
  if (text(current.provider) === provider && text(current.joinUrl) && hasExternalRecord) {
    const updated = await updateSchedulingMeeting(userId, provider, {
      externalMeetingId: text(current.externalMeetingId),
      calendarEventId: text(current.calendarEventId),
    }, {
      title: text(event.title) || "MaxForm event",
      description: text(event.description),
      ...schedule,
      timezone: text(event.timezone) || "UTC",
    });
    const nextIntegration = {
      ...current,
      provider,
      providerLabel: meta.label,
      scheduleFingerprint,
      calendarSynced: updated.calendarSynced ?? current.calendarSynced === true,
      updatedAt: new Date().toISOString(),
    };
    const nextSettings = {
      ...settings,
      meetingIntegration: nextIntegration,
      meetingSync: {
        status: "synced",
        provider,
        lastSyncedAt: new Date().toISOString(),
        lastError: "",
      },
    };
    await query(`UPDATE events SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by = $3`, [JSON.stringify(nextSettings), eventId, userId]);
    return { eventId, ...nextIntegration, reused: true, updated: true };
  }
  const replacementSource = previousIntegration && text(previousIntegration.provider) !== provider
    ? previousIntegration
    : current;
  const previousProvider = text(replacementSource.provider) as EventMeetingProvider;
  const previousIds = {
    externalMeetingId: text(replacementSource.externalMeetingId),
    calendarEventId: text(replacementSource.calendarEventId),
  };
  const meeting = await createSchedulingMeeting(userId, provider, {
    title: text(event.title) || "MaxForm event",
    description: text(event.description),
    ...schedule,
    timezone: text(event.timezone) || "UTC",
  });
  const nextIntegration = {
    provider: meeting.provider,
    providerLabel: meta.label,
    connectionId: meeting.connectionId,
    externalMeetingId: meeting.externalMeetingId,
    calendarEventId: meeting.calendarEventId,
    joinUrl: meeting.joinUrl,
    hostUrl: meeting.hostUrl,
    calendarSynced: meeting.calendarSynced,
    scheduleFingerprint,
    updatedAt: new Date().toISOString(),
  };
  const nextSettings = {
    ...settings,
    meetingIntegration: {
      ...nextIntegration,
      replacedProvider: previousProvider && previousProvider !== provider ? previousProvider : undefined,
      replacedExternalMeetingId: previousProvider && previousProvider !== provider ? previousIds.externalMeetingId : undefined,
      replacedCalendarEventId: previousProvider && previousProvider !== provider ? previousIds.calendarEventId : undefined,
    },
  };
  await query(`UPDATE events SET online_url = $1, settings = $2::jsonb, updated_at = NOW() WHERE id = $3 AND created_by = $4`, [meeting.joinUrl, JSON.stringify(nextSettings), eventId, userId]);
  let replacementSync = { status: "synced", provider, lastSyncedAt: new Date().toISOString(), lastError: "" };
  if (previousProvider && previousProvider !== provider && meetingProviderMeta[previousProvider] && (previousIds.externalMeetingId || previousIds.calendarEventId)) {
    try {
      await cancelSchedulingMeeting(userId, previousProvider, previousIds);
    } catch (error) {
      replacementSync = {
        status: "reconnect_required",
        provider,
        lastSyncedAt: new Date().toISOString(),
        lastError: `The previous ${meetingProviderMeta[previousProvider].label} meeting could not be cancelled: ${error instanceof Error ? error.message.slice(0, 220) : "provider error"}`,
      };
    }
    await query(`UPDATE events SET settings = jsonb_set(settings, '{meetingSync}', $1::jsonb, true), updated_at = NOW() WHERE id = $2 AND created_by = $3`, [JSON.stringify(replacementSync), eventId, userId]);
  }
  return { eventId, ...nextIntegration, reused: false };
};

export const syncEventMeeting = async (userId: string, eventId: string) => {
  const result = await query(`SELECT id, title, description, location_type, event_date, range_start_date, range_end_date, range_schedule_mode, schedule_start_time, schedule_end_time, daily_schedule, timezone, settings FROM events WHERE id = $1 AND created_by = $2 LIMIT 1`, [eventId, userId]);
  const event = result.rows[0] as DatabaseRow | undefined;
  if (!event) throw new Error("Event was not found.");
  const settings = json<Record<string, unknown>>(event.settings, {});
  const current = settings.meetingIntegration && typeof settings.meetingIntegration === "object" ? settings.meetingIntegration as DatabaseRow : {};
  const provider = text(current.provider) as EventMeetingProvider;
  if (!meetingProviderMeta[provider] || !text(current.joinUrl)) throw new Error("This event does not have an automatic meeting to sync.");
  const schedule = eventSchedule(event);
  await updateSchedulingMeeting(userId, provider, { externalMeetingId: text(current.externalMeetingId), calendarEventId: text(current.calendarEventId) }, { title: text(event.title) || "MaxForm event", description: text(event.description), ...schedule, timezone: text(event.timezone) || "UTC" });
  const nextSettings = { ...settings, meetingIntegration: { ...current, scheduleFingerprint: JSON.stringify({ ...schedule, title: text(event.title), description: text(event.description), timezone: text(event.timezone) || "UTC" }), updatedAt: new Date().toISOString() }, meetingSync: { status: "synced", provider, lastSyncedAt: new Date().toISOString(), lastError: "" } };
  await query(`UPDATE events SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by = $3`, [JSON.stringify(nextSettings), eventId, userId]);
  return { eventId, provider, synced: true };
};

export const cancelEventMeeting = async (
  userId: string,
  eventId: string,
  previousIntegration?: DatabaseRow | null,
) => {
  const result = await query(`SELECT settings FROM events WHERE id = $1 AND created_by = $2 LIMIT 1`, [eventId, userId]);
  const event = result.rows[0] as DatabaseRow | undefined;
  if (!event) throw new Error("Event was not found.");
  const settings = json<Record<string, unknown>>(event.settings, {});
  const current = previousIntegration && typeof previousIntegration === "object"
    ? previousIntegration
    : settings.meetingIntegration && typeof settings.meetingIntegration === "object"
      ? settings.meetingIntegration as DatabaseRow
      : {};
  const provider = text(current.provider) as EventMeetingProvider;
  if (!meetingProviderMeta[provider]) return { eventId, cancelled: false, externalCancelled: false };
  let externalCancelled = true;
  let lastError = "";
  try {
    await cancelSchedulingMeeting(userId, provider, { externalMeetingId: text(current.externalMeetingId), calendarEventId: text(current.calendarEventId) });
  } catch (error) {
    externalCancelled = false;
    lastError = error instanceof Error ? error.message.slice(0, 300) : "The provider could not cancel the meeting.";
  }
  const now = new Date().toISOString();
  const nextSettings = {
    ...settings,
    meetingIntegration: {
      ...current,
      status: externalCancelled ? "cancelled" : "cancellation_pending",
      joinUrl: externalCancelled ? "" : text(current.joinUrl),
      hostUrl: externalCancelled ? "" : text(current.hostUrl),
      updatedAt: now,
    },
    meetingSync: {
      status: externalCancelled ? "cancelled" : "reconnect_required",
      provider,
      lastSyncedAt: now,
      lastError,
    },
  };
  await query(`UPDATE events SET online_url = $1, settings = $2::jsonb, updated_at = NOW() WHERE id = $3 AND created_by = $4`, [externalCancelled ? "" : text(current.joinUrl), JSON.stringify(nextSettings), eventId, userId]);
  return { eventId, cancelled: true, externalCancelled, onlineUrl: externalCancelled ? "" : text(current.joinUrl), settings: nextSettings };
};
