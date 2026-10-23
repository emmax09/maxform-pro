/**
 * The AI provider adapter.
 *
 * One interface, implemented per vendor, exactly as Payments and Email are
 * built here. Every surface that talks to the assistant -- the floating
 * bubble, the AI Workspace tab, the in-module entry points -- calls
 * `AIProvider.chat()` and never a vendor SDK directly, so changing model or
 * provider is a configuration edit rather than a change in five features.
 *
 * Which provider runs is configuration (AI_PROVIDER / AI_MODEL or the active
 * database row). Credentials may be entered in MaxAI settings, are encrypted
 * at rest, and are never returned to a caller or written to a log.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

/**
 * What the assistant is looking at when it answers.
 *
 * Deliberately not named WorkspaceContext: that name is already taken in
 * workspace-access.ts for the caller's membership and role. This is the
 * screen-level context packaged with each message -- the thing that makes
 * "why did this payment fail" answerable without the person naming a payment.
 */
export type AssistantContext = {
  workspaceId: string;
  userId: string;
  /** Owner, admin, moderator or user. Shapes what the assistant offers to do. */
  role: string;
  /** Which module the person is in: crm, payments, forms... */
  module?: string;
  /** The tab or section within that module. */
  section?: string;
  /** The record open on screen, if any. */
  recordType?: string;
  recordId?: string;
  /** The most recent error the screen showed, if the person is stuck on one. */
  lastError?: string;
  workspaceName?: string;
  userName?: string;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema. Object schemas only, which is what every provider accepts. */
  inputSchema: Record<string, unknown>;
};

export type AiToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/**
 * Provider-neutral transcript. Stored in this shape in ai_messages so a
 * conversation started on one provider can be replayed onto another.
 */
export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: string;
      isError?: boolean;
    };

export type AiStopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";

export type AiResponse = {
  text: string;
  toolCalls: AiToolCall[];
  stopReason: AiStopReason;
  /** The model that actually produced the message, after any fallback. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export interface AIProvider {
  readonly id: AiProviderId;
  readonly model: string;
  chat(
    messages: AiMessage[],
    tools: AiToolDefinition[],
    context: AssistantContext,
    system: string,
  ): Promise<AiResponse>;
}

/**
 * `openai-compatible` is the escape hatch that makes "any provider" true
 * without a new adapter per vendor: Groq, OpenRouter, Together, Mistral,
 * DeepSeek, Fireworks and local runtimes (Ollama, vLLM, LM Studio) all speak
 * the OpenAI Chat Completions shape, so they differ only by base URL and key.
 */
export type AiProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openai-compatible";

export const AI_PROVIDER_IDS: AiProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "openai-compatible",
];

export const isAiProviderId = (value: unknown): value is AiProviderId =>
  typeof value === "string" &&
  (AI_PROVIDER_IDS as string[]).includes(value);

export class AiProviderError extends Error {
  /**
   * The vendor's own explanation, for logs and the smoke script.
   *
   * Never sent to a browser: it can name models, quotas and account state.
   * But "the assistant is busy" with no way to discover that the real cause
   * was a zero quota on the chosen model wastes an afternoon, so it is kept
   * where an operator can reach it.
   */
  detail = "";

  constructor(
    message: string,
    readonly status = 502,
    readonly code = "ai_provider_error",
    readonly retryable = false,
    detail = "",
    /** Provider hint for a retryable response, in seconds, when available. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.detail = detail.slice(0, 500);
  }
}

/* -------------------------------------------------------------------------- */
/* Stored credentials                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Provider keys may be entered from the workspace settings screen. They are
 * encrypted before they leave this process and are decrypted only when the
 * server constructs a provider client. Keep a dedicated key in production;
 * the integration key remains a compatibility fallback for existing installs.
 */
const credentialKeys = () => {
  const secrets = [
    process.env.AI_ENCRYPTION_KEY || "",
    process.env.INTEGRATION_ENCRYPTION_KEY || "",
  ].filter(
    (secret, index, values) =>
      secret.length >= 24 && values.indexOf(secret) === index,
  );
  if (!secrets.length) {
    throw new Error(
      "AI_ENCRYPTION_KEY or INTEGRATION_ENCRYPTION_KEY must be configured to store provider keys.",
    );
  }
  return secrets.map((secret) => createHash("sha256").update(secret).digest());
};

const encryptApiKey = (apiKey: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKeys()[0], iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

const decryptApiKey = (value: string) => {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted AI key.");
  for (const key of credentialKeys()) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // A previous encryption key may still be retained during rotation.
    }
  }
  throw new Error("The stored AI provider key could not be decrypted.");
};

const apiKeyHint = (apiKey: string) => {
  if (!apiKey) return "";
  const suffix = apiKey.slice(-4);
  return `••••••••${suffix}`;
};

/**
 * Provider settings are entered by people, so tolerate a trailing slash but
 * keep one canonical form everywhere. In particular, an OpenAI-compatible
 * endpoint must not become `.../v1//chat/completions` after it is saved.
 */
export const normalizeProviderBaseUrl = (value: string) =>
  String(value || "").trim().replace(/\/+$/, "");

export const providerEndpoint = (baseUrl: string, path: string) => {
  const base = normalizeProviderBaseUrl(baseUrl);
  const suffix = String(path || "").replace(/^\/+/, "");
  if (!suffix || !base) return suffix ? `${base}/${suffix}` : base;
  try {
    const url = new URL(base);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = `${pathname}/${suffix}`;
    return url.toString();
  } catch {
    return `${base}/${suffix}`;
  }
};

/** The Anthropic SDK appends `/v1/...` to its configured base URL. */
const anthropicSdkBaseUrl = (baseUrl: string) =>
  normalizeProviderBaseUrl(baseUrl).replace(/\/v1$/i, "");

export const providerModelsEndpoint = (
  provider: AiProviderId,
  baseUrl: string,
) => {
  if (provider !== "anthropic") return providerEndpoint(baseUrl, "models");
  let includesVersionPath = false;
  try {
    includesVersionPath = /\/v1$/i.test(new URL(baseUrl).pathname.replace(/\/+$/, ""));
  } catch {
    includesVersionPath = /\/v1$/i.test(normalizeProviderBaseUrl(baseUrl));
  }
  return providerEndpoint(baseUrl, includesVersionPath ? "models" : "v1/models");
};

/** Keep interactive turns bounded; free compatible providers often have a low TPM cap. */
const maxOutputTokens = () => {
  const configured = Number(process.env.AI_MAX_OUTPUT_TOKENS || "");
  if (!Number.isFinite(configured) || configured <= 0) return 1_024;
  return Math.min(Math.max(Math.trunc(configured), 512), 64_000);
};

const requestTimeoutMs = () => {
  const configured = Number(process.env.AI_PROVIDER_TIMEOUT_MS || "");
  if (!Number.isFinite(configured)) return 45_000;
  return Math.min(Math.max(Math.trunc(configured), 5_000), 120_000);
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isEffort = (
  value: string,
): value is "low" | "medium" | "high" | "xhigh" | "max" =>
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh" ||
  value === "max";

/**
 * Low is the interactive default because a person is waiting on the answer;
 * raise it with AI_EFFORT for deployments that value depth over latency.
 */
const effortLevel = () => {
  const configured = (process.env.AI_EFFORT || "").trim().toLowerCase();
  return isEffort(configured) ? configured : "low";
};

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                  */
/* -------------------------------------------------------------------------- */

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;

  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
    baseUrl = normalizeProviderBaseUrl(
      process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    ),
  ) {
    this.client = new Anthropic({
      apiKey,
      baseURL: anthropicSdkBaseUrl(baseUrl),
      timeout: requestTimeoutMs(),
      // The assistant owns its short retry policy below. Avoid a hidden SDK
      // retry turning a quick provider failure into a long spinner.
      maxRetries: 1,
    });
  }

