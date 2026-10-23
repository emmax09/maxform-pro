/**
 * The one configured public origin for this MaxForm deployment.
 *
 * PUBLIC_APP_URL is the canonical setting. The legacy names remain as a
 * server-side fallback so an existing deployment can migrate without
 * breaking callbacks; they are intentionally not documented in .env.example.
 */
export const configuredAppUrl = () => {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    process.env.AUTH_OAUTH_BASE_URL,
    process.env.INTEGRATION_OAUTH_BASE_URL,
    process.env.PAYMENT_PROVIDER_BASE_URL,
    process.env.APP_BASE_URL,
  ];

  return candidates
    .map((value) => String(value || "").trim().replace(/\/+$/, ""))
    .find(Boolean) || "";
};
