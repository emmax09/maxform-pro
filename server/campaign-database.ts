import { neon } from "@neondatabase/serverless";

/**
 * Campaign workers use Neon over HTTP. A short DNS/TLS/socket interruption
 * should be retried before a batch is returned to BullMQ, while SQL errors
 * still fail immediately and remain visible to the caller.
 */
/**
 * Deliberately two parameters, not three.
 *
 * The contract previously carried `options?: unknown`, which no caller ever
 * passed and which a plain Neon client could not satisfy: a function property
 * is checked contravariantly, so promising to accept `unknown` there is a
 * promise Neon's typed options cannot keep. Dropping it lets the raw client be
 * handed straight to anything taking a CampaignDatabase, which is what the
 * payment and provider paths already do.
 */
export type CampaignDatabase = {
  query: (query: string, params?: unknown[]) => Promise<unknown[]>;
};

const retryableTransportError = (error: unknown) => {
  const candidate = error as {
    message?: unknown;
    cause?: { message?: unknown; code?: unknown };
  };
  const message = [
    candidate?.message,
    candidate?.cause?.message,
    candidate?.cause?.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /fetch failed|error connecting to database|enotfound|eai_again|econnreset|etimedout|econnrefused|network|socket/i.test(
    message,
  );
};

const retryAttempts = () =>
  Math.max(
    1,
    Math.min(5, Math.floor(Number(process.env.CAMPAIGN_DATABASE_RETRY_ATTEMPTS || 3))),
  );

const retryDelayMs = (attempt: number) =>
  Math.min(
    2_000,
    Math.max(50, Number(process.env.CAMPAIGN_DATABASE_RETRY_DELAY_MS || 250)) *
      2 ** Math.max(0, attempt),
  );

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const createCampaignDatabase = (url: string): CampaignDatabase => {
  const client = neon(url);

  return {
    query: async (query, params = []) => {
      let lastError: unknown;
      const attempts = retryAttempts();
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return (await client.query(query, params)) as unknown[];
        } catch (error) {
          lastError = error;
          if (!retryableTransportError(error) || attempt === attempts - 1) throw error;
          await sleep(retryDelayMs(attempt));
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("The campaign database request failed.");
    },
  };
};
