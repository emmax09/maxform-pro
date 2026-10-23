-- Files and Documents are deliberately separate workspace modules:
-- Files stores and organizes assets; Documents tracks signature workflows.
-- This application currently uses the authenticated user as its workspace
-- boundary, so every table is scoped by user_id.

CREATE TABLE IF NOT EXISTS workspace_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES workspace_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_folders_unique_name
  ON workspace_folders(
    user_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER(name)
  );

CREATE INDEX IF NOT EXISTS idx_workspace_folders_parent
  ON workspace_folders(user_id, parent_id, name);

CREATE TABLE IF NOT EXISTS workspace_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES workspace_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL,
  content_data TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN (
      'form_upload',
      'event_upload',
      'document',
      'manual',
      'import'
    )),
  source_id UUID,
  source_label TEXT NOT NULL DEFAULT '',
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  scan_status TEXT NOT NULL DEFAULT 'clean'
    CHECK (scan_status IN ('pending', 'clean', 'quarantined')),
  deleted_at TIMESTAMPTZ,
  purge_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, storage_key),
  CHECK (
    content_data IS NULL OR
    content_data ~ '^data:[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_workspace_files_visible
  ON workspace_files(user_id, folder_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_files_trash
  ON workspace_files(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_files_source
  ON workspace_files(user_id, source_type, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_file_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_file_shares_owner
  ON workspace_file_share_links(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 180),
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL
    CHECK (source_type IN ('uploaded_pdf', 'block_built')),
  base_file_id UUID REFERENCES workspace_files(id) ON DELETE SET NULL,
  blocks JSONB NOT NULL DEFAULT '[]',
  field_positions JSONB NOT NULL DEFAULT '[]',
  signer_roles JSONB NOT NULL DEFAULT '[{"role":"signer","order":1}]',
  default_signing_order TEXT NOT NULL DEFAULT 'sequential'
    CHECK (default_signing_order IN ('sequential', 'parallel')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_owner
  ON document_templates(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES document_templates(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 220),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'sent',
      'viewed',
      'partially_signed',
      'completed',
      'declined',
      'voided',
      'expired'
    )),
  signing_order TEXT NOT NULL DEFAULT 'sequential'
    CHECK (signing_order IN ('sequential', 'parallel')),
  merge_values JSONB NOT NULL DEFAULT '{}',
  signed_file_id UUID REFERENCES workspace_files(id) ON DELETE SET NULL,
  certificate_file_id UUID REFERENCES workspace_files(id) ON DELETE SET NULL,
  document_hash TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_owner
  ON workspace_documents(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_status
  ON workspace_documents(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('signer', 'approver', 'cc')),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 1 CHECK (order_index > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'viewed', 'signed', 'approved', 'declined')),
  signature_value TEXT NOT NULL DEFAULT '',
  signed_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  ip_address INET,
  consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  signing_token TEXT NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_signers_document
  ON document_signers(document_id, order_index);

CREATE INDEX IF NOT EXISTS idx_document_signers_pending
  ON document_signers(document_id, status)
  WHERE status IN ('pending', 'viewed');

CREATE TABLE IF NOT EXISTS document_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES document_signers(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'created',
      'sent',
      'viewed',
      'signed',
      'approved',
      'declined',
      'reminded',
      'completed',
      'voided'
    )),
  actor_name TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_events_timeline
  ON document_events(document_id, created_at ASC);

CREATE TABLE IF NOT EXISTS document_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_signing_order TEXT NOT NULL DEFAULT 'sequential'
    CHECK (default_signing_order IN ('sequential', 'parallel')),
  reminder_days INTEGER NOT NULL DEFAULT 3 CHECK (reminder_days BETWEEN 1 AND 30),
  expiry_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_days BETWEEN 1 AND 365),
  identity_verification BOOLEAN NOT NULL DEFAULT FALSE,
  include_workspace_branding BOOLEAN NOT NULL DEFAULT TRUE,
  disclosure_text TEXT NOT NULL DEFAULT
    'I consent to use electronic records and signatures for this document.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bring existing, real form-upload assets into the universal Files module.
INSERT INTO workspace_files (
  user_id,
  name,
  mime_type,
  size_bytes,
  storage_key,
  content_data,
  source_type,
  source_id,
  source_label,
  uploaded_by,
  scan_status,
  created_at,
  updated_at
)
SELECT
  form.created_by,
  upload.file_name,
  upload.mime_type,
  upload.file_size,
  'forms/' || upload.id::text,
  upload.content_data,
  'form_upload',
  upload.submission_id,
  'From: ' || COALESCE(NULLIF(form.title, ''), 'Untitled form') || ' / Response',
  form.created_by,
  'clean',
  upload.created_at,
  upload.created_at
FROM form_submission_files upload
JOIN forms form ON form.id = upload.form_id
WHERE form.created_by IS NOT NULL
ON CONFLICT (user_id, storage_key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE workspace_folders FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_files FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_file_share_links FROM maxform_browser;
    REVOKE ALL ON TABLE document_templates FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_documents FROM maxform_browser;
    REVOKE ALL ON TABLE document_signers FROM maxform_browser;
    REVOKE ALL ON TABLE document_events FROM maxform_browser;
    REVOKE ALL ON TABLE document_settings FROM maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE workspace_files IS
  'Universal, user-scoped file catalog for uploads, signed documents, and imported assets.';

COMMENT ON TABLE workspace_documents IS
  'Active signature workflows; completed output is linked back into workspace_files.';
