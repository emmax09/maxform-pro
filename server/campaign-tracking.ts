import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

import { configuredAppUrl } from "./app-url";
import { consumeRateLimit, rateLimitIdentifier } from "./rate-limit";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";
import {
  campaignEventTypeForStatus,
  kickCampaignAnalyticsWorker,
  recordCampaignEvent,
  refreshCampaignMetrics,
} from "./campaign-analytics-engine";
import {
  createCampaignDatabase,
  type CampaignDatabase,
} from "./campaign-database";

type DatabaseRow = Record<string, unknown>;
export type CampaignEngagementStatus =
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained";
export type CampaignEngagementSource = "first_party" | "provider";
type TrackingKind = "open" | "click" | "unsubscribe" | "attribution";
type TrackingPayload = {
  version: 1;
  messageId: string;
  kind: TrackingKind;
  destination?: string;
  expiresAt?: number;
};

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("Campaign tracking is temporarily unavailable.");
  return createCampaignDatabase(url);
};

const text = (value: unknown, max = 2_000) =>
  String(value ?? "").trim().slice(0, max);

const safeMetadata = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const trackingSecret = () =>
  text(
    process.env.CAMPAIGN_TRACKING_SECRET ||
      process.env.EMAIL_ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      process.env.INTEGRATION_ENCRYPTION_KEY,
    500,
  );

const deployedRuntime = () =>
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

const stableOrigin = (value: string) => {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      Boolean(hostname) &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1" &&
      !/(?:ngrok|loca\.lt|trycloudflare|localtunnel)/i.test(hostname)
    );
  } catch {
    return false;
  }
};

/**
 * Background campaign sends do not have the browser request's origin. Use the
 * configured production origin, then Vercel's deployment hostname. Never use
 * localhost in a message sent to a real recipient.
 */
