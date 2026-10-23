import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssistantError,
  confirmAssistantAction,
  generateAiCanvas,
  listAiCanvasSessions,
  loadAssistantCapabilities,
  sendAssistantMessage,
} from "@/lib/ai-assistant";

const response = (value: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => value,
  }) as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("access_token", "test-token");
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : null };
};

describe("request shape", () => {
  it("sends the session token and the action as a query parameter", async () => {
    fetchMock.mockResolvedValue(
      response({ conversationId: "c1", message: "hi", pendingConfirmations: [] }),
    );
    await sendAssistantMessage({ message: "hello" });

    const { url, init } = lastCall();
    expect(url).toBe("/api/ai/assistant?action=chat");
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer test-token");
  });

  it("never sends a workspace id — the server takes it from the token", async () => {
    fetchMock.mockResolvedValue(
      response({ conversationId: "c1", message: "", pendingConfirmations: [] }),
    );
    await sendAssistantMessage({
      message: "hello",
      context: { module: "payments", section: "transactions" },
    });
    expect(JSON.stringify(lastCall().body)).not.toContain("workspace");
  });

  it("drops empty context fields rather than sending blanks", async () => {
    fetchMock.mockResolvedValue(
      response({ conversationId: "c1", message: "", pendingConfirmations: [] }),
    );
    await sendAssistantMessage({
      message: "hello",
      context: { module: "crm", section: "", recordId: undefined },
    });
    expect(lastCall().body.context).toEqual({ module: "crm" });
  });

  it("omits the conversation id on the first message and sends it after", async () => {
    fetchMock.mockResolvedValue(
      response({ conversationId: "c1", message: "", pendingConfirmations: [] }),
    );
    await sendAssistantMessage({ message: "first" });
    expect(lastCall().body).not.toHaveProperty("conversationId");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      response({ conversationId: "c1", message: "", pendingConfirmations: [] }),
    );
    await sendAssistantMessage({ message: "second", conversationId: "c1" });
    expect(lastCall().body.conversationId).toBe("c1");
  });

  it("passes the confirmation id as a query parameter", async () => {
    fetchMock.mockResolvedValue(response({ id: "p1", status: "confirmed" }));
    await confirmAssistantAction("p1");
    expect(lastCall().url).toBe("/api/ai/assistant?action=confirm&id=p1");
  });

  it("reads capabilities with GET and no body", async () => {
    fetchMock.mockResolvedValue(response({ available: true, tools: [] }));
    await loadAssistantCapabilities();
    const { url, init } = lastCall();
    expect(url).toBe("/api/ai/assistant?action=tools");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("uses the explicit canvas generation contract", async () => {
    fetchMock.mockResolvedValue(response({ session: { id: "canvas-1" } }));
    await generateAiCanvas({
      canvasType: "form_builder",
      prompt: "Create an event registration form",
      canvasState: { form: { title: "Registration" } },
    });
    expect(lastCall().url).toBe("/api/ai/assistant?action=generate");
    expect(lastCall().body).toMatchObject({
      canvasType: "form_builder",
      prompt: "Create an event registration form",
    });
  });

  it("lists saved canvas sessions through the workspace history action", async () => {
    fetchMock.mockResolvedValue(response({ sessions: [] }));
    await listAiCanvasSessions();
    expect(lastCall().url).toBe("/api/ai/assistant?action=canvases");
    expect(lastCall().init.method).toBe("GET");
  });
});

describe("failure handling", () => {
  it("refuses to call the endpoint without a session token", async () => {
    localStorage.clear();
    await expect(sendAssistantMessage({ message: "hi" })).rejects.toBeInstanceOf(
      AssistantError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's message and code", async () => {
    fetchMock.mockResolvedValue(
      response(
        { error: "You are sending messages too fast.", code: "ai_rate_limited" },
        false,
        429,
      ),
    );
    await expect(sendAssistantMessage({ message: "hi" })).rejects.toMatchObject({
      message: "You are sending messages too fast.",
      code: "ai_rate_limited",
      status: 429,
    });
  });

  it("falls back to a readable message when the body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    await expect(sendAssistantMessage({ message: "hi" })).rejects.toMatchObject({
      message: "MaxAI could not answer that.",
    });
  });
});
