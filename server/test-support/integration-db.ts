/**
 * Provisions a real Postgres for integration tests.
 *
 * Opt-in by design: unit tests must stay runnable with no database, so
 * everything here is inert unless TEST_DATABASE_URL is set. `describeIntegration`
 * skips rather than fails, so a contributor without Docker sees the suite pass
 * and CI still gets the coverage.
 *
 * Isolation is per *database*, not per schema. A schema-based approach is
 * cheaper but cannot work here: several migrations define SECURITY DEFINER
 * functions pinned to `SET search_path = public`, and Postgres validates a SQL
 * function body at creation time under that pinned path — so a table living in
 * a custom schema is invisible and the migration fails. Running each suite in
 * its own database puts the schema exactly where production has it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { describe } from "vitest";

import { createPgNeonClient, type NeonLikeClient } from "./pg-neon-adapter";

export const integrationDatabaseUrl = () => process.env.TEST_DATABASE_URL || "";

export const hasIntegrationDatabase = () => Boolean(integrationDatabaseUrl());

/**
 * `describe` that skips when no database is configured, so the suite is green
 * for contributors without Docker while still running in CI.
 */
export const describeIntegration = hasIntegrationDatabase() ? describe : describe.skip;

const migrationsDirectory = join(__dirname, "..", "..", "migrations");

/**
 * Migration files in the order their numeric prefixes imply, falling back to
 * name order for the duplicated prefixes the repo already contains (two 050s).
 */
const migrationFiles = () =>
  readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left.slice(0, 3), 10);
      const rightNumber = Number.parseInt(right.slice(0, 3), 10);
      if (
        Number.isFinite(leftNumber) &&
        Number.isFinite(rightNumber) &&
        leftNumber !== rightNumber
      ) {
        return leftNumber - rightNumber;
      }
      return left.localeCompare(right);
    });

export type IntegrationDatabase = {
  pool: Pool;
  sql: NeonLikeClient;
  databaseName: string;
  close: () => Promise<void>;
};

/** Swaps the database name in a connection string, keeping credentials intact. */
const withDatabase = (url: string, databaseName: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

/**
 * Creates a throwaway database, applies every migration into it, and returns a
 * client that runs the server's queries against it.
 */
export const createIntegrationDatabase = async (
  label = "test",
): Promise<IntegrationDatabase> => {
  const url = integrationDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL is not set");

  const databaseName = `wf_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${Date.now().toString(36)}`;

  // CREATE DATABASE cannot run inside a transaction or against the database
  // being created, so it goes through a single-shot admin connection.
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: withDatabase(url, databaseName), max: 4 });

  const setup = await pool.connect();
  try {
    // pgcrypto backs gen_random_uuid(), which the schema relies on throughout.
    await setup.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    for (const file of migrationFiles()) {
      const sql = readFileSync(join(migrationsDirectory, file), "utf8");
      try {
        await setup.query(sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${file} failed: ${message}`);
      }
    }
  } finally {
    setup.release();
  }

  return {
    pool,
    sql: createPgNeonClient(pool),
    databaseName,
    close: async () => {
      await pool.end().catch(() => {});
      const cleanup = new Client({ connectionString: url });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } catch {
        // A leftover test database is noise, not a failure worth failing on.
      } finally {
        await cleanup.end();
      }
    },
  };
};
