import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";

import { configuredAppUrl } from "./app-url";

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const isStableHttpsOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      !url.hostname.endsWith(".trycloudflare.com") &&
      !url.hostname.endsWith(".ngrok-free.app") &&
      !url.hostname.endsWith(".ngrok.io")
    );
  } catch {
    return false;
  }
};

const databaseReady = async () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return false;
  try {
    const sql = neon(url);
    const rows = await sql`SELECT 1 AS ok`;
    return Number(rows[0]?.ok || 0) === 1;
  } catch {
    return false;
  }
};

export const handleHealth = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const url = new URL(request.url || "/api/health", "http://localhost");
  const mode = url.searchParams.get("mode") || "ready";
  if (request.method !== "GET") {
    json(response, 405, { status: "error", error: "Method not allowed." });
    return;
  }
  if (mode === "live") {
    json(response, 200, {
      status: "ok",
      service: "maxform",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const production = process.env.NODE_ENV === "production";
  const origin = configuredAppUrl();
  const checks = {
    database: await databaseReady(),
    encryption:
      String(
        process.env.PAYMENT_ENCRYPTION_KEY ||
          process.env.INTEGRATION_ENCRYPTION_KEY ||
          "",
      ).length >= 24,
    jwt: String(process.env.JWT_SECRET || "").length >= 32,
    origin: production ? isStableHttpsOrigin(origin) : Boolean(origin),
  };
  const ready = Object.values(checks).every(Boolean);
  json(response, ready ? 200 : 503, {
    status: ready ? "ready" : "not_ready",
    service: "maxform",
    checks,
    timestamp: new Date().toISOString(),
  });
};
