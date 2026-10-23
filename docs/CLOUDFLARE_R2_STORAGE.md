# Cloudflare R2 storage architecture

## Runtime design

All file bytes live in Cloudflare R2. PostgreSQL stores only metadata,
ownership, relationships, permissions, object keys, public asset URLs, and
short-lived upload state.

```text
Browser
  -> request upload intent
  -> Storage API authorizes tenant, source, type, size, and quota
  -> browser PUTs directly to the private R2 bucket
  -> Storage API verifies R2 size, MIME type, and magic bytes
     -> private file: mark ready in the private bucket
     -> public asset: copy to the public bucket, then mark ready

Private download
  -> authenticated Storage API ownership check
  -> short-lived signed R2 GET (default 5 minutes)

Public delivery
  -> immutable public-bucket URL through Cloudflare
```

Public assets are staged privately, so an invalid upload is never publicly
reachable. Private API responses do not include the R2 key or a permanent URL.
The backend retrieves the key from `storage_objects` only after authorization.

The private and public buckets must be different. The private bucket must have
no public domain or `r2.dev` access. The public bucket is limited to assets
that must render without authentication, such as event banners, form imagery,
email images, avatars, ticket design images, and product images.

## Required server environment

```dotenv
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=maxform-private-files
R2_PUBLIC_BUCKET_NAME=maxform-public-assets
R2_PUBLIC_URL=https://your-public-bucket-or-custom-domain.example
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
```

Optional controls:

```dotenv
R2_SIGNED_URL_TTL_SECONDS=300
R2_UPLOAD_URL_TTL_SECONDS=300
R2_MULTIPART_THRESHOLD_BYTES=26214400
R2_MULTIPART_PART_BYTES=10485760
R2_MAX_ATTEMPTS=3
```

All R2 values are server-only. Never use a `VITE_` prefix for an account ID,
endpoint, access key, or secret key. Startup fails closed for a non-Cloudflare
endpoint, malformed account ID, identical bucket names, non-HTTPS delivery
URL, or browser-exposed credentials.

Use an R2 Object Read & Write API token scoped only to the two application
buckets. See Cloudflare's [R2 API token documentation](https://developers.cloudflare.com/r2/api/tokens/).

For localhost, the public bucket's `r2.dev` URL is acceptable. Replace it with
a custom domain before production because presigned URLs use the S3 API
domain, while public CDN delivery should use the custom domain.

## Browser upload CORS

Apply a narrow policy to the private staging bucket. Add only real application
origins:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:8080",
      "https://app.example.com"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The public bucket uses the same origins but only `GET` and `HEAD`; browsers
never write directly to it.

Do not use `*` in production. Multipart uploads need `ETag` exposed to the
browser. See Cloudflare's [R2 CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

## Database metadata and security

`storage_objects` is the canonical object catalog. Important fields are:

- `user_id`: tenant/owner
- `bucket_name` and `object_key`: server-only R2 location
- `file_name`, `mime_type`, `size_bytes`, `etag`, and checksum
- `visibility`, `purpose`, and optional source relationship
- `status`, validation state, timestamps, and non-sensitive metadata
- `public_url`: required for public assets and forbidden for private files

Database constraints require every key to start with
`tenants/{user_id}/`. The browser database role has no access to
`storage_objects`, upload sessions, audit events, or workspace file
references. The legacy form-submission path has narrowly scoped access to safe
display columns and opaque object IDs; it cannot read or write object keys,
URLs, ETags, checksums, or storage state.

The form-file trigger verifies that an object:

- belongs to the form owner;
- was created for that exact form and upload field;
- is a ready, private `form_response` object; and
- has not been deleted or quarantined.

It then copies canonical metadata from `storage_objects`; browser-supplied
file metadata is never authoritative.

Storage quotas are reserved atomically before an intent is created. Pending,
ready, quarantined, and deleting bytes count against the plan allowance.

Deletion is recoverable: metadata moves to `deleting` before the R2 delete.
The cleanup job retries provider failures and only marks the row `deleted`
after R2 succeeds.

`storage_audit_events` records authorization, upload, and deletion outcomes.
It never stores credentials, signed URLs, object keys, or file content.
Operational logs fingerprint bucket names and keys rather than printing them.

## Installation and migration

1. Back up PostgreSQL and record both bucket names.
2. Create the private and public buckets, apply CORS, and set the server
   environment.
3. Run `npm run storage:install`.
4. Run `npm run storage:migrate:dry`.
5. Run `npm run storage:migrate`.
6. Run `npm run storage:verify`.
7. Run `npm run storage:finalize` only after verification reports no remaining
   database or embedded payload.
8. Run `npm run storage:harden`.
9. Run `npm run storage:lockdown`.
10. Run `npm run storage:validation-status`.
11. Run `npm run storage:security-verify`.
12. Schedule `npm run storage:cleanup` every 15-60 minutes.

Migration 050 adds the metadata catalog and upload sessions. Migration 051
fails closed before removing the legacy byte columns. Migration 052 adds
private staging, exact metadata constraints, quotas, recoverable deletion, and
the audit trail. Migration 053 locks down browser metadata permissions.
Migration 054 renames the allowlist/signature gate to `validated` so it cannot
be confused with an antivirus result.

`storage:migrate` is idempotent and follows:

```text
discover legacy payload
  -> upload to R2
  -> HEAD and checksum verification
  -> update metadata/reference
  -> remove the legacy database payload
```

## Validation and malware scanning

The current synchronous upload gate enforces allowlisted MIME types, maximum
sizes, expected R2 metadata, and magic-byte/file-signature checks. A metadata
marker explicitly records that no antivirus provider is configured.

Magic-byte validation is not malware scanning. Before accepting high-risk
Office, archive, or PDF content from untrusted users at large scale, connect
R2 event notifications to a malware scanner and keep objects unavailable
until the scanner changes their state to approved. Do not describe the current
validation as antivirus.

## Operations

- Configure an R2 lifecycle rule to abort incomplete multipart uploads.
- Keep public object keys immutable so Cloudflare can cache them for one year.
- Use short presigned URL expirations; signed URLs are bearer tokens.
- Alert on API 5xx/429 responses, quota denials, quarantined uploads, objects
  stuck in `deleting`, and cleanup failures.
- Run `storage:verify` regularly to compare R2 HEAD metadata with PostgreSQL.
- Rotate the bucket-scoped R2 token periodically and immediately after any
  suspected exposure.

Cloudflare encrypts R2 data at rest and uses TLS in transit. Application-level
authorization remains the backend's responsibility. See Cloudflare's
[R2 data security documentation](https://developers.cloudflare.com/r2/reference/data-security/)
and [presigned URL guidance](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Release checklist

- No `bytea`, base64 data URL, document, image, PDF, or generated file remains
  in PostgreSQL.
- Private bucket has no public access.
- Public uploads are unreachable until validation and promotion complete.
- Private API responses contain neither object key nor permanent URL.
- Signed downloads expire and require tenant ownership.
- Cross-tenant object access returns not found.
- Browser role cannot query storage metadata tables.
- Upload quota, rate limit, retry, abort, and cleanup paths work.
- Delete transitions are recoverable and physically remove R2 objects.
- `npm run storage:verify`, `npm run storage:security-verify`, tests, typecheck,
  and the production build pass.
