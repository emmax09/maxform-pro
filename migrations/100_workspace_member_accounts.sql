-- Members who can actually sign in, with the tabs their owner granted them.
--
-- Until now "adding a member" wrote an invitations row and stopped there: no
-- account was created, no mail was sent, and there was nothing to sign in with.
-- Membership also carried no notion of which parts of the product a member
-- could open. This migration adds both halves.
--
--   * users.username / must_change_password -- the credentials a provisioned
--     member receives by email and is asked to replace on first sign-in.
--   * workspace_members.allowed_modules -- NULL means every module, which is
--     what an owner or admin gets. A non-empty array restricts the member to
--     exactly those dashboard tabs.

-- ---------------------------------------------------------------------------
-- Sign-in identity
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(60);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing accounts sign in by email, but every account gets a username so the
-- column can be relied on rather than null-checked at each call site. The
-- email local part is the natural choice; short_id breaks ties because it is
-- already unique per user.
WITH candidate AS (
  SELECT
    id,
    LEFT(
      COALESCE(
        NULLIF(
          regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'),
          ''
        ),
        'member'
      ),
      30
    ) AS base,
    lower(COALESCE(short_id, LEFT(replace(id::text, '-', ''), 6))) AS suffix
  FROM users
  WHERE username IS NULL
),
numbered AS (
  SELECT
    id,
    base,
    suffix,
    ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS position
  FROM candidate
)
UPDATE users
SET username = CASE
  WHEN numbered.position = 1 THEN numbered.base
  ELSE numbered.base || '.' || numbered.suffix
END
FROM numbered
WHERE users.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (lower(username))
  WHERE username IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Module grants
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS allowed_modules TEXT[];

-- Carried on the invitation too, so the grant survives on the record that
-- created the membership and a re-sync cannot silently widen access.
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS allowed_modules TEXT[];

-- Owners and admins are unrestricted by definition; NULL is already that, this
-- only makes an accidental empty array on an owner row harmless.
UPDATE workspace_members
SET allowed_modules = NULL
WHERE role IN ('owner', 'admin')
  AND allowed_modules IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_members_allowed_modules
  ON workspace_members USING GIN (allowed_modules)
  WHERE allowed_modules IS NOT NULL;

-- Every account owns its own workspace. Migration 097 backfilled this, but a
-- signup between the two migrations would have missed it, and projectScopeFor()
-- plus the new workspace resolver both read this row.
INSERT INTO workspace_members (owner_id, user_id, role, status, project_scope)
SELECT users.id, users.id, 'owner', 'active', NULL
FROM users
ON CONFLICT (owner_id, user_id) DO NOTHING;

COMMENT ON COLUMN users.username IS
  'Unique sign-in handle. Provisioned members receive one by email; everyone else gets one derived from their address.';
COMMENT ON COLUMN users.must_change_password IS
  'TRUE while a system-generated password is still in place. Cleared on the first password change.';
COMMENT ON COLUMN workspace_members.allowed_modules IS
  'NULL = every dashboard module. A non-empty array restricts the member to those module keys (see src/lib/workspace-modules.ts).';
