import type { IncomingMessage, ServerResponse } from "node:http";

import { jwtVerify } from "jose";

import {
  WorkspaceEmailError,
  addEmailSendingDomain,
  checkEmailProviderHealth,
  connectEmailProvider,
  connectManagedEmailProvider,
  createEmailAnalyticsWebhook,
  createEmailInboundWebhook,
  deleteEmailLogs,
  deleteEmailIdentity,
  disconnectEmailProvider,
  disconnectManagedEmailProvider,
  deleteEmailSendingDomain,
  emailProviderSchemas,
  getEmailAnalytics,
  getEmailWorkspace,
  publicEmailErrorMessage,
  retryWorkspaceEmail,
  saveEmailIdentity,
  saveEmailSettings,
  saveEmailTemplate,
  setEmailProviderRole,
  verifyEmailSendingDomain,
} from "./workspace-email";
import { sendEmailNow } from "./email-service";
import { configuredAppUrl } from "./app-url";
import { workspaceScopeFor } from "./workspace-access";

type RecordValue = Record<string, unknown>;

const testEmailVariables = (recipient: string) => {
  const origin = configuredAppUrl() || "https://example.com";
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const previousStartsAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1_000);
  const date = startsAt.toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const previousDate = previousStartsAt.toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const time = startsAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

  return {
    action: { url: `${origin}/dashboard` },
    workspace: { name: "MaxForm workspace", signInUrl: `${origin}/auth` },
    contact: { name: "Test recipient", email: recipient },
    sender: { name: "MaxForm team" },
    form: { title: "Sample form", url: `${origin}/forms/sample` },
    response: {
      email: recipient,
      progress: "100%",
      reference: "RESP-1001",
      startedAt: previousDate,
      submittedAt: date,
    },
    event: {
      name: "Sample event",
      date,
      startTime: time,
      timezone: "UTC",
      location: "Online",
      meetingProvider: "Google Meet",
      attendeeMeetingLink: `${origin}/events/sample/join`,
      calendarUrl: `${origin}/events/sample/calendar`,
      mapUrl: `${origin}/events/sample/map`,
    },
    ticket: {
      code: "TEST-1234",
      holder: "Test recipient",
      type: "General admission",
      downloadUrl: `${origin}/tickets/sample`,
    },
    tickets: {
      quantity: "2",
      numbers: "TEST-1234, TEST-1235",
      summary: "2 × General admission",
    },
    appointment: {
      date,
      time,
      previousDate,
      duration: "30 minutes",
      host: "MaxForm team",
      service: "Product consultation",
      location: "Online meeting",
      calendarUrl: `${origin}/appointments/sample/calendar`,
      mapUrl: `${origin}/appointments/sample/map`,
    },
    invoice: {
      number: "INV-1001",
      amount: "$100.00",
      balance: "$100.00",
      issuedAt: previousDate,
      dueDate: date,
      paidAt: date,
    },
    payment: {
      amount: "$100.00",
      date,
      method: "Card ending in 4242",
      reference: "PAY-1001",
      failureReason: "The card issuer declined the payment.",
    },
    refund: { amount: "$100.00", issuedAt: date },
    order: {
      number: "ORD-1001",
      itemCount: "2",
      placedAt: previousDate,
      paidAt: date,
      subtotal: "$90.00",
      tax: "$5.00",
      shipping: "$5.00",
      total: "$100.00",
      summaryUrl: `${origin}/orders/sample`,
    },
    document: {
      name: "Sample agreement",
      pageCount: "4",
      signerCount: "2",
      sentAt: previousDate,
      dueDate: date,
      completedAt: date,
    },
    reminder: { subject: "Sample agreement", dueDate: date },
    invitation: { role: "Editor", expiresAt: date },
    member: {
      name: "Sample member",
      email: recipient,
      username: recipient,
      password: "Sample-Password-123!",
      passwordLabel: "Temporary password",
      role: "Editor",
      tabs: "Forms, Campaigns, Contacts",
    },
    campaign: {
      subject: "Sample campaign",
      message: "This is a test email from MaxForm.",
    },
    unsubscribe: { link: `${origin}/unsubscribe-preview` },
    message: "This is a test email from MaxForm.",
  };
};

const json = (response: ServerResponse, status: number, value: RecordValue) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(JSON.stringify(value));
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new WorkspaceEmailError(
      "Email settings are temporarily unavailable. Please try again shortly.",
      503,
      "email_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) {
    throw new WorkspaceEmailError(
      "Please sign in again to manage email settings.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof WorkspaceEmailError) throw error;
    throw new WorkspaceEmailError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new WorkspaceEmailError("This email request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid body");
    }
    return value as RecordValue;
  } catch {
    throw new WorkspaceEmailError("This email request could not be read.");
  }
};

