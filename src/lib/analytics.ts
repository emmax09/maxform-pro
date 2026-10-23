export type AnalyticsSummary = {
  currency: string;
  published_forms: number;
  responses: number;
  previous_responses: number;
  contacts: number;
  previous_contacts: number;
  event_registrations: number;
  previous_event_registrations: number;
  checked_ins: number;
  paid_orders: number;
  previous_paid_orders: number;
  payment_attempts: number;
  paid_revenue: number;
  previous_paid_revenue: number;
  other_currency_paid_orders: number;
  upcoming_events: number;
};

export type AnalyticsPoint = {
  date: string;
  responses: number;
  contacts: number;
  registrations: number;
  paid_orders: number;
  revenue: number;
};

export type AnalyticsCount = { label: string; value: number };

export type AnalyticsRevenueSource = AnalyticsCount & {
  orders: number;
  revenue: number;
};

export type AnalyticsTopForm = {
  id: string;
  title: string;
  responses: number;
  is_event_registration: boolean;
};

export type AnalyticsUpcomingEvent = {
  id: string;
  title: string;
  starts_at: string;
  capacity_total: number | null;
  registrations: number;
  checked_ins: number;
};

export type AnalyticsData = {
  generatedAt: string;
  rangeDays: number;
  summary: AnalyticsSummary;
  daily: AnalyticsPoint[];
  topForms: AnalyticsTopForm[];
  lifecycle: AnalyticsCount[];
  responseSources: AnalyticsCount[];
  countries: AnalyticsCount[];
  revenueSources: AnalyticsRevenueSource[];
  providers: AnalyticsCount[];
  upcomingEvents: AnalyticsUpcomingEvent[];
};

const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const count = (value: unknown): AnalyticsCount => {
  const row = (value || {}) as Record<string, unknown>;
  return { label: String(row.label || "Unknown"), value: asNumber(row.value) };
};

const mapAnalytics = (value: unknown): AnalyticsData => {
  const response = (value || {}) as Record<string, unknown>;
  const rawSummary = (response.summary || {}) as Record<string, unknown>;
  const summary = Object.fromEntries(
    Object.entries(rawSummary).map(([key, item]) =>
      key === "currency" ? [key, String(item || "USD")] : [key, asNumber(item)],
    ),
  ) as unknown as AnalyticsSummary;
  return {
    generatedAt: String(response.generatedAt || new Date().toISOString()),
    rangeDays: asNumber(response.rangeDays) || 30,
    summary: { currency: "USD", ...summary },
    daily: Array.isArray(response.daily)
      ? response.daily.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            date: String(row.date || ""),
            responses: asNumber(row.responses),
            contacts: asNumber(row.contacts),
            registrations: asNumber(row.registrations),
            paid_orders: asNumber(row.paid_orders),
            revenue: asNumber(row.revenue),
          };
        })
      : [],
    topForms: Array.isArray(response.topForms)
      ? response.topForms.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            id: String(row.id || ""),
            title: String(row.title || "Untitled form"),
            responses: asNumber(row.responses),
            is_event_registration: row.is_event_registration === true,
          };
        })
      : [],
    lifecycle: Array.isArray(response.lifecycle) ? response.lifecycle.map(count) : [],
    responseSources: Array.isArray(response.responseSources)
      ? response.responseSources.map(count)
      : [],
    countries: Array.isArray(response.countries) ? response.countries.map(count) : [],
    revenueSources: Array.isArray(response.revenueSources)
      ? response.revenueSources.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            label: String(row.label || "Unknown"),
            value: asNumber(row.revenue),
            revenue: asNumber(row.revenue),
            orders: asNumber(row.orders),
          };
        })
      : [],
    providers: Array.isArray(response.providers) ? response.providers.map(count) : [],
    upcomingEvents: Array.isArray(response.upcomingEvents)
      ? response.upcomingEvents.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            id: String(row.id || ""),
            title: String(row.title || "Untitled event"),
            starts_at: String(row.starts_at || ""),
            capacity_total:
              row.capacity_total == null ? null : asNumber(row.capacity_total),
            registrations: asNumber(row.registrations),
            checked_ins: asNumber(row.checked_ins),
          };
        })
      : [],
  };
};

export async function getWorkspaceAnalytics(range: number) {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`/api/analytics/data?range=${range}`, {
    headers: {
      Authorization: `Bearer ${token || ""}`,
      "Content-Type": "application/json",
    },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const result = value as { error?: unknown };
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Analytics could not be loaded right now.",
    );
  }
  return mapAnalytics(value);
}
