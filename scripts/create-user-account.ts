import { hash } from 'bcrypt-ts';
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

async function createUserAccount() {
  try {
    console.log('👤 Creating regular user account...\n');

    const testUser = {
      email: 'user@maxform.com',
      password: 'user123',
      fullName: 'John Doe',
      phone: '+14155552671',
      country: 'United States'
    };

    // Hash password
    const passwordHash = await hash(testUser.password, 10);

    // Check if user already exists
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${testUser.email}
    `;

    if (existingUser.length > 0) {
      console.log('⚠️  User account already exists!');
      console.log('\n📧 Email:', testUser.email);
      console.log('🔑 Password:', testUser.password);
      console.log('\n✅ You can use these credentials to login.\n');
      return;
    }

    // Insert new user
    const userResult = await sql`
      INSERT INTO users (email, password_hash, full_name, phone, created_at, updated_at)
      VALUES (${testUser.email}, ${passwordHash}, ${testUser.fullName}, ${testUser.phone}, NOW(), NOW())
      RETURNING id, email, full_name, phone, created_at
    `;

    const user = userResult[0];
    console.log('✅ User created successfully!');
    console.log('   ID:', user.id);

    // Create profile
    await sql`
      INSERT INTO profiles (user_id, full_name, phone, country, created_at, updated_at)
      VALUES (${user.id}, ${testUser.fullName}, ${testUser.phone}, ${testUser.country}, NOW(), NOW())
    `;

    console.log('✅ Profile created successfully!');

    // Create user role (regular user, not admin)
    await sql`
      INSERT INTO user_roles (user_id, role)
      VALUES (${user.id}, 'user')
    `;

    console.log('✅ User role assigned!');

    console.log('\n🎉 User account created successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📧 Email:    ', testUser.email);
    console.log('🔑 Password: ', testUser.password);
    console.log('👤 Name:     ', testUser.fullName);
    console.log('📱 Phone:    ', testUser.phone);
    console.log('🌍 Country:  ', testUser.country);
    console.log('👥 Role:     ', 'User');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error creating user account:', error);
    process.exit(1);
  }
}

createUserAccount();
