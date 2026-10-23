import type { NeonQueryFunction } from "@neondatabase/serverless";

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

let sqlPromise: Promise<NeonQueryFunction<false, false>> | null = null;

const database = () => {
  if (typeof window !== "undefined") {
    throw new Error("Database queries are only available on the server.");
  }
  if (!sqlPromise) {
    sqlPromise = import("@neondatabase/serverless").then(({ neon }) => {
      const databaseUrl =
        typeof process === "undefined" ? "" : process.env.DATABASE_URL || "";
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is not set");
      }
      return neon(databaseUrl);
    });
  }
  return sqlPromise;
};

export const query = async <Row = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<Row>> => {
  const sql = await database();
  const result = await sql.query(text, params);
  const rows = result as unknown as Row[];

  return {
    rows,
    rowCount: rows.length,
  };
};

export default database;
