import { afterEach, describe, expect, it, vi } from "vitest";

import { emailProviderAdapters, resetToSendInfoCache } from "./email-adapters";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetToSendInfoCache();
});

describe("email provider adapters", () => {
  it("sends through Resend and returns its provider message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ id: "resend-message-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await emailProviderAdapters.resend.sendEmail(
      { api_key: "re_test_1234567890" },
      {
        from: { name: "MaxForm", email: "notifications@example.com" },
        replyTo: "reply@example.com",
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Hello</p>",
        text: "Hello",
      },
    );

    expect(result.messageId).toBe("resend-message-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("normalises provider DNS records for a custom domain", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({
        id: "domain-1",
        domain: "mail.example.com",
        status: "pending",
        records: [{ type: "TXT", name: "mail.example.com", value: "verification-token" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const domain = await emailProviderAdapters.resend.addDomain?.(
      { api_key: "re_test_1234567890" },
      "mail.example.com",
    );

    expect(domain).toMatchObject({
      id: "domain-1",
      domain: "mail.example.com",
      status: "pending",
      records: [{ type: "TXT", value: "verification-token" }],
    });
  });

  it("connects to Sender through its authenticated transactional API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await emailProviderAdapters.sender.getProviderStatus({
      api_key: "sender_test_token_123",
    });

    expect(result).toMatchObject({ healthy: true, validationMode: "api" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sender.net/v2/transactional?limit=1",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer sender_test_token_123",
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("sends the documented Sender transactional payload and returns its email id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ success: true, message: "Email sent", emailId: "sender-message-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await emailProviderAdapters.sender.sendEmail(
      { api_key: "sender_test_token_123" },
      {
        from: { name: "MaxForm", email: "notifications@example.com" },
        replyTo: "reply@example.com",
        to: "recipient@example.com",
        subject: "Ticket ready",
        html: "<p>Hello</p>",
        text: "Hello",
      },
    );

    expect(result).toMatchObject({
      messageId: "sender-message-1",
      response: { success: true, emailId: "sender-message-1" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sender.net/v2/message/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sender_test_token_123" });
    expect(JSON.parse(String(init.body))).toEqual({
      from: { email: "notifications@example.com", name: "MaxForm" },
      to: { email: "recipient@example.com" },
      subject: "Ticket ready",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { charset: "utf-8", "Reply-To": "reply@example.com" },
    });
  });

  it("rejects an unusable Sender delivery response instead of marking the email sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ success: true, message: "Email sent" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(emailProviderAdapters.sender.sendEmail(
      { api_key: "sender_test_token_123" },
      {
        from: { name: "MaxForm", email: "notifications@example.com" },
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Hello</p>",
        text: "Hello",
      },
    )).rejects.toMatchObject({ code: "provider_response_invalid", retryable: true });
  });

  it("simulates success, bounce, and complaint outcomes without network access", async () => {
    const input = {
      from: { name: "MaxForm", email: "notifications@example.com" },
      to: "recipient@example.com",
      subject: "Mock test",
      html: "<p>Hello</p>",
      text: "Hello",
    };
    vi.stubEnv("MOCK_EMAIL_OUTCOME", "success");
    await expect(emailProviderAdapters.mock.sendEmail({}, input)).resolves.toMatchObject({
      response: { mock: true, outcome: "success" },
    });

    await expect(emailProviderAdapters.mock.sendEmail({}, { ...input, to: "user+bounce@example.com" })).resolves.toMatchObject({
      response: { outcome: "bounce" },
    });
    await expect(emailProviderAdapters.mock.sendEmail({}, { ...input, to: "user+complaint@example.com" })).resolves.toMatchObject({
      response: { outcome: "complaint" },
    });
  });

  it("marks mock temporary failures as retryable", async () => {
    vi.stubEnv("MOCK_EMAIL_OUTCOME", "temporary");
    await expect(emailProviderAdapters.mock.sendEmail({}, {
      from: { name: "MaxForm", email: "notifications@example.com" },
      to: "recipient@example.com",
      subject: "Mock retry",
      html: "<p>Hello</p>",
      text: "Hello",
    })).rejects.toMatchObject({ code: "mock_temporary_failure", retryable: true });
  });

  it("sends the documented ToSend single-message payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "x-tenant-id": "tenant-1", "x-recipient-count": "1" }),
      text: async () => JSON.stringify({ message_id: "tosend-message-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await emailProviderAdapters.tosend.sendEmail(
      { api_key: "ts_test_1234567890" },
      {
        from: { name: "MaxForm", email: "notifications@example.com" },
        to: "recipient@example.com",
        subject: "ToSend test",
        html: "<p>Hello</p>",
        text: "Hello",
        messageHash: "campaign-message-1",
        tags: { module: "contacts" },
      },
    );

    expect(result.messageId).toBe("tosend-message-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tosend.com/v2/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer ts_test_1234567890" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: { name: "MaxForm", email: "notifications@example.com" },
      to: [{ email: "recipient@example.com" }],
      message_hash: "campaign-message-1",
      tags: { module: "contacts" },
    });
  });

  it("preserves ordered partial results from ToSend batch delivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 207,
      headers: new Headers(),
      text: async () => JSON.stringify({
        results: [
          { status: "success", message_id: "tosend-message-1" },
          { status: "error", error_type: "invalid_recipient", message: "Invalid recipient", status_code: 422 },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await emailProviderAdapters.tosend.sendBatch?.(
      { api_key: "ts_test_1234567890" },
      [
        { from: { email: "notifications@example.com" }, to: "one@example.com", subject: "One", html: "<p>1</p>", text: "1" },
        { from: { email: "notifications@example.com" }, to: "bad", subject: "Two", html: "<p>2</p>", text: "2" },
      ],
    );

    expect(result?.status).toBe(207);
    expect(result?.results).toEqual([
      expect.objectContaining({ ok: true, messageId: "tosend-message-1" }),
      expect.objectContaining({ ok: false, retryable: false, code: "provider_request_failed" }),
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toHaveProperty("emails");
  });

  it("reads and caches the ToSend account sending limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({
        account: { status: "active", limit_per_second: 12, credit_balance: 99, monthly_email_limit: 10000 },
        domains: [{ domain_name: "example.com", verification_status: "verified" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await emailProviderAdapters.tosend.getSendingLimits?.({ api_key: "ts_test_1234567890" });
    const second = await emailProviderAdapters.tosend.getSendingLimits?.({ api_key: "ts_test_1234567890" });
    expect(first).toMatchObject({ maxPerSecond: 12, creditBalance: 99, monthlyEmailLimit: 10000 });
    expect(second).toMatchObject({ maxPerSecond: 12 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(emailProviderAdapters.tosend.getSendingDomains({ api_key: "ts_test_1234567890" })).resolves.toEqual([
      expect.objectContaining({ domain: "example.com", status: "verified" }),
    ]);
  });
});
