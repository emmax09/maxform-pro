const configured = String(
  process.env.FORMS_HEALTH_URL || process.env.PUBLIC_APP_URL || "",
).trim();

if (!configured) {
  throw new Error("Set FORMS_HEALTH_URL or PUBLIC_APP_URL before checking health.");
}

const url = new URL(configured);
if (!/^https?:$/.test(url.protocol)) {
  throw new Error("FORMS_HEALTH_URL must use HTTP(S).");
}
url.pathname = "/api/health";
url.search = "?mode=ready";

const response = await fetch(url, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(10_000),
});
const payload = (await response.json()) as {
  status?: string;
  checks?: Record<string, boolean>;
};

if (!response.ok || payload.status !== "ready") {
  throw new Error(
    `Forms health check failed (${response.status}): ${JSON.stringify(payload)}`,
  );
}

const failed = Object.entries(payload.checks || {})
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);
if (failed.length) {
  throw new Error(`Forms readiness checks failed: ${failed.join(", ")}`);
}

console.log("Forms health check passed", {
  url: `${url.origin}${url.pathname}`,
  checks: payload.checks,
});
