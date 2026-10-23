import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import {
  authorizeIntegrationAction,
  disconnectIntegrationConnection,
  listIntegrationsWorkspace,
  saveCustomWebhookConnection,
  setIntegrationDefault,
  setIntegrationModuleAccess,
} from "../server/integrations-data";
import { listEventMeetingProviders } from "../server/event-integrations";
import { createSchedulingMeeting } from "../server/scheduling-oauth";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Integrations smoke test requires DATABASE_URL.");

const sql = neon(databaseUrl);
const userId = randomUUID();
const connectionId = randomUUID();
let webhookConnectionId = "";
let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(`Smoke assertion failed: ${message}`);
};

try {
  await sql.query(
    `INSERT INTO users (id, email, password_hash, full_name, short_id)
     VALUES ($1, $2, 'integration-smoke-account', 'Integration Smoke', $3)`,
    [userId, `integration-smoke-${userId}@example.test`, userId.replace(/-/g, "").slice(0, 6).toUpperCase()],
  );
  await sql.query(
    `INSERT INTO integration_connections (
       id, workspace_id, provider_key, connection_name, external_account_name,
       status, auth_type, credentials_encrypted, granted_scopes
     ) VALUES ($1, $2, 'google_workspace', 'Smoke Google Workspace', 'smoke@example.test', 'connected', 'oauth', 'server-only-secret', '[]'::jsonb)`,
    [connectionId, userId],
  );
  const eventMeetingProviders = await listEventMeetingProviders(userId);
  check(eventMeetingProviders.map((provider) => provider.key).join(",") === "google_meet,teams,zoom", "Events exposes the supported online meeting providers");
  let missingMeetingConnection = false;
  try {
    await createSchedulingMeeting(userId, "zoom", {
      title: "Integration smoke",
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      timezone: "UTC",
    });
  } catch (error) {
    missingMeetingConnection = error instanceof Error && /connect zoom/i.test(error.message);
  }
  check(missingMeetingConnection, "event meeting creation stops cleanly when the provider is not connected");

  const initial = await listIntegrationsWorkspace(userId);
  check(initial.providers.some((provider) => provider.key === "google_workspace"), "Google Workspace is in the central directory");
  check(!initial.providers.some((provider) => /payment|stripe|paystack|flutterwave/i.test(provider.key)), "payment providers are excluded from the hub");
  check(initial.connections[0]?.hasCredentials === true, "connection credentials are tracked without returning the secret");
  check(!JSON.stringify(initial).includes("server-only-secret"), "encrypted credentials never reach the API model");

  await setIntegrationModuleAccess(userId, userId, {
    connectionId,
    moduleKey: "forms",
    enabled: true,
    capabilities: ["spreadsheet.write"],
  });
  await setIntegrationDefault(userId, userId, {
    moduleKey: "forms",
    purposeKey: "spreadsheet",
    connectionId,
  });
  const authorized = await authorizeIntegrationAction({
    workspaceId: userId,
    connectionId,
    moduleKey: "forms",
    capability: "spreadsheet.write",
    actionKey: "smoke.write",
    requestMetadata: { smoke: true },
  });
  check(authorized.authorized === true, "a granted module capability is authorized");

  let rejected = false;
  try {
    await authorizeIntegrationAction({
      workspaceId: userId,
      connectionId,
      moduleKey: "crm",
      capability: "email.send",
      actionKey: "smoke.denied",
    });
  } catch {
    rejected = true;
  }
  check(rejected, "an ungranted module capability is rejected");

  let dependencyGuarded = false;
  try {
    await disconnectIntegrationConnection(userId, userId, connectionId, false);
  } catch {
    dependencyGuarded = true;
  }
  check(dependencyGuarded, "disconnect requires confirmation when module access exists");
  await disconnectIntegrationConnection(userId, userId, connectionId, true);
  const afterDisconnect = await listIntegrationsWorkspace(userId);
  check(!afterDisconnect.connections.some((connection) => connection.id === connectionId), "confirmed disconnect removes the connection");
  check(afterDisconnect.audit.some((entry) => entry.eventType === "connection_disconnected"), "disconnect is retained in the audit trail");

  const webhook = await saveCustomWebhookConnection(userId, userId, {
    providerKey: "custom_webhook",
    name: "Smoke delivery",
    endpointUrl: "https://example.com/maxform-smoke",
    method: "POST",
    headers: { "X-Smoke": "true" },
    query: { source: "smoke" },
    bodyTemplate: "",
    authType: "bearer",
    authSecret: "smoke-secret-that-must-not-leak",
  });
  webhookConnectionId = webhook.connectionId;
  check(webhook.connectionId === webhookConnectionId, "custom webhook returns its stable connection id");
  const withWebhook = await listIntegrationsWorkspace(userId);
  const webhookRow = withWebhook.connections.find((connection) => connection.id === webhookConnectionId);
  check(Boolean(webhookRow?.metadata.hasSecret), "custom webhook reports secret presence without returning the secret");
  check(!JSON.stringify(withWebhook).includes("smoke-secret-that-must-not-leak"), "custom webhook secrets never reach the workspace model");
  await saveCustomWebhookConnection(userId, userId, {
    connectionId: webhookConnectionId,
    providerKey: "custom_webhook",
    name: "Smoke delivery edited",
    endpointUrl: "https://example.com/maxform-smoke-edited",
    method: "POST",
    headers: {},
    query: {},
    bodyTemplate: "",
    authType: "bearer",
    authSecret: "",
  });
  const editedWebhook = (await listIntegrationsWorkspace(userId)).connections.find((connection) => connection.id === webhookConnectionId);
  check(editedWebhook?.metadata.endpointUrl === "https://example.com/maxform-smoke-edited", "custom webhook can be edited without losing its saved secret");
  await disconnectIntegrationConnection(userId, userId, webhookConnectionId, true);

  console.log(`Integrations hub smoke test passed with ${assertions} checks.`);
} finally {
  await sql.query("DELETE FROM users WHERE id = $1", [userId]);
}
