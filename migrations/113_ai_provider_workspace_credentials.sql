-- Store AI credentials encrypted at rest and scope them to a workspace. The
-- legacy deployment row remains for non-workspace diagnostics only; an
-- authenticated workspace must use its own row. The plaintext key never
-- belongs in this table.

ALTER TABLE ai_provider_config
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ai_provider_config
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_config
  ADD COLUMN IF NOT EXISTS api_key_hint TEXT NOT NULL DEFAULT '';

-- Migration 107 enforced one active row globally. Keep that behaviour for the
-- nullable deployment fallback, while allowing one active override per
-- workspace.
DROP INDEX IF EXISTS idx_ai_provider_config_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_config_active_workspace
  ON ai_provider_config(workspace_id)
  WHERE is_active AND workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_config_active_global
  ON ai_provider_config(is_active)
  WHERE is_active AND workspace_id IS NULL;

-- Do not turn the legacy deployment row into a shared credential. Every
-- authenticated workspace must connect its own provider key.
UPDATE ai_provider_config
SET api_key_encrypted = '',
    api_key_hint = ''
WHERE workspace_id IS NULL;

COMMENT ON COLUMN ai_provider_config.workspace_id IS
  'Workspace owner id for a workspace-specific provider override; NULL is the deployment fallback.';
COMMENT ON COLUMN ai_provider_config.api_key_encrypted IS
  'AES-256-GCM encrypted provider API key. Decrypt only on the server using AI_ENCRYPTION_KEY or the integration encryption key.';
COMMENT ON COLUMN ai_provider_config.api_key_hint IS
  'Non-secret masked suffix shown only as a connection hint.';
COMMENT ON TABLE ai_provider_config IS
  'AI provider selection and encrypted credentials. Authenticated workspaces use their own active row; the legacy deployment row has no shared credential.';
