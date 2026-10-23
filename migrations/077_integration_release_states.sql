-- Provider release states are separate from connection health. A provider can
-- be configured at the platform level but still be intentionally unavailable
-- to workspace users until its adapter is production-ready.
ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS availability_state TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'integration_providers_availability_state_check'
  ) THEN
    ALTER TABLE integration_providers
      ADD CONSTRAINT integration_providers_availability_state_check
      CHECK (availability_state IN ('active', 'coming_soon'));
  END IF;
END $$;

UPDATE integration_providers
SET availability_state = CASE
  WHEN key IN ('box', 'hubspot', 'zapier') THEN 'coming_soon'
  ELSE 'active'
END,
sort_order = CASE key
  WHEN 'box' THEN 901
  WHEN 'hubspot' THEN 902
  WHEN 'zapier' THEN 903
  ELSE sort_order
END,
updated_at = NOW()
WHERE key IN ('box', 'hubspot', 'zapier')
   OR availability_state IS NULL;

CREATE INDEX IF NOT EXISTS idx_integration_providers_availability
  ON integration_providers(availability_state, sort_order, name);
