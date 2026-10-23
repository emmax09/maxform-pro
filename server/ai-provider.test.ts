// @vitest-environment node
//
// The suite defaults to jsdom, and the Anthropic SDK refuses to construct in a
// browser-like environment so an API key cannot end up in a bundle. That guard
// is correct and stays on: this adapter only ever runs on the server, so the
// test runs there too rather than opting out of it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aiProviderStatus,
  isAiProviderId,
  GeminiProvider,
  OpenAiProvider,
  toGeminiContents,
  toGeminiSchema,
  resetAiProviderCache,
  resolveAiProvider,
  normalizeProviderBaseUrl,
  providerEndpoint,
  providerModelsEndpoint,
  testAiProviderConnection,
  toAnthropicMessages,
  toOpenAiMessages,
  AiProviderError,
  type AiMessage,
  type AssistantContext,
} from "./ai-provider";

const context: AssistantContext = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "owner",
};

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.AI_COMPATIBLE_API_KEY;
  delete process.env.AI_COMPATIBLE_BASE_URL;
  // No DATABASE_URL means the environment is the whole configuration, which
  // is the path these tests exercise.
  delete process.env.DATABASE_URL;
  resetAiProviderCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("provider resolution", () => {
  it("reports the deployment as unconfigured rather than throwing on a missing key", async () => {
    const status = await aiProviderStatus();
    expect(status.configured).toBe(false);
    expect(status.provider).toBe("anthropic");
    // The model is still reported so an admin screen can show what would run.
    expect(status.model).toBe("claude-opus-5");
    expect(status.source).toBe("environment");
  });

  it("refuses to build a provider when no key is configured", async () => {
    await expect(resolveAiProvider()).rejects.toBeInstanceOf(AiProviderError);
    await expect(resolveAiProvider()).rejects.toMatchObject({
      code: "ai_not_configured",
      status: 503,
    });
  });

  it("auto-detects an available provider when AI_PROVIDER is omitted", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    resetAiProviderCache();

    const status = await aiProviderStatus();

    expect(status.provider).toBe("openai");
    expect(status.configured).toBe(true);
    expect((await resolveAiProvider()).id).toBe("openai");
  });

  it("switches vendor and model from configuration alone", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect((await resolveAiProvider()).id).toBe("anthropic");
    expect((await resolveAiProvider()).model).toBe("claude-opus-5");

    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AI_MODEL = "gpt-4.1-mini";
    resetAiProviderCache();
    const provider = await resolveAiProvider();
    expect(provider.id).toBe("openai");
    expect(provider.model).toBe("gpt-4.1-mini");
  });

  it("runs any OpenAI-compatible vendor from a base URL and a key", async () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_COMPATIBLE_API_KEY = "gsk-test";
    process.env.AI_COMPATIBLE_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.AI_MODEL = "llama-3.3-70b-versatile";
    resetAiProviderCache();

    const status = await aiProviderStatus();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("openai-compatible");

    const provider = await resolveAiProvider();
    expect(provider.id).toBe("openai-compatible");
    expect(provider.model).toBe("llama-3.3-70b-versatile");
  });

  it("reports the default base URL for each native provider", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    resetAiProviderCache();
    expect((await aiProviderStatus()).baseUrl).toBe("https://api.anthropic.com");

    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    resetAiProviderCache();
    expect((await aiProviderStatus()).baseUrl).toBe("https://api.openai.com/v1");

    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    resetAiProviderCache();
    expect((await aiProviderStatus()).baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("will not run a compatible provider without somewhere to send the request", async () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_COMPATIBLE_API_KEY = "gsk-test";
    process.env.AI_MODEL = "llama-3.3-70b-versatile";
    resetAiProviderCache();

    const status = await aiProviderStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/base URL/i);
  });

  it("will not run a provider with no model chosen", async () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_COMPATIBLE_API_KEY = "gsk-test";
    process.env.AI_COMPATIBLE_BASE_URL = "https://example.test/v1";
    resetAiProviderCache();

    const status = await aiProviderStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/model/i);
  });

  it("falls back to Anthropic when the configured provider is not one we have", async () => {
    process.env.AI_PROVIDER = "some-vendor";
    process.env.ANTHROPIC_API_KEY = "test-key";
    resetAiProviderCache();
    expect((await resolveAiProvider()).id).toBe("anthropic");
    expect(isAiProviderId("some-vendor")).toBe(false);
  });

  it("runs Gemini, defaulting to a model a free key can actually use", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AIza-test";
    resetAiProviderCache();

    const provider = await resolveAiProvider();
    expect(provider.id).toBe("gemini");
    // gemini-2.5-pro has a zero free-tier quota, so it cannot be the default.
    expect(provider.model).toBe("gemini-2.5-flash");
  });

  it("accepts GOOGLE_API_KEY as an alias for the Gemini key", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GOOGLE_API_KEY = "AIza-test";
    resetAiProviderCache();
    expect((await aiProviderStatus()).configured).toBe(true);
  });

  it("keeps the key out of the reported status", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-secret-value";
    expect(JSON.stringify(await aiProviderStatus())).not.toContain(
      "sk-secret-value",
    );
  });
});

