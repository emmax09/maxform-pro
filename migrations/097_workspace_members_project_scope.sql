-- The membership record the project-scoping rule has always needed.
--
-- Until now "who is in this workspace" existed only as an invitations row that
-- was created and revoked but never accepted, so a scoped teammate had nowhere
-- to live. This gives membership a real record, moves project_scope onto it,
-- and puts a database-level check behind the application's own.

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The workspace owner. Every other module scopes by owner id, so membership
  -- uses the same anchor rather than inventing a competing workspace key.
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('owner', 'admin', 'moderator', 'user')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  -- NULL = unrestricted, the default for an owner or admin. A non-empty array
  -- restricts the member to exactly those projects. An empty array is a member
  -- who has been scoped out of every project.
  project_scope UUID[],
  invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_members_owner
  ON workspace_members(owner_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_members_scope
  ON workspace_members USING GIN (project_scope)
  WHERE project_scope IS NOT NULL;

-- Every existing user owns their own workspace and is unrestricted in it.
INSERT INTO workspace_members (owner_id, user_id, role, status, project_scope)
SELECT users.id, users.id, 'owner', 'active', NULL
FROM users
ON CONFLICT (owner_id, user_id) DO NOTHING;

-- Accepting an invitation is what creates a membership, so the accepted rows
-- that already exist are carried across with whatever scope they were sent
-- with. Pending invitations stay pending.
INSERT INTO workspace_members (
  owner_id, user_id, role, status, project_scope, invitation_id
)
SELECT invitation.invited_by,
       invited.id,
       invitation.role,
       'active',
       invitation.project_scope,
       invitation.id
FROM invitations invitation
JOIN users invited ON LOWER(invited.email) = LOWER(invitation.email)
WHERE invitation.status = 'accepted'
  AND invitation.invited_by IS NOT NULL
ON CONFLICT (owner_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION touch_workspace_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspace_members_updated_at ON workspace_members;
CREATE TRIGGER workspace_members_updated_at
  BEFORE UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION touch_workspace_members_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: the second check, at the database.
--
-- The API already refuses to return a project outside the caller's scope. This
-- makes the same rule true one layer down, so a bug in the application alone
-- cannot leak one client's project to a contractor scoped to another.
--
-- The caller is identified by a per-transaction setting. Reads that do not set
-- it see nothing, which is why every projects query runs through
-- withProjectAccess() in server/projects-data.ts. Migrations and maintenance
-- run as the table owner, which BYPASSRLS covers.
--
-- Scope is deliberately limited to projects and workspace_members. Enabling it
-- on forms, events, or workflows would silently empty every other module in
-- the product, none of which sets the variable yet; those adopt it as they
-- migrate to the same helper.
--
-- IMPORTANT -- these policies are inert until the application stops connecting
-- as `neondb_owner`. That role both owns these tables and carries BYPASSRLS,
-- and BYPASSRLS defeats policies even with FORCE. FORCE is set here so that
-- table ownership alone will not defeat them, and the policies are verified
-- against a non-BYPASSRLS role. To make them live, create a restricted role
-- and point DATABASE_URL at it:
--
--   CREATE ROLE maxform_app LOGIN PASSWORD '<secret>' NOBYPASSRLS;
--   GRANT USAGE ON SCHEMA public TO maxform_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON ALL TABLES IN SCHEMA public TO maxform_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maxform_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO maxform_app;
--
-- Until that happens the API check in projectScopeFor()/applyScope() is the
-- only enforcement, and it should be described that way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::uuid;
$$ LANGUAGE sql STABLE;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_visible_to_scope ON projects;
CREATE POLICY projects_visible_to_scope ON projects
  USING (
    current_app_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM workspace_members member
      WHERE member.user_id = current_app_user_id()
        AND member.owner_id = projects.created_by
        AND member.status = 'active'
        AND (
          member.project_scope IS NULL
          OR projects.id = ANY (member.project_scope)
        )
    )
  )
  WITH CHECK (
    current_app_user_id() IS NOT NULL
    AND projects.created_by = current_app_user_id()
  );

DROP POLICY IF EXISTS workspace_members_visible_to_workspace ON workspace_members;
CREATE POLICY workspace_members_visible_to_workspace ON workspace_members
  USING (
    current_app_user_id() IS NOT NULL
    AND (
      workspace_members.user_id = current_app_user_id()
      OR workspace_members.owner_id = current_app_user_id()
    )
  )
  WITH CHECK (
    current_app_user_id() IS NOT NULL
    AND workspace_members.owner_id = current_app_user_id()
  );

COMMENT ON TABLE workspace_members IS
  'Workspace membership. project_scope NULL = every project; a non-empty array restricts to those projects.';
COMMENT ON FUNCTION current_app_user_id() IS
  'Reads app.current_user_id, set per transaction by withProjectAccess(). NULL means no rows are visible.';
