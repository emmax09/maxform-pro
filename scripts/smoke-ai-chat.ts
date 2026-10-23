/**
 * Proves the configured provider can actually hold a conversation.
 *
 *   npm run smoke:ai
 *
 * This is the check that catches what a configuration check cannot: whether
 * the adapter's request shape is one the provider accepts, and whether tool
 * calling survives the round trip. It spends a small number of tokens on
 * whatever provider is configured, and touches no workspace data -- the tool
 * below is a stand-in, not a real one.
 */
import {
  resolveAiProvider,
  AiProviderError,
  type AssistantContext,
} from "../server/ai-provider";

/** The vendor's own words, which the user-facing message deliberately hides. */
const reason = (error: unknown) =>
  error instanceof AiProviderError && error.detail
    ? `${error.message} -- ${error.detail}`
    : (error as Error).message;

let failures = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
};

const context: AssistantContext = {
  workspaceId: process.env.AI_WORKSPACE_ID || "00000000-0000-4000-8000-000000000000",
  userId: process.env.AI_WORKSPACE_ID || "00000000-0000-4000-8000-000000000000",
  role: "owner",
  module: "orders",
};

const provider = await resolveAiProvider(process.env.AI_WORKSPACE_ID || undefined);
console.log(`Provider: ${provider.id} / ${provider.model}\n`);

/* -------------------------------------------------------------------------- */
/* 1. Plain answer                                                            */
/* -------------------------------------------------------------------------- */

try {
  const result = await provider.chat(
    [{ role: "user", content: "Reply with exactly the word: READY" }],
    [],
    context,
    "You are a test harness. Follow the instruction literally.",
  );
  check(result.stopReason !== "refusal", "a plain message is not refused");
  check(result.text.length > 0, `a plain message returns text (${JSON.stringify(result.text.slice(0, 60))})`);
  check(
    result.usage.inputTokens > 0 || result.usage.outputTokens > 0,
    `usage is reported (in ${result.usage.inputTokens} / out ${result.usage.outputTokens})`,
  );
} catch (error) {
  check(false, `a plain message round-trips (${reason(error)})`);
}

/* -------------------------------------------------------------------------- */
/* 2. Tool calling                                                            */
/* -------------------------------------------------------------------------- */

const revenueTool = {
  name: "get_revenue_summary",
  description:
    "Read totalled revenue over a recent window. Call this for 'how much did we make' style questions.",
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "integer", description: "Window in days, 1 to 365." },
    },
    required: ["days"],
    additionalProperties: false,
  },
};

let toolCallId = "";
try {
  const result = await provider.chat(
    [{ role: "user", content: "How much revenue did we make in the last 30 days?" }],
    [revenueTool],
    context,
    "You are the workspace assistant. Use the tools available to answer questions about workspace data.",
  );
  check(result.toolCalls.length > 0, "the model reaches for the tool");
  const call = result.toolCalls[0];
  if (call) {
    toolCallId = call.id;
    check(call.name === "get_revenue_summary", `it calls the right tool (${call.name})`);
    check(
      typeof call.input.days === "number",
      `arguments arrive parsed, not as a string (${JSON.stringify(call.input)})`,
    );
  }
} catch (error) {
  check(false, `tool calling round-trips (${reason(error)})`);
}

/* -------------------------------------------------------------------------- */
/* 3. Tool result goes back in                                                */
/* -------------------------------------------------------------------------- */

if (toolCallId) {
  try {
    const result = await provider.chat(
      [
        { role: "user", content: "How much revenue did we make in the last 30 days?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: toolCallId, name: "get_revenue_summary", input: { days: 30 } },
          ],
        },
        {
          role: "tool",
          toolCallId,
          toolName: "get_revenue_summary",
          content:
            '<workspace_data>{"total":4210.5,"currency":"USD","orders":37}</workspace_data>',
        },
      ],
      [revenueTool],
      context,
      "You are the workspace assistant. Answer from the tool result.",
    );
    check(result.text.length > 0, "the model answers from the tool result");
    check(
      /4[,.]?210|4210|4,210/.test(result.text.replace(/\s/g, "")),
      `the answer uses the number the tool returned (${JSON.stringify(result.text.slice(0, 120))})`,
    );
  } catch (error) {
    check(false, `a tool result is accepted back (${reason(error)})`);
  }
}

console.log("");
if (failures) {
  console.error(`AI chat smoke failed: ${failures} check(s).`);
  process.exitCode = 1;
} else {
  console.log("AI chat smoke passed.");
}
