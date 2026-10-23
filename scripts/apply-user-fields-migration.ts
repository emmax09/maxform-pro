import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
const envPath = join(process.cwd(), '.env');
const envContent = readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    process.env[key] = value;
  }
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  try {
    console.log('Adding phone field to users table...');
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`;
    
    console.log('Adding additional fields to profiles table...');
    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company VARCHAR(255)`;
    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`;
    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country VARCHAR(100)`;
    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT`;
    
    console.log('Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_profiles_company ON profiles(company)`;
    
    console.log('✓ User fields migration completed successfully!');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  }
}

main();
