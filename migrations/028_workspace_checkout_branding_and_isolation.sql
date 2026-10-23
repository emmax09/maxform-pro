ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) NOT NULL DEFAULT '#236BFE'
    CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$');

DELETE FROM company_settings older
USING company_settings newer
WHERE older.user_id = newer.user_id
  AND (
    older.updated_at < newer.updated_at
    OR (
      older.updated_at = newer.updated_at
      AND older.id < newer.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_settings_user_unique
  ON company_settings(user_id);

DELETE FROM profiles older
USING profiles newer
WHERE older.user_id = newer.user_id
  AND (
    older.updated_at < newer.updated_at
    OR (
      older.updated_at = newer.updated_at
      AND older.id < newer.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_unique
  ON profiles(user_id);

DELETE FROM invitations older
USING invitations newer
WHERE older.invited_by = newer.invited_by
  AND LOWER(older.email) = LOWER(newer.email)
  AND older.status = 'pending'
  AND newer.status = 'pending'
  AND (
    older.created_at < newer.created_at
    OR (
      older.created_at = newer.created_at
      AND older.id < newer.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_workspace_email
  ON invitations(invited_by, LOWER(email))
  WHERE status = 'pending';

ALTER TABLE workspace_regional_settings
  ADD COLUMN IF NOT EXISTS currency_country_code VARCHAR(2)
    CHECK (
      currency_country_code IS NULL
      OR currency_country_code ~ '^[A-Z]{2}$'
    );

COMMENT ON COLUMN company_settings.brand_color IS
  'Workspace accent used for dashboard and public checkout branding.';
COMMENT ON COLUMN workspace_regional_settings.currency_country_code IS
  'ISO 3166-1 alpha-2 country selected for the workspace currency row.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE profiles FROM maxform_browser;
    REVOKE ALL ON TABLE company_settings FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_regional_settings FROM maxform_browser;
    REVOKE ALL ON TABLE notification_preferences FROM maxform_browser;
    REVOKE ALL ON TABLE invitations FROM maxform_browser;
    REVOKE UPDATE ON TABLE users FROM maxform_browser;
  END IF;
END
$$;
