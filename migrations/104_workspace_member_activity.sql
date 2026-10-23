-- An reviewable history of what happened to, and by, each member.
--
-- The generic `activity_log` table from migration 001 has no workspace column
-- and nothing writes to it, so "review this member's activity" had no source.
-- This is a purpose-built trail: every administrative act on a member, and
-- every sign-in they make, recorded against the workspace that owns them.
--
-- Two deliberate choices about deletion:
--
--   * member_user_id is ON DELETE SET NULL, not CASCADE. Deleting an account
--     must not erase the record of what was done to it -- that is precisely
--     the history an administrator would want afterwards.
--   * member_label holds the email as it read at the time, so a row stays
--     legible once the account behind it is gone or has been renamed.

CREATE TABLE IF NOT EXISTS workspace_member_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The workspace the event belongs to. Reads are scoped by this.
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Who the event was about, as it read when the event happened.
  member_label TEXT NOT NULL DEFAULT '',
  -- Who did it. NULL means the member themselves, or the system.
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_member_events_member
  ON workspace_member_events(member_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_member_events_workspace
  ON workspace_member_events(workspace_id, created_at DESC);

COMMENT ON TABLE workspace_member_events IS
  'Audit trail for workspace membership: administrative changes and member sign-ins. Rows outlive the accounts they describe.';
COMMENT ON COLUMN workspace_member_events.member_label IS
  'The member email as it read when the event happened, so history stays legible after a rename or deletion.';
COMMENT ON COLUMN workspace_member_events.actor_user_id IS
  'Who performed it. NULL means the member themselves, or the system.';
