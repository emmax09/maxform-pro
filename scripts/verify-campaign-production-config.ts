import { createCampaignDatabase } from "../server/campaign-database";

const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CAMPAIGN_TRACKING_SECRET",
  "CRON_SECRET",
  "CAMPAIGN_ANALYTICS_WORKER_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_HOST",
  "UPSTASH_REDIS_PASSWORD",
] as const;

let failures = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
};

check(process.env.NODE_ENV === "production", "NODE_ENV is production");
check(
  String(process.env.ALLOW_DEV_CAMPAIGN_SEND || "").toLowerCase() !== "true",
  "development campaign sending is disabled",
);

for (const name of required) {
  const value = String(process.env[name] || "").trim();
  check(value.length >= (name.includes("SECRET") ? 16 : 1), `${name} is configured`);
}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (databaseUrl) {
  try {
    const rows = await createCampaignDatabase(databaseUrl).query(
      "SELECT 1 AS ok",
    );
    check(Number((rows[0] as { ok?: unknown } | undefined)?.ok) === 1, "DATABASE_URL accepts a live query");
  } catch (error) {
    check(false, `DATABASE_URL accepts a live query (${error instanceof Error ? error.name : "connection error"})`);
  }
}

const redisPort = Number(process.env.UPSTASH_REDIS_PORT || 0);
check(Number.isInteger(redisPort) && redisPort > 0, "UPSTASH_REDIS_PORT is a valid TCP port");
check(
  String(process.env.QUEUE_REQUIRED || "").toLowerCase() === "true",
  "QUEUE_REQUIRED fails closed in production",
);

const origin = String(process.env.PUBLIC_APP_URL || "").trim();
let parsedOrigin: URL | null = null;
try {
  parsedOrigin = new URL(origin);
} catch {
  parsedOrigin = null;
}
const hostname = parsedOrigin?.hostname.toLowerCase() || "";
const temporaryHost = /(?:ngrok|loca\.lt|trycloudflare|localtunnel)/i.test(hostname);
check(Boolean(parsedOrigin && parsedOrigin.protocol === "https:"), "PUBLIC_APP_URL uses HTTPS");
check(Boolean(hostname && !temporaryHost && hostname !== "localhost" && hostname !== "127.0.0.1"), "PUBLIC_APP_URL is a stable deployment origin");

if (failures) {
  console.error(`\nCampaign production configuration failed: ${failures} check(s).`);
  process.exitCode = 1;
} else {
  console.log("\nCampaign production configuration passed.");
}
