/** Providers that are intentionally shown in the directory before their
 * production adapters are released. Keep this list server-side so a disabled
 * card cannot be bypassed by calling an API route directly. */
export const COMING_SOON_PROVIDER_KEYS = new Set([
  "box",
  "zapier",
] as const);

export const isComingSoonProvider = (providerKey: string) =>
  COMING_SOON_PROVIDER_KEYS.has(providerKey as never);