  async chat(
    messages: AiMessage[],
    tools: AiToolDefinition[],
    _context: AssistantContext,
    system: string,
  ): Promise<AiResponse> {
    let response: Anthropic.Message;
    const request = {
      model: this.model,
      max_tokens: maxOutputTokens(),
      system,
      messages: toAnthropicMessages(messages) as Anthropic.MessageParam[],
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    };
    try {
      response = await this.client.messages.create({
        ...request,
        thinking: { type: "adaptive" },
        output_config: { effort: effortLevel() },
      });
    } catch (error) {
      // Newer Claude models can use adaptive thinking, while older models and
      // compatible gateways may reject those optional fields. A rejected
      // optional field is safe to retry without it; auth, quota, and network
      // failures still surface through the normal error translation.
      if (!isAnthropicOptionalConfigError(error)) {
        throw translateAnthropicError(error);
      }
      try {
        response = await this.client.messages.create(request);
      } catch (fallbackError) {
        throw translateAnthropicError(fallbackError);
      }
    }

    // Check the stop reason before reading content: a refusal arrives as a
    // successful response whose content array may be empty.
    if (response.stop_reason === "refusal") {
      return {
        text: "",
        toolCalls: [],
        stopReason: "refusal",
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }

    const text: string[] = [];
    const toolCalls: AiToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: asRecord(block.input),
        });
      }
    }

    return {
      text: text.join("").trim(),
      toolCalls,
      stopReason:
        response.stop_reason === "tool_use"
          ? "tool_use"
          : response.stop_reason === "max_tokens"
            ? "max_tokens"
            : "end_turn",
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

/**
 * Folds the neutral transcript into Anthropic's shape. Consecutive tool
 * results collapse into one user turn, which is what the API expects when the
 * assistant made several calls at once.
 */
export const toAnthropicMessages = (
  messages: AiMessage[],
): Anthropic.Beta.BetaMessageParam[] => {
  const result: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      result.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls || []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }
      if (content.length > 0) result.push({ role: "assistant", content });
      continue;
    }
    const block: Anthropic.Beta.BetaContentBlockParam = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
      is_error: message.isError === true,
    };
    const previous = result[result.length - 1];
    if (previous && previous.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(block);
    } else {
      result.push({ role: "user", content: [block] });
    }
  }
  return result;
};

const translateAnthropicError = (error: unknown) => {
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError(
      "The assistant is busy right now. Try again in a moment.",
      429,
      "ai_rate_limited",
      true,
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    // Never echo the key or the vendor message; this is a deployment fault.
    return new AiProviderError(
      "The assistant is not configured correctly.",
      503,
      "ai_unavailable",
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError(
      "The assistant could not be reached. Try again.",
      503,
      "ai_unreachable",
      true,
    );
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = typeof error.status === "number" && error.status >= 500;
    return new AiProviderError(
      "The assistant could not answer that. Try again.",
      retryable ? 503 : 502,
      "ai_provider_error",
      retryable,
    );
  }
  return new AiProviderError("The assistant could not answer that.");
};

const isAnthropicOptionalConfigError = (error: unknown) =>
  error instanceof Anthropic.APIError &&
  error.status === 400 &&
  /(thinking|output[_\s-]*config|effort|unsupported|unknown\s+(?:field|parameter))/i.test(
    String(error.message || ""),
  );

/**
 * One mapping from an HTTP failure to a user-safe error, shared by every
 * fetch-based adapter. The vendor's body is read once and kept on `detail`,
 * so the reason survives for an operator without reaching a browser.
 */
const providerLabel = (provider: AiProviderId) => {
  if (provider === "gemini") return "Gemini";
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "The AI provider";
};

const retryAfterSecondsFrom = (response: Response, detail: string) => {
  const header = response.headers?.get?.("retry-after") || "";
  const headerSeconds = Number(header);
  const headerDateSeconds = Number.isFinite(headerSeconds) || !header
    ? NaN
    : (Date.parse(header) - Date.now()) / 1_000;
  const bodyMatch = detail.match(
    /(?:retry(?:\s+after|\s+in)?|retry[_\s-]*delay)["'\s:=]+([0-9]+(?:\.[0-9]+)?)\s*["']?\s*s?/i,
  );
  const bodySeconds = bodyMatch ? Number(bodyMatch[1]) : NaN;
  const seconds = Number.isFinite(headerSeconds) && headerSeconds > 0
    ? headerSeconds
    : Number.isFinite(headerDateSeconds) && headerDateSeconds > 0
      ? headerDateSeconds
      : Number.isFinite(bodySeconds) && bodySeconds > 0
        ? bodySeconds
        : NaN;
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(86_400, Math.max(1, Math.ceil(seconds)));
};

const httpProviderError = async (
  response: Response,
  provider: AiProviderId,
) => {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    detail = "";
  }
  const unauthorised = response.status === 401 || response.status === 403;
  const retryable =
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    (response.status >= 500 && response.status < 600);
  const retryAfterSeconds = response.status === 429
    ? retryAfterSecondsFrom(response, detail)
    : undefined;
  // Vendors use several names for a hard usage cap. Keep their raw response
  // in `detail` for operators, but give the browser a useful next step rather
  // than hiding a depleted quota behind the transient "busy" message.
  const quotaExceeded = response.status === 429 &&
    /quota|resource[\s_-]*exhausted|free[\s_-]*tier|current\s+quota/i.test(detail);
  const quotaMessage = quotaExceeded
    ? `${providerLabel(provider)}'s usage limit has been reached. ${
        retryAfterSeconds
          ? `Try again in about ${retryAfterSeconds} seconds. `
          : ""
      }${
        provider === "gemini"
          ? "Check Google AI Studio quota or connect another provider in MaxAI settings."
          : "Check the provider quota or connect another provider in MaxAI settings."
      }`
    : "The assistant is busy right now. Try again in a moment.";
  return new AiProviderError(
    response.status === 429
      ? quotaMessage
      : unauthorised
        ? "The assistant is not configured correctly."
        : "The assistant could not answer that. Try again.",
    unauthorised ? 503 : retryable ? 503 : 502,
    quotaExceeded ? "ai_quota_exceeded" : response.status === 429 ? "ai_rate_limited" : "ai_provider_error",
    retryable,
    `HTTP ${response.status}: ${detail}`,
    retryAfterSeconds,
  );
};

/* -------------------------------------------------------------------------- */
/* OpenAI                                                                     */
/* -------------------------------------------------------------------------- */

type OpenAiToolCall = {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

type OpenAiFunctionCall = {
  name?: unknown;
  arguments?: unknown;
};

type OpenAiResponseBody = {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
      tool_calls?: OpenAiToolCall[];
      /** Older Chat Completions implementations still use this field. */
      function_call?: OpenAiFunctionCall;
      refusal?: unknown;
    };
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

const invalidProviderResponse = (provider: AiProviderId, detail: string) =>
  new AiProviderError(
    "The assistant received an invalid response from the provider. Try again.",
    502,
    "ai_provider_invalid_response",
    false,
    `${provider}: ${detail}`,
  );

const readProviderJson = async <T>(response: Response, provider: AiProviderId) => {
  try {
    return (await response.json()) as T;
  } catch {
    throw invalidProviderResponse(provider, "the response was not valid JSON");
  }
};

const openAiContentText = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const entry = part as Record<string, unknown>;
      return typeof entry.text === "string"
        ? entry.text
        : typeof entry.content === "string"
          ? entry.content
          : "";
    })
    .join("")
    .trim();
};

