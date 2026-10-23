/**
 * Runs the server's queries against a plain Postgres.
 *
 * Production talks to Neon over HTTP. Neon's driver cannot point at an ordinary
 * Postgres without a websocket proxy in front of it, which would make
 * integration tests need a second container and a fetch-endpoint override just
 * to reach a database.
 *
 * Every server module gets its client from a single `neon(url)` call, so
 * mocking that one import swaps the transport for the whole server. This
 * implements the surface those modules actually use, backed by `pg`:
 *
 *   sql`SELECT * FROM t WHERE id = ${id}`   → tagged template
 *   sql.query("SELECT ... $1", [id])        → parameterised call
 *
 * Both resolve to a rows array, matching the driver they stand in for. No
 * application code changes to accommodate the tests.
 */
import { Pool, type PoolClient } from "pg";

export type NeonLikeClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

/**
 * Rebuilds a tagged template as a parameterised statement.
 *
 * Interpolating the values would both break on quoting and defeat the point of
 * testing the real queries, so each `${}` becomes a placeholder exactly as the
 * driver would produce.
 */
const toParameterised = (strings: TemplateStringsArray, values: unknown[]) => {
  let text = "";
  strings.forEach((part, index) => {
    text += part;
    if (index < values.length) text += `$${index + 1}`;
  });
  return { text, values };
};

export const createPgNeonClient = (pool: Pool | PoolClient): NeonLikeClient => {
  const run = async (text: string, params: unknown[] = []) => {
    const result = await pool.query(text, params);
    return result.rows as Record<string, unknown>[];
  };

  const client = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, values: params } = toParameterised(strings, values);
    return run(text, params);
  }) as NeonLikeClient;

  client.query = run;
  return client;
};
