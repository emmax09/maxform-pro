export const RESERVED_MANAGED_SENDER_PREFIXES = new Set([
  "admin",
  "root",
  "system",
  "support",
  "security",
  "noreply",
  "no-reply",
]);

/**
 * Convert a workspace name into the initial managed local part. Names that
 * contain punctuation keep word boundaries; ordinary names stay compact so
 * "Test Space" becomes "testspace", matching the managed-sender convention.
 */
export const normalizeManagedSenderPrefix = (value: unknown) => {
  const source = String(value ?? "").trim().toLowerCase();
  const hasUnsupportedPunctuation = /[^a-z0-9\s_-]/i.test(source);
  const cleaned = source
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, (match) => match.includes(" ") && hasUnsupportedPunctuation ? "-" : "")
    .replace(/-+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 63);
  return cleaned;
};

export const managedSenderPrefixError = (value: unknown) => {
  const prefix = String(value ?? "").trim();
  if (!prefix) return "Enter a sender prefix.";
  if (prefix !== prefix.toLowerCase()) return "Use lowercase letters only for the sender prefix.";
  if (/\s/.test(prefix)) return "The sender prefix cannot contain spaces.";
  if (!/^[a-z0-9_-]+$/.test(prefix)) return "Use lowercase letters, numbers, hyphens, or underscores only.";
  if (prefix.length > 63) return "The sender prefix must be 63 characters or fewer.";
  if (RESERVED_MANAGED_SENDER_PREFIXES.has(prefix)) return "That sender prefix is reserved. Choose another one.";
  return "";
};

export const managedSenderEmail = (prefix: string, domain: string) =>
  `${prefix}@${domain.trim().toLowerCase()}`;

export const resolveStoredCustomSenderEmail = (
  storedCustomSender: unknown,
  legacySender: unknown,
  managedSenders: unknown[],
) => {
  const stored = String(storedCustomSender ?? "").trim().toLowerCase();
  if (stored) return stored;
  const legacy = String(legacySender ?? "").trim().toLowerCase();
  const managed = new Set(managedSenders.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean));
  return managed.has(legacy) ? "" : legacy;
};
