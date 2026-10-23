/**
 * Scheduling integrations client.
 *
 * Kept separate from the appointments workspace client because these calls talk
 * to providers rather than to our own records: they are slower, they fail for
 * reasons the user has to act on, and their errors are worth showing verbatim.
 */
import type { SchedulingToolProvider } from "@/lib/appointments";

const token = () => localStorage.getItem("access_token") || "";

const headers = () => ({
  "Content-Type": "application/json",
  ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
});

export class SchedulingIntegrationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SchedulingIntegrationError";
  }
}

export type SchedulingProviderStatus = {
  configured: boolean;
  authType: "oauth" | "api_key";
  label: string;
  category: "calendar" | "video" | "scheduling";
  setupUrl: string;
  scopes: string[];
};

const request = async <T>(action: string, init: RequestInit = {}) => {
  const response = await fetch(`/api/appointments/integrations?action=${action}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });

  let parsed: unknown;
  let readable = true;
  try {
    parsed = await response.json();
  } catch {
    readable = false;
  }
  const value = (readable && parsed && typeof parsed === "object" ? parsed : {}) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new SchedulingIntegrationError(
      value.error || "That integration request could not be completed.",
      response.status,
    );
  }
  if (!readable) {
    throw new SchedulingIntegrationError(
      "The server returned an unexpected response. Please try again.",
      response.status,
    );
  }
  return value;
};

/** Which providers this deployment actually has credentials for. */
export const getSchedulingProviders = () =>
  request<{
    providers: Record<SchedulingToolProvider, SchedulingProviderStatus>;
    callbackUrl: string;
  }>("providers");

/** Returns the provider URL the popup should navigate to. */
export const prepareSchedulingConnection = async (provider: SchedulingToolProvider) => {
  const result = await request<{ authorizationUrl: string }>("prepare", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
  if (!result.authorizationUrl) {
    throw new SchedulingIntegrationError("That provider is not available right now.");
  }
  return result.authorizationUrl;
};

/** Cal.com API keys and Calendly personal access tokens. */
export const connectSchedulingKey = (provider: SchedulingToolProvider, apiKey: string) =>
  request<{ connected: boolean; accountLabel: string }>("connect-key", {
    method: "POST",
    body: JSON.stringify({ provider, apiKey }),
  });

/** Calls the provider with the stored token and records the result. */
export const testSchedulingConnection = (provider: SchedulingToolProvider) =>
  request<{ ok: boolean; error?: string }>("test", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });

export const disconnectSchedulingTool = (provider: SchedulingToolProvider) =>
  request<{ disconnected: boolean; revoked: boolean }>("disconnect", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });

export const schedulingProvidersQueryKey = ["appointments", "scheduling-providers"];
