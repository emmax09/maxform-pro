-- Make Google Gemini the active MaxAI provider for this deployment.
--
-- The provider key remains server-side in GEMINI_API_KEY. This migration only
-- selects the vendor and safe default model. It is idempotent so it can be
-- applied again during deployment without creating duplicate active rows.

UPDATE ai_provider_config
SET is_active = FALSE,
    updated_at = NOW()
WHERE is_active = TRUE;

WITH existing AS (
  SELECT id
  FROM ai_provider_config
  WHERE provider = 'gemini'
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1
)
UPDATE ai_provider_config AS config
SET provider = 'gemini',
    model = 'gemini-2.5-flash',
    base_url = '',
    label = 'Google Gemini',
    is_active = TRUE,
    updated_at = NOW()
FROM existing
WHERE config.id = existing.id;

INSERT INTO ai_provider_config
  (provider, model, base_url, label, is_active, updated_by, updated_at)
SELECT
  'gemini',
  'gemini-2.5-flash',
  '',
  'Google Gemini',
  TRUE,
  NULL,
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM ai_provider_config WHERE is_active = TRUE
);
