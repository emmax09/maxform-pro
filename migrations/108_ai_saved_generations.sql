-- Generations someone chose to keep.
--
-- The AI Workspace tab lists these alongside conversation history. A saved
-- generation is a copy, not a pointer: the text is stored here so it survives
-- the conversation being cleared, which is the whole reason someone saved it
-- rather than scrolling back. conversation_id is kept only as a breadcrumb and
-- goes NULL rather than taking the generation with it.
--
-- Not in the original module schema: the design note lists SavedGenerations as
-- part of the AI Workspace tab but gives it no table, so this fills that gap.

CREATE TABLE IF NOT EXISTS ai_saved_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Where it came from. Null once that conversation is gone.
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES ai_messages(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_saved_generations_user
  ON ai_saved_generations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_saved_generations_workspace
  ON ai_saved_generations(workspace_id, created_at DESC);

-- Saving the same message twice is a double-click, not two generations.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_saved_generations_message
  ON ai_saved_generations(user_id, message_id)
  WHERE message_id IS NOT NULL;

COMMENT ON TABLE ai_saved_generations IS
  'Assistant output someone kept. Stores the text itself so it outlives the conversation it came from.';
