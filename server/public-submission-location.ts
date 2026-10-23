import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";

import { countryForRequest, requestIp } from "./geo-address";

type RecordValue = Record<string, unknown>;

class PublicSubmissionLocationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const json = (
  response: ServerResponse,
  status: number,
  value: RecordValue,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new PublicSubmissionLocationError(
      "Location recording is temporarily unavailable.",
      503,
    );
  }
  return neon(url);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12_000) {
      throw new PublicSubmissionLocationError("Request is too large.", 413);
    }
  }
  try {
    const value = JSON.parse(body || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request");
    }
    return value as RecordValue;
  } catch {
    throw new PublicSubmissionLocationError("Location request is invalid.");
  }
};

/**
 * Records location from the HTTP request itself. Public forms currently save
 * their answers directly, so this endpoint is deliberately called immediately
 * after a save to persist the real request IP and its resolved country.
 */
export async function handlePublicSubmissionLocation(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "POST") {
      throw new PublicSubmissionLocationError("This action is not available.", 404);
    }
    const body = await readBody(request);
    const formId = String(body.formId || "");
    const submissionId = String(body.submissionId || "");
    if (!isUuid(formId) || !isUuid(submissionId)) {
      throw new PublicSubmissionLocationError("Location request is invalid.");
    }

    const location = await countryForRequest(
      request,
      new URL(request.url || "/", "http://localhost"),
    );
    const ipAddress = requestIp(request) || null;
    const country = location?.country || "";
    const sql = database();
    const updated = await sql`
      UPDATE form_submissions submission
      SET ip_address = COALESCE(${ipAddress}, submission.ip_address),
          data = CASE
            WHEN ${country} <> '' THEN jsonb_set(
              jsonb_set(
                submission.data,
                '{_meta}',
                COALESCE(submission.data->'_meta', '{}'::jsonb),
                TRUE
              ),
              '{_meta,country}',
              to_jsonb(${country}::text),
              TRUE
            )
            ELSE submission.data
          END
      FROM forms form
      WHERE submission.id = ${submissionId}
        AND submission.form_id = ${formId}
        AND form.id = submission.form_id
        AND form.status = 'published'
      RETURNING submission.id
    `;
    json(response, 200, {
      country,
      recorded: updated.length === 1,
    });
  } catch (error) {
    if (error instanceof PublicSubmissionLocationError) {
      json(response, error.status, { error: error.message });
      return;
    }
    console.error("[public-submission-location] unexpected request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      error: "Location could not be recorded right now.",
    });
  }
}
