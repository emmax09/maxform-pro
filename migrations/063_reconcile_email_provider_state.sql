-- Reconcile accounts created before explicit active-provider state existed.
-- A connected primary provider is the strongest legacy signal for custom mode;
-- users can switch back to Managed Sending from the provider card afterward.

UPDATE email_settings settings
SET active_provider = connection.provider,
    active_provider_mode = 'custom',
    updated_at = NOW()
FROM email_provider_connections connection
WHERE connection.user_id = settings.user_id
  AND connection.role = 'primary'
  AND connection.status = 'connected'
  AND connection.is_active = TRUE;

UPDATE email_identities identity
SET sending_mode = 'custom',
    updated_at = NOW()
FROM email_settings settings
WHERE settings.user_id = identity.user_id
  AND settings.active_provider_mode = 'custom'
  AND identity.sending_mode = 'managed';
