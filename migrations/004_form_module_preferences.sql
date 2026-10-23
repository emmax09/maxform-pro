CREATE TABLE IF NOT EXISTS form_module_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_module_preferences_user_id
  ON form_module_preferences(user_id);

DROP TRIGGER IF EXISTS update_form_module_preferences_updated_at
  ON form_module_preferences;

CREATE TRIGGER update_form_module_preferences_updated_at
  BEFORE UPDATE ON form_module_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
