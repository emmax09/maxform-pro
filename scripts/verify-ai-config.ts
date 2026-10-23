/**
 * Checks the AI assistant's configuration end to end.
 *
 *   npm run verify:ai          -- configuration and schema only, no network
 *   npm run verify:ai:live     -- also proves the key and model against the
 *                                 provider, using a listing call so nothing
 *                                 is generated and nothing is billed for
 *                                 tokens
 *
 * Never prints a key. Credentials are reported as present or absent and by
 * length, because the whole point of a check script is that it is safe to run
 * with the output pasted into a ticket.
 */
import {
  aiProviderStatus,
  resetAiProviderCache,
  AI_KEY_NAMES,
  AI_PROVIDER_IDS,
  testAiProviderConnection,
} from "../server/ai-provider";

const value = (name: string) => String(process.env[name] || "").trim();

let failures = 0;
let warnings = 0;

const check = (condition: unknown, message: string) => {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
};

const warn = (condition: unknown, message: string) => {
  if (!condition) warnings += 1;
  console.log(`${condition ? "ok  " : "warn"} ${message}`);
};

const live = process.argv.includes("--live");
const workspaceId = value("AI_WORKSPACE_ID");

console.log("AI assistant configuration\n");

/* -------------------------------------------------------------------------- */
/* Platform prerequisites                                                     */
/* -------------------------------------------------------------------------- */

check(value("DATABASE_URL"), "DATABASE_URL is configured");
check(
  value("JWT_SECRET").length >= 32,
  "JWT_SECRET is at least 32 characters (the assistant verifies session tokens)",
);

/* -------------------------------------------------------------------------- */
/* Provider selection                                                         */
/* -------------------------------------------------------------------------- */

const declared = value("AI_PROVIDER").toLowerCase();
warn(
  !declared || (AI_PROVIDER_IDS as string[]).includes(declared),
  `AI_PROVIDER is one of ${AI_PROVIDER_IDS.join(", ")}${
    declared && !(AI_PROVIDER_IDS as string[]).includes(declared)
      ? ` (got "${declared}", falling back to anthropic)`
      : ""
  }`,
);

resetAiProviderCache();
const status = await aiProviderStatus(workspaceId || undefined);

console.log(
  `\n  workspace ${workspaceId || "(deployment diagnostics)"}\n  provider  ${status.provider}\n  model     ${status.model || "(none)"}\n  base URL  ${
    status.baseUrl || "(provider default)"
  }\n  source    ${status.source}${status.label ? ` (${status.label})` : ""}\n  key       ${status.apiKeyConfigured ? `configured${status.apiKeyHint ? ` (${status.apiKeyHint})` : ""}` : "missing"}\n`,
);

check(
  status.configured,
  `the provider configuration is complete${status.reason ? ` (${status.reason})` : ""}`,
);

const keyName = AI_KEY_NAMES[status.provider];
const environmentKey =
  value(keyName) ||
  (status.provider === "openai-compatible" ? value("OPENAI_API_KEY") : "") ||
  (status.provider === "gemini" ? value("GOOGLE_API_KEY") : "");
const key = workspaceId ? "" : environmentKey;
check(
  workspaceId ? status.apiKeyConfigured : Boolean(key) || status.apiKeyConfigured,
  workspaceId
    ? "the workspace has an encrypted provider key"
    : `${keyName} is set (${key ? `${key.length} chars` : "empty"})`,
);

