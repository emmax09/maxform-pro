import { neon } from "@neondatabase/serverless";

import {
  checkEmailProviderHealth,
  connectManagedEmailProvider,
  setEmailProviderRole,
} from "../server/workspace-email";
import { sendEmailNow } from "../server/email-service";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Resend smoke test requires DATABASE_URL.");
const userId = String(process.env.MAXFORM_EMAIL_SMOKE_USER_ID || "").trim();
const recipient = String(process.env.RESEND_SMOKE_RECIPIENT || "").trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("Resend smoke requires an explicit MAXFORM_EMAIL_SMOKE_USER_ID. It will not select or modify an arbitrary workspace.");
}
if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) {
  throw new Error("Resend smoke requires an explicit valid RESEND_SMOKE_RECIPIENT.");
}

const sql = neon(databaseUrl);
const configured = await sql.query(
  `SELECT users.id AS user_id, connection.role,
          connection.status, connection.health_ok
   FROM users
   LEFT JOIN email_provider_connections connection
     ON connection.user_id = users.id
    AND connection.provider = 'resend'
    AND connection.status <> 'disconnected'
   WHERE users.id = $1
   LIMIT 1`,
  [userId],
);

const account = configured[0] as Record<string, unknown> | undefined;
if (!account) {
  throw new Error(
    "MAXFORM_EMAIL_SMOKE_USER_ID does not identify an existing smoke-test workspace.",
  );
}

const managedAdminConfigured = Boolean(
  process.env.MAXFORM_MANAGED_RESEND_API_KEY
  && process.env.MAXFORM_MANAGED_SENDING_DOMAIN,
);
const settingsSnapshot = await sql.query(
  `SELECT active_provider, active_provider_mode, managed_sending_enabled
   FROM email_settings WHERE user_id = $1 LIMIT 1`,
  [userId],
);
if (!settingsSnapshot[0]) throw new Error("The Resend smoke workspace must already have email settings initialized.");
const connectionSnapshot = await sql.query(
  `SELECT id, role, is_active, status, health_ok, validation_mode,
          last_health_check_at, last_verified_at, last_error, last_error_detail
   FROM email_provider_connections WHERE user_id = $1`,
  [userId],
);
const identitySnapshot = await sql.query(
  `SELECT id, sending_mode, domain_verified, domain_verification_status,
          spf_verified, dkim_verified, dmarc_verified, status
   FROM email_identities WHERE user_id = $1`,
  [userId],
);

try {
  if (!managedAdminConfigured && !account.status) {
    throw new Error("No connected Resend provider was found and Managed Sending is not configured.");
  }
  if (!managedAdminConfigured) {
    await setEmailProviderRole(userId, "resend", "active", "custom");
  }
  if (managedAdminConfigured) {
    await connectManagedEmailProvider(userId);
    await setEmailProviderRole(userId, "resend", "active", "managed");
  }
  if (!managedAdminConfigured && account.health_ok !== true) {
    const health = await checkEmailProviderHealth(userId, "resend");
    if (!health.ok) throw new Error(`Resend health check failed: ${health.error || "unknown error"}`);
  }
  const sent = await sendEmailNow({
    userId,
    to: recipient,
    templateKey: "workflow_custom",
    idempotencyKey: `resend-smoke-${Date.now()}`,
    variables: {
      message: "This is a Resend delivery smoke test from the workspace email module.",
    },
  });

  const logs = await sql.query(
    `SELECT status, provider, last_error
     FROM email_logs
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [sent.id, userId],
  );
  const result = logs[0] as Record<string, unknown> | undefined;
  const status = String(result?.status || "");
  if (!["sent", "delivered", "opened", "clicked"].includes(status)) {
    throw new Error(
      `Resend smoke test failed with status '${status}': ${String(result?.last_error || "unknown error")}`,
    );
  }

  console.log(`Resend email smoke passed: ${String(result?.provider || "resend")} / ${status}`);
} finally {
  for (const connection of connectionSnapshot) {
    await sql.query(
      `UPDATE email_provider_connections
       SET role = $1, is_active = $2, status = $3, health_ok = $4,
           validation_mode = $5, last_health_check_at = $6,
           last_verified_at = $7, last_error = $8, last_error_detail = $9,
           updated_at = NOW()
       WHERE id = $10 AND user_id = $11`,
      [connection.role, connection.is_active, connection.status, connection.health_ok,
        connection.validation_mode, connection.last_health_check_at,
        connection.last_verified_at, connection.last_error,
        connection.last_error_detail, connection.id, userId],
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
  await sql.query(
    `UPDATE email_settings
     SET active_provider = $1, active_provider_mode = $2,
         managed_sending_enabled = $3, updated_at = NOW()
     WHERE user_id = $4`,
    [settings.active_provider, settings.active_provider_mode,
      settings.managed_sending_enabled, userId],
  );
  const [restoredSettings, restoredConnections, restoredIdentities] = await Promise.all([
    sql.query(
      `SELECT active_provider, active_provider_mode, managed_sending_enabled
       FROM email_settings WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    sql.query(
      `SELECT id, role, is_active, status, health_ok, validation_mode,
              last_health_check_at, last_verified_at, last_error, last_error_detail
       FROM email_provider_connections WHERE user_id = $1 ORDER BY id`,
      [userId],
    ),
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
    console.error("Resend smoke could not restore the test workspace's original email state.");
    process.exitCode = 1;
  }
}
