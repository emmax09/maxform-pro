-- New-user onboarding.
--
-- The answers collected at signup are not throwaway analytics: the business
-- address becomes the compliance footer every marketing email is required to
-- carry, and the rest seeds sensible defaults so a new workspace is not empty
-- on arrival. They live in one row per user rather than a generic key/value
-- table so the columns that other modules read are typed and indexable.

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Who they are.
  business_name TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '',
  team_size TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',

  -- Where they are. address_line1 through country compose the postal address
  -- that Campaigns uses for its CAN-SPAM footer.
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state_region TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',

  -- What they came for. Stored as arrays because these are multi-select.
  goals JSONB NOT NULL DEFAULT '[]',
  modules JSONB NOT NULL DEFAULT '[]',
  referral_source TEXT NOT NULL DEFAULT '',

  -- Progress. current_step lets a half-finished flow resume where it stopped
  -- rather than starting over.
  current_step INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  completed_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The dashboard asks "does this user still need onboarding?" on every load.
CREATE INDEX IF NOT EXISTS idx_user_onboarding_pending
  ON user_onboarding(user_id)
  WHERE completed_at IS NULL AND skipped_at IS NULL;

-- Accounts that predate onboarding are treated as already done: retroactively
-- interrupting an established workspace with a signup questionnaire would be
-- worse than not having the answers.
INSERT INTO user_onboarding (user_id, completed_at, current_step)
SELECT id, NOW(), 0 FROM users
ON CONFLICT (user_id) DO NOTHING;
