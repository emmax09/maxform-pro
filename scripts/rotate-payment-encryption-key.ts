import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

type Credentials = Record<string, string>;

const databaseUrl = process.env.DATABASE_URL || "";
const currentSecrets = [
  process.env.PAYMENT_ENCRYPTION_KEY || "",
  process.env.INTEGRATION_ENCRYPTION_KEY || "",
].filter(
  (secret, index, values) =>
    secret.length >= 24 && values.indexOf(secret) === index,
);
const envPath = resolve(process.cwd(), ".env");

if (!databaseUrl || currentSecrets.length === 0) {
  throw new Error("Database and current encryption keys are required.");
}

const keys = currentSecrets.map((secret) =>
  createHash("sha256").update(secret).digest(),
);

const decrypt = (value: string): Credentials => {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted value.");
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as Credentials;
    } catch {
      // Try the next retained key.
    }
  }
  throw new Error("A payment connection could not be rotated.");
};

const nextSecret = randomBytes(48).toString("base64url");
const nextKey = createHash("sha256").update(nextSecret).digest();
const encrypt = (credentials: Credentials) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", nextKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

const sql = neon(databaseUrl);
const rows = await sql.query(
  `SELECT id, credentials_encrypted
   FROM payment_provider_connections`,
);
const rotated = rows.map((row) => ({
  id: String(row.id),
  value: encrypt(decrypt(String(row.credentials_encrypted || ""))),
}));

const currentEnv = readFileSync(envPath, "utf8");
const withoutLegacyBrowserSecret = currentEnv.replace(
  /^VITE_JWT_SECRET=.*(?:\r?\n|$)/m,
  "",
);
const nextEnv = /^PAYMENT_ENCRYPTION_KEY=.*$/m.test(
  withoutLegacyBrowserSecret,
)
  ? withoutLegacyBrowserSecret.replace(
      /^PAYMENT_ENCRYPTION_KEY=.*$/m,
      `PAYMENT_ENCRYPTION_KEY=${nextSecret}`,
    )
  : `${withoutLegacyBrowserSecret.trimEnd()}\r\nPAYMENT_ENCRYPTION_KEY=${nextSecret}\r\n`;
writeFileSync(envPath, nextEnv, "utf8");

if (rotated.length > 0) {
  await sql.transaction((transaction) =>
    rotated.map((connection) =>
      transaction`
        UPDATE payment_provider_connections
        SET credentials_encrypted = ${connection.value},
            updated_at = NOW()
        WHERE id = ${connection.id}
      `,
    ),
  );
}

process.stdout.write(
  `Payment encryption key rotated (${rotated.length} connection${rotated.length === 1 ? "" : "s"}).\n`,
);
