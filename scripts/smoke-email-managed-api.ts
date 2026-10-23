import { createServer } from "node:http";

import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";

import { handleEmailData } from "../server/email-data";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const userId = String(process.env.MAXFORM_EMAIL_SMOKE_USER_ID || "").trim();
if (!databaseUrl || jwtSecret.length < 32) {
  throw new Error("Managed API smoke requires DATABASE_URL and JWT_SECRET.");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("Managed API smoke requires an explicit MAXFORM_EMAIL_SMOKE_USER_ID. It will not select or modify an arbitrary workspace.");
}

const sql = neon(databaseUrl);
const users = await sql.query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [userId]);
if (!users[0]) throw new Error("MAXFORM_EMAIL_SMOKE_USER_ID does not identify an existing test workspace.");
const settingsSnapshot = await sql.query(
  `SELECT active_provider, active_provider_mode, managed_sending_enabled
   FROM email_settings WHERE user_id = $1 LIMIT 1`,
  [userId],
);
if (!settingsSnapshot[0]) throw new Error("The managed API smoke workspace must already have email settings initialized.");
const connectionSnapshot = await sql.query(
  `SELECT id, role, is_active FROM email_provider_connections WHERE user_id = $1`,
  [userId],
);
const identitySnapshot = await sql.query(
  `SELECT id, sending_mode, domain_verified, domain_verification_status,
          spf_verified, dkim_verified, dmarc_verified, status
   FROM email_identities WHERE user_id = $1`,
  [userId],
);

const token = await new SignJWT({ userId })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer("maxform")
  .setAudience("maxform-dashboard")
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(jwtSecret));

const server = createServer((request, response) => {
  void handleEmailData(request, response);
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Managed API smoke could not start its test server.");
const baseUrl = `http://127.0.0.1:${address.port}/api/email/data`;
const call = async (action: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}?action=${action}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.error || `Managed API smoke failed with HTTP ${response.status}.`));
  return result;
};

try {
  await call("disconnect-managed", { method: "POST", body: "{}" });
  await call("connect-managed", { method: "POST", body: "{}" });
  const connected = await call("workspace");
  const connectedProvider = connected.activeProvider as Record<string, unknown> | null;
  const connectedManagedConnection = connected.managedConnection as Record<string, unknown>;
  if (connected.managedSendingConfigured !== true
    || connectedManagedConnection?.status !== "connected"
    || connectedManagedConnection?.isActive !== false
    || connectedProvider?.mode === "managed") {
    throw new Error("Managed API smoke observed an automatic activation after connecting.");
  }

  await call("provider-role", {
    method: "POST",
    body: JSON.stringify({ provider: "resend", role: "active", mode: "managed" }),
  });
  const active = await call("workspace");
  const activeProvider = active.activeProvider as Record<string, unknown> | null;
  const managedConnection = active.managedConnection as Record<string, unknown>;
  if (active.managedSendingConfigured !== true || activeProvider?.mode !== "managed" || managedConnection?.status !== "connected" || managedConnection?.isActive !== true) {
    throw new Error("Managed API smoke did not observe the confirmed active state.");
  }

  await call("disconnect-managed", { method: "POST", body: "{}" });
  const disconnected = await call("workspace");
  const disconnectedProvider = disconnected.activeProvider as Record<string, unknown> | null;
  const disconnectedManagedConnection = disconnected.managedConnection as Record<string, unknown>;
  if (disconnectedProvider?.mode === "managed"
    || disconnectedManagedConnection?.status !== "disconnected"
    || disconnectedManagedConnection?.isActive !== false) {
    throw new Error("Managed API smoke did not clear the connected and active states after disconnect.");
  }

  console.log("Managed API smoke passed: connect inactive / activate / disconnect / restore");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const connection of connectionSnapshot) {
    await sql.query(
      `UPDATE email_provider_connections SET role = $1, is_active = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [connection.role, connection.is_active, connection.id, userId],
    );
  }
  for (const identity of identitySnapshot) {
    await sql.query(
      `UPDATE email_identities
       SET sending_mode = $1, domain_verified = $2,
           domain_verification_status = $3, spf_verified = $4,
           dkim_verified = $5, dmarc_verified = $6, status = $7,
           updated_at = NOW()
       WHERE id = $8 AND user_id = $9`,
      [identity.sending_mode, identity.domain_verified, identity.domain_verification_status,
        identity.spf_verified, identity.dkim_verified, identity.dmarc_verified,
        identity.status, identity.id, userId],
    );
  }
  const settings = settingsSnapshot[0];
  if (settings) {
    await sql.query(
      `UPDATE email_settings
       SET active_provider = $1, active_provider_mode = $2,
           managed_sending_enabled = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [settings.active_provider, settings.active_provider_mode,
        settings.managed_sending_enabled, userId],
    );
  }
  const [restoredSettings, restoredConnections, restoredIdentities] = await Promise.all([
    sql.query(`SELECT active_provider, active_provider_mode, managed_sending_enabled FROM email_settings WHERE user_id = $1 LIMIT 1`, [userId]),
    sql.query(`SELECT id, role, is_active FROM email_provider_connections WHERE user_id = $1 ORDER BY id`, [userId]),
    sql.query(
      `SELECT id, sending_mode, domain_verified, domain_verification_status,
              spf_verified, dkim_verified, dmarc_verified, status
       FROM email_identities WHERE user_id = $1 ORDER BY id`,
      [userId],
    ),
  ]);
  const stable = (value: unknown) => JSON.stringify(value);
  if (stable(restoredSettings) !== stable(settingsSnapshot)
    || stable(restoredConnections) !== stable([...connectionSnapshot].sort((a, b) => String(a.id).localeCompare(String(b.id))))
    || stable(restoredIdentities) !== stable([...identitySnapshot].sort((a, b) => String(a.id).localeCompare(String(b.id))))) {
    console.error("Managed API smoke could not restore the test workspace's original email state.");
    process.exitCode = 1;
  }
}
