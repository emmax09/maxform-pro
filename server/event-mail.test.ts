import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseQuery = vi.hoisted(() => vi.fn());
// The parameter is declared so `mock.calls[0][0]` has a type at all: a vi.fn()
// with no arguments records an empty tuple, and the assertions below read the
// input the module passed.
const sendEmailNow = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ id: "email-log-1" })),
);

vi.mock("../src/lib/db", () => ({ query: databaseQuery }));
vi.mock("./email-service", () => ({
  scheduleEmail: sendEmailNow,
  sendEmailNow,
}));
vi.mock("./workspace-email", () => ({
  getEmailWorkspace: vi.fn(),
  saveEmailTemplate: vi.fn(),
}));

import { sendEventAttendeeEmailsNow } from "./event-mail";

const eventId = "12b60c13-a582-40fb-b70a-07e907e1a7f0";
const attendeeId = "e85db125-3453-4754-92c7-24dc23bca100";
const orderId = "9d8c0a9b-dc1b-4e7a-9f2d-3f7779e25e10";
const originalEnvironment = { ...process.env };

const orderRow = {
  id: attendeeId,
  event_id: eventId,
  email: "",
  full_name: "Assigned attendee",
  ticket_number: "VIP-0001",
  ticket_code: "CODE-0001",
  ticket_type_id: "ticket-type-vip",
  issued_at: "2026-08-02T10:00:00.000Z",
  ticket_type: "VIP",
  ticket_price: 25000,
  currency: "NGN",
  created_by: "99b525e5-456b-4d68-bb85-5e054504435b",
  status: "published",
  title: "Launch night",
  description: "A MaxForm event",
  slug: "launch-night",
  event_date: "2026-08-20",
  schedule_start_time: "18:00",
  schedule_end_time: "22:00",
  timezone: "Africa/Lagos",
  location_type: "in_person",
  venue_name: "Main hall",
  address: "Lagos",
  online_url: "",
  settings: { mailSettings: { event_ticket_delivery: true } },
  event_code: "LAUNCH-2026",
  short_id: "LaunchSpace",
  support_email: "support@example.test",
  event_order_id: orderId,
  event_order_status: "confirmed",
  purchaser_email: "buyer@example.test",
  purchaser_name: "Buyer Example",
  event_order_total_amount: 50000,
  event_order_currency: "NGN",
  order_number: "ORD-0001",
  total_amount: 50000,
  payment_currency: "NGN",
  checkout_key: "",
};

describe("event ticket delivery dispatch", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "event-mail-test-secret".repeat(3);
    databaseQuery.mockReset();
    sendEmailNow.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("keeps every ticket for the purchaser when attendee emails differ or are blank", async () => {
    databaseQuery
      .mockResolvedValueOnce({ rows: [orderRow] })
      .mockResolvedValueOnce({
        rows: [
          { ...orderRow, email: "", full_name: "Assigned attendee", ticket_number: "VIP-0001", ticket_code: "CODE-0001", ticket_type: "VIP" },
          { ...orderRow, id: "b48f9b8d-2f7a-4b02-b5ea-9781b0e431de", email: "other-attendee@example.test", full_name: "Other attendee", ticket_number: "REG-0002", ticket_code: "CODE-0002", ticket_type: "Regular", ticket_price: 0 },
        ],
      });

    await sendEventAttendeeEmailsNow(eventId, attendeeId);

    expect(sendEmailNow).toHaveBeenCalledTimes(1);
    const input = sendEmailNow.mock.calls[0]?.[0] as {
      templateKey: string;
      to: string;
      relatedTicketIds: string[];
      variables: { ticket: { quantity: number }; tickets: { numbers: string; quantity: number } };
    };
    expect(input.templateKey).toBe("event_ticket_delivery");
    expect(input.to).toBe("buyer@example.test");
    expect(input.relatedTicketIds).toEqual([
      attendeeId,
      "b48f9b8d-2f7a-4b02-b5ea-9781b0e431de",
    ]);
    expect(input.variables.ticket.quantity).toBe(2);
    expect(input.variables.tickets).toMatchObject({
      quantity: 2,
      numbers: "VIP-0001, REG-0002",
    });
  });

  it("does not queue delivery when the event disabled its own template", async () => {
    databaseQuery
      .mockResolvedValueOnce({ rows: [{ ...orderRow, settings: { mailSettings: { event_ticket_delivery: false } } }] })
      .mockResolvedValueOnce({ rows: [orderRow] });

    await sendEventAttendeeEmailsNow(eventId, attendeeId);

    expect(sendEmailNow).not.toHaveBeenCalled();
  });
});
