import { QueryClient, type QueryKey } from "@tanstack/react-query";

export const SERVER_STATE_STALE_TIME = 5 * 60 * 1000;
export const SERVER_STATE_GC_TIME = 30 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: SERVER_STATE_STALE_TIME,
      gcTime: SERVER_STATE_GC_TIME,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const compact = (value: unknown) =>
  value == null || value === "" ? "__none" : String(value);

export const queryKeys = {
  contacts: {
    workspace: (userId?: string): QueryKey => [
      "contacts",
      "workspace",
      compact(userId),
    ],
  },
  events: {
    detail: (userId?: string, eventId?: string): QueryKey => [
      "events",
      "detail",
      compact(userId),
      compact(eventId),
    ],
    workspace: (userId?: string, timezone?: string): QueryKey => [
      "events",
      "workspace",
      "ticket-pricing-v2",
      compact(userId),
      compact(timezone),
    ],
  },
  forms: {
    bootstrap: (userId?: string): QueryKey => [
      "forms",
      "bootstrap",
      compact(userId),
    ],
    context: (userId?: string, formId?: string): QueryKey => [
      "forms",
      "context",
      compact(userId),
      compact(formId),
    ],
    hydrated: (userId?: string): QueryKey => [
      "forms",
      "hydrated",
      compact(userId),
    ],
  },
  payments: {
    availability: (): QueryKey => ["payments", "availability"],
    workspace: (userId?: string): QueryKey => [
      "payments",
      "workspace",
      compact(userId),
    ],
  },
  workspace: {
    regional: (userId?: string, country?: string | null): QueryKey => [
      "workspace",
      "regional",
      compact(userId),
      compact(country),
    ],
    settings: (userId?: string): QueryKey => [
      "workspace",
      "settings",
      compact(userId),
    ],
  },
};
