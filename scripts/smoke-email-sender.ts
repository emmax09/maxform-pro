import { emailProviderAdapters } from "../server/email-adapters";

const calls: Array<{ url: string; init: RequestInit }> = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const requestInit = init || {};
  calls.push({ url, init: requestInit });
  if (requestInit.method === "POST") {
    return new Response(
      JSON.stringify({ success: true, message: "Email sent", emailId: "sender-smoke-message" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

try {
  const credentials = { api_key: "sender_smoke_token_123" };
  const status = await emailProviderAdapters.sender.getProviderStatus(credentials);
  if (!status.healthy || status.validationMode !== "api") {
    throw new Error("Sender health smoke did not return an API-validated healthy status.");
  }
  const delivery = await emailProviderAdapters.sender.sendEmail(credentials, {
    from: { name: "MaxForm", email: "notifications@example.com" },
    replyTo: "reply@example.com",
    to: "recipient@example.com",
    subject: "Sender smoke test",
    html: "<p>Sender adapter smoke test</p>",
    text: "Sender adapter smoke test",
  });
  if (delivery.messageId !== "sender-smoke-message") {
    throw new Error("Sender smoke did not preserve the provider message id.");
  }
  if (calls[0]?.url !== "https://api.sender.net/v2/transactional?limit=1") {
    throw new Error("Sender smoke used an unexpected health endpoint.");
  }
  if (calls[1]?.url !== "https://api.sender.net/v2/message/send" || calls[1]?.init.method !== "POST") {
    throw new Error("Sender smoke used an unexpected transactional send endpoint.");
  }
  const body = JSON.parse(String(calls[1]?.init.body || "{}")) as Record<string, unknown>;
  if ((body.from as Record<string, unknown>)?.email !== "notifications@example.com"
    || (body.to as Record<string, unknown>)?.email !== "recipient@example.com") {
    throw new Error("Sender smoke did not build the documented address payload.");
  }
  console.log("Sender adapter smoke passed: authenticated health / transactional send / message id");
} finally {
  globalThis.fetch = originalFetch;
}
