// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  eventCheckoutConfigured,
  initializePaystackCheckout,
  publicEventTicketForStatus,
  providerPaymentStatus,
  verifyPaystackCallback,
} from "./payment-checkout";
import { verifyPaystack } from "./payment-providers";

const secretKey = "sk_test_maxform_server_only_secret";
const publicKey = "pk_test_maxform_public_key";

const jsonResponse = (value: Record<string, unknown>) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Paystack server contract", () => {
  it("keeps free event tickets in checkout so secure tickets are issued", () => {
    expect(
      eventCheckoutConfigured({
        event_has_paid_tickets: false,
        event_id: "event-free",
        ticketing_enabled: true,
      }),
    ).toBe(true);
  });

  it("returns the exact saved event design and dynamic purchased ticket data", () => {
    const frontLayout = [
      { id: "type", label: "Ticket type", type: "ticket_type" },
    ];
    const backLayout = [
      { id: "number", label: "Ticket number", type: "ticket_number" },
    ];
    const theme = {
      accent: "#FF5500",
      background: "#111111",
      edge: "perforated",
      motif: "dots",
      muted: "#999999",
      text: "#FFFFFF",
    };

    const ticket = publicEventTicketForStatus(
      {
        attendee_email: "buyer@example.test",
        attendee_name: "Checkout Buyer",
        design_id: "event-design-id",
        event_code: "EVTEST-",
        event_title: "Live event",
        template_id: "workspace-edited-template",
        ticket_back_layout: backLayout,
        ticket_currency: "NGN",
        ticket_front_layout: frontLayout,
        ticket_number: "EVTEST-123456789012",
        ticket_price: 25000,
        ticket_theme: theme,
        ticket_type_name: "VIP",
      },
      { currency: "NGN", order_number: "MF-ORDER-1" },
      "mfe1.signed.valid-code",
    );

    expect(ticket).toMatchObject({
      attendeeName: "Checkout Buyer",
      code: "mfe1.signed.valid-code",
      number: "EVTEST-123456789012",
      orderCode: "MF-ORDER-1",
      price: 25000,
      ticketType: "VIP",
    });
    expect(ticket.design).toEqual({
      backLayout,
      frontLayout,
      templateId: "workspace-edited-template",
      theme,
    });
  });

  it("verifies a connection without returning secret credentials to clients", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${secretKey}`,
      });
      return jsonResponse({ status: true, data: { total_transactions: 0 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const verified = await verifyPaystack({ publicKey, secretKey });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/totals",
      expect.any(Object),
    );
    expect(verified.identity.hint).not.toContain(secretKey);
    expect(JSON.stringify(verified.identity)).not.toContain(secretKey);
  });

  it("initializes hosted checkout with canonical minor units and metadata", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        amount: 12500,
        currency: "NGN",
        email: "buyer@example.test",
        reference: "MF-PAYSTACK-SMOKE",
      });
      expect(body.metadata).toEqual({
        customer_name: "Checkout Buyer",
        maxform_order_id: "5cae8ca1-af5f-4af7-9233-8f556a9e8791",
      });
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${secretKey}`,
      });
      return jsonResponse({
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.test/session",
          reference: "MF-PAYSTACK-SMOKE",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await initializePaystackCheckout(
      {
        amount: 125,
        billingInterval: null,
        billingType: "one_time",
        cancelUrl: "https://maxform.test/cancel",
        currency: "NGN",
        customerEmail: "buyer@example.test",
        customerName: "Checkout Buyer",
        itemName: "Paid registration",
        orderId: "5cae8ca1-af5f-4af7-9233-8f556a9e8791",
        orderNumber: "MF-PAYSTACK-SMOKE",
        productId: null,
        returnUrl: "https://maxform.test/verify",
        webhookUrl: "https://maxform.test/webhook",
      },
      { publicKey, secretKey },
    );

    expect(result).toEqual({
      reference: "MF-PAYSTACK-SMOKE",
      url: "https://checkout.paystack.test/session",
    });
    expect(JSON.stringify(result)).not.toContain(secretKey);
  });

  it("confirms only matching successful Paystack transactions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: true,
          data: {
            amount: 12500,
            currency: "NGN",
            reference: "MF-PAYSTACK-SMOKE",
            status: "success",
          },
        }),
      ),
    );

    const paid = await providerPaymentStatus(
      {
        currency: "NGN",
        provider: "paystack",
        provider_reference: "MF-PAYSTACK-SMOKE",
        total_amount: 125,
      },
      { secretKey },
    );
    const wrongAmount = await providerPaymentStatus(
      {
        currency: "NGN",
        provider: "paystack",
        provider_reference: "MF-PAYSTACK-SMOKE",
        total_amount: 126,
      },
      { secretKey },
    );

    expect(paid.paid).toBe(true);
    expect(wrongAmount.paid).toBe(false);
  });

  it("does not treat a PayPal subscription approval as a completed payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/v1/oauth2/token")) {
          return jsonResponse({ access_token: "paypal-server-token" });
        }
        if (url.includes("SUBSCRIPTION-APPROVED")) {
          return jsonResponse({ status: "APPROVED", id: "SUBSCRIPTION-APPROVED" });
        }
        return jsonResponse({
          status: "ACTIVE",
          id: "SUBSCRIPTION-ACTIVE",
          billing_info: {
            last_payment: {
              amount: { currency_code: "USD", value: "25.00" },
            },
          },
        });
      }),
    );

    const approved = await providerPaymentStatus(
      {
        billing_type: "recurring",
        currency: "USD",
        provider: "paypal",
        provider_reference: "SUBSCRIPTION-APPROVED",
        total_amount: 25,
      },
      { merchantId: "merchant-test" },
    );
    const activeAndPaid = await providerPaymentStatus(
      {
        billing_type: "recurring",
        currency: "USD",
        provider: "paypal",
        provider_reference: "SUBSCRIPTION-ACTIVE",
        total_amount: 25,
      },
      { merchantId: "merchant-test" },
    );
    const wrongAmount = await providerPaymentStatus(
      {
        billing_type: "recurring",
        currency: "USD",
        provider: "paypal",
        provider_reference: "SUBSCRIPTION-ACTIVE",
        total_amount: 26,
      },
      { merchantId: "merchant-test" },
    );

    expect(approved.paid).toBe(false);
    expect(activeAndPaid.paid).toBe(true);
    expect(wrongAmount.paid).toBe(false);
  });

  it("uses constant-shape signature verification for Paystack callbacks", () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "MF-PAYSTACK-SMOKE" },
    });
    const signature = createHmac("sha512", secretKey)
      .update(body)
      .digest("hex");

    expect(verifyPaystackCallback(body, signature, secretKey)).toBe(true);
    expect(verifyPaystackCallback(body, "invalid", secretKey)).toBe(false);
    expect(verifyPaystackCallback(body, signature, "")).toBe(false);
  });
});
