-- The AI assistant: one engine, many surfaces.
--
-- The floating assistant, the AI Workspace tab, and every in-module "Ask AI"
-- entry point write to these same tables. What differs between them is the
-- screen context packaged with the message and the tools offered, not the
-- storage.
--
-- Three deliberate choices:
--
--   * workspace_id references users(id), matching every other module here --
--     a workspace is keyed by its owner's account id (see workspace-access.ts).
--     Reads are scoped by it, never by a workspace id sent from the browser.
--   * user_id is ON DELETE CASCADE. A conversation is personal: unlike the
--     member audit trail, there is no reason to keep one after the account
--     that held it is gone.
--   * ai_pending_confirmations is a table rather than in-memory state. A
--     consequential action must survive a serverless cold start between the
--     assistant proposing it and the person clicking confirm, and the row is
--     the audit record of who approved what.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Where the person was when they last spoke: module, tab, open record id.
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Which surface opened it: floating, workspace, or a module entry point.
  surface TEXT NOT NULL DEFAULT 'floating',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_status_check'
  ) THEN
    ALTER TABLE ai_conversations
      ADD CONSTRAINT ai_conversations_status_check
      CHECK (status IN ('active', 'escalated', 'resolved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace
  ON ai_conversations(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  -- Provider-neutral record of what the assistant called and what came back,
  -- so a conversation can be replayed onto a different provider later.
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_role_check'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_role_check
      CHECK (role IN ('user', 'assistant', 'tool'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages(conversation_id, created_at);

-- Actions the assistant has proposed and a human has not yet approved.
-- Nothing here has run: the row is the proposal, and confirming it is what
-- executes the action.
CREATE TABLE IF NOT EXISTS ai_pending_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  -- The tool that would run, and the arguments it would run with.
  action_type TEXT NOT NULL,
  action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- What the person is shown before they approve.
  summary TEXT NOT NULL DEFAULT '',
  -- Links the eventual result back to the assistant turn that proposed it.
  tool_call_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_pending_confirmations_status_check'
  ) THEN
    ALTER TABLE ai_pending_confirmations
      ADD CONSTRAINT ai_pending_confirmations_status_check
      CHECK (status IN ('pending', 'confirmed', 'declined', 'expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_pending_confirmations_conversation
  ON ai_pending_confirmations(conversation_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS support_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Why the person asked for a human, in their words.
  reason TEXT NOT NULL DEFAULT '',
  -- The screen context the assistant already had, handed over so nobody has
  -- to re-explain where they were.
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Shown to the person as an honest wait, not a vague "someone will reply".
  response_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_escalations_status_check'
  ) THEN
    ALTER TABLE support_escalations
      ADD CONSTRAINT support_escalations_status_check
      CHECK (status IN ('open', 'in_progress', 'resolved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_support_escalations_status
  ON support_escalations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_escalations_workspace
  ON support_escalations(workspace_id, created_at DESC);

-- Which provider and model the engine runs on. Deployment-wide for now: the
-- .env values are the source of truth and this table records the override an
-- admin screen will eventually write. One active row wins.
CREATE TABLE IF NOT EXISTS ai_provider_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_config_provider_check'
  ) THEN
    ALTER TABLE ai_provider_config
      ADD CONSTRAINT ai_provider_config_provider_check
      CHECK (provider IN ('anthropic', 'openai'));
  END IF;
END $$;

-- At most one active configuration, so "which model is live" has one answer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_config_active
  ON ai_provider_config(is_active)
  WHERE is_active;

COMMENT ON TABLE ai_conversations IS
  'Assistant conversations, scoped to the workspace the speaker belongs to. The floating bubble, the AI Workspace tab and every in-module entry point share these rows.';
COMMENT ON COLUMN ai_conversations.context IS
  'Last known screen context: module, tab and open record. Packaged with each message so the assistant can see what the person is looking at.';
COMMENT ON TABLE ai_pending_confirmations IS
  'Consequential actions the assistant proposed and a human has not yet approved. Nothing here has run.';
COMMENT ON TABLE ai_provider_config IS
  'Deployment-wide provider and model choice. Blank falls back to the .env configuration.';