export const campaignPublicOrigin = () => {
  const configured = configuredAppUrl();
  // A deployed process must never put a temporary tunnel or local origin in
  // a real recipient's email. Production configuration verification catches
  // this before release; this runtime guard protects sends if configuration is
  // changed or a cron request arrives before that check is run.
  if (/^https:\/\//i.test(configured)) {
    if (!deployedRuntime() || stableOrigin(configured)) return configured;
    return "";
  }

  // A local development send is useful for testing provider acceptance and
  // the rendered message against a developer-owned list. It is deliberately
  // opt-in and cannot activate on Vercel/production. Local tracking URLs only
  // work when the recipient opens them from the same development machine (or
  // when PUBLIC_APP_URL points at a developer-controlled HTTPS tunnel).
  const allowDevSend =
    process.env.ALLOW_DEV_CAMPAIGN_SEND === "true" &&
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV;
  if (allowDevSend) {
    const developmentOrigin = configuredAppUrl();
    if (/^https?:\/\//i.test(developmentOrigin)) return developmentOrigin;
  }

  const vercelHost = text(process.env.VERCEL_URL, 255).replace(/\/+$/, "");
  return vercelHost ? `https://${vercelHost}` : "";
};

/**
 * Campaign delivery is opt-in locally and requires a stable HTTPS origin in
 * any deployed runtime. Tracking URLs may still be generated for previews,
 * but the send path must refuse to enqueue a real recipient unless this is
 * true.
 */
export const campaignSendAllowed = () => {
  const origin = campaignPublicOrigin();
  if (!origin) return false;
  if (deployedRuntime()) {
    return Boolean(configuredAppUrl()) && stableOrigin(origin);
  }
  return (
    process.env.ALLOW_DEV_CAMPAIGN_SEND === "true" &&
    /^https?:\/\//i.test(origin)
  );
};

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const signatureFor = (body: string) =>
  createHmac("sha256", trackingSecret()).update(body).digest("base64url");

const sign = (payload: TrackingPayload) => {
  const body = encode(JSON.stringify(payload));
  return `${body}.${signatureFor(body)}`;
};

const verify = (token: string): TrackingPayload | null => {
  const [body, receivedSignature] = token.split(".");
  if (!body || !receivedSignature || !trackingSecret()) return null;
  const expectedSignature = signatureFor(body);
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(receivedSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }
  try {
    const payload = JSON.parse(decode(body)) as TrackingPayload;
    if (payload.version !== 1 || !payload.messageId || !payload.kind) return null;
    if (payload.expiresAt && payload.expiresAt < Math.floor(Date.now() / 1_000)) {
      return null;
    }
    if (!["open", "click", "unsubscribe", "attribution"].includes(payload.kind)) return null;
    if (payload.kind === "click" && !/^https?:\/\//i.test(payload.destination || "")) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const trackingUrl = (path: string, token: string) => {
  const origin = campaignPublicOrigin();
  return origin ? `${origin}${path}?token=${encodeURIComponent(token)}` : "";
};

export const campaignOpenUrl = (messageId: string) =>
  trackingUrl(
    "/api/campaigns/track",
    sign({
      version: 1,
      messageId,
      kind: "open",
      // A campaign may be opened long after it was sent. Keep the pixel valid
      // for a year, while the unsubscribe link remains non-expiring.
      expiresAt: Math.floor(Date.now() / 1_000) + 365 * 24 * 60 * 60,
    }),
  );

export const campaignClickUrl = (messageId: string, destination: string) =>
  trackingUrl(
    "/api/campaigns/track",
    sign({
      version: 1,
      messageId,
      kind: "click",
      destination,
      expiresAt: Math.floor(Date.now() / 1_000) + 365 * 24 * 60 * 60,
    }),
  );

export const campaignUnsubscribeUrl = (messageId: string) =>
  trackingUrl(
    "/api/campaigns/unsubscribe",
    sign({ version: 1, messageId, kind: "unsubscribe" }),
  );

const campaignAttributionCookieName = "maxform_campaign_attribution";

/**
 * A signed, HttpOnly browser marker lets checkout attribute a later payment
 * without putting a campaign id in public form data. It contains only the
 * message UUID and expires after thirty days.
 */
export const campaignAttributionCookie = (messageId: string, secure = true) => {
  const token = sign({
    version: 1,
    messageId,
    kind: "attribution",
    expiresAt: Math.floor(Date.now() / 1_000) + 30 * 24 * 60 * 60,
  });
  return `${campaignAttributionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
};

export const campaignAttributionMessageId = (request: IncomingMessage) => {
  const cookieHeader = text(request.headers.cookie, 8_000);
  const value = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${campaignAttributionCookieName}=`))
    ?.slice(campaignAttributionCookieName.length + 1);
  if (!value) return "";
  try {
    const payload = verify(decodeURIComponent(value));
    return payload?.kind === "attribution" ? payload.messageId : "";
  } catch {
    return "";
  }
};

// Annotated rather than inferred: the empty branch would otherwise widen the
// union to `{ "List-Unsubscribe"?: undefined }`, which no longer satisfies the
// Record<string, string> the mailer takes.
export const campaignListUnsubscribeHeaders = (
  unsubscribeUrl: string,
): Record<string, string> =>
  unsubscribeUrl
    ? {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : {};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character] || character,
  );