// A key pasted with quotes or whitespace is the single most common cause of a
// 401 that looks like a code fault. Only worth saying when there is a key --
// reporting "ok, no quotes" about an empty value reads as reassurance.
if (key) {
  const raw = String(process.env[keyName] ?? "");
  warn(raw === raw.trim(), `${keyName} has no surrounding whitespace`);
  warn(!/^["']|["']$/.test(key), `${keyName} is not wrapped in quotes`);
  if (status.provider === "anthropic") {
    warn(
      key.startsWith("sk-ant-"),
      "ANTHROPIC_API_KEY looks like an Anthropic key (starts with sk-ant-)",
    );
  }
} else if (workspaceId) {
  console.log("     ↳ the workspace key is encrypted in ai_provider_config");
} else {
  console.log(
    `     ↳ paste a key into ${keyName} in .env, then re-run this check`,
  );
}

if (status.provider === "openai-compatible") {
  let parsed: URL | null = null;
  try {
    parsed = new URL(status.baseUrl);
  } catch {
    parsed = null;
  }
  check(Boolean(parsed), "AI_COMPATIBLE_BASE_URL is a valid URL");
  warn(
    !parsed ||
      parsed.protocol === "https:" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1",
    "the compatible endpoint uses HTTPS (or is local)",
  );
  warn(
    !parsed || !parsed.pathname.endsWith("/"),
    "AI_COMPATIBLE_BASE_URL has no trailing slash",
  );
}

// Nothing here is fatal: every one of these has a safe in-code default.
const effort = value("AI_EFFORT").toLowerCase();
warn(
  !effort || ["low", "medium", "high", "xhigh", "max"].includes(effort),
  `AI_EFFORT is a known level${effort ? ` (got "${effort}")` : ""}`,
);

const maxTokens = Number(value("AI_MAX_OUTPUT_TOKENS") || 2_048);
warn(
  Number.isFinite(maxTokens) && maxTokens >= 512 && maxTokens <= 64_000,
  "AI_MAX_OUTPUT_TOKENS is between 512 and 64000",
);

const timeout = Number(value("AI_PROVIDER_TIMEOUT_MS") || 60_000);
warn(
  Number.isFinite(timeout) && timeout >= 5_000 && timeout <= 120_000,
  "AI_PROVIDER_TIMEOUT_MS is between 5000 and 120000",
);

const responseHours = Number(value("AI_SUPPORT_RESPONSE_HOURS") || 24);
warn(
  Number.isFinite(responseHours) && responseHours >= 1 && responseHours <= 168,
  "AI_SUPPORT_RESPONSE_HOURS is between 1 and 168",
);

warn(
  !value("VITE_ANTHROPIC_API_KEY") && !value("VITE_OPENAI_API_KEY"),
  "no AI key is exposed to the browser with a VITE_ prefix",
);

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

const requiredTables = [
  "ai_conversations",
  "ai_messages",
  "ai_pending_confirmations",
  "support_escalations",
  "ai_provider_config",
  "ai_saved_generations",
];

if (value("DATABASE_URL")) {
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(value("DATABASE_URL"));
    const rows = (await sql.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [requiredTables],
    )) as Array<{ table_name: string }>;
    const present = new Set(rows.map((row) => row.table_name));
    for (const table of requiredTables) {
      check(
        present.has(table),
        `table ${table} exists${present.has(table) ? "" : " (run the ai:install migrations)"}`,
      );
    }

    // Migration 109 adds columns to a table 107 already created, so the table
    // existing is not evidence that it ran. Check a column it introduced.
    const columns = (await sql.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'ai_provider_config' AND column_name IN ('base_url', 'label', 'workspace_id', 'api_key_encrypted', 'api_key_hint'))
           OR (table_name = 'ai_conversations' AND column_name = 'surface')
         )`,
    )) as Array<{ table_name: string; column_name: string }>;
    const columnNames = new Set(
      columns.map((row) => `${row.table_name}.${row.column_name}`),
    );
    check(
      columnNames.has("ai_provider_config.base_url") &&
        columnNames.has("ai_provider_config.label") &&
        columnNames.has("ai_provider_config.workspace_id") &&
        columnNames.has("ai_provider_config.api_key_encrypted") &&
        columnNames.has("ai_provider_config.api_key_hint"),
      "ai_provider_config has provider URL, workspace scope, and encrypted key columns (migrations 109 and 113)",
    );
    check(
      columnNames.has("ai_conversations.surface"),
      "ai_conversations has surface (migration 107)",
    );

    const providerIndexes = (await sql.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'ai_provider_config'
          AND indexname IN ('idx_ai_provider_config_active_workspace', 'idx_ai_provider_config_workspace_connection')`,
    )) as Array<{ indexname: string }>;
    const indexNames = new Set(providerIndexes.map((row) => row.indexname));
    check(
      indexNames.has("idx_ai_provider_config_workspace_connection"),
      "ai_provider_config supports multiple saved workspace connections (migration 115)",
    );
    const duplicateActiveRows = (await sql.query(
      `SELECT workspace_id
         FROM ai_provider_config
        WHERE workspace_id IS NOT NULL AND is_active
        GROUP BY workspace_id
       HAVING COUNT(*) > 1`,
    )) as Array<{ workspace_id: string }>;
    check(
      duplicateActiveRows.length === 0,
      "each workspace has at most one active AI provider connection",
    );

    const configRows = (await sql.query(
      `SELECT provider, model FROM ai_provider_config WHERE is_active LIMIT 1`,
    )) as Array<{ provider: string; model: string }>;
    console.log(
      configRows[0]
        ? `ok   an active ai_provider_config row overrides .env (${configRows[0].provider} / ${configRows[0].model})`
        : "ok   no ai_provider_config override; .env is in charge",
    );
  } catch (error) {
    check(
      false,
      `schema check ran (${error instanceof Error ? error.message.slice(0, 120) : "connection error"})`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Live credential check                                                      */
/* -------------------------------------------------------------------------- */

if (live && status.configured) {
  console.log("\nLive provider check");
  try {
    if (workspaceId) {
      const result = await testAiProviderConnection(workspaceId);
      check(true, "the workspace credential is accepted by the provider");
      if (result.modelAvailable === false) {
        warn(false, `the endpoint lists the configured model ${status.model}`);
      }
    } else if (!key) {
      check(false, "a deployment live check needs an environment key or AI_WORKSPACE_ID");
    } else if (status.provider === "anthropic") {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({
        apiKey: key,
        baseURL: status.baseUrl || undefined,
        maxRetries: 0,
      });
      // Retrieving the model proves the key works and the model id is real,
      // without generating a single token.
      const model = await client.models.retrieve(status.model);
      check(Boolean(model.id), `the provider accepts the key and knows ${model.id}`);
    } else if (status.provider === "gemini") {
      const base =
        status.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
      const response = await fetch(`${base}/models`, {
        headers: { "x-goog-api-key": key },
      });
      check(response.ok, `${base}/models accepts the key (HTTP ${response.status})`);
      if (response.ok) {
        const body = (await response.json()) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };
        // Gemini reports models as "models/gemini-2.5-pro".
        const usable = (body.models || [])
          .filter(
            (entry) =>
              !entry.supportedGenerationMethods ||
              entry.supportedGenerationMethods.includes("generateContent"),
          )
          .map((entry) => String(entry.name || "").replace(/^models\//, ""));
        check(
          usable.includes(status.model),
          `the endpoint offers ${status.model}${
            usable.includes(status.model)
              ? ""
              : ` (try one of: ${usable.slice(0, 5).join(", ")})`
          }`,
        );
      }
    } else {
      const base = status.baseUrl || "https://api.openai.com/v1";
      const response = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      check(response.ok, `${base}/models accepts the key (HTTP ${response.status})`);
      if (response.ok) {
        const body = (await response.json()) as {
          data?: Array<{ id?: string }>;
        };
        const ids = (body.data || []).map((entry) => String(entry.id));
        warn(
          ids.length === 0 || ids.includes(status.model),
          `the endpoint lists ${status.model}${
            ids.length && !ids.includes(status.model)
              ? ` (it offers ${ids.slice(0, 3).join(", ")}…)`
              : ""
          }`,
        );
      }
    }
  } catch (error) {
    check(
      false,
      `the provider accepted the key (${
        error instanceof Error ? error.message.slice(0, 140) : "request failed"
      })`,
    );
  }
} else if (!live) {
  console.log("\n(run with --live to prove the key against the provider)");
}

/* -------------------------------------------------------------------------- */

console.log("");
if (failures) {
  console.error(
    `AI configuration failed: ${failures} check(s)${warnings ? `, ${warnings} warning(s)` : ""}.`,
  );
  process.exitCode = 1;
} else if (warnings) {
  console.log(`AI configuration passed with ${warnings} warning(s).`);
} else {
  console.log("AI configuration passed.");
}
