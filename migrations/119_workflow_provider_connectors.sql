-- Provider actions used by the workspace workflow builder.
-- Google Workspace remains one central connection; Gmail and Sheets are
-- capability-specific actions backed by the same encrypted OAuth account.

UPDATE integration_providers
SET description = 'Calendar, Meet, Sheets, Drive, Gmail, and contacts in one workspace connection.',
    capabilities = (
      SELECT jsonb_agg(DISTINCT capability ORDER BY capability)
      FROM jsonb_array_elements_text(capabilities || '["email.read","email.send"]'::jsonb) AS item(capability)
    ),
    updated_at = NOW()
WHERE key = 'google_workspace';
