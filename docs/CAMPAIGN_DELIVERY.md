# Production campaign delivery

MaxForm separates latency-sensitive delivery from bulk work:

- Test and transactional email: `persist audit log -> provider now -> return accepted/failed`
- Small send-now campaign: `audience snapshot -> one direct wave -> provider now`
- Bulk or scheduled campaign: `audience snapshot -> paced batches -> BullMQ -> provider`
- Every accepted message: `provider webhook -> analytics read model`

`CAMPAIGN_BULK_THRESHOLD` defaults to 100. The actual direct-send ceiling is
also bounded by workspace/provider limits and a 30-second interactive request
budget, so a slow provider can move a smaller audience onto the bulk path. A
scheduled campaign remains a durable delayed job regardless of size because it
must survive the dashboard and web process being offline at send time.

The existing `contact_campaign_messages` and `campaign_send_batches` tables are the source of truth. PostgreSQL conditional claims and the stable `campaign-{campaignId}-{messageId}` idempotency key protect sends when workers overlap or restart.

## Required environment

```dotenv
# BullMQ TCP connection. Do not use the Upstash REST URL for BullMQ.
UPSTASH_REDIS_HOST=your-instance.upstash.io
UPSTASH_REDIS_PORT=6379
UPSTASH_REDIS_USERNAME=default
UPSTASH_REDIS_PASSWORD=your-password
QUEUE_PREFIX=maxform
QUEUE_REQUIRED=true

# Worker tuning
QUEUE_MAX_ATTEMPTS=5
QUEUE_RETRY_DELAY_MS=30000
CAMPAIGN_ORCHESTRATOR_CONCURRENCY=2
CAMPAIGN_DELIVERY_CONCURRENCY=5
CAMPAIGN_BULK_THRESHOLD=100
CAMPAIGN_WEBHOOK_CONCURRENCY=10
CAMPAIGN_METRICS_CONCURRENCY=1
TRANSACTIONAL_EMAIL_CONCURRENCY=10

# Optional reputation thresholds
CAMPAIGN_HARD_BOUNCE_PAUSE_RATE=0.04
CAMPAIGN_COMPLAINT_PAUSE_RATE=0.001
CAMPAIGN_TEMPORARY_FAILURE_SLOW_RATE=0.10
CAMPAIGN_TEMPORARY_FAILURE_PAUSE_RATE=0.20
CAMPAIGN_BATCH_STALE_MINUTES=15
```

The Redis user must have read/write permissions; do not use a read-only user such as a `*_ro` account for BullMQ. `PUBLIC_APP_URL`, `CAMPAIGN_TRACKING_SECRET`, `EMAIL_WORKER_SECRET`, the active provider credentials, and the existing database/encryption variables are still required. Production sending fails closed when the TCP Redis credentials are missing.

## Install and migrate

```bash
npm install
npm run migrate -- 096_campaign_bullmq_delivery.sql
```

Run the migration once per database before starting workers. It adds distributed-worker bookkeeping, reputation state, durable webhook events, and configurable workspace/domain/campaign limits without replacing the existing campaign schema.

Validate the release environment before enabling traffic:

```bash
npm run verify:campaigns:production
```

## Worker startup

```bash
npm run worker:campaigns
```

Run at least one worker process in production. Scale delivery workers horizontally only after setting provider/workspace limits; PostgreSQL claims, Redis locks, and the four-scope rate limiter make concurrent workers safe. The existing Vercel cron endpoints remain a recovery backstop for rows that were queued before a worker restart.

## Local/CI verification

The mock adapter never contacts a provider:

```dotenv
EMAIL_PROVIDER=mock
MOCK_EMAIL_OUTCOME=success
```

Use recipients containing `+bounce`, `+complaint`, or `+temporary` to exercise the corresponding outcome. Run:

```bash
npx vitest run server/campaign-batching.test.ts server/email-adapters.test.ts
npx tsc --noEmit
npm run build
```

For a real staging test, configure one verified provider, a verified HTTPS `PUBLIC_APP_URL`, an inbox recipient, and the provider delivery-event webhook. Confirm accepted, delivered, opened, clicked, bounced, complaint, unsubscribe, pause/resume, and retry-failed-recipient transitions before enabling production traffic.
