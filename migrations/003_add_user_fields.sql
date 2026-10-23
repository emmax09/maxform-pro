-- Add additional user fields to users and profiles tables

-- Add phone to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- Add company and other fields to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;

-- Create index for phone lookups
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_company ON profiles(company);

-- Add comment
COMMENT ON COLUMN users.phone IS 'User phone number for contact';
COMMENT ON COLUMN profiles.company IS 'Company name where user works';
COMMENT ON COLUMN profiles.country IS 'User country location';
