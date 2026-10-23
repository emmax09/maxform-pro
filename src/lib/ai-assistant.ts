/**
 * Browser client for the AI assistant.
 *
 * Every surface -- the floating bubble, the AI Workspace tab, and any
 * in-module entry point added later -- goes through these functions rather
 * than calling fetch directly, so the request shape and the error handling
 * stay in one place. The server decides what the assistant may do; nothing
 * here can widen that, and the workspace is always taken from the session
 * token rather than sent from the browser.
 */

export type AssistantSurface = "floating" | "workspace" | "module";

/**
 * What the person is looking at. Sent with every message so the assistant can
 * answer "why did this fail" without them having to say which record.
 */
export type AssistantScreenContext = {
  module?: string;
  section?: string;
  recordType?: string;
  recordId?: string;
  lastError?: string;
};

export type PendingConfirmation = {
  id: string;
  actionType: string;
  summary: string;
};

export type AssistantChatResult = {
  conversationId: string;
  message: string;
  /** The stored id of this answer, for saving it. Empty when there is none. */
  messageId: string;
  pendingConfirmations: PendingConfirmation[];
  /** True when the model declined the request. */
  refused: boolean;
  model: string;
  provider: string;
  workspaceChanges?: WorkspaceChange[];
};

export type WorkspaceChange = {
  module: "forms" | "events" | "appointments";
  action: "created";
  recordId: string;
  label: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AssistantConversation = {
  id: string;
  status: "active" | "escalated" | "resolved";
  surface: string;
  messages: AssistantMessage[];
  pendingConfirmations: PendingConfirmation[];
};

export type AssistantTool = {
  name: string;
  description: string;
  module: string;
  requiresConfirmation: boolean;
};

export type AssistantCapabilities = {
  /** False when no provider key is configured for this deployment. */
  available: boolean;
  provider: string;
  model: string;
  reason?: string;
  tools: AssistantTool[];
};

export type AiCanvasType =
  | "form_builder"
  | "event_builder"
  | "appointment_booking_page"
  | "analytics_chart"
  | "crm_table"
  | "campaign_builder"
  | "document_template"
  | "generic_module";

export type AiCanvasSession = {
  id: string;
  conversationId: string | null;
  canvasType: AiCanvasType;
  title: string;
  canvasState: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AiInsight = {
  id: string;
  module: string;
  signalType: string;
  severity: "info" | "warning" | "critical";
  explanation: string;
  relatedRecordType: string | null;
  relatedRecordId: string | null;
  status: "open" | "dismissed" | "snoozed" | "resolved";
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiModuleAccessSetting = {
  module: string;
  label: string;
  description: string;
  accessEnabled: boolean;
  dashboardAllowed: boolean;
  requiresConfirmationFor: string[];
  updatedAt: string | null;
};

export type AiWorkspaceSettings = {
  settings: AiModuleAccessSetting[];
  provider: {
    connectionId?: string;
    configured: boolean;
    provider: string;
    model: string;
    baseUrl: string;
    label: string;
    source: "database" | "environment";
    apiKeyConfigured: boolean;
    apiKeyHint: string;
    reason?: string;
  };
  providers: AiProviderConnection[];
  canManage: boolean;
};

export type AiProviderConnection = {
  id: string;
  connectionId?: string;
  configured: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  label: string;
  source: "database" | "environment";
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  isActive: boolean;
  updatedAt: string | null;
  reason?: string;
};

export type ConfirmationResult = {
  id: string;
  status: "confirmed" | "declined";
  actionType?: string;
  workspaceChanges?: WorkspaceChange[];
};

export class AssistantError extends Error {
  constructor(
    message: string,
    readonly code = "ai_error",
    readonly status = 500,
  ) {
    super(message);
  }
}

// Keep a stalled provider from leaving the composer in a permanent loading
// state. The server has a shorter provider deadline, but this covers network
// buffering and serverless cold starts as well.
const ASSISTANT_REQUEST_TIMEOUT_MS = 55_000;

const assistantRequest = async <T>(
  action: string,
  params: Record<string, string> = {},
  body?: object,
): Promise<T> => {
  const token = localStorage.getItem("access_token") || "";
  if (!token) {
    throw new AssistantError(
      "Sign in again to use MaxAI.",
      "authentication_required",
      401,
    );
  }
  const query = new URLSearchParams({ action, ...params });
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    ASSISTANT_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(`/api/ai/assistant?${query.toString()}`, {
      method: body ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as Error | null)?.name === "AbortError";
    throw new AssistantError(
      aborted
        ? "MaxAI took too long to answer. Please try again."
        : "MaxAI could not be reached. Please try again.",
      aborted
        ? "ai_timeout"
        : "ai_unreachable",
      503,
    );
  } finally {
    window.clearTimeout(timeout);
  }
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new AssistantError(
      result.error || "MaxAI could not answer that.",
      result.code || "ai_error",
      response.status,
    );
  }
  return result;
};

/** Drops empty fields so the request carries only what the screen actually knows. */
const cleanContext = (context: AssistantScreenContext) =>
  Object.fromEntries(
    Object.entries(context).filter(([, value]) => Boolean(value)),
  );

/**
 * Lets the dashboard refresh active module queries after an approved AI
 * action. The event is intentionally generic: a module can be mounted or
 * lazy-loaded after the assistant action and still receive the next refresh.
 */
export const notifyWorkspaceChanged = (changes: WorkspaceChange[] = []) => {
  if (!changes.length || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("maxform:workspace-changed", {
      detail: { changes },
    }),
  );
};

export const sendAssistantMessage = (input: {
  message: string;
  conversationId?: string | null;
  surface?: AssistantSurface;
  context?: AssistantScreenContext;
}) =>
  assistantRequest<AssistantChatResult>("chat", {}, {
    message: input.message,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    surface: input.surface || "floating",
    context: cleanContext(input.context || {}),
  });

/**
 * Runs an action the assistant proposed. Nothing has happened until this
 * resolves: the server holds the action as a proposal until it is called.
 */
export const confirmAssistantAction = (id: string) =>
  assistantRequest<ConfirmationResult>("confirm", { id }, {});

export const declineAssistantAction = (id: string) =>
  assistantRequest<ConfirmationResult>("decline", { id }, {});

export const loadAssistantConversation = (id: string) =>
  assistantRequest<AssistantConversation>("conversation", { id });

export type AssistantConversationSummary = {
  id: string;
  title: string;
  status: "active" | "escalated" | "resolved";
  surface: string;
  context: AssistantScreenContext;
  updatedAt: string;
  /** Turns a person would read: tool plumbing is not counted. */
  messageCount: number;
};

export const listAssistantConversations = () =>
  assistantRequest<{ conversations: AssistantConversationSummary[] }>(
    "conversations",
  ).then((result) => result.conversations);

export type SavedGeneration = {
  id: string;
  title: string;
  content: string;
  conversationId: string | null;
  createdAt: string;
};

/**
 * Keeps one assistant message. Only the message id is sent -- the server
 * copies the text from its own row, so what is saved is what was actually
 * said.
 */
export const saveGeneration = (input: { messageId: string; title?: string }) =>
  assistantRequest<SavedGeneration>("save", {}, {
    messageId: input.messageId,
    ...(input.title ? { title: input.title } : {}),
  });

export const listSavedGenerations = () =>
  assistantRequest<{ generations: SavedGeneration[] }>("generations").then(
    (result) => result.generations,
  );

export const deleteSavedGeneration = (id: string) =>
  assistantRequest<{ id: string; deleted: boolean }>("unsave", { id }, {});

/** What the assistant can do for this person right now, and whether it is on at all. */
export const loadAssistantCapabilities = () =>
  assistantRequest<AssistantCapabilities>("tools");

export const listAiInsights = (input: { module?: string; status?: string } = {}) =>
  assistantRequest<{ insights: AiInsight[] }>("insights", {
    ...(input.module ? { module: input.module } : {}),
    ...(input.status ? { status: input.status } : {}),
  }).then((result) => result.insights);

export const updateAiInsight = (
  id: string,
  action: "dismiss" | "snooze" | "resolve",
) =>
  assistantRequest<{ insight: AiInsight }>("insight", { id }, { action }).then(
    (result) => result.insight,
  );

export const loadAiWorkspaceSettings = () =>
  assistantRequest<AiWorkspaceSettings>("settings");

export const saveAiModuleAccess = (input: {
  module: string;
  accessEnabled: boolean;
  requiresConfirmationFor: string[];
}) =>
  assistantRequest<{ setting: AiModuleAccessSetting }>("access", {}, input).then(
    (result) => result.setting,
  );

export const saveAiProviderConfig = (input: {
  provider: string;
  model: string;
  baseUrl?: string;
  label?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  connectionId?: string;
  setActive?: boolean;
}) =>
  assistantRequest<{
    provider: AiWorkspaceSettings["provider"];
    providers: AiProviderConnection[];
  }>("provider", {}, input).then((result) => result.provider);

export const activateAiProviderConnection = (connectionId: string) =>
  assistantRequest<{
    provider: AiProviderConnection;
    providers: AiProviderConnection[];
  }>("provider-activate", {}, { connectionId }).then((result) => result.provider);

export const disconnectAiProviderConnection = (connectionId: string) =>
  assistantRequest<{ providers: AiProviderConnection[] }>(
    "provider-disconnect",
    {},
    { connectionId },
  ).then((result) => result.providers);

export const testAiProviderConnection = (connectionId?: string) =>
  assistantRequest<{
    provider: {
      provider: string;
      model: string;
      modelAvailable: boolean | null;
    };
  }>("provider-test", {}, connectionId ? { connectionId } : {}).then(
    (result) => result.provider,
  );

export const loadAiCanvasSession = (id: string) =>
  assistantRequest<{ session: AiCanvasSession }>("canvas", { id }).then(
    (result) => result.session,
  );

export const listAiCanvasSessions = () =>
  assistantRequest<{ sessions: AiCanvasSession[] }>("canvases").then(
    (result) => result.sessions,
  );

export const saveAiCanvasSession = (input: {
  id?: string | null;
  conversationId?: string | null;
  canvasType: AiCanvasType;
  title: string;
  canvasState: Record<string, unknown>;
}) =>
  assistantRequest<{ session: AiCanvasSession }>(
    "canvas",
    input.id ? { id: input.id } : {},
    {
      conversationId: input.conversationId || "",
      canvasType: input.canvasType,
      title: input.title,
      canvasState: input.canvasState,
    },
  ).then((result) => result.session);

/**
 * Creates a canvas through the explicit generation contract. The caller may
 * provide a structured initial state (the Forms generator does this locally),
 * while the server still validates the canvas type, size, workspace, and
 * optional conversation ownership before persisting it.
 */
export const generateAiCanvas = (input: {
  conversationId?: string | null;
  canvasType: AiCanvasType;
  title?: string;
  prompt: string;
  canvasState?: Record<string, unknown>;
}) =>
  assistantRequest<{ session: AiCanvasSession }>("generate", {}, {
    conversationId: input.conversationId || "",
    canvasType: input.canvasType,
    title: input.title || "",
    prompt: input.prompt,
    canvasState: input.canvasState || {},
  }).then((result) => result.session);

/**
 * "in about 4 hours", "by tomorrow" -- an honest wait rather than a bare
 * timestamp or a vague promise that someone will be in touch.
 */