const injectBeforeBody = (html: string, addition: string) =>
  /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${addition}</body>`)
    : `${html}${addition}`;

const rewriteCampaignLinks = (html: string, messageId: string) =>
  html.replace(
    /(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix: string, quote: string, destination: string) => {
      const cleanDestination = destination.trim();
      if (
        !/^https?:\/\//i.test(cleanDestination) ||
        /\/api\/campaigns\/(?:track|unsubscribe)/i.test(cleanDestination)
      ) {
        return match;
      }
      const tracked = campaignClickUrl(messageId, cleanDestination);
      return tracked
        ? `${prefix}${quote}${escapeHtml(tracked)}${quote}`
        : match;
    },
  );

/**
 * Adds the compliance footer and first-party engagement signals to the exact
 * HTML that is delivered. This is intentionally done per recipient because
 * every open/click/unsubscribe token must point at one campaign message.
 */
export const decorateCampaignEmail = (
  html: string,
  messageId: string,
  mailingAddress: string,
) => {
  const source = html.trim();
  const unsubscribeUrl = campaignUnsubscribeUrl(messageId);
  const address = mailingAddress.trim();
  const hasUnsubscribeAnchor = /<a\b[^>]*href\s*=\s*["'][^"']*(?:unsubscribe|unsubscribe\.url)/i.test(source);
  const firstAddressLine = address.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const hasAddress = Boolean(firstAddressLine && source.includes(firstAddressLine));
  const footerParts: string[] = [];

  if (!hasUnsubscribeAnchor && unsubscribeUrl) {
    footerParts.push(
      `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748B;text-decoration:underline">Unsubscribe</a>`,
    );
  }
  if (!hasAddress && address) {
    footerParts.push(
      `<span style="display:block;margin-top:8px">${escapeHtml(address).replace(/\r?\n/g, "<br>")}</span>`,
    );
  }

  // Keep a consistent visual boundary on every delivered campaign. The
  // divider is presentation only; the tracking pixel below remains the
  // engagement signal for clients that load remote images.
  const complianceFooter = `<div role="separator" aria-hidden="true" style="margin:24px 0 0;border-top:1px solid #E2E8F0;${footerParts.length ? "padding-top:16px;" : ""}text-align:center;color:#64748B;font:12px/1.6 Arial,sans-serif">${footerParts.join("")}</div>`;
  const withFooter = injectBeforeBody(source, complianceFooter);
  const withTrackedLinks = rewriteCampaignLinks(withFooter, messageId);
  const openUrl = campaignOpenUrl(messageId);
  return openUrl
    ? injectBeforeBody(
        withTrackedLinks,
        `<img src="${escapeHtml(openUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0" />`,
      )
    : withTrackedLinks;
};

export const refreshCampaignStats = async (sql: CampaignDatabase, campaignId: string) => {
  const owners = (await sql.query(
    `SELECT user_id FROM contact_campaigns WHERE id = $1::uuid LIMIT 1`,
    [campaignId],
  )) as DatabaseRow[];
  const ownerId = text(owners[0]?.user_id, 64);
  if (ownerId) await refreshCampaignMetrics(sql, ownerId, campaignId);
};