const openAiTokenParameterError = (detail: string) =>
  /\b(max_completion_tokens|max_tokens)\b/i.test(detail) &&
  /(unknown|unsupported|unrecognized|invalid|not\s+support|extra|additional|required|parameter|field)/i.test(
    detail,
  );

/**
 * Second implementation of the same interface, over the Chat Completions API.
 * Raw fetch rather than a vendor SDK, matching how the payment and email
 * adapters here call their providers -- there is no OpenAI SDK in this
 * project's dependency tree to justify adding.
 */
export class OpenAiProvider implements AIProvider {
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl = normalizeProviderBaseUrl(
      process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    ),
    /** Reported as-is so diagnostics can tell OpenAI from a compatible host. */
    readonly id: AiProviderId = "openai",
  ) {}

  async chat(
    messages: AiMessage[],
    tools: AiToolDefinition[],
    _context: AssistantContext,
    system: string,
  ): Promise<AiResponse> {
    let response: Response;
    let tokenParameter =
      this.id === "openai" ? "max_completion_tokens" : "max_tokens";
    let tokenParameterRetried = false;
    let rateLimitRetried = false;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
      try {
        response = await fetch(providerEndpoint(this.baseUrl, "chat/completions"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,
            [tokenParameter]: maxOutputTokens(),
            messages: [
              { role: "system", content: system },
              ...toOpenAiMessages(messages),
            ],
            ...(tools.length > 0
              ? {
                  tools: tools.map((tool) => ({
                    type: "function",
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    },
                  })),
                }
              : {}),
          }),
        });
      } catch (error) {
        throw new AiProviderError(
          (error as Error)?.name === "AbortError"
            ? "The assistant took too long to answer. Try again."
            : "The assistant could not be reached. Try again.",
          503,
          "ai_unreachable",
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) break;
      const failure = await httpProviderError(response, this.id);
      // A large part of the OpenAI-compatible ecosystem predates
      // max_completion_tokens. Retry once with the other spelling only when
      // the provider explicitly rejected that request field; never duplicate
      // a billable completion for a generic 400 response.
      if (
        response.status === 400 &&
        !tokenParameterRetried &&
        openAiTokenParameterError(failure.detail)
      ) {
        tokenParameter =
          tokenParameter === "max_tokens"
            ? "max_completion_tokens"
            : "max_tokens";
        tokenParameterRetried = true;
        continue;
      }
      // Free tiers commonly return a short TPM window. Honor a brief retry
      // hint once so a tool-result turn does not fail while the window clears;
      // long quota resets remain visible to the user instead of holding open
      // the request for tens of seconds.
      if (
        response.status !== 429 ||
        rateLimitRetried ||
        !failure.retryAfterSeconds ||
        failure.retryAfterSeconds > 3
      ) {
        throw failure;
      }
      rateLimitRetried = true;
      await wait(failure.retryAfterSeconds * 1000);
    }

    const body = await readProviderJson<OpenAiResponseBody>(response, this.id);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw invalidProviderResponse(this.id, "the response body was not an object");
    }
    const choice = body.choices?.[0];
    if (!choice?.message) {
      throw invalidProviderResponse(this.id, "the response contained no message choice");
    }
    const finish = String(choice?.finish_reason || "");
    const toolCalls: AiToolCall[] = [];
    const calls: OpenAiToolCall[] = choice.message.tool_calls?.length
      ? choice.message.tool_calls
      : choice.message.function_call
        ? [{ function: choice.message.function_call }]
        : [];
    for (const [index, call] of calls.entries()) {
      const name = String(call.function?.name || "");
      if (!name) continue;
      toolCalls.push({
        // A few compatible servers omit ids. Keep the neutral transcript
        // valid and unique so the next tool-result turn remains replayable.
        id: String(call.id || `call_${index + 1}_${name}`),
        name,
        // Arguments arrive as a JSON string on OpenAI, but several compatible
        // servers return an object already. Parse both forms safely.
        input: parseJsonObject(call.function?.arguments),
      });
    }

    const text = openAiContentText(choice.message.content);
    const refusal = typeof choice.message.refusal === "string"
      ? choice.message.refusal.trim()
      : "";

    return {
      text,
      toolCalls,
      stopReason:
        toolCalls.length > 0
          ? "tool_use"
          : finish === "length"
            ? "max_tokens"
            : finish === "content_filter" || refusal
              ? "refusal"
              : "end_turn",
      model: String(body.model || this.model),
      usage: {
        inputTokens: Number(body.usage?.prompt_tokens) || 0,
        outputTokens: Number(body.usage?.completion_tokens) || 0,
      },
    };
  }
}

