-- Central connections are available automatically in compatible modules.
-- The old access/default projections remain only for legacy workflow records;
-- there is no second permission step in the user-facing integrations hub.

UPDATE integration_providers
SET description = 'Connect Google Calendar, Meet, Drive, Docs, and Sheets to MaxForm.',
    capabilities = capabilities - 'email.read' - 'email.send' - 'contacts.read' - 'contact.sync',
    updated_at = NOW()
WHERE key = 'google_workspace';

UPDATE integration_providers
SET description = 'Connect Outlook Calendar, Teams, OneDrive, Word, and Excel to MaxForm.',
    capabilities = capabilities - 'email.read' - 'email.send' - 'contacts.read' - 'contact.sync',
    updated_at = NOW()
WHERE key = 'microsoft_365';

-- Calendly is connected through its OAuth handshake. The original seed used
-- the API-key label, which made the central directory open the wrong flow.
UPDATE integration_providers
SET auth_type = 'oauth',
    updated_at = NOW()
WHERE key = 'calendly';

INSERT INTO integration_module_access (
  workspace_id, connection_id, module_key, capabilities, enabled
)
SELECT connection.workspace_id,
       connection.id,
       module.module_key,
       provider.capabilities,
       TRUE
FROM integration_connections connection
JOIN integration_providers provider
  ON provider.key = connection.provider_key
CROSS JOIN LATERAL jsonb_array_elements_text(provider.supported_modules)
  AS module(module_key)
WHERE connection.status IN ('connected', 'partially_connected')
  AND provider.category <> 'email'
  AND provider.key <> 'mailchimp'
  AND module.module_key <> 'emails'
ON CONFLICT (connection_id, module_key) DO UPDATE SET
  capabilities = EXCLUDED.capabilities,
  enabled = TRUE,
  updated_at = NOW();

COMMENT ON TABLE integration_module_access IS
  'Compatibility projection; connected central providers are automatically available to supported modules.';
