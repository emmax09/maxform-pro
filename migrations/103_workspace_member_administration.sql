-- Owner-set credentials and the full set of member controls.
--
-- Migration 100 made a member a real account. This adds what an owner needs to
-- administer one:
--
--   * users.blocked_at / blocked_by -- an account-level stop. Suspension
--     (workspace_members.status) removes access to one workspace; blocking
--     refuses sign-in outright, which is the control an owner reaches for when
--     something has gone wrong rather than merely changed.
--   * workspace_members.provisioned -- whether this workspace created the
--     account. Only a provisioned account may be deleted outright from here;
--     an account that existed first is never destroyed by the workspace that
--     borrowed it.
--   * workspace_members.credentials_sent_at -- when sign-in details last went
--     out, so "resend" is an informed decision rather than a guess.

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS blocked_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS provisioned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_blocked
  ON users(blocked_at)
  WHERE blocked_at IS NOT NULL;

-- An account with no workspace of its own was created by the workspace it
-- belongs to; that is the only way such a row can exist. Marking these lets the
-- delete-account control appear for members added before this migration.
UPDATE workspace_members member
SET provisioned = TRUE
WHERE member.role <> 'owner'
  AND member.provisioned = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM workspace_members own
    WHERE own.user_id = member.user_id AND own.role = 'owner'
  );

COMMENT ON COLUMN users.blocked_at IS
  'Set while the account is blocked from signing in anywhere. NULL means the account is usable.';
COMMENT ON COLUMN workspace_members.provisioned IS
  'TRUE when this workspace created the account. Only these may be deleted outright by the workspace.';
COMMENT ON COLUMN workspace_members.credentials_sent_at IS
  'When sign-in details were last emailed to this member.';