export const toOpenAiMessages = (messages: AiMessage[]) =>
  messages.map((message) => {
    if (message.role === "user") {
      return { role: "user" as const, content: message.content };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant" as const,
        content: message.content || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input),
                },
              })),
            }
          : {}),
      };
    }
    return {
      role: "tool" as const,
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  });

/* -------------------------------------------------------------------------- */
/* Google Gemini                                                              */
/* -------------------------------------------------------------------------- */

type GeminiPart = {
  text?: unknown;
  functionCall?: { name?: unknown; args?: unknown };
};

type GeminiResponseBody = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
};

/**
 * Gemini validates tool schemas against an OpenAPI subset and rejects keywords
 * it does not know -- `additionalProperties` among them, which every tool here
 * sets. Rather than weaken the schemas the other providers benefit from, they
 * are trimmed on the way out.
 */
export const toGeminiSchema = (schema: Record<string, unknown>): unknown => {
  const unsupported = new Set([
    "additionalProperties",
    "$schema",
    "$id",
    "definitions",
    "$defs",
    "$ref",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "const",
    "default",
    "examples",
    "title",
    "patternProperties",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
  ]);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (unsupported.has(key)) continue;
      result[key] = walk(entry);
    }
    return result;
  };
  return walk(schema);
};

/**
 * Folds the neutral transcript into Gemini's shape.
 *
 * Two differences worth naming: the assistant is called `model`, and a tool
 * result is matched to its call by *name* rather than by id -- Gemini does not
 * issue call ids at all. Parallel calls to the same tool are therefore
 * ambiguous on the wire, which is why the id we hand back is the tool name.
 */
export const toGeminiContents = (messages: AiMessage[]) => {
  const contents: Array<{ role: "user" | "model"; parts: unknown[] }> = [];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }
    if (message.role === "assistant") {
      const parts: unknown[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls || []) {
        parts.push({ functionCall: { name: call.name, args: call.input } });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    const part = {
      functionResponse: {
        name: message.toolName,
        // Gemini requires an object here; tool output is a string for us.
        response: message.isError
          ? { error: message.content }
          : { result: message.content },
      },
    };
    const previous = contents[contents.length - 1];
    if (previous && previous.role === "user") {
      previous.parts.push(part);
    } else {
      contents.push({ role: "user", parts: [part] });
    }
  }
  return contents;
};

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl = normalizeProviderBaseUrl(
      process.env.GEMINI_BASE_URL ||
        "https://generativelanguage.googleapis.com/v1beta",
    ),
  ) {}

  async chat(
    messages: AiMessage[],
    tools: AiToolDefinition[],
    _context: AssistantContext,
    system: string,
  ): Promise<AiResponse> {
    let response: Response;
    let rateLimitRetried = false;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
      try {
        response = await fetch(
          providerEndpoint(
            this.baseUrl,
            `models/${encodeURIComponent(this.model)}:generateContent`,
          ),
          {
            method: "POST",
            headers: {
              // Header rather than a query parameter: a key in a URL ends up in
              // proxy and access logs.
              "x-goog-api-key": this.apiKey,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: toGeminiContents(messages),
              ...(tools.length > 0
                ? {
                    tools: [
                      {
                        functionDeclarations: tools.map((tool) => ({
                          name: tool.name,
                          description: tool.description,
                          parameters: toGeminiSchema(tool.inputSchema),
                        })),
                      },
                    ],
                  }
                : {}),
              generationConfig: { maxOutputTokens: maxOutputTokens() },
            }),
          },
        );
      } catch (error) {
        throw new AiProviderError(
          (error as Error)?.name === "AbortError"
            ? "The assistant took too long to answer. Try again."
            : "The assistant could not be reached. Try again.",
          503,
          "ai_unreachable",
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) break;
      const failure = await httpProviderError(response, this.id);
      if (
        response.status !== 429 ||
        rateLimitRetried ||
        !failure.retryAfterSeconds ||
        failure.retryAfterSeconds > 3
      ) {
        throw failure;
      }
      rateLimitRetried = true;
      await wait(failure.retryAfterSeconds * 1000);
    }

    const body = await readProviderJson<GeminiResponseBody>(response, this.id);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw invalidProviderResponse(this.id, "the response body was not an object");
    }
    const candidate = body.candidates?.[0];
    const finish = String(candidate?.finishReason || "");

    // A prompt blocked by safety filters comes back with no candidate at all,
    // so an empty response is a refusal rather than an empty answer.
    if (body.promptFeedback?.blockReason || finish === "SAFETY") {
      return {
        text: "",
        toolCalls: [],
        stopReason: "refusal",
        model: this.model,
        usage: usageFromGemini(body),
      };
    }

    if (!candidate?.content) {
      throw invalidProviderResponse(this.id, "the response contained no candidate content");
    }

    const text: string[] = [];
    const toolCalls: AiToolCall[] = [];
    for (const part of candidate.content.parts || []) {
      if (typeof part.text === "string") text.push(part.text);
      if (part.functionCall) {
        const name = String(part.functionCall.name || "");
        if (!name) continue;
        toolCalls.push({
          // Gemini correlates function responses by name rather than id.
          id: name,
          name,
          input: parseJsonObject(part.functionCall.args),
        });
      }
    }

    return {
      text: text.join("").trim(),
      toolCalls,
      stopReason:
        toolCalls.length > 0
          ? "tool_use"
          : finish === "MAX_TOKENS"
            ? "max_tokens"
            : "end_turn",
      model: this.model,
      usage: usageFromGemini(body),
    };
  }
}

const usageFromGemini = (body: GeminiResponseBody) => ({
  inputTokens: Number(body.usageMetadata?.promptTokenCount) || 0,
  outputTokens: Number(body.usageMetadata?.candidatesTokenCount) || 0,
});

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_MODELS: Record<AiProviderId, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1",
  // Flash rather than Pro: Pro has a zero free-tier quota, so a key that
  // works everywhere else would 429 on the very first message.
  gemini: "gemini-2.5-flash",
  // No sensible default: a compatible endpoint's model names are its own.
  "openai-compatible": "",
};

