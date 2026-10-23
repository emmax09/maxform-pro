import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";

import { WorkspaceEmailError, sendEmailNow } from "./email-service";

type Row = Record<string, unknown>;

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new WorkspaceEmailError("Email automation is temporarily unavailable.", 503, "email_unavailable");
  return neon(url);
};

const respond = (response: ServerResponse, status: number, value: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const uuid = (value: unknown) => {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
};

const text = (value: unknown, max = 100_000) => String(value ?? "").trim().slice(0, max);
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const variable = (values: Row, key: string) => key.split(".").reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Row)[segment] : "", values);
const template = (value: unknown, values: Row) => text(value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
  const resolved = variable(values, key.trim());
  return Array.isArray(resolved) ? resolved.join(", ") : String(resolved ?? "").replace(/[\r\n]/g, " ");
});
const html = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character).replace(/\n/g, "<br>");

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_000) throw new WorkspaceEmailError("Automation request is too large.", 413);
  }
  try {
    const value = JSON.parse(body || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
    return value as Row;
  } catch {
    throw new WorkspaceEmailError("Automation request could not be read.");
  }
};

export async function sendFormAutomationEmailNow(body: Row) {
  const formId = uuid(body.formId);
  const submissionId = uuid(body.submissionId);
  const actionId = uuid(body.actionId);
  const runId = uuid(body.runId);
  if (!formId || !submissionId || !actionId || !runId) {
    throw new WorkspaceEmailError(
      "Automation request is invalid.",
      400,
      "invalid_automation_request",
    );
  }
  const rows = await database().query(
    `SELECT form.id AS form_id, form.title AS form_title, form.slug AS form_slug, form.created_by,
            submission.id AS submission_id, submission.data AS submission_data,
            action.id AS action_id, action.action_type, action.configuration,
            run.id AS run_id
     FROM automation_runs run
     JOIN workflows workflow ON workflow.id = run.workflow_id AND workflow.enabled = TRUE
     JOIN workflow_actions action ON action.workflow_id = workflow.id AND action.id = $3 AND action.enabled = TRUE
     JOIN forms form ON form.id = workflow.form_id AND form.id = $1
     JOIN form_submissions submission ON submission.id = $2 AND submission.form_id = form.id
     WHERE run.id = $4 AND run.form_id = form.id AND run.submission_id = submission.id
       AND run.status = 'running'
       AND action.action_type IN ('send_email', 'notify_team')
       AND COALESCE(submission.data #>> '{_meta,status}', 'completed') = 'completed'
     LIMIT 1`,
    [formId, submissionId, actionId, runId],
  );
  const row = rows[0] as Row | undefined;
  if (!row) {
    throw new WorkspaceEmailError(
      "This email action is not available for the submitted response.",
      409,
      "automation_not_available",
    );
  }
  const config = object(row.configuration);
  const responseValues = object(row.submission_data);
  const values: Row = {
    form: {
      id: text(row.form_id, 64),
      slug: text(row.form_slug, 160),
      title: text(row.form_title, 255),
    },
    response: responseValues,
    submission: { id: text(row.submission_id, 64) },
  };
  const recipient = template(config.recipient, values).toLowerCase();
  const subject = template(config.subject, values);
  const message = template(config.message, values);
  const replyTo = template(config.replyTo, values).toLowerCase();
  const templateKey = text(config.templateKey, 100).toLowerCase();
  if (!recipient || (!templateKey && (!subject || !message))) {
    throw new WorkspaceEmailError(
      "This automation email needs a recipient and either a saved template or a subject and message.",
      409,
      "automation_email_incomplete",
    );
  }
  return sendEmailNow({
    userId: text(row.created_by, 64),
    to: recipient,
    sourceEventId: submissionId,
    idempotencyKey: `workflow:${actionId}:${submissionId}`,
    variables: values,
    templateKey: templateKey || undefined,
    override: templateKey
      ? undefined
      : {
          module: "workflows",
          subject,
          text: message,
          html: `<p>${html(message)}</p>`,
          replyTo: replyTo || undefined,
        },
  });
}

export async function handleEmailAutomation(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method !== "POST") {
      respond(response, 405, { error: "Use POST for email automation." });
      return;
    }
    const body = await readBody(request);
    const email = await sendFormAutomationEmailNow(body);
    respond(response, 200, { email });
  } catch (error) {
    if (error instanceof WorkspaceEmailError) {
      respond(response, error.status, { error: error.message, code: error.code });
      return;
    }
    console.error("[email-automation] unexpected request failure", { type: error instanceof Error ? error.name : typeof error });
    respond(response, 500, { error: "Automation email could not be sent." });
  }
}
