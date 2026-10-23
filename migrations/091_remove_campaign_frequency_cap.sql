-- Frequency capping is no longer a campaign feature. Keep suppression and
-- unsubscribe filtering as the compliance boundary, but do not silently skip
-- otherwise eligible contacts because of an adjustable rolling-send limit.
ALTER TABLE contact_campaign_settings
  DROP COLUMN IF EXISTS frequency_cap_count,
  DROP COLUMN IF EXISTS frequency_cap_days;
