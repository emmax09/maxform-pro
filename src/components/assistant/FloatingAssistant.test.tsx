import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingAssistant } from "@/components/assistant/FloatingAssistant";
import type { AssistantScreenContext } from "@/lib/ai-assistant";

const response = (value: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => value }) as Response;

const capabilities = (available = true) =>
  response({
    available,
    provider: "anthropic",
    model: "claude-opus-5",
    tools: [
      {
        name: "send_email",
        description: "Send an email.",
        module: "emails",
        requiresConfirmation: true,
      },
    ],
  });

const fetchMock = vi.fn();

const route = (handlers: Record<string, () => Response>) => {
  fetchMock.mockImplementation(async (url: string) => {
    const action = new URL(url, "http://localhost").searchParams.get("action") || "";
    const handler = handlers[action];
    if (!handler) throw new Error(`unstubbed action: ${action}`);
    return handler();
  });
};

const context: AssistantScreenContext = {
  module: "payments",
  section: "transactions",
};

const renderAssistant = (
  screenContext = context,
  fullName?: string,
  workspaceLogo?: string,
) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FloatingAssistant
        context={screenContext}
        fullName={fullName}
        workspaceLogo={workspaceLogo}
      />
    </QueryClientProvider>,
  );
};

const openPanel = async () => {
  fireEvent.click(screen.getByRole("button", { name: /open maxai/i }));
  return screen.findByRole("dialog", { name: /maxai/i });
};

const openChat = () => {
  const button = screen.queryByRole("button", {
    name: /open chat|continue conversation/i,
  });
  if (button) fireEvent.click(button);
};

const send = (message: string) => {
  openChat();
  fireEvent.change(screen.getByLabelText(/message maxai/i), {
    target: { value: message },
  });
  fireEvent.click(screen.getByRole("button", { name: /send message/i }));
};

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("access_token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("launcher", () => {
  it("starts closed and does not load AI until opened", () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an attached launch prompt beside the AI icon", () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    expect(
      screen.getByRole("button", { name: /ask maxai about this screen/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Need a hand?")).toBeInTheDocument();
  });

  it("opens the panel and closes on Escape", async () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    await openPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("home screen", () => {
  it("opens on a branded home screen rather than an empty chat box", async () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    await openPanel();
    expect(screen.getByLabelText(/assistant home/i)).toBeInTheDocument();
    expect(screen.getByText(/how can I help/i)).toBeInTheDocument();
    expect(screen.getByText(/ask before anything gets sent/i)).toBeInTheDocument();
  });

  it("suggests openers for the current screen", async () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    await openPanel();
    expect(
      screen.getByRole("button", { name: /is a payment provider connected/i }),
    ).toBeInTheDocument();
  });

  it("sends a suggestion and leaves home", async () => {
    route({
      tools: () => capabilities(),
      chat: () =>
        response({
          conversationId: "c1",
          message: "Yes, Stripe is connected.",
          messageId: "m1",
          pendingConfirmations: [],
        }),
    });
    renderAssistant();
    await openPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /is a payment provider connected/i }),
    );
    expect(await screen.findByText("Yes, Stripe is connected.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/assistant home/i)).toBeNull();
  });

  it("greets by first name when the shell knows it", async () => {
    route({ tools: () => capabilities() });
    renderAssistant(context, "Ada Lovelace");
    await openPanel();
    expect(screen.getByText(/Hi Ada, how can I help/i)).toBeInTheDocument();
  });

  it("opens the dedicated chat screen from the home CTA", async () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }));
    expect(screen.getByLabelText(/message maxai/i)).toBeInTheDocument();
    expect(screen.getByText("Chat with MaxAI")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("action=chat"))).toBe(false);
  });

  it("closes the current conversation and returns to home", async () => {
    route({
      tools: () => capabilities(),
      chat: () =>
        response({
          conversationId: "c-close",
          message: "This is the conversation to close.",
          pendingConfirmations: [],
        }),
    });
    renderAssistant();
    await openPanel();
    send("start a conversation");
    expect(await screen.findByText("This is the conversation to close.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close conversation/i }));
    expect(screen.getByLabelText(/assistant home/i)).toBeInTheDocument();
    expect(screen.queryByText("This is the conversation to close.")).toBeNull();
  });

  it("uses the workspace identity for person messages and the MaxAI brand for assistant messages", async () => {
    route({
      tools: () => capabilities(),
      chat: () =>
        response({
          conversationId: "c-identity",
          message: "I can help with that.",
          pendingConfirmations: [],
        }),
    });
    renderAssistant(context, undefined, "https://assets.example.test/workspace.png");
    await openPanel();
    send("hello");

    expect(await screen.findByText("I can help with that.")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Workspace identity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "MaxAI" })).toBeInTheDocument();
  });
});

