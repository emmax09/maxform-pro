import { compare } from 'bcrypt-ts';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env file manually
const envPath = join(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      process.env[key.trim()] = value;
    }
  });
} catch (error) {
  console.error('⚠️  Could not load .env file');
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env file');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function testLogin() {
  try {
    const testAccounts = [
      { email: 'test@maxform.com', password: 'test123' },
      { email: 'user@maxform.com', password: 'user123' }
    ];

    console.log('🔐 Testing login for both accounts...\n');

    for (const account of testAccounts) {
      console.log(`Testing: ${account.email}`);
      
      // Get user from database
      const users = await sql`
        SELECT id, email, password_hash, full_name 
        FROM users 
        WHERE email = ${account.email}
      `;

      if (users.length === 0) {
        console.log('   ❌ User not found\n');
        continue;
      }

      const user = users[0];
      
      // Test password
      const isValid = await compare(account.password, user.password_hash);
      
      if (isValid) {
        console.log('   ✅ Password is correct!');
        console.log(`   📧 Email: ${account.email}`);
        console.log(`   🔑 Password: ${account.password}`);
        console.log('');
      } else {
        console.log('   ❌ Password is incorrect');
        console.log('   🔍 This might be a bcrypt issue\n');
      }
    }

  } catch (error) {
    console.error('❌ Error testing login:', error);
    process.exit(1);
  }
}

testLogin();
