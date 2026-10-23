-- Allow a workspace to keep several AI providers connected while retaining
-- one active provider for assistant traffic.
--
-- The existing partial unique index on (workspace_id) WHERE is_active remains
-- the one-active-provider guard. This second index only prevents duplicate
-- copies of the same provider/model/endpoint connection.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_config_workspace_connection
  ON ai_provider_config(workspace_id, provider, model, base_url)
  WHERE workspace_id IS NOT NULL;

COMMENT ON INDEX idx_ai_provider_config_workspace_connection IS
  'One saved connection per workspace/provider/model/base URL; inactive connections are allowed.';
