import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIWorkspaceModule } from "@/components/assistant/AIWorkspaceModule";
import { AssistantControllerProvider } from "@/components/assistant/AssistantControllerProvider";
import { FloatingAssistant } from "@/components/assistant/FloatingAssistant";

const response = (value: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => value,
  }) as Response;

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Why did this payment fail?",
  status: "active",
  surface: "floating",
  context: { module: "payments" },
  updatedAt: new Date().toISOString(),
  messageCount: 4,
};

const generation = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Follow-up email",
  content: "Hello Sam, following up on your order.",
  conversationId: conversation.id,
  createdAt: new Date().toISOString(),
};

const fetchMock = vi.fn();

const route = (handlers: Record<string, () => Response>) => {
  fetchMock.mockImplementation(async (url: string) => {
    const action = new URL(url, "http://localhost").searchParams.get("action") || "";
    const handler = handlers[action];
    if (!handler) throw new Error(`unstubbed action: ${action}`);
    return handler();
  });
};

const defaultRoutes = {
  conversations: () => response({ conversations: [conversation] }),
  generations: () => response({ generations: [generation] }),
  insights: () => response({ insights: [] }),
  canvases: () => response({ sessions: [] }),
  settings: () =>
    response({
      settings: [],
      provider: {
        configured: false,
        provider: "",
        model: "",
        label: "",
        source: "environment",
      },
      canManage: false,
    }),
};

/** Mounts the tab beside the assistant, which is how they ship. */
const renderWorkspace = (withAssistant = false) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssistantControllerProvider>
        <AIWorkspaceModule />
        {withAssistant ? (
          <FloatingAssistant context={{ module: "ai" }} />
        ) : null}
      </AssistantControllerProvider>
    </QueryClientProvider>,
  );
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

describe("conversation history", () => {
  it("lists the person's own conversations", async () => {
    route(defaultRoutes);
    renderWorkspace();
    expect(
      await screen.findByText("Why did this payment fail?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/4 messages/)).toBeInTheDocument();
  });

  it("says nothing is there rather than showing an empty list", async () => {
    route({
      conversations: () => response({ conversations: [] }),
      generations: () => response({ generations: [] }),
    });
    renderWorkspace();
    expect(await screen.findByText(/Nothing yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/Nothing saved yet/i)).toBeInTheDocument();
  });

  it("marks a conversation that went to a person", async () => {
    route({
      ...defaultRoutes,
      conversations: () =>
        response({ conversations: [{ ...conversation, status: "escalated" }] }),
    });
    renderWorkspace();
    expect(await screen.findByText(/With a person/i)).toBeInTheDocument();
  });

  it("reports a load failure instead of showing a blank tab", async () => {
    route({
      conversations: () => response({ error: "nope" }, false, 500),
      generations: () => response({ generations: [] }),
    });
    renderWorkspace();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be loaded/i,
    );
  });
});

describe("MaxAI home analytics", () => {
  it("keeps the overview focused on assistant usage rather than workspace business metrics", async () => {
    route(defaultRoutes);
    renderWorkspace();

    expect(await screen.findByText("MaxAI pulse")).toBeInTheDocument();
    expect(await screen.findByText("AI conversations")).toBeInTheDocument();
    expect(screen.getByText("Assistant turns")).toBeInTheDocument();
    expect(screen.getByText("Saved AI outputs")).toBeInTheDocument();
    expect(screen.getByText("Assistant activity")).toBeInTheDocument();
    expect(screen.queryByText("Contacts added", { exact: true })).toBeNull();
    expect(screen.queryByText("Paid revenue", { exact: true })).toBeNull();
  });
});

describe("driving the assistant", () => {
  it("opens a past conversation in the assistant rather than a second chat", async () => {
    route({
      ...defaultRoutes,
      tools: () => response({ available: true, tools: [] }),
      conversation: () =>
        response({
          id: conversation.id,
          status: "active",
          surface: "floating",
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "The card was declined.",
              createdAt: new Date().toISOString(),
            },
          ],
          pendingConfirmations: [],
        }),
    });
    renderWorkspace(true);

    fireEvent.click(await screen.findByText("Why did this payment fail?"));

    expect(
      await screen.findByRole("dialog", { name: /maxai/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText("The card was declined.")).toBeInTheDocument();
    // Read back from the server, not trusted from the list row.
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(`action=conversation&id=${conversation.id}`),
      ),
    ).toBe(true);
  });

  it("starts a generator by sending the prompt for the person", async () => {
    route({
      ...defaultRoutes,
      tools: () => response({ available: true, tools: [] }),
      chat: () =>
        response({
          conversationId: "c9",
          message: "Sure — what is the form for?",
          messageId: "m9",
          pendingConfirmations: [],
        }),
    });
    renderWorkspace(true);

    fireEvent.click(await screen.findByRole("button", { name: /draft a form/i }));

    expect(
      await screen.findByText("Sure — what is the form for?"),
    ).toBeInTheDocument();
    const chatCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("action=chat"),
    );
    const body = JSON.parse(String((chatCall?.[1] as RequestInit).body));
    expect(body.message).toMatch(/design a form/i);
    // A generator starts fresh; it must not continue whatever was open.
    expect(body).not.toHaveProperty("conversationId");
  });

  it("does nothing but stay quiet when no assistant is mounted", async () => {
    route(defaultRoutes);
    renderWorkspace(false);
    fireEvent.click(await screen.findByRole("button", { name: /draft a form/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("action=chat")),
      ).toBe(false),
    );
  });
});