describe("workspace context", () => {
  it("shows the current module and section without leaving workspace scope", async () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    await openPanel();
    expect(screen.getByText(/Payments \/ transactions/)).toBeInTheDocument();
    expect(screen.getAllByText(/Workspace only/i).length).toBeGreaterThan(0);
  });

  it("sends module context and no client-selected workspace id", async () => {
    route({
      tools: () => capabilities(),
      chat: () =>
        response({ conversationId: "c1", message: "The card was declined.", pendingConfirmations: [] }),
    });
    renderAssistant({ ...context, recordType: "order", recordId: "o-1" });
    await openPanel();
    send("why did this fail?");
    await screen.findByText("The card was declined.");
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("action=chat"));
    const body = JSON.parse(String((chatCall?.[1] as RequestInit).body));
    expect(body.context).toEqual({
      module: "payments",
      section: "transactions",
      recordType: "order",
      recordId: "o-1",
    });
    expect(body.workspaceId).toBeUndefined();
  });

  it("carries the conversation id into the next message", async () => {
    route({
      tools: () => capabilities(),
      chat: () => response({ conversationId: "c1", message: "ok", pendingConfirmations: [] }),
    });
    renderAssistant();
    await openPanel();
    send("first");
    await screen.findByText("ok");
    send("second");
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("action=chat"));
      expect(calls).toHaveLength(2);
      const body = JSON.parse(String((calls[1][1] as RequestInit).body));
      expect(body.conversationId).toBe("c1");
    });
  });
});

describe("failures", () => {
  it("explains an unconfigured deployment and disables input", async () => {
    route({ tools: () => capabilities(false) });
    renderAssistant();
    await openPanel();
    openChat();
    expect(await screen.findByText(/MaxAI is not switched on/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/message maxai/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /open ai settings/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /retry connection/i })).toBeEnabled();
  });

  it("surfaces a send failure and removes the unanswered turn", async () => {
    route({
      tools: () => capabilities(),
      chat: () => response({ error: "The assistant is busy." }, false, 429),
    });
    renderAssistant();
    await openPanel();
    send("hello");
    expect(await screen.findByRole("alert")).toHaveTextContent("The assistant is busy.");
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("makes a provider quota failure actionable", async () => {
    route({
      tools: () => capabilities(),
      chat: () =>
        response(
          { error: "Gemini usage limit reached. Check provider quota.", code: "ai_quota_exceeded" },
          false,
          503,
        ),
    });
    renderAssistant();
    await openPanel();
    send("hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Gemini usage limit/i);
    expect(screen.getByRole("button", { name: /open ai settings/i })).toBeInTheDocument();
  });
});

describe("confirmation", () => {
  const withPending = () =>
    response({
      conversationId: "c1",
      message: "I have drafted it.",
      pendingConfirmations: [
        {
          id: "p1",
          actionType: "send_email",
          summary: 'Send an email to sam@example.com with the subject "Hello".',
        },
      ],
    });

  it("shows a proposal as pending approval rather than done", async () => {
    route({ tools: () => capabilities(), chat: withPending });
    renderAssistant();
    await openPanel();
    send("email sam");
    expect(await screen.findByText(/needs your approval/i)).toBeInTheDocument();
    expect(screen.getByText(/sam@example.com/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("action=confirm"))).toBe(false);
  });

  it("runs the action only after approval", async () => {
    route({
      tools: () => capabilities(),
      chat: withPending,
      confirm: () => response({ id: "p1", status: "confirmed" }),
    });
    renderAssistant();
    await openPanel();
    send("email sam");
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("action=confirm&id=p1"))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText(/needs your approval/i)).toBeNull());
  });

  it("cancels without sending", async () => {
    route({
      tools: () => capabilities(),
      chat: withPending,
      decline: () => response({ id: "p1", status: "declined" }),
    });
    renderAssistant();
    await openPanel();
    send("email sam");
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(await screen.findByText(/nothing was sent/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("action=confirm"))).toBe(false);
  });

  it("keeps the card when approval fails", async () => {
    route({
      tools: () => capabilities(),
      chat: withPending,
      confirm: () => response({ error: "That action expired." }, false, 409),
    });
    renderAssistant();
    await openPanel();
    send("email sam");
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    expect(await screen.findByText("That action expired.")).toBeInTheDocument();
    expect(screen.getByText(/needs your approval/i)).toBeInTheDocument();
  });

  it("does not expose human support escalation", async () => {
    route({ tools: () => capabilities() });
    renderAssistant();
    await openPanel();
    expect(screen.queryByRole("button", { name: /talk to a human/i })).toBeNull();
  });
});
