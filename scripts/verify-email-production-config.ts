import { createCampaignDatabase } from "../server/campaign-database";

const value = (name: string) => String(process.env[name] || "").trim();
let failures = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
};

check(value("NODE_ENV") === "production", "NODE_ENV is production");
check(value("ALLOW_DEV_CAMPAIGN_SEND").toLowerCase() !== "true", "development campaign sending is disabled");
check(value("DATABASE_URL"), "DATABASE_URL is configured");
check(value("JWT_SECRET").length >= 16, "JWT_SECRET is configured");
check(value("EMAIL_ENCRYPTION_KEY").length >= 24, "EMAIL_ENCRYPTION_KEY is configured");
check(value("EMAIL_WORKER_SECRET").length >= 16 || value("CRON_SECRET").length >= 16, "email worker authentication secret is configured");
check(value("QUEUE_REQUIRED").toLowerCase() === "true", "QUEUE_REQUIRED fails closed");

const origin = value("PUBLIC_APP_URL");
let parsedOrigin: URL | null = null;
try { parsedOrigin = new URL(origin); } catch { parsedOrigin = null; }
const hostname = parsedOrigin?.hostname.toLowerCase() || "";
check(Boolean(parsedOrigin && parsedOrigin.protocol === "https:"), "PUBLIC_APP_URL uses HTTPS");
check(Boolean(hostname && hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1" && !/(?:ngrok|loca\.lt|trycloudflare|localtunnel)/i.test(hostname)), "PUBLIC_APP_URL is a stable origin");

const redisUrl = value("REDIS_URL");
let redisUrlValid = false;
if (redisUrl) {
  try {
    const parsed = new URL(redisUrl);
    redisUrlValid = ["redis:", "rediss:"].includes(parsed.protocol) && Boolean(parsed.hostname && parsed.password);
    check(redisUrlValid, "REDIS_URL is a valid authenticated Redis TCP URL");
    check(parsed.username.toLowerCase() !== "default_ro" && parsed.username.toLowerCase() !== "readonly", "Redis credential is not read-only");
  } catch {
    check(false, "REDIS_URL is a valid authenticated Redis TCP URL");
  }
} else {
  const port = Number(value("UPSTASH_REDIS_PORT") || 0);
  const splitValid = Boolean(value("UPSTASH_REDIS_HOST") && value("UPSTASH_REDIS_PASSWORD") && Number.isInteger(port) && port > 0);
  check(splitValid, "split Redis TCP credentials are configured");
  check(value("UPSTASH_REDIS_USERNAME").toLowerCase() !== "default_ro" && value("UPSTASH_REDIS_USERNAME").toLowerCase() !== "readonly", "Redis credential is not read-only");
}
check(Boolean(redisUrl || value("UPSTASH_REDIS_HOST")), "BullMQ has a Redis TCP transport");

if (value("DATABASE_URL")) {
  try {
    const rows = await createCampaignDatabase(value("DATABASE_URL")).query("SELECT 1 AS ok");
    check(Number((rows[0] as { ok?: unknown } | undefined)?.ok) === 1, "DATABASE_URL accepts a live query");
  } catch (error) {
    check(false, `DATABASE_URL accepts a live query (${error instanceof Error ? error.name : "connection error"})`);
  }
}

if (failures) {
  console.error(`\nEmail production configuration failed: ${failures} check(s).`);
  process.exitCode = 1;
} else {
  console.log("\nEmail production configuration passed.");
}