/** Synchronises provider or first-party engagement into campaign analytics. */
export const recordCampaignMessageEvent = async (input: {
  providerMessageId?: string;
  messageId?: string;
  status: CampaignEngagementStatus;
  userId?: string;
  provider?: string;
  source?: CampaignEngagementSource;
  providerEventId?: string;
  destination?: string;
  ipHash?: string;
  userAgent?: string;
  country?: string;
  metadata?: Record<string, unknown>;
}) => {
  const sql = database();
  const providerMessageId = text(input.providerMessageId, 255);
  const messageId = text(input.messageId, 64);
  const ownerId = text(input.userId, 64) || null;
  const rows = await sql.query(
    `SELECT message.id, message.campaign_id, message.contact_id,
            message.provider_message_id, campaign.user_id
     FROM contact_campaign_messages message
     JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
     WHERE (($1 <> '' AND trim(BOTH '<>' FROM message.provider_message_id) = trim(BOTH '<>' FROM $1))
        OR ($2 <> '' AND message.id::text = $2))
       AND ($3::uuid IS NULL OR campaign.user_id = $3::uuid)
     LIMIT 1`,
    [providerMessageId, messageId, ownerId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) return { matched: false };
  const campaignId = text(row.campaign_id, 64);
  const status = input.status;
  const source: CampaignEngagementSource =
    input.source === "first_party" ? "first_party" : "provider";
  const eventType = campaignEventTypeForStatus(status);
  const provider = text(input.provider, 64);
  const destination = text(input.destination, 2_048);
  const metadata = safeMetadata({
    ...safeMetadata(input.metadata),
    ...(destination ? { destination } : {}),
  });
  const providerEventId =
    source === "provider" && eventType
      ? (
          text(input.providerEventId, 255) ||
          `${provider}:${providerMessageId}:${eventType}:${destination}`
        ).slice(0, 255)
      : "";
  let eventRecorded = false;
  let countEngagement = false;

  if (eventType) {
    const event = await recordCampaignEvent({
      workspaceId: text(row.user_id, 64),
      campaignId,
      messageId: text(row.id, 64),
      eventType,
      source,
      provider,
      providerEventId,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      metadata,
      device: text(metadata.device, 64),
      client: text(metadata.client, 64),
      country: input.country || text(metadata.country, 64),
    });
    eventRecorded = event.eventRecorded;
    const firstPartyRows =
      source === "provider"
        ? ((await sql.query(
            `SELECT EXISTS (
               SELECT 1
               FROM campaign_events
               WHERE message_id = $1::uuid
                 AND event_type = $2
                 AND source = 'first_party'
             ) AS exists`,
            [text(row.id, 64), eventType],
          )) as DatabaseRow[])
        : [];
    const hasFirstPartySignal =
      source === "first_party" ||
      String(firstPartyRows[0]?.exists || "").toLowerCase() === "true";
    countEngagement =
      eventRecorded && (source === "first_party" || !hasFirstPartySignal);

    // Keep the 086 ledger populated for old reporting consumers and safe
    // rollback. campaign_events remains the canonical aggregate input.
    if (eventType === "email_opened" || eventType === "email_clicked") {
      await sql.query(
        `INSERT INTO contact_campaign_engagement_events (
           campaign_id, message_id, event_type, source, provider,
           provider_event_id, destination, metadata, occurred_at, campaign_event_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, NOW(), $9::uuid)
         ON CONFLICT DO NOTHING`,
        [
          campaignId,
          text(row.id, 64),
          eventType === "email_opened" ? "open" : "click",
          source,
          provider,
          providerEventId,
          destination,
          JSON.stringify(metadata),
          event.eventId || null,
        ],
      );
    }
    void dispatchWorkspaceWorkflowEvent(
      text(row.user_id, 64),
      eventType,
      {
        id: text(row.id, 64),
        messageId: text(row.id, 64),
        campaignId,
        status,
        source,
        provider,
        destination,
      },
      `${eventType}:${text(row.id, 64)}:${providerEventId || source}`,
    ).catch(() => undefined);
    kickCampaignAnalyticsWorker(campaignId);
  }
  return {
    matched: true,
    campaignId,
    eventRecorded,
    counted: countEngagement,
  };
};

export const applyCampaignUnsubscribe = async (
  messageId: string,
  reasonDetail = "",
) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT message.id, message.contact_id, message.recipient,
            campaign.id AS campaign_id, campaign.user_id
     FROM contact_campaign_messages message
     JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
     WHERE message.id = $1::uuid
     LIMIT 1`,
    [messageId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) return { matched: false };
  const userId = text(row.user_id, 64);
  const recipient = text(row.recipient, 320).toLowerCase();
  const detail = text(reasonDetail, 500) || "No reason provided";
  await sql.query(
    `INSERT INTO email_suppressions (
       user_id, recipient, reason, reason_detail, source_message_id
     )
     VALUES ($1::uuid, $2, 'unsubscribe', $3, $4::uuid)
     ON CONFLICT (user_id, LOWER(recipient)) DO UPDATE
       SET reason_detail = CASE
             WHEN EXCLUDED.reason_detail <> '' THEN EXCLUDED.reason_detail
             ELSE email_suppressions.reason_detail
           END,
           source_message_id = COALESCE(
             EXCLUDED.source_message_id,
             email_suppressions.source_message_id
           )`,
    [userId, recipient, detail, text(row.id, 64)],
  );
  await sql.query(
    `UPDATE contacts
     SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()),
         last_activity_at = NOW()
     WHERE id = NULLIF($1, '')::uuid AND created_by = $2::uuid`,
    [text(row.contact_id, 64), userId],
  );
  await recordCampaignEvent({
    workspaceId: userId,
    campaignId: text(row.campaign_id, 64),
    messageId: text(row.id, 64),
    eventType: "email_unsubscribed",
    source: "first_party",
    eventKey: `email_unsubscribed:${text(row.id, 64)}`,
    metadata: { channel: "unsubscribe_link", reason: detail },
  });
  void dispatchWorkspaceWorkflowEvent(
    userId,
    "subscriber_unsubscribed",
    {
      id: text(row.contact_id, 64) || text(row.id, 64),
      contactId: text(row.contact_id, 64),
      campaignId: text(row.campaign_id, 64),
      reason: detail,
    },
    `subscriber_unsubscribed:${text(row.id, 64)}`,
  ).catch(() => undefined);
  kickCampaignAnalyticsWorker(text(row.campaign_id, 64));
  return { matched: true };
};

const responseJson = (response: ServerResponse, status: number, value: DatabaseRow) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const readToken = (request: IncomingMessage) => {
  const url = new URL(request.url || "/", "http://localhost");
  return { url, payload: verify(url.searchParams.get("token") || "") };
};

const pixel = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

const requestTrackingMetadata = (request: IncomingMessage) => {
  const userAgent = text(request.headers["user-agent"], 500).toLowerCase();
  const isMachine = /googleimageproxy|yahoo|proofpoint|mimecast|barracuda|scanner|crawler|bot|spider|prefetch|headless|linkpreview/i.test(
    userAgent,
  );
  const device = /ipad|tablet|kindle/i.test(userAgent)
    ? "tablet"
    : /android|iphone|ipod|mobile/i.test(userAgent)
      ? "mobile"
      : "desktop";
  const client = /googleimageproxy|gmail/i.test(userAgent)
    ? "gmail"
    : /outlook|microsoft office/i.test(userAgent)
      ? "outlook"
      : /applewebkit|apple mail/i.test(userAgent)
        ? "apple mail"
        : /firefox/i.test(userAgent)
          ? "firefox"
          : /chrome|crios/i.test(userAgent)
            ? "chrome"
            : "unknown";
  // Forwarded headers are only useful when the request came through a proxy
  // that the deployment controls. On a direct development server an attacker
  // can otherwise spoof a new address on every request and bypass the shared
  // tracking limiter.
  const trustForwardedHeaders =
    process.env.TRUST_PROXY_HEADERS === "true" ||
    Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const forwarded = trustForwardedHeaders
    ? text(request.headers["x-forwarded-for"], 255)
        .split(",")[0]
        .trim()
    : "";
  const address = forwarded || text(request.socket?.remoteAddress, 255);
  const country = text(
    request.headers["x-vercel-ip-country"] ||
      request.headers["cf-ipcountry"] ||
      request.headers["x-country"],
    16,
  ).toUpperCase();
  return {
    device,
    client,
    isMachine,
    country,
    userAgent,
    ipHash: address
      ? createHmac("sha256", trackingSecret()).update(address).digest("hex")
      : "",
  };
};

export async function handleCampaignTracking(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    responseJson(response, 405, { error: "Use GET for campaign tracking." });
    return;
  }
  try {
    const { payload } = readToken(request);
    if (!payload || !["open", "click"].includes(payload.kind)) {
      responseJson(response, 400, { error: "That campaign tracking link is invalid." });
      return;
    }
    // HEAD requests are commonly issued by link scanners and mail clients
    // probing a resource. Only a real GET is a usable engagement signal.
    if (request.method === "GET") {
      const metadata = requestTrackingMetadata(request);
      const rateLimit = await consumeRateLimit({
        action: `campaign-tracking-${payload.kind}`,
        identifier: rateLimitIdentifier(metadata.ipHash || payload.messageId),
        limit: payload.kind === "open" ? 180 : 90,
        windowSeconds: 60,
      });
      if (rateLimit.allowed) {
        await recordCampaignMessageEvent({
          messageId: payload.messageId,
          status: payload.kind === "open" ? "opened" : "clicked",
          destination: payload.destination,
          source: "first_party",
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
          country: metadata.country,
          metadata,
        });
      }
      if (payload.kind === "click") {
        response.setHeader(
          "Set-Cookie",
          campaignAttributionCookie(
            payload.messageId,
            /^https:\/\//i.test(campaignPublicOrigin()),
          ),
        );
      }
    }
    if (payload.kind === "open") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "image/gif");
      response.setHeader("Content-Length", String(pixel.length));
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Vary", "User-Agent");
      response.end(request.method === "HEAD" ? undefined : pixel);
      return;
    }
    response.statusCode = 302;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Location", payload.destination || "/");
    response.end();
  } catch (error) {
    console.error("[campaign-tracking] request failed", { type: error instanceof Error ? error.name : typeof error });
    responseJson(response, 500, { error: "Campaign tracking is temporarily unavailable." });
  }
}

type UnsubscribePageState = "confirm" | "success" | "invalid";

const unsubscribeReasons = [
  ["too_many", "I receive too many emails"],
  ["not_relevant", "The content is not relevant to me"],
  ["did_not_signup", "I did not sign up for these emails"],
  ["prefer_other", "I prefer another way to hear from you"],
  ["other", "Other"],
] as const;

const unsubscribePage = (
  state: UnsubscribePageState,
  token = "",
  errorMessage = "",
) => {
  const title =
    state === "success"
      ? "You’re unsubscribed"
      : state === "invalid"
        ? "This link is unavailable"
        : "Manage your email preferences";
  const action = token
    ? `/api/campaigns/unsubscribe?token=${encodeURIComponent(token)}`
    : "";
  const body =
    state === "success"
      ? `<div class="success-mark" aria-hidden="true">✓</div><h1>${title}</h1><p>You will not receive further campaign email from this workspace. If you change your mind, contact the sender directly.</p>`
      : state === "invalid"
        ? `<div class="error-mark" aria-hidden="true">!</div><h1>${title}</h1><p>The unsubscribe link is invalid or no longer available. Request a new link from the sender if you still need help.</p>`
        : `<div class="eyebrow">Email preferences</div><h1>Before you go</h1><p>Confirm that you want to stop receiving campaign emails from this workspace. Your choice applies immediately after you submit it.</p>${errorMessage ? `<div class="form-error" role="alert">${escapeHtml(errorMessage)}</div>` : ""}<form method="post" action="${escapeHtml(action)}"><fieldset><legend>Why are you unsubscribing?</legend>${unsubscribeReasons
            .map(
              ([value, label], index) =>
                `<label class="option"><input type="radio" name="reason" value="${value}"${index === 0 ? " required" : ""}><span>${label}</span></label>`,
            )
            .join("")}<label for="reason-detail" class="detail-label">Anything else? <span>Optional</span></label><textarea id="reason-detail" name="reason_detail" maxlength="450" rows="3" placeholder="Share a little more if you’d like"></textarea></fieldset><div class="actions"><button class="secondary" type="button" onclick="window.history.back()">Keep me subscribed</button><button class="primary" type="submit">Confirm unsubscribe</button></div><p class="fine-print">This only changes campaign email preferences for this workspace.</p></form>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(145deg,#f6f8fb,#eef2f7);color:#172033;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;padding:24px}.shell{width:min(100%,560px)}.card{background:#fff;border:1px solid #e1e7ef;border-radius:24px;box-shadow:0 22px 70px rgba(31,42,61,.13);padding:clamp(26px,6vw,48px)}.brand{display:inline-flex;align-items:center;gap:8px;color:#526174;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.brand-dot{width:10px;height:10px;border-radius:50%;background:#e94773;box-shadow:0 0 0 5px #fde8ef}.eyebrow{color:#e94773;font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}h1{font-size:clamp(27px,6vw,36px);line-height:1.1;letter-spacing:-.04em;margin:0 0 14px}p{color:#637187;font-size:14px;line-height:1.7;margin:0}form{margin-top:28px}fieldset{border:0;margin:0;padding:0}legend{font-size:13px;font-weight:750;margin-bottom:11px}.option{display:flex;align-items:flex-start;gap:11px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 13px;margin-top:8px;font-size:13px;line-height:1.35;cursor:pointer;transition:border-color .15s,background .15s}.option:hover{background:#fafbfc;border-color:#c8d2df}.option input{accent-color:#e94773;margin:1px 0 0;width:16px;height:16px;flex:none}.detail-label{display:flex;justify-content:space-between;gap:12px;color:#36445a;font-size:12px;font-weight:700;margin:20px 0 8px}.detail-label span{font-weight:500;color:#8693a5}textarea{display:block;width:100%;resize:vertical;border:1px solid #dce3ec;border-radius:12px;padding:11px 12px;color:#172033;font:inherit;font-size:13px;outline:none}textarea:focus{border-color:#e94773;box-shadow:0 0 0 3px #fde8ef}.actions{display:flex;flex-direction:column-reverse;gap:10px;margin-top:24px}@media(min-width:480px){.actions{flex-direction:row;justify-content:flex-end}}button{min-height:44px;border-radius:11px;padding:0 16px;font:inherit;font-size:13px;font-weight:750;cursor:pointer}.primary{background:#172033;color:#fff;border:1px solid #172033}.primary:hover{background:#29384d}.secondary{background:#fff;color:#36445a;border:1px solid #d4dce7}.secondary:hover{background:#f8fafc}.fine-print{font-size:11px;line-height:1.5;text-align:center;margin-top:18px;color:#8995a6}.success-mark,.error-mark{display:grid;place-items:center;width:54px;height:54px;border-radius:18px;margin-bottom:22px;font-size:25px;font-weight:800}.success-mark{background:#e7f7ef;color:#168153}.error-mark{background:#fff4e6;color:#b56a10}.form-error{border:1px solid #f4c6c6;background:#fff5f5;color:#b53f3f;border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5;margin-top:16px}.footer{margin-top:16px;text-align:center;color:#93a0b0;font-size:11px}
  </style></head><body><main class="shell"><section class="card"><div class="brand"><span class="brand-dot"></span>MaxForm email preferences</div>${body}</section><div class="footer">You can close this window at any time.</div></main></body></html>`;
};

const readUrlEncodedBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (body.length > 8_192) throw new Error("Unsubscribe request is too large.");
  }
  return new URLSearchParams(body);
};

const isProviderOneClick = (request: IncomingMessage, body: URLSearchParams) =>
  /(?:^|\s|;)list-unsubscribe\s*=\s*one-click(?:\s|;|$)/i.test(
    text(request.headers["list-unsubscribe-post"], 500) || body.toString(),
  );

export async function handleCampaignUnsubscribe(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, POST");
    response.end("Method not allowed");
    return;
  }
  try {
    const { url, payload } = readToken(request);
    const token = url.searchParams.get("token") || "";
    if (!payload || payload.kind !== "unsubscribe") {
      response.statusCode = 400;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(unsubscribePage("invalid"));
      return;
    }

    let body = new URLSearchParams();
    if (request.method === "POST") {
      body = await readUrlEncodedBody(request);
    }

    // RFC 8058 provider requests must be honoured without an HTML step. A
    // human GET, however, gets a confirmation page so an accidental click
    // cannot silently change a recipient's preference.
    if (request.method === "GET") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(unsubscribePage("confirm", token));
      return;
    }

    const oneClick = isProviderOneClick(request, body);
    let reasonDetail = "One-click unsubscribe";
    if (!oneClick) {
      const reason = body.get("reason") || "";
      const selected = unsubscribeReasons.find(([value]) => value === reason);
      const customDetail = text(body.get("reason_detail"), 450);
      if (!selected) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(unsubscribePage("confirm", token, "Choose a reason to continue."));
        return;
      }
      if (selected[0] === "other" && !customDetail) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(unsubscribePage("confirm", token, "Add a short reason so we can improve."));
        return;
      }
      reasonDetail = customDetail
        ? `${selected[1]}: ${customDetail}`
        : selected[1];
    }

    const matched = (await applyCampaignUnsubscribe(
      payload.messageId,
      reasonDetail,
    )).matched;
    response.statusCode = matched ? 200 : 400;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(unsubscribePage(matched ? "success" : "invalid"));
  } catch (error) {
    console.error("[campaign-unsubscribe] request failed", { type: error instanceof Error ? error.name : typeof error });
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(unsubscribePage("invalid"));
  }
}