describe("provider endpoint safety", () => {
  it("canonicalizes provider URLs without changing their path", () => {
    expect(normalizeProviderBaseUrl(" https://example.test/v1/// ")).toBe(
      "https://example.test/v1",
    );
    expect(providerEndpoint("https://example.test/v1///", "/chat/completions"))
      .toBe("https://example.test/v1/chat/completions");
  });

  it("uses Anthropic's versioned model path while keeping custom v1 bases valid", () => {
    expect(providerModelsEndpoint("anthropic", "https://api.anthropic.com")).toBe(
      "https://api.anthropic.com/v1/models",
    );
    expect(providerModelsEndpoint("anthropic", "https://proxy.test/v1")).toBe(
      "https://proxy.test/v1/models",
    );
    expect(providerModelsEndpoint("openai", "https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1/models",
    );
  });

  it("tests Anthropic with the versioned model endpoint and header auth", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    resetAiProviderCache();
    const fetchMock = vi.fn(async (_url: string, _init?: { headers?: Record<string, string> }) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "claude-opus-5" }] }),
      }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testAiProviderConnection();

    expect(result.modelAvailable).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/models",
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
    });
  });
});

const transcript: AiMessage[] = [
  { role: "user", content: "How many orders this week?" },
  {
    role: "assistant",
    content: "Checking.",
    toolCalls: [
      { id: "call_1", name: "get_revenue_summary", input: { days: 7 } },
      { id: "call_2", name: "list_orders", input: {} },
    ],
  },
  {
    role: "tool",
    toolCallId: "call_1",
    toolName: "get_revenue_summary",
    content: "<workspace_data>{\"total\":10}</workspace_data>",
  },
  {
    role: "tool",
    toolCallId: "call_2",
    toolName: "list_orders",
    content: "denied",
    isError: true,
  },
];

describe("transcript translation", () => {
  it("collapses parallel tool results into a single Anthropic user turn", () => {
    const messages = toAnthropicMessages(transcript);
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe("assistant");

    const results = messages[2];
    expect(results.role).toBe("user");
    expect(Array.isArray(results.content)).toBe(true);
    // Splitting parallel results across turns teaches the model to stop making
    // parallel calls, so both must land in the one message.
    expect(results.content).toHaveLength(2);
    expect((results.content as Array<{ is_error?: boolean }>)[1].is_error).toBe(
      true,
    );
  });

  it("keeps one OpenAI tool message per call", () => {
    const messages = toOpenAiMessages(transcript);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    const assistant = messages[1] as { tool_calls?: unknown[] };
    expect(assistant.tool_calls).toHaveLength(2);
  });

  it("round-trips tool arguments as JSON rather than a formatted string", () => {
    const assistant = toOpenAiMessages(transcript)[1] as {
      tool_calls: Array<{ function: { arguments: string } }>;
    };
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({
      days: 7,
    });
  });
});

