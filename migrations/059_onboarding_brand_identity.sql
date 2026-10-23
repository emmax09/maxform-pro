-- Brand identity captured during onboarding.
--
-- These are not a second copy of the workspace's branding: company_settings
-- stays the source of truth, and completing onboarding writes through to it.
-- They are stored here too so a half-finished signup can resume with the
-- answers intact before there is anything to write through.

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) NOT NULL DEFAULT '';

ALTER TABLE user_onboarding
  DROP CONSTRAINT IF EXISTS user_onboarding_brand_color_check;
ALTER TABLE user_onboarding
  ADD CONSTRAINT user_onboarding_brand_color_check
    CHECK (brand_color = '' OR brand_color ~ '^#[0-9A-Fa-f]{6}$');

-- A data: URI or an https: URL, matching what company_settings.company_logo_url
-- already accepts. Nullable because a logo is genuinely optional — a brand
-- with no artwork yet still has a name and a colour.
ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS industry TEXT NOT NULL DEFAULT '';