export async function handleEmailData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "workspace";
    const userId = await authenticatedUserId(request);

    if (request.method === "GET") {
      if (action === "schema") {
        json(response, 200, { providers: emailProviderSchemas });
        return;
      }
      if (action === "workspace") {
        json(response, 200, await getEmailWorkspace(userId, {
          status: url.searchParams.get("status") || "",
          search: url.searchParams.get("search") || "",
        }));
        return;
      }
      if (action === "analytics") {
        json(response, 200, await getEmailAnalytics(userId, Number(url.searchParams.get("days") || 30)));
        return;
      }
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      if (action === "connect") {
        const credentials = body.credentials;
        if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
          throw new WorkspaceEmailError("Enter the provider credentials.");
        }
        const connection = await connectEmailProvider(
          userId,
          String(body.provider || ""),
          credentials as Record<string, string>,
        );
        json(response, 200, { connection });
        return;
      }
      if (action === "connect-managed") {
        await connectManagedEmailProvider(userId);
        json(response, 200, { connected: true });
        return;
      }
      if (action === "disconnect") {
        await disconnectEmailProvider(userId, String(body.provider || ""));
        json(response, 200, { disconnected: true });
        return;
      }
      if (action === "disconnect-managed") {
        await disconnectManagedEmailProvider(userId);
        json(response, 200, { disconnected: true });
        return;
      }
      if (action === "health") {
        json(response, 200, {
          health: await checkEmailProviderHealth(userId, String(body.provider || "")),
        });
        return;
      }
      if (action === "provider-role") {
        await setEmailProviderRole(userId, String(body.provider || ""), String(body.role || ""), String(body.mode || "custom"));
        json(response, 200, { updated: true });
        return;
      }
      if (action === "inbound-webhook") {
        json(response, 200, {
          webhook: await createEmailInboundWebhook(userId, String(body.provider || "")),
        });
        return;
      }
      if (action === "analytics-webhook") {
        json(response, 200, {
          webhook: await createEmailAnalyticsWebhook(userId, String(body.provider || "")),
        });
        return;
      }
      if (action === "identity") {
        json(response, 200, { identity: await saveEmailIdentity(userId, body) });
        return;
      }
      if (action === "domain-add") {
        json(response, 200, { domain: await addEmailSendingDomain(userId, String(body.domain || "")) });
        return;
      }
      if (action === "domain-verify") {
        json(response, 200, { domain: await verifyEmailSendingDomain(userId, String(body.id || "")) });
        return;
      }
      if (action === "domain-delete") {
        json(response, 200, await deleteEmailSendingDomain(userId, String(body.id || "")));
        return;
      }
      if (action === "delete-identity") {
        await deleteEmailIdentity(userId, String(body.id || ""));
        json(response, 200, { deleted: true });
        return;
      }
      if (action === "template") {
        json(response, 200, { template: await saveEmailTemplate(userId, body) });
        return;
      }
      if (action === "settings") {
        await saveEmailSettings(userId, body);
        json(response, 200, { updated: true });
        return;
      }
      if (action === "send-test") {
        const templateKey = String(body.templateKey || "");
        const recipient = String(body.to || "");
        const email = await sendEmailNow({
          userId,
          templateKey,
          to: recipient,
          identityId: typeof body.identityId === "string" ? body.identityId : null,
          idempotencyKey: crypto.randomUUID(),
          variables: testEmailVariables(recipient),
        });
        json(response, email.status === "sent" ? 200 : 202, { email });
        return;
      }
      if (action === "retry") {
        json(response, 200, { email: await retryWorkspaceEmail(userId, String(body.id || "")) });
        return;
      }
      if (action === "delete-logs") {
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((value): value is string => typeof value === "string")
          : [];
        json(response, 200, {
          ...(await deleteEmailLogs(userId, { ids, all: body.all === true })),
        });
        return;
      }
    }

    json(response, 404, { error: "This email action is not available." });
  } catch (error) {
    if (error instanceof WorkspaceEmailError) {
      json(response, error.status, { error: publicEmailErrorMessage(error.message, "Email settings could not be updated. Please try again."), code: error.code });
      return;
    }
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    console.error("[email-data] unexpected request failure", {
      code: databaseCode || "unknown",
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      error: "Email settings could not be updated right now. Please try again.",
      code: "email_data_error",
    });
  }
}
