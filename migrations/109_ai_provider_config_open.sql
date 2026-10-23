-- Let the provider be switched at runtime, to anything.
--
-- Two changes:
--
--   * The provider list stops being a closed pair. Most vendors -- Groq,
--     OpenRouter, Together, Mistral, DeepSeek, and local runtimes like Ollama
--     and vLLM -- speak the OpenAI Chat Completions shape, so one
--     `openai-compatible` adapter plus a base URL covers them without a new
--     row in a CHECK constraint every time.
--   * base_url and a label, so an operator can point the deployment at a
--     different endpoint by updating this row rather than by redeploying.
--
-- The API key still comes from the environment and never from this table: a
-- database row is the wrong place for a credential, and reading one here would
-- put it a single SQL injection away from being readable.

ALTER TABLE ai_provider_config
  ADD COLUMN IF NOT EXISTS base_url TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_config
  ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_config
  DROP CONSTRAINT IF EXISTS ai_provider_config_provider_check;

ALTER TABLE ai_provider_config
  ADD CONSTRAINT ai_provider_config_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'openai-compatible'));

COMMENT ON COLUMN ai_provider_config.base_url IS
  'Endpoint for openai-compatible providers. Blank uses the adapter default.';
COMMENT ON COLUMN ai_provider_config.label IS
  'What to call this in an admin screen, e.g. "Groq / Llama 3.3 70B".';
COMMENT ON TABLE ai_provider_config IS
  'Deployment-wide provider and model choice. One active row wins; blank falls back to the .env configuration. Workspace credentials are added by a later migration and stored encrypted.';
