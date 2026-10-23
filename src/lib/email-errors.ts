type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

const codeMessages: Record<string, string> = {
  authentication_required: "Your session has expired. Sign in again to continue.",
  analytics_unauthorized: "Your delivery-event endpoint is no longer valid. Generate a new endpoint and try again.",
  custom_domain_unverified: "This sending domain is not verified yet. Publish the DNS records, then check verification again.",
  domain_management_required: "This provider key cannot manage sending domains. Use a key with domain-management permission, then try again.",
  domain_management_unsupported: "This provider does not support domain management here. Verify the domain with the provider, then import it again.",
  domain_not_found: "We could not find that sending domain. Add it again and try once more.",
  email_data_error: "Email settings are temporarily unavailable. Please try again shortly.",
  email_rate_limited: "Your workspace has reached its email sending limit. Please try again later.",
  email_unavailable: "Email settings are temporarily unavailable. Please try again shortly.",
  encryption_unavailable: "Secure email connections are temporarily unavailable. Please try again shortly.",
  identity_limit: "This workspace already has a sender identity. Edit the existing identity instead.",
  inbound_unauthorized: "Your inbound email endpoint is no longer valid. Generate a new endpoint and try again.",
  invalid_inbound_message: "The inbound email was incomplete and could not be saved.",
  invalid_domain: "Enter a valid sending domain.",
  invalid_email_event: "That delivery event could not be processed.",
  invalid_provider_credentials: "The provider details are incomplete or invalid. Check the connection fields and try again.",
  invalid_sender_identity: "Check the From address and Reply-to address, then try again.",
  invalid_sender_prefix: "Use a lowercase sender prefix with letters, numbers, hyphens, or underscores.",
  managed_sender_domain_unverified: "MaxForm Managed Sending is not ready because its sending domain is not verified yet.",
  managed_sender_not_connected: "Connect Managed Sending before selecting it as the active provider.",
  managed_sender_unavailable: "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.",
  managed_sender_verification_failed: "MaxForm Managed Sending could not be verified right now. Please try again later or contact your workspace administrator.",
  provider_credentials_invalid: "The provider credentials were rejected. Check them and reconnect the provider.",
  provider_network_error: "We could not reach the email provider. Check your connection and try again.",
  provider_not_connected: "Connect this provider before continuing.",
  provider_required: "Choose and activate an email provider before continuing.",
  provider_request_failed: "The email provider could not complete that request. Please try again shortly.",
  provider_sandbox_restriction: "This provider account is still in testing mode. Verify a sending domain or use an approved test address.",
  recipient_suppressed: "This recipient is suppressed because of a previous unsubscribe, bounce, or complaint.",
  sender_domain_unverified: "This sending domain is not verified yet. Publish the DNS records, then check verification again.",
};

const clean = (value: unknown, max = 320) => Array.from(String(value ?? "")).filter((character) => {
  const code = character.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}).join("").replace(/\s+/g, " ").trim().slice(0, max);

const technicalOrSensitive = (value: string) => /(?:MAXFORM_[A-Z0-9_]+|EMAIL_ENCRYPTION_KEY|DATABASE_URL|SUPABASE_|INTEGRATION_ENCRYPTION_KEY|PAYMENT_ENCRYPTION_KEY|\b(?:api[_ -]?key|server token|secret(?: access)? key|password|authorization|bearer)\b|https?:\/\/|node_modules|\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b|\bat\s+.+\(.*:\d+:\d+\)|\{\s*["']?\w+["']?\s*:|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(value);

const knownUserMessage = (value: string) => /^(?:A |An |Check |Choose |Connect |Custom |Email |Enter |Inbound |Managed |MaxForm |No |Only |Provider |Reconnect |Secure |The |This |Use |We |Your )/i.test(value);

const codeFrom = (error: unknown) => {
  if (!error || typeof error !== "object") return "";
  return clean((error as ErrorLike).code, 80).toLowerCase();
};

const messageFrom = (error: unknown) => {
  if (typeof error === "string") return clean(error);
  if (error && typeof error === "object") return clean((error as ErrorLike).message);
  return "";
};

/**
 * Converts email request failures into short, actionable dashboard copy.
 * Unknown provider/network text is intentionally not shown to the user.
 */
export const formatEmailError = (
  error: unknown,
  fallback = "Email settings could not be updated. Please try again.",
) => {
  const code = codeFrom(error);
  const message = messageFrom(error);
  if (codeMessages[code]) return codeMessages[code];

  const searchable = `${code} ${message}`.toLowerCase();
  if (/failed to fetch|network|timed out|timeout|could not reach|temporarily unavailable/.test(searchable)) {
    return "We could not reach the email service. Check your connection and try again.";
  }
  if (/domain.*(?:not verified|unverified)|verify.*domain|sender domain|domain verification/.test(searchable)) {
    return "This sending domain is not verified yet. Publish the DNS records, then check verification again.";
  }
  if (/api key|server token|secret access key|provider credentials|credentials were rejected|invalid credentials/.test(searchable)) {
    return "The provider details could not be verified. Check the connection fields and try again.";
  }
  if (/managed sending.*(?:unavailable|not configured|could not)|managed_sender/.test(searchable)) {
    return "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.";
  }
  if (/permission|forbidden|access denied/.test(searchable)) {
    return "This provider connection does not have permission for that action. Update its access scope and try again.";
  }

  if (message && message.length <= 220 && !technicalOrSensitive(message) && knownUserMessage(message)) {
    return message;
  }
  return fallback;
};
