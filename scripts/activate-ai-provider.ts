/**
 * Make one provider the active deployment/workspace AI selection.
 *
 * If a provider key is present in .env, this command encrypts it into the
 * selected row. With no workspace id it updates the deployment fallback; pass
 * a workspace owner id to create/update that workspace's override.
 *
 * Usage:
 *   npm run ai:activate-gemini
 *   npx tsx --env-file=.env scripts/activate-ai-provider.ts gemini gemini-2.5-flash "Google Gemini"
 *   npx tsx --env-file=.env scripts/activate-ai-provider.ts openai-compatible openai/gpt-oss-20b Groq <workspace-owner-id>
 */
import {
  AI_KEY_NAMES,
  AI_PROVIDER_IDS,
  saveAiProviderConfig,
  type AiProviderId,
} from "../server/ai-provider";

const provider = (process.argv[2] || "gemini").trim().toLowerCase();
const model = (process.argv[3] || "gemini-2.5-flash").trim();
const label = (process.argv[4] || "Google Gemini").trim();
const workspaceId = (process.argv[5] || "").trim() || null;

if (!(AI_PROVIDER_IDS as string[]).includes(provider)) {
  throw new Error(`Unsupported AI provider: ${provider}`);
}
if (!model) throw new Error("An AI model is required.");

const keyName = AI_KEY_NAMES[provider as AiProviderId];
const environmentKey =
  process.env[keyName] ||
  (provider === "openai-compatible" ? process.env.OPENAI_API_KEY : "") ||
  (provider === "gemini" ? process.env.GOOGLE_API_KEY : "") ||
  "";
const apiKey = workspaceId ? environmentKey : "";
const baseUrl =
  provider === "openai-compatible"
    ? process.env.AI_COMPATIBLE_BASE_URL || ""
    : provider === "openai"
      ? process.env.OPENAI_BASE_URL || ""
      : provider === "gemini"
        ? process.env.GEMINI_BASE_URL || ""
        : process.env.ANTHROPIC_BASE_URL || "";

const saved = await saveAiProviderConfig({
  provider: provider as AiProviderId,
  model,
  label,
  baseUrl,
  apiKey,
  workspaceId,
  updatedBy: null,
});
console.log(
  `Active AI provider${workspaceId ? ` for workspace ${workspaceId}` : " (deployment fallback)"}: ${saved.provider} / ${saved.model}${
    saved.label ? ` (${saved.label})` : ""
  }${saved.apiKeyConfigured ? " · encrypted key saved" : environmentKey && !workspaceId ? " · key not stored; pass a workspace owner id" : " · workspace key required"}`,
);
