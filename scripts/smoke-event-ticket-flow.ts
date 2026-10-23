import { spawn } from "node:child_process";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { chromium } from "@playwright/test";
import { SignJWT } from "jose";
import { createEventTicketDownloadToken } from "../server/event-ticket-download";

const host = "127.0.0.1";
const port = 4176;
const origin = `http://${host}:${port}`;

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The event-flow smoke server did not become ready.");
};

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

const vite = spawn(
  process.execPath,
  [
    join(process.cwd(), "node_modules", "vite", "bin", "vite.js"),
    "--host",
    host,
    "--port",
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

try {
  await waitForServer();
  const sql = neon(databaseUrl);
  const rows = await sql.query(`
    SELECT event.id AS event_id, event.slug AS event_slug, event.created_by AS owner_id,
      owner.short_id AS workspace_id,
      COALESCE(NULLIF(company.company_name, ''), NULLIF(owner.full_name, ''), 'Event team') AS workspace_name,
      (SELECT MIN(active_ticket.price) FROM event_ticket_types active_ticket
       WHERE active_ticket.event_id = event.id AND active_ticket.active = TRUE) AS minimum_ticket_price,
      (SELECT MAX(active_ticket.price) FROM event_ticket_types active_ticket
       WHERE active_ticket.event_id = event.id AND active_ticket.active = TRUE) AS maximum_ticket_price,
      (SELECT MIN(active_ticket.currency) FROM event_ticket_types active_ticket
       WHERE active_ticket.event_id = event.id AND active_ticket.active = TRUE) AS ticket_currency,
      ticket_type.name AS ticket_name, ticket_type.min_per_order,
      ticket_type.max_per_order,
      GREATEST(0, ticket_type.quantity_available - (
        SELECT COUNT(*) FROM event_attendees attendee
        WHERE attendee.ticket_type_id = ticket_type.id
          AND attendee.ticket_status IN ('valid', 'transferred')
      ))::int AS remaining
    FROM events event
    JOIN users owner ON owner.id = event.created_by
    LEFT JOIN company_settings company ON company.user_id = event.created_by
    JOIN forms form ON form.id = event.registration_form_id
    JOIN event_ticket_types ticket_type
      ON ticket_type.event_id = event.id
     AND ticket_type.active = TRUE
    WHERE event.ticketing_enabled = TRUE
      AND event.status IN ('published', 'on_sale')
      AND event.access_control = 'public'
      AND form.status = 'published'
      AND ticket_type.quantity_available - (
        SELECT COUNT(*) FROM event_attendees attendee
        WHERE attendee.ticket_type_id = ticket_type.id
          AND attendee.ticket_status IN ('valid', 'transferred')
      ) >= ticket_type.min_per_order
    ORDER BY event.updated_at DESC, ticket_type.sort_order
    LIMIT 1
  `);
  if (!rows.length) {
    throw new Error(
      "No eligible published public ticket event exists for browser smoke.",
    );
  }

  const fixture = rows[0];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(
      `${origin}/event/${fixture.workspace_id}/${fixture.event_slug}`,
      { waitUntil: "networkidle" },
    );
    const continueLink = page.getByRole("link", {
      name: /continue to registration/i,
    });
    await continueLink.waitFor({ state: "visible" });
    const eventTicketPreview = page.getByText(String(fixture.ticket_name), {
      exact: true,
    });
    if (!(await eventTicketPreview.count())) {
      throw new Error("Ticket options were missing from the event preview.");
    }
    const eventTicketAction = page
      .getByRole("button")
      .filter({ hasText: String(fixture.ticket_name) });
    if (await eventTicketAction.count()) {
      throw new Error("A ticket could be selected before registration.");
    }

    await continueLink.click();
    await page.waitForURL(/\/forms\//);
    await page
      .locator("form.maxform-renderer")
      .waitFor({ state: "visible", timeout: 35_000 })
      .catch(async (error) => {
        console.error(
          JSON.stringify({
            registrationDebug: {
              text: (await page.locator("body").innerText()).slice(0, 1_000),
              url: page.url(),
            },
          }),
        );
        throw error;
      });
    const fullName = page.getByLabel(/full name/i);
    if (await fullName.count()) await fullName.fill("Browser Smoke");
    const email = page.getByLabel(/email address/i);
    if (await email.count()) await email.fill("browser-smoke@example.test");

    const selectionStatus = page.getByLabel(
      /choose your ticket selection status/i,
    );
    for (let step = 0; step < 4; step += 1) {
      if (await selectionStatus.count()) break;
      const next = page.getByRole("button", { name: /^next$/i });
      if (!(await next.count())) break;
      await next.click();
    }
    await selectionStatus.waitFor({ state: "attached" });

    const blocked = page.getByRole("button", {
      name: /select a ticket to continue/i,
    });
    if (!(await blocked.isDisabled())) {
      throw new Error("Registration continued without a ticket selection.");
    }

    const choice = page
      .getByRole("button")
      .filter({ hasText: String(fixture.ticket_name) })
      .first();
    await choice.click();
    const quantity = page.getByRole("spinbutton");
    const expectedMax = Math.min(
      Number(fixture.max_per_order),
      Number(fixture.remaining),
    );
    if (Number(await quantity.getAttribute("max")) !== expectedMax) {
      throw new Error("The browser quantity maximum differs from inventory.");
    }
    if (Number(await quantity.inputValue()) < Number(fixture.min_per_order)) {
      throw new Error("The browser quantity is below the ticket minimum.");
    }
    const checkout = page.getByRole("button", {
      name: /continue to checkout/i,
    });
    if (!(await checkout.isEnabled())) {
      throw new Error("Checkout did not unlock after ticket selection.");
    }

    const jwtSecret = process.env.JWT_SECRET || "";
    if (jwtSecret.length < 32) throw new Error("JWT_SECRET is not configured.");
    const accessToken = await new SignJWT({ userId: String(fixture.owner_id) })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("maxform-dashboard")
      .setIssuer("maxform")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(jwtSecret));
    const eventListResponse = await fetch(`${origin}/api/events/data`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operation: "listEvents", args: {} }),
    });
    const eventListBody = (await eventListResponse.json()) as {
      error?: string;
      value?: Array<{
        maximumTicketPrice?: number;
        minimumTicketPrice?: number;
        slug?: string;
        ticketCurrency?: string;
      }>;
    };
    const listedEvent = eventListBody.value?.find(
      (event) => event.slug === fixture.event_slug,
    );
    if (
      !eventListResponse.ok ||
      !listedEvent ||
      Number(listedEvent.minimumTicketPrice) !== Number(fixture.minimum_ticket_price) ||
      Number(listedEvent.maximumTicketPrice) !== Number(fixture.maximum_ticket_price) ||
      listedEvent.ticketCurrency !== fixture.ticket_currency
    ) {
      throw new Error(
        eventListBody.error || "The event card did not receive its live ticket prices.",
      );
    }
    const issuedTicketRows = await sql.query(
      `SELECT attendee.id, attendee.order_id, attendee.event_id
       FROM event_attendees attendee
       JOIN events event ON event.id = attendee.event_id
       WHERE attendee.ticket_status = 'valid'
         AND attendee.ticket_code IS NOT NULL
         AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
       ORDER BY attendee.created_at DESC
       LIMIT 1`,
    );
    let publicTicketDownloadWorks = false;
    const issuedTicket = issuedTicketRows[0] as {
      id?: string;
      order_id?: string;
      event_id?: string;
    } | undefined;
    if (issuedTicket?.event_id && (issuedTicket.order_id || issuedTicket.id)) {
      const downloadToken = createEventTicketDownloadToken({
        eventId: String(issuedTicket.event_id),
        ...(issuedTicket.order_id
          ? { orderId: String(issuedTicket.order_id) }
          : { attendeeId: String(issuedTicket.id) }),
      });
      const ticketDownloadResponse = await fetch(
        `${origin}/api/events/tickets?action=download&token=${encodeURIComponent(downloadToken)}`,
      );
      const ticketDownload = (await ticketDownloadResponse.json()) as {
        message?: string;
        tickets?: Array<{
          code?: string;
          design?: unknown;
          number?: string;
          ticketType?: string;
        }>;
      };
      if (
        !ticketDownloadResponse.ok ||
        !ticketDownload.tickets?.length ||
        !ticketDownload.tickets[0]?.code ||
        !ticketDownload.tickets[0]?.design ||
        !ticketDownload.tickets[0]?.number ||
        !ticketDownload.tickets[0]?.ticketType
      ) {
        throw new Error(
          ticketDownload.message || "The public ticket download link failed.",
        );
      }
      publicTicketDownloadWorks = true;
    }
    const validatorResponse = await fetch(
      `${origin}/api/events/tickets?action=validator-link`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    const validatorLink = (await validatorResponse.json()) as {
      maskedId?: string;
      message?: string;
    };
    if (!validatorResponse.ok || !validatorLink.maskedId) {
      throw new Error(
        validatorLink.message || "The authenticated validator link action failed.",
      );
    }
    const invalidScansBefore = await sql.query(
      `SELECT COUNT(*)::int AS total
       FROM event_ticket_scans
       WHERE attendee_id IS NULL`,
    );
    const dashboardScanResponse = await fetch(
      `${origin}/api/events/tickets?action=scan`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          station: "Browser smoke dashboard",
          ticketCode: `SMOKE-DASHBOARD-INVALID-${Date.now()}`,
        }),
      },
    );
    const dashboardScan = (await dashboardScanResponse.json()) as {
      message?: string;
      result?: string;
    };
    if (
      !dashboardScanResponse.ok ||
      dashboardScan.result !== "invalid_signature"
    ) {
      throw new Error(
        dashboardScan.message || "The dashboard check-in action failed.",
      );
    }
    await page.goto(
      `${origin}/${validatorLink.maskedId}/checkin`,
      { waitUntil: "networkidle" },
    );
    await page.getByText(String(fixture.workspace_name), { exact: true }).waitFor({
      state: "visible",
    });
    if (validatorLink.maskedId.length !== 22) {
      throw new Error("The public validator URL is not using a compact token.");
    }
    await page.getByLabel(/ticket number or qr code/i).fill(
      `SMOKE-INVALID-${Date.now()}`,
    );
    await page.getByRole("button", { name: /validate and check in/i }).click();
    await page.getByText(/not valid/i).waitFor({ state: "visible" });
    const invalidScansAfter = await sql.query(
      `SELECT COUNT(*)::int AS total
       FROM event_ticket_scans
       WHERE attendee_id IS NULL`,
    );
    if (
      Number(invalidScansAfter[0]?.total || 0) !==
      Number(invalidScansBefore[0]?.total || 0)
    ) {
      throw new Error("An invalid validator attempt was recorded as a scan.");
    }
    if (pageErrors.length) {
      throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
    }

    console.log(
      JSON.stringify({
        checkoutReady: true,
        dashboardCheckinActionReady: true,
        eventPagePreviewsTickets: true,
        eventPageTicketsAreReadOnly: true,
        eventCardUsesTicketPrice: true,
        invalidScanNotRecorded: true,
        publicValidatorRejectsInvalid: true,
        publicValidatorUsesWorkspaceBranding: true,
        shortWorkspaceValidatorUrl: true,
        quantityMaxRespected: true,
        selectorRequired: true,
        publicTicketDownloadWorks,
      }),
    );
  } finally {
    await browser.close();
  }
} finally {
  vite.kill();
}