/**
 * Which provider runs, and where. The public selection intentionally excludes
 * the credential; the internal resolved selection carries it only inside the
 * server process while a provider client is being constructed.
 */
export type AiProviderSelection = {
  /** The saved connection id when this selection comes from a workspace row. */
  connectionId?: string;
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  label: string;
  /** Where the choice came from, so an operator can tell which one is winning. */
  source: "database" | "environment";
};

type ResolvedAiProviderSelection = AiProviderSelection & {
  apiKey: string;
  apiKeyHint: string;
  apiKeySource: "database" | "environment" | "none";
  credentialError?: string;
};

export type AiProviderStatus = AiProviderSelection & {
  configured: boolean;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  /** Why it is unavailable, for an admin screen. Never shown to an end user. */
  reason?: string;
};

/**
 * A provider connection shown in MaxAI settings. The credential is deliberately
 * absent; only an encrypted server-side key and a short hint ever leave this
 * module.
 */
export type AiProviderConnection = AiProviderStatus & {
  id: string;
  isActive: boolean;
  updatedAt: string | null;
};

export const AI_KEY_NAMES: Record<AiProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compatible": "AI_COMPATIBLE_API_KEY",
};

const environmentApiKey = (provider: AiProviderId) => {
  if (provider === "openai") return process.env.OPENAI_API_KEY || "";
  if (provider === "gemini") {
    // GOOGLE_API_KEY is the name Google's own tooling uses; accepted as an
    // alias so a key pasted under either name works.
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  }
  if (provider === "openai-compatible") {
    return process.env.AI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY || "";
  }
  return process.env.ANTHROPIC_API_KEY || "";
};

const baseUrlFor = (provider: AiProviderId, configured: string) => {
  if (configured) return normalizeProviderBaseUrl(configured);
  let value: string;
  if (provider === "anthropic") {
    value = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  } else if (provider === "gemini") {
    value =
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
  } else if (provider === "openai-compatible") {
    value = process.env.AI_COMPATIBLE_BASE_URL || "";
  } else {
    value = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }
  return normalizeProviderBaseUrl(value);
};

/**
 * The .env answer. Always available, and the fallback when the table is empty.
 *
 * AI_PROVIDER remains authoritative when it is explicitly set. When it is
 * omitted, select the first provider with a server-side key so a deployment
 * cannot look disabled just because an optional selector was not copied into
 * the environment.
 */
const environmentSelection = (): AiProviderSelection => {
  const raw = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const provider = isAiProviderId(raw)
    ? raw
    : raw
      ? "anthropic"
      : process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
            ? "gemini"
            : process.env.AI_COMPATIBLE_API_KEY
              ? "openai-compatible"
              : "anthropic";
  return {
    provider,
    model: (process.env.AI_MODEL || "").trim() || DEFAULT_MODELS[provider],
    baseUrl: baseUrlFor(provider, ""),
    label: "",
    source: "environment",
  };
};

/**
 * The database answer, cached briefly.
 *
 * This is what makes the provider switchable without a redeploy: update the
 * active row and the next request picks it up. The cache keeps that from
 * costing a query per message; a few seconds of staleness on a config change
 * is not worth a round trip on every turn.
 */
const SELECTION_CACHE_MS = 30_000;
const GLOBAL_SELECTION_CACHE_KEY = "__global__";
const cachedSelections = new Map<
  string,
  { value: ResolvedAiProviderSelection; expiresAt: number }
>();

export const resetAiProviderCache = () => {
  cachedSelections.clear();
};

const resolvedEnvironmentSelection = (): ResolvedAiProviderSelection => {
  const selection = environmentSelection();
  const apiKey = environmentApiKey(selection.provider);
  return {
    ...selection,
    apiKey,
    apiKeyHint: apiKeyHint(apiKey),
    apiKeySource: apiKey ? "environment" : "none",
  };
};

type AiProviderRow = Record<string, unknown>;

/** Convert one database row into the private, credential-bearing selection. */
const resolvedSelectionFromRow = (
  row: AiProviderRow,
  workspaceId?: string,
): ResolvedAiProviderSelection | null => {
  const provider = String(row.provider || "");
  if (!isAiProviderId(provider)) return null;
  const encryptedKey = String(row.api_key_encrypted || "").trim();
  // A workspace row must never silently borrow the deployment key. The
  // environment key is only a legacy/global diagnostic fallback.
  const configuredEnvironmentKey = workspaceId ? "" : environmentApiKey(provider);
  let storedKey = "";
  let credentialError = "";
  if (encryptedKey) {
    try {
      storedKey = decryptApiKey(encryptedKey).trim();
    } catch {
      credentialError = "The saved AI provider key could not be decrypted.";
    }
  }
  const apiKey = storedKey || configuredEnvironmentKey;
  const connectionId = String(row.id || "").trim();
  return {
    ...(connectionId ? { connectionId } : {}),
    provider,
    model: String(row.model || "").trim() || DEFAULT_MODELS[provider],
    baseUrl: baseUrlFor(provider, String(row.base_url || "").trim()),
    label: String(row.label || "").trim(),
    source: "database",
    apiKey,
    apiKeyHint: storedKey
      ? String(row.api_key_hint || "").trim() || apiKeyHint(storedKey)
      : apiKeyHint(configuredEnvironmentKey),
    apiKeySource: storedKey
      ? "database"
      : configuredEnvironmentKey
        ? "environment"
        : "none",
    ...(credentialError ? { credentialError } : {}),
  };
};

const databaseSelection = async (
  workspaceId?: string,
): Promise<ResolvedAiProviderSelection | null> => {
  const url = process.env.DATABASE_URL || "";
  if (!url) return null;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const rows = (await neon(url).query(
      workspaceId
        ? `SELECT id, provider, model, base_url, label,
                  api_key_encrypted, api_key_hint, workspace_id
           FROM ai_provider_config
           WHERE is_active AND workspace_id = $1
           LIMIT 1`
        : `SELECT id, provider, model, base_url, label,
                  api_key_encrypted, api_key_hint, workspace_id
           FROM ai_provider_config
           WHERE is_active AND workspace_id IS NULL
           LIMIT 1`,
      workspaceId ? [workspaceId] : [],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return resolvedSelectionFromRow(row, workspaceId);
  } catch {
    // A missing table or an unreachable database must not take the assistant
    // down: the environment configuration is a complete answer on its own.
    return null;
  }
};

const databaseProviderConnection = async (
  workspaceId: string,
  connectionId: string,
): Promise<{ selection: ResolvedAiProviderSelection; isActive: boolean; updatedAt: string | null } | null> => {
  const url = process.env.DATABASE_URL || "";
  if (!url) return null;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const rows = (await neon(url).query(
      `SELECT id, provider, model, base_url, label,
              api_key_encrypted, api_key_hint, is_active, updated_at
         FROM ai_provider_config
        WHERE id = $1 AND workspace_id = $2
        LIMIT 1`,
      [connectionId, workspaceId],
    )) as AiProviderRow[];
    const row = rows[0];
    const selection = row ? resolvedSelectionFromRow(row, workspaceId) : null;
    if (!selection) return null;
    return {
      selection,
      isActive: row.is_active === true,
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    };
  } catch {
    return null;
  }
};

