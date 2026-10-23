-- Prevent a retried model turn from creating multiple approval cards for the
-- same action payload in one conversation. Settling a row removes it from the
-- partial unique index, so a deliberately re-proposed action can be approved
-- later after the previous one was declined or expired.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_pending_confirmations_unique_pending
  ON ai_pending_confirmations (conversation_id, action_type, action_payload)
  WHERE status = 'pending';
