-- Projects: the folder that groups work (forms, workflows, events, files) and
-- gates who can see it. The table already existed from the initial schema as a
-- bare name/description record; this migration turns it into the real module.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'folder';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'blue';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_status_check
      CHECK (status IN ('active', 'archived'));
  END IF;
END $$;

-- created_by is the workspace owner. Every other module in this platform is
-- scoped the same way, so projects stay consistent with it rather than
-- introducing a second, competing notion of workspace ownership.
CREATE INDEX IF NOT EXISTS idx_projects_owner_status
  ON projects(created_by, status, updated_at DESC);

-- Deleting a project must NOT destroy the work inside it. The initial schema
-- wired forms.project_id with ON DELETE CASCADE, which would have taken every
-- form -- and therefore every submission, payment, and file behind it -- down
-- with the folder. Contents are unassigned instead (see the delete path in
-- server/projects-data.ts), and the FK is corrected here as the backstop.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'forms'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'forms'::regclass AND attname = 'project_id')
    ]::smallint[];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE forms DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE forms
    ADD CONSTRAINT forms_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS project_id UUID
    REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS project_id UUID
    REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_project
  ON events(project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflows_project
  ON workflows(project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

-- NULL means unrestricted -- the default for an owner or admin. A non-empty
-- array restricts the member to exactly those projects. This platform has no
-- accepted-membership record yet, so the scope is stored on the invitation
-- that carries it; the check that reads it lives in projectScopeFor().
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS project_scope UUID[];

CREATE INDEX IF NOT EXISTS idx_invitations_project_scope
  ON invitations USING GIN (project_scope)
  WHERE project_scope IS NOT NULL;

COMMENT ON TABLE projects IS
  'Named folder grouping forms, workflows, events, and files under one initiative or client.';
COMMENT ON COLUMN projects.status IS
  'active or archived. Archiving hides the project; everything inside stays intact.';
COMMENT ON COLUMN invitations.project_scope IS
  'NULL = sees every project. A non-empty array restricts the invitee to those projects only.';
COMMENT ON COLUMN events.project_id IS
  'Optional project grouping. Unassigned events stay visible in the main Events list.';
COMMENT ON COLUMN workflows.project_id IS
  'Optional project grouping. Unassigned workflows stay visible in the main Workflows list.';