/** List every saved workspace connection without exposing credentials. */
export const aiProviderConnections = async (
  workspaceId: string,
): Promise<AiProviderConnection[]> => {
  const url = process.env.DATABASE_URL || "";
  if (!url) return [];
  try {
    const { neon } = await import("@neondatabase/serverless");
    const rows = (await neon(url).query(
      `SELECT id, provider, model, base_url, label,
              api_key_encrypted, api_key_hint, is_active, updated_at
         FROM ai_provider_config
        WHERE workspace_id = $1
        ORDER BY is_active DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
      [workspaceId],
    )) as AiProviderRow[];
    return rows.flatMap((row) => {
      const selection = resolvedSelectionFromRow(row, workspaceId);
      const id = String(row.id || "").trim();
      if (!selection || !id) return [];
      return [{
        ...statusFromSelection(selection),
        id,
        isActive: row.is_active === true,
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      }];
    });
  } catch {
    return [];
  }
};

const resolvedAiProviderSelection = async (
  workspaceId?: string,
): Promise<ResolvedAiProviderSelection> => {
  const cacheKey = workspaceId || GLOBAL_SELECTION_CACHE_KEY;
  const cached = cachedSelections.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const databaseValue = await databaseSelection(workspaceId);
  const value = databaseValue || (() => {
    const environment = resolvedEnvironmentSelection();
    if (!workspaceId) return environment;
    return {
      ...environment,
      apiKey: "",
      apiKeyHint: "",
      apiKeySource: "none" as const,
      credentialError: "Connect an AI provider for this workspace.",
    };
  })();
  cachedSelections.set(cacheKey, {
    value,
    expiresAt: Date.now() + SELECTION_CACHE_MS,
  });
  return value;
};

export const aiProviderSelection = async (
  workspaceId?: string,
): Promise<AiProviderSelection> => {
  const resolved = await resolvedAiProviderSelection(workspaceId);
  return {
    ...(resolved.connectionId ? { connectionId: resolved.connectionId } : {}),
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    label: resolved.label,
    source: resolved.source,
  };
};

/**
 * What the deployment is set up to run, without needing a key to answer.
 * Used by the tools introspection endpoint and by admin diagnostics, so
 * "the assistant is off" reads differently from "the assistant is broken".
 */
const statusFromSelection = (
  selection: ResolvedAiProviderSelection,
): AiProviderStatus => {
  const base = {
    ...(selection.connectionId ? { connectionId: selection.connectionId } : {}),
    provider: selection.provider,
    model: selection.model,
    baseUrl: selection.baseUrl,
    label: selection.label,
    source: selection.source,
  };
  if (!selection.apiKey) {
    return {
      ...base,
      configured: false,
      apiKeyConfigured: false,
      apiKeyHint: "",
      reason:
        selection.credentialError ||
        `No API key configured for ${selection.provider}.`,
    };
  }
  if (selection.provider === "openai-compatible" && !selection.baseUrl) {
    return {
      ...base,
      configured: false,
      apiKeyConfigured: true,
      apiKeyHint: selection.apiKeyHint,
      reason: "No base URL configured for the compatible provider.",
    };
  }
  if (!selection.model) {
    return {
      ...base,
      configured: false,
      apiKeyConfigured: true,
      apiKeyHint: selection.apiKeyHint,
      reason: "No model configured for this provider.",
    };
  }
  return {
    ...base,
    configured: true,
    apiKeyConfigured: true,
    apiKeyHint: selection.apiKeyHint,
  };
};

export const aiProviderStatus = async (
  workspaceId?: string,
): Promise<AiProviderStatus> => {
  return statusFromSelection(await resolvedAiProviderSelection(workspaceId));
};

export const aiProviderConnectionStatus = async (
  workspaceId: string,
  connectionId: string,
): Promise<AiProviderConnection | null> => {
  const connection = await databaseProviderConnection(workspaceId, connectionId);
  if (!connection) return null;
  return {
    ...statusFromSelection(connection.selection),
    id: connectionId,
    isActive: connection.isActive,
    updatedAt: connection.updatedAt,
  };
};

/** Select one already-connected workspace provider as the active route. */
export const activateAiProviderConnection = async (input: {
  workspaceId: string;
  connectionId: string;
  updatedBy?: string | null;
}): Promise<AiProviderConnection> => {
  if (!/^[0-9a-f-]{36}$/i.test(input.workspaceId)) {
    throw new Error("The workspace identifier is not valid.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.connectionId)) {
    throw new Error("The provider connection identifier is not valid.");
  }
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("AI provider settings are temporarily unavailable.");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const connection = await databaseProviderConnection(input.workspaceId, input.connectionId);
  if (!connection) throw new Error("That provider connection no longer exists in this workspace.");
  if (!statusFromSelection(connection.selection).configured) {
    throw new Error("Connect a valid API key and model before making this provider active.");
  }
  await sql.query(
    `UPDATE ai_provider_config
        SET is_active = FALSE, updated_at = NOW()
      WHERE workspace_id = $1 AND is_active`,
    [input.workspaceId],
  );
  const rows = (await sql.query(
    `UPDATE ai_provider_config
        SET is_active = TRUE,
            updated_by = $3,
            updated_at = NOW()
      WHERE id = $1 AND workspace_id = $2
    RETURNING id, provider, model, base_url, label, api_key_encrypted,
              api_key_hint, is_active, updated_at`,
    [input.connectionId, input.workspaceId, input.updatedBy || null],
  )) as AiProviderRow[];
  if (!rows[0]) throw new Error("The provider connection could not be activated.");
  resetAiProviderCache();
  const status = await aiProviderConnectionStatus(input.workspaceId, input.connectionId);
  if (!status) throw new Error("The provider connection could not be activated.");
  return status;
};

/** Remove one saved workspace connection and promote a remaining connection if needed. */
export const disconnectAiProviderConnection = async (input: {
  workspaceId: string;
  connectionId: string;
}) => {
  if (!/^[0-9a-f-]{36}$/i.test(input.workspaceId)) {
    throw new Error("The workspace identifier is not valid.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.connectionId)) {
    throw new Error("The provider connection identifier is not valid.");
  }
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("AI provider settings are temporarily unavailable.");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const existing = (await sql.query(
    `SELECT is_active
       FROM ai_provider_config
      WHERE id = $1 AND workspace_id = $2
      LIMIT 1`,
    [input.connectionId, input.workspaceId],
  )) as AiProviderRow[];
  if (!existing[0]) throw new Error("That provider connection no longer exists in this workspace.");
  const wasActive = existing[0].is_active === true;
  await sql.query(
    `DELETE FROM ai_provider_config
      WHERE id = $1 AND workspace_id = $2`,
    [input.connectionId, input.workspaceId],
  );
  if (wasActive) {
    await sql.query(
      `UPDATE ai_provider_config
          SET is_active = TRUE, updated_at = NOW()
        WHERE id = (
          SELECT id
            FROM ai_provider_config
           WHERE workspace_id = $1
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
           LIMIT 1
        )`,
      [input.workspaceId],
    );
  }
  resetAiProviderCache();
};

/**
 * Saves a workspace provider selection. API keys are encrypted before being
 * persisted; an empty key keeps the existing saved credential so changing a
 * model or endpoint does not accidentally disconnect the provider.
 */
export const saveAiProviderConfig = async (input: {
  provider: AiProviderId;
  model: string;
  baseUrl?: string;
  label?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  /** Update a particular saved connection instead of creating a new one. */
  connectionId?: string | null;
  /** A connection can be saved without taking over the active slot. */
  setActive?: boolean;
  workspaceId?: string | null;
  updatedBy?: string | null;
}) => {
  if (!isAiProviderId(input.provider)) throw new Error("Choose a supported AI provider.");
  const model = String(input.model || "").trim().slice(0, 160);
  if (!model) throw new Error("Choose an AI model.");
  const baseUrl = normalizeProviderBaseUrl(
    String(input.baseUrl || "").slice(0, 500),
  );
  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error("The provider base URL is not valid.");
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error("The provider base URL must use HTTP or HTTPS.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("The provider base URL must not contain embedded credentials.");
    }
    if (parsed.search || parsed.hash) {
      throw new Error("The provider base URL must not contain a query or fragment.");
    }
  }
  const label = String(input.label || "").trim().slice(0, 120);
  const workspaceId = input.workspaceId === undefined ? null : input.workspaceId;
  if (workspaceId !== null && !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new Error("The workspace identifier is not valid.");
  }
  const connectionId = String(input.connectionId || "").trim();
  if (connectionId && !/^[0-9a-f-]{36}$/i.test(connectionId)) {
    throw new Error("The provider connection identifier is not valid.");
  }
  const replacementKey = String(input.apiKey || "").trim().slice(0, 2_000);
  if (replacementKey && input.clearApiKey) {
    throw new Error("Choose a new key or remove the saved key, not both.");
  }
  if (!workspaceId && replacementKey) {
    throw new Error("Provider API keys must be connected to a workspace.");
  }
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("AI provider settings are temporarily unavailable.");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  let existing: Array<Record<string, unknown>>;
  if (workspaceId) {
    existing = (await sql.query(
      connectionId
        ? `SELECT id, provider, model, base_url, label,
                  api_key_encrypted, api_key_hint, is_active
             FROM ai_provider_config
            WHERE id = $1 AND workspace_id = $2
            LIMIT 1`
        : `SELECT id, provider, model, base_url, label,
                  api_key_encrypted, api_key_hint, is_active
             FROM ai_provider_config
            WHERE workspace_id = $1
              AND provider = $2
              AND model = $3
              AND base_url = $4
            LIMIT 1`,
      connectionId
        ? [connectionId, workspaceId]
        : [workspaceId, input.provider, model, baseUrl],
    )) as Array<Record<string, unknown>>;
  } else {
    existing = (await sql.query(
      `SELECT id, provider, model, base_url, label,
              api_key_encrypted, api_key_hint, is_active
         FROM ai_provider_config
        WHERE is_active AND workspace_id IS NULL
        LIMIT 1`,
    )) as Array<Record<string, unknown>>;
  }
  if (connectionId && !existing[0]) {
    throw new Error("That provider connection no longer exists in this workspace.");
  }
  const currentEncrypted = String(existing[0]?.api_key_encrypted || "");
  const currentHint = String(existing[0]?.api_key_hint || "");
  const providerChanged =
    workspaceId &&
    Boolean(existing[0]) &&
    String(existing[0]?.provider || "") !== input.provider;
  if (providerChanged && !replacementKey && !input.clearApiKey) {
    throw new Error("Paste a new API key when switching providers.");
  }
  let encryptedKey = currentEncrypted;
  let storedHint = currentHint;
  if (input.clearApiKey) {
    encryptedKey = "";
    storedHint = "";
  } else if (replacementKey) {
    encryptedKey = encryptApiKey(replacementKey);
    storedHint = apiKeyHint(replacementKey);
  }
  if (workspaceId && !encryptedKey) {
    throw new Error("Paste an API key to connect this workspace to the provider.");
  }

  let rows: Array<Record<string, unknown>>;
  if (workspaceId) {
    const activeRows = (await sql.query(
      `SELECT id
         FROM ai_provider_config
        WHERE workspace_id = $1 AND is_active
        LIMIT 1`,
      [workspaceId],
    )) as Array<Record<string, unknown>>;
    // Activation is controlled by the dedicated active-provider control in
    // the MaxAI settings. A legacy caller that omits setActive keeps the old
    // behavior, while the settings modal always sends false. Updating the
    // currently active connection must also preserve its active state.
    const shouldActivate =
      input.setActive !== false ||
      Boolean(connectionId && String(activeRows[0]?.id || "") === connectionId);
    if (shouldActivate) {
      await sql.query(
        `UPDATE ai_provider_config
            SET is_active = FALSE, updated_at = NOW()
          WHERE workspace_id = $1 AND is_active`,
        [workspaceId],
      );
    }
    const values = [
      input.provider,
      model,
      baseUrl,
      label,
      workspaceId,
      encryptedKey,
      storedHint,
      shouldActivate,
      input.updatedBy || null,
    ];
    if (connectionId) {
      rows = (await sql.query(
        `UPDATE ai_provider_config
            SET provider = $1,
                model = $2,
                base_url = $3,
                label = $4,
                api_key_encrypted = $6,
                api_key_hint = $7,
                is_active = $8,
                updated_by = $9,
                updated_at = NOW()
          WHERE id = $10 AND workspace_id = $5
        RETURNING id, provider, model, base_url, label, api_key_hint,
                  is_active, updated_at`,
        [...values, connectionId],
      )) as Array<Record<string, unknown>>;
    } else {
      rows = (await sql.query(
        `INSERT INTO ai_provider_config
           (workspace_id, provider, model, base_url, label, api_key_encrypted,
            api_key_hint, is_active, updated_by, updated_at)
         VALUES ($5, $1, $2, $3, $4, $6, $7, $8, $9, NOW())
         ON CONFLICT (workspace_id, provider, model, base_url)
           WHERE workspace_id IS NOT NULL
         DO UPDATE SET label = EXCLUDED.label,
                       api_key_encrypted = EXCLUDED.api_key_encrypted,
                       api_key_hint = EXCLUDED.api_key_hint,
                       is_active = EXCLUDED.is_active,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()
      RETURNING id, provider, model, base_url, label, api_key_hint,
                is_active, updated_at`,
        values,
      )) as Array<Record<string, unknown>>;
    }
  } else {
    const globalValues = [
      input.provider,
      model,
      baseUrl,
      label,
      encryptedKey,
      storedHint,
      input.updatedBy || null,
    ];
    const updated = (await sql.query(
      `UPDATE ai_provider_config
          SET provider = $1,
              model = $2,
              base_url = $3,
              label = $4,
              api_key_encrypted = $5,
              api_key_hint = $6,
              updated_by = $7,
              updated_at = NOW()
        WHERE is_active AND workspace_id IS NULL
        RETURNING id, provider, model, base_url, label, api_key_hint,
                  is_active, updated_at`,
      globalValues,
    )) as Array<Record<string, unknown>>;
    rows = updated.length
      ? updated
      : ((await sql.query(
          `INSERT INTO ai_provider_config
             (workspace_id, provider, model, base_url, label, api_key_encrypted,
              api_key_hint, is_active, updated_by, updated_at)
           VALUES (NULL, $1, $2, $3, $4, $5, $6, TRUE, $7, NOW())
           RETURNING id, provider, model, base_url, label, api_key_hint,
                     is_active, updated_at`,
          globalValues,
        )) as Array<Record<string, unknown>>);
  }
  resetAiProviderCache();
  const savedRow = rows[0];
  const savedSelection = resolvedSelectionFromRow(
    {
      ...savedRow,
      api_key_encrypted: encryptedKey,
    },
    workspaceId || undefined,
  );
  if (!savedSelection) throw new Error("The provider connection could not be saved.");
  return {
    id: String(savedRow?.id || connectionId || ""),
    provider: String(rows[0]?.provider || input.provider),
    model: String(rows[0]?.model || model),
    baseUrl: String(rows[0]?.base_url || baseUrl),
    label: String(rows[0]?.label || label),
    apiKeyConfigured: Boolean(encryptedKey),
    apiKeyHint: String(rows[0]?.api_key_hint || storedHint),
    isActive: savedRow?.is_active === true,
    updatedAt: savedRow?.updated_at ? String(savedRow.updated_at) : null,
    source: "database" as const,
  };
};

/** Throws rather than returning null: a caller with no provider has nothing to do. */
export const resolveAiProvider = async (
  workspaceId?: string,
): Promise<AIProvider> => {
  const selection = await resolvedAiProviderSelection(workspaceId);
  const status = statusFromSelection(selection);
  if (!status.configured) {
    throw new AiProviderError(
      "MaxAI is not available on this workspace yet.",
      503,
      "ai_not_configured",
    );
  }
  const apiKey = selection.apiKey;
  if (status.provider === "anthropic") {
    return new AnthropicProvider(status.model, apiKey, status.baseUrl || undefined);
  }
  if (status.provider === "gemini") {
    return new GeminiProvider(status.model, apiKey, status.baseUrl || undefined);
  }
  // Both OpenAI and every compatible vendor run the same adapter; only the
  // endpoint differs, which is the whole point of the compatible shape.
  return new OpenAiProvider(
    status.model,
    apiKey,
    status.baseUrl || undefined,
    status.provider,
  );
};

/**
 * Verifies a saved workspace credential without generating a completion. The
 * response is deliberately small and contains no provider response body or
 * credential material.
 */
export const testAiProviderConnection = async (
  workspaceId?: string,
  connectionId?: string,
) => {
  const resolvedConnection = workspaceId && connectionId
    ? await databaseProviderConnection(workspaceId, connectionId)
    : null;
  if (workspaceId && connectionId && !resolvedConnection) {
    throw new AiProviderError(
      "That provider connection no longer exists in this workspace.",
      404,
      "ai_provider_connection_not_found",
    );
  }
  const selection = resolvedConnection?.selection || await resolvedAiProviderSelection(workspaceId);
  const status = statusFromSelection(selection);
  if (!status.configured) {
    throw new AiProviderError(
      status.reason || "Connect an AI provider for this workspace first.",
      503,
      "ai_not_configured",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
  const headers: Record<string, string> = { Accept: "application/json" };
  if (selection.provider === "gemini") {
    headers["x-goog-api-key"] = selection.apiKey;
  } else if (selection.provider === "anthropic") {
    headers["x-api-key"] = selection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${selection.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(
      providerModelsEndpoint(selection.provider, selection.baseUrl),
      { headers, signal: controller.signal },
    );
  } catch (error) {
    throw new AiProviderError(
      (error as Error)?.name === "AbortError"
        ? "The provider connection timed out."
        : "The provider could not be reached.",
      503,
      "ai_unreachable",
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw await httpProviderError(response, selection.provider);

  let modelAvailable: boolean | null = null;
  try {
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
      models?: Array<{ name?: unknown }>;
    };
    const ids = [
      ...(body.data || []).map((entry) => String(entry.id || "")),
      ...(body.models || []).map((entry) =>
        String(entry.name || "").replace(/^models\//, ""),
      ),
    ].filter(Boolean);
    if (ids.length > 0) modelAvailable = ids.includes(selection.model);
  } catch {
    // A successful endpoint response is still a valid connection check when
    // a compatible proxy does not return a standard model list body.
  }

  return {
    provider: selection.provider,
    model: selection.model,
    modelAvailable,
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  const source = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return asRecord(JSON.parse(source));
  } catch {
    return {};
  }
};