describe("Gemini translation", () => {
  it("calls the assistant 'model' and pairs tool results by name", () => {
    const contents = toGeminiContents(transcript);
    expect(contents.map((entry) => entry.role)).toEqual([
      "user",
      "model",
      "user",
    ]);
    // Gemini issues no call ids, so both results collapse into one user turn
    // and are matched to their calls by tool name.
    expect(contents[2].parts).toHaveLength(2);
    expect(contents[2].parts[0]).toMatchObject({
      functionResponse: { name: "get_revenue_summary" },
    });
  });

  it("marks a failed tool result as an error rather than a result", () => {
    const contents = toGeminiContents(transcript);
    expect(contents[2].parts[1]).toMatchObject({
      functionResponse: { name: "list_orders", response: { error: "denied" } },
    });
  });

  it("strips schema keywords Gemini rejects, keeping the rest intact", () => {
    const schema = toGeminiSchema({
      type: "object",
      additionalProperties: false,
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: {
        days: { type: "integer", description: "Window in days." },
        nested: {
          type: "object",
          additionalProperties: false,
          properties: { id: { type: "string" } },
        },
      },
      required: ["days"],
    }) as Record<string, unknown>;

    expect(schema).not.toHaveProperty("additionalProperties");
    expect(schema).not.toHaveProperty("$schema");
    // Nested objects carry the same rejected keyword and must be cleaned too.
    const nested = (schema.properties as Record<string, Record<string, unknown>>)
      .nested;
    expect(nested).not.toHaveProperty("additionalProperties");
    expect(nested.properties).toEqual({ id: { type: "string" } });
    expect(schema.required).toEqual(["days"]);
  });
});

describe("Gemini adapter", () => {
  const geminiResponse = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response;

  it("reads text and function calls out of a candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { text: "Checking." },
                  {
                    functionCall: {
                      name: "get_revenue_summary",
                      args: { days: 30 },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
        }),
      ),
    );

    const result = await new GeminiProvider("gemini-2.5-flash", "k").chat(
      [],
      [],
      context,
      "system",
    );
    expect(result.text).toBe("Checking.");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls[0]).toEqual({
      id: "get_revenue_summary",
      name: "get_revenue_summary",
      input: { days: 30 },
    });
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
  });

  it("treats a blocked prompt as a refusal, not an empty answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse({ promptFeedback: { blockReason: "SAFETY" } }),
      ),
    );
    const result = await new GeminiProvider("gemini-2.5-flash", "k").chat(
      [],
      [],
      context,
      "system",
    );
    expect(result.stopReason).toBe("refusal");
  });

  it("sends the system prompt as systemInstruction, never as a turn", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) =>
        geminiResponse({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: "hi" }] } },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GeminiProvider("gemini-2.5-flash", "k").chat(
      [{ role: "user", content: "hello" }],
      [],
      context,
      "SYSTEM RULES",
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.systemInstruction.parts[0].text).toBe("SYSTEM RULES");
    expect(JSON.stringify(body.contents)).not.toContain("SYSTEM RULES");
  });

  it("sends the key as a header, not in the URL where logs would keep it", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { headers?: Record<string, string> }) =>
        geminiResponse({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: "hi" }] } },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GeminiProvider("gemini-2.5-flash", "secret-key").chat(
      [],
      [],
      context,
      "system",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("secret-key");
    expect(init?.headers?.["x-goog-api-key"]).toBe("secret-key");
  });

  it("keeps the vendor's reason for an operator without showing it to a user", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse(
          {
            error: {
              message: "Quota exceeded, limit: 0. Please retry in 39s.",
            },
          },
          429,
        ),
      ),
    );
    try {
      await new GeminiProvider("gemini-2.5-pro", "k").chat([], [], context, "s");
      throw new Error("expected a rejection");
    } catch (error) {
      const failure = error as AiProviderError;
      expect(failure.code).toBe("ai_quota_exceeded");
      expect(failure.retryable).toBe(true);
      expect(failure.retryAfterSeconds).toBe(39);
      expect(failure.message).toContain("Gemini's usage limit has been reached");
      expect(failure.message).toContain("about 39 seconds");
      expect(failure.message).not.toContain("limit: 0");
      expect(failure.detail).toContain("limit: 0");
    }
  });
});

const openAiResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => headers[name.toLowerCase()] || null },
  }) as Response;

describe("OpenAI adapter", () => {
  it("parses tool arguments and reports a tool_use stop", async () => {
    const fetchMock = vi.fn(async () =>
      openAiResponse({
        model: "gpt-4.1",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_9",
                  function: {
                    name: "get_revenue_summary",
                    arguments: '{"days": 14}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiProvider("gpt-4.1", "test-key");
    const result = await provider.chat([], [], context, "system");

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls[0].input).toEqual({ days: 14 });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it("treats malformed tool arguments as an empty object instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        openAiResponse({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  { id: "call_1", function: { name: "x", arguments: "{not json" } },
                ],
              },
            },
          ],
        }),
      ),
    );
    const result = await new OpenAiProvider("gpt-4.1", "k").chat(
      [],
      [],
      context,
      "system",
    );
    expect(result.toolCalls[0].input).toEqual({});
  });

  it("accepts legacy function_call responses and object arguments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        openAiResponse({
          choices: [
            {
              finish_reason: "function_call",
              message: {
                content: [{ type: "text", text: "Checking." }],
                function_call: {
                  name: "get_revenue_summary",
                  arguments: { days: 7 },
                },
              },
            },
          ],
        }),
      ),
    );

    const result = await new OpenAiProvider("legacy-model", "k").chat(
      [],
      [],
      context,
      "system",
    );

    expect(result.text).toBe("Checking.");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls[0]).toMatchObject({
      id: "call_1_get_revenue_summary",
      name: "get_revenue_summary",
      input: { days: 7 },
    });
  });

  it("switches token-limit spelling once for an OpenAI-compatible endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAiResponse(
          { error: { message: "Unsupported parameter: max_tokens" } },
          400,
        ),
      )
      .mockResolvedValueOnce(
        openAiResponse({
          choices: [{ finish_reason: "stop", message: { content: "ready" } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiProvider(
      "compatible-model",
      "k",
      "https://provider.test/v1/",
      "openai-compatible",
    ).chat([], [], context, "system");

    expect(result.text).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.max_tokens).toBeDefined();
    expect(firstBody.max_completion_tokens).toBeUndefined();
    expect(secondBody.max_completion_tokens).toBeDefined();
    expect(secondBody.max_tokens).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://provider.test/v1/chat/completions",
    );
  });

  it("turns a successful non-JSON provider response into a safe adapter error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
      ),
    );

    await expect(
      new OpenAiProvider("gpt-4.1", "k").chat([], [], context, "system"),
    ).rejects.toMatchObject({
      code: "ai_provider_invalid_response",
      status: 502,
    });
  });

  it("maps a rate limit to a retryable error without leaking the vendor body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiResponse({ error: { message: "sk-leak" } }, 429)),
    );
    const provider = new OpenAiProvider("gpt-4.1", "test-key");
    await expect(provider.chat([], [], context, "system")).rejects.toMatchObject({
      code: "ai_rate_limited",
      retryable: true,
    });
  });

  it("honors one short retry hint before surfacing a rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAiResponse({ error: { message: "try again" } }, 429, {
          "retry-after": "1",
        }),
      )
      .mockResolvedValueOnce(
        openAiResponse({
          model: "gpt-4.1",
          choices: [{ finish_reason: "stop", message: { content: "ready" } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiProvider("gpt-4.1", "test-key").chat(
      [],
      [],
      context,
      "system",
    );

    expect(result.text).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a bad key as a deployment fault, not a user error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiResponse({}, 401)),
    );
    const provider = new OpenAiProvider("gpt-4.1", "bad-key");
    await expect(provider.chat([], [], context, "system")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("sends the system prompt as the first message and never in the transcript", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) =>
        openAiResponse({
          choices: [{ finish_reason: "stop", message: { content: "hi" } }],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiProvider("gpt-4.1", "k").chat(
      [{ role: "user", content: "hello" }],
      [],
      context,
      "SYSTEM RULES",
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM RULES" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
  });
});
