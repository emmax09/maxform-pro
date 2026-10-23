-- Keep workspace business addresses structured so settings, checkout, and
-- compliance footers can use the same country/state/city data.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS state_region VARCHAR(120),
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS country VARCHAR(120);

-- Existing workspaces used the single address column. Carry it into the first
-- address line so no saved business address disappears when the new form opens.
UPDATE company_settings
SET address_line1 = COALESCE(NULLIF(BTRIM(address_line1), ''), NULLIF(BTRIM(address), ''))
WHERE NULLIF(BTRIM(address_line1), '') IS NULL
  AND NULLIF(BTRIM(address), '') IS NOT NULL;
