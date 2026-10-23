-- Gemini joins the provider list.
--
-- Google's API is not OpenAI-shaped -- it calls the assistant "model", matches
-- a tool result to its call by name rather than by id, and validates tool
-- schemas against an OpenAPI subset that rejects `additionalProperties`. That
-- is enough difference to need its own adapter rather than the compatible one,
-- so it needs its own entry here.

ALTER TABLE ai_provider_config
  DROP CONSTRAINT IF EXISTS ai_provider_config_provider_check;

ALTER TABLE ai_provider_config
  ADD CONSTRAINT ai_provider_config_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'gemini', 'openai-compatible'));