describe("saved generations", () => {
  it("shows what was kept", async () => {
    route(defaultRoutes);
    renderWorkspace();
    expect(await screen.findByText("Follow-up email")).toBeInTheDocument();
    expect(
      screen.getByText("Hello Sam, following up on your order."),
    ).toBeInTheDocument();
  });

  it("removes one and refreshes the list", async () => {
    let generations = [generation];
    route({
      conversations: () => response({ conversations: [] }),
      generations: () => response({ generations }),
      unsave: () => {
        generations = [];
        return response({ id: generation.id, deleted: true });
      },
    });
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /remove/i }));

    await waitFor(() =>
      expect(screen.queryByText("Follow-up email")).toBeNull(),
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(`action=unsave&id=${generation.id}`),
      ),
    ).toBe(true);
  });
});

describe("provider settings", () => {
  it("uses provider cards with setup links and an explicit active provider selector", async () => {
    route({
      ...defaultRoutes,
      settings: () =>
        response({
          settings: [],
          provider: {
            configured: true,
            provider: "gemini",
            model: "gemini-2.5-flash",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            label: "Google Gemini",
            source: "database",
          },
          canManage: true,
        }),
    });
    renderWorkspace(false);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(await screen.findByText("Active AI provider")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Active AI provider" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect active AI provider" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Google Gemini/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("link", { name: /get a gemini api key/i })).toHaveAttribute(
      "href",
      "https://aistudio.google.com/app/apikey",
    );
    expect(screen.getByText("https://generativelanguage.googleapis.com/v1beta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get an anthropic api key/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get an openai api key/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /compatible provider guide/i })).toBeInTheDocument();
  });

  it("opens a secure connect modal with fixed official provider metadata", async () => {
    route({
      ...defaultRoutes,
      settings: () =>
        response({
          settings: [],
          provider: { configured: false, provider: "", model: "", baseUrl: "", label: "", source: "environment" },
          providers: [],
          canManage: true,
        }),
    });
    renderWorkspace(false);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("button", { name: "Chat & build" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Anthropic" }));

    expect(await screen.findByRole("dialog", { name: /connect anthropic/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Provider name")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Base URL")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "password");
    expect(screen.queryByText("Set as active provider")).toBeNull();
  });
});

describe("generative workspace", () => {
  it("opens an editable canvas beside the chat for a form generator", async () => {
    route(defaultRoutes);
    renderWorkspace(false);

    fireEvent.click(await screen.findByRole("button", { name: /draft a form/i }));

    expect(await screen.findByRole("region", { name: "Generative canvas" })).toBeInTheDocument();
    expect(screen.getByText(/Editable Forms canvas/i)).toBeInTheDocument();
  });

  it("renders an insight and lets the person dismiss it", async () => {
    let open = true;
    const insight = {
      id: "33333333-3333-4333-8333-333333333333",
      module: "events",
      signalType: "registration_drop",
      severity: "warning",
      explanation: "Registrations dropped this week. Review ticket availability.",
      relatedRecordType: "event",
      relatedRecordId: "44444444-4444-4444-8444-444444444444",
      status: "open",
      snoozedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    route({
      ...defaultRoutes,
      insights: () => response({ insights: open ? [insight] : [] }),
      insight: () => {
        open = false;
        return response({ insight: { ...insight, status: "dismissed" } });
      },
    });
    renderWorkspace(false);
    fireEvent.click(await screen.findByRole("button", { name: "Insights" }));

    expect(await screen.findByText(insight.explanation)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(insight.explanation)).toBeNull());
  });
});
