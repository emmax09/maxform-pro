import { neon, neonConfig } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join } from 'path';

// Enable multiple statements
neonConfig.fetchOptions = {
  headers: {
    'Neon-Batch-Isolation-Level': 'RepeatableRead',
  }
};

// Load environment variables from .env file
const envPath = join(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
} catch (error) {
  console.warn('Warning: Could not load .env file');
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

function splitSqlStatements(source: string) {
  const statements: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        current += "\n";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = "";
      } else {
        current += character;
      }
      continue;
    }
    if (singleQuoted) {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      current += character;
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      current += character;
      continue;
    }
    if (character === "$") {
      const match = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (character === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += character;
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function runMigration(filename: string) {
  try {
    console.log(`Running migration: ${filename}...`);
    
    const migrationPath = join(process.cwd(), 'migrations', filename);
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    const statements = splitSqlStatements(migrationSQL);
    
    for (const statement of statements) {
      if (statement.length > 0) {
        await sql.query(statement);
      }
    }
    
    console.log(`✓ Migration ${filename} completed successfully`);
  } catch (error) {
    console.error(`✗ Migration ${filename} failed:`, error);
    throw error;
  }
}

async function main() {
  const migrationFile = process.argv[2];
  
  if (!migrationFile) {
    console.error('Usage: tsx scripts/run-migration.ts <migration-file>');
    console.error('Example: tsx scripts/run-migration.ts 002_add_password_reset.sql');
    process.exit(1);
  }
  
  try {
    await runMigration(migrationFile);
    console.log('\n✓ All migrations completed successfully!');
  } catch (error) {
    console.error('\n✗ Migration failed');
    process.exit(1);
  }
}

main();
