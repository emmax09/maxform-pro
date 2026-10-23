import { neon } from "@neondatabase/serverless";

import {
  abortStorageMultipartUpload,
  deleteStorageObject,
  type StorageObjectLocation,
} from "../server/storage-service";

type Row = Record<string, unknown>;

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = neon(databaseUrl);
const requestedBatch = Number(
  process.argv.find((value) => value.startsWith("--batch="))?.split("=")[1],
);
const batchSize = Number.isInteger(requestedBatch)
  ? Math.max(1, Math.min(500, requestedBatch))
  : 100;
const dryRun = process.argv.includes("--dry-run");

const locationFor = (row: Row): StorageObjectLocation => ({
  bucket: String(row.bucket_name || ""),
  key: String(row.object_key || ""),
  publicUrl: row.public_url ? String(row.public_url) : null,
  visibility: String(row.visibility) === "public" ? "public" : "private",
});

let removed = 0;
let failed = 0;

const deleting = await sql.query(
  `SELECT id, bucket_name, object_key, public_url, visibility
   FROM storage_objects
   WHERE status = 'deleting'
   ORDER BY updated_at
   LIMIT $1`,
  [batchSize],
);

for (const value of deleting) {
  const row = value as Row;
  try {
    if (!dryRun) {
      await deleteStorageObject(locationFor(row));
      await sql.query(
        `WITH removed_crm_reference AS (
           DELETE FROM crm_attachments WHERE storage_object_id = $1
         ),
         removed_form_reference AS (
           DELETE FROM form_submission_files WHERE storage_object_id = $1
         ),
         removed_workspace_reference AS (
           DELETE FROM workspace_files WHERE storage_object_id = $1
         )
         UPDATE storage_objects
         SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'deleting'`,
        [row.id],
      );
    }
    removed += 1;
  } catch (error) {
    failed += 1;
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Retrying an R2 deletion failed.",
        id: row.id,
        error: error instanceof Error ? error.message : "Unknown error",
      })}\n`,
    );
  }
}

const pendingCapacity = Math.max(0, batchSize - deleting.length);
const pending = await sql.query(
  `SELECT object.id,
          COALESCE(session.upload_bucket_name, object.bucket_name)
            AS bucket_name,
          COALESCE(session.upload_object_key, object.object_key)
            AS object_key,
          NULL::text AS public_url,
          COALESCE(session.upload_visibility, object.visibility)
            AS visibility,
          session.multipart_upload_id, session.status AS session_status
   FROM storage_upload_sessions session
   JOIN storage_objects object ON object.id = session.storage_object_id
   WHERE session.status IN ('pending', 'processing')
     AND session.expires_at < NOW()
   ORDER BY session.expires_at
   LIMIT $1`,
  [pendingCapacity],
);

for (const value of pending) {
  const row = value as Row;
  try {
    if (!dryRun) {
      const uploadId = String(row.multipart_upload_id || "");
      if (uploadId) {
        await abortStorageMultipartUpload({
          location: locationFor(row),
          uploadId,
        }).catch(() => undefined);
      }
      await deleteStorageObject(locationFor(row));
      await sql.query(
        `WITH ended_session AS (
           UPDATE storage_upload_sessions
           SET status = 'aborted', completed_at = NOW()
           WHERE storage_object_id = $1
             AND status IN ('pending', 'processing')
         )
         UPDATE storage_objects
         SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [row.id],
      );
    }
    removed += 1;
  } catch (error) {
    failed += 1;
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Expired R2 upload cleanup failed.",
        id: row.id,
        error: error instanceof Error ? error.message : "Unknown error",
      })}\n`,
    );
  }
}

const remainingCapacity = Math.max(
  0,
  batchSize - deleting.length - pending.length,
);
if (remainingCapacity > 0) {
  const orphans = await sql.query(
    `SELECT object.id, object.bucket_name, object.object_key,
            object.public_url, object.visibility
     FROM storage_objects object
     WHERE object.status = 'ready'
       AND object.created_at < NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM form_submission_files file
         WHERE file.storage_object_id = object.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM workspace_files file
         WHERE file.storage_object_id = object.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM crm_attachments attachment
         WHERE attachment.storage_object_id = object.id
       )
       AND (
         object.visibility = 'private'
         OR (
           object.visibility = 'public'
           AND NOT (
             (
               object.purpose = 'profile_avatar'
               AND (
                 EXISTS (
                   SELECT 1 FROM profiles profile
                   WHERE profile.user_id = object.user_id
                     AND profile.avatar_url = object.public_url
                 )
                 OR EXISTS (
                   SELECT 1 FROM company_settings company
                   WHERE company.user_id = object.user_id
                     AND company.company_logo_url = object.public_url
                 )
               )
             )
             OR (
               object.purpose = 'product_image'
               AND EXISTS (
                 SELECT 1 FROM payment_products product
                 WHERE product.user_id = object.user_id
                   AND product.image_url = object.public_url
               )
             )
             OR (
               object.purpose = 'form_asset'
               AND (
                 EXISTS (
                   SELECT 1 FROM forms form
                   WHERE form.created_by = object.user_id
                     AND (
                       form.fields::text LIKE '%' || object.public_url || '%'
                       OR form.settings::text LIKE '%' || object.public_url || '%'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM form_fields field
                   JOIN forms form ON form.id = field.form_id
                   WHERE form.created_by = object.user_id
                     AND (
                       field.options::text LIKE '%' || object.public_url || '%'
                       OR field.config::text LIKE '%' || object.public_url || '%'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM form_settings setting
                   JOIN forms form ON form.id = setting.form_id
                   WHERE form.created_by = object.user_id
                     AND (
                       setting.theme::text LIKE '%' || object.public_url || '%'
                       OR setting.live_snapshot::text LIKE '%' || object.public_url || '%'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM form_versions version
                   JOIN forms form ON form.id = version.form_id
                   WHERE form.created_by = object.user_id
                     AND version.fields::text LIKE '%' || object.public_url || '%'
                 )
               )
             )
             OR (
               object.purpose IN ('event_asset', 'ticket_asset')
               AND (
                 EXISTS (
                   SELECT 1 FROM events event
                   WHERE event.created_by = object.user_id
                     AND (
                       event.branding::text LIKE '%' || object.public_url || '%'
                       OR event.public_sections::text LIKE '%' || object.public_url || '%'
                       OR event.section_content::text LIKE '%' || object.public_url || '%'
                       OR event.seo::text LIKE '%' || object.public_url || '%'
                       OR event.settings::text LIKE '%' || object.public_url || '%'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM event_ticket_designs design
                   JOIN events event ON event.id = design.event_id
                   WHERE event.created_by = object.user_id
                     AND (
                       design.front_layout::text LIKE '%' || object.public_url || '%'
                       OR design.back_layout::text LIKE '%' || object.public_url || '%'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM event_ticket_design_templates template
                   WHERE template.created_by = object.user_id
                     AND (
                       template.theme::text LIKE '%' || object.public_url || '%'
                       OR template.front_layout::text LIKE '%' || object.public_url || '%'
                       OR template.back_layout::text LIKE '%' || object.public_url || '%'
                     )
                 )
               )
             )
             OR (
               object.purpose = 'email_image'
               AND EXISTS (
                 SELECT 1 FROM email_templates template
                 WHERE template.user_id = object.user_id
                   AND (
                     template.blocks::text LIKE '%' || object.public_url || '%'
                     OR template.html_body LIKE '%' || object.public_url || '%'
                   )
               )
             )
           )
         )
       )
     ORDER BY object.created_at
     LIMIT $1`,
    [remainingCapacity],
  );
  for (const value of orphans) {
    const row = value as Row;
    try {
      if (!dryRun) {
        await deleteStorageObject(locationFor(row));
        await sql.query(
          `UPDATE storage_objects
           SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
           WHERE id = $1
             AND status = 'ready'
             AND status = 'ready'`,
          [row.id],
        );
      }
      removed += 1;
    } catch (error) {
      failed += 1;
      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          message: "Orphaned R2 object cleanup failed.",
          id: row.id,
          error: error instanceof Error ? error.message : "Unknown error",
        })}\n`,
      );
    }
  }
}

if (!dryRun) {
  const stagedCopies = await sql.query(
    `SELECT session.storage_object_id AS id,
            session.upload_bucket_name AS bucket_name,
            session.upload_object_key AS object_key,
            NULL::text AS public_url,
            session.upload_visibility AS visibility
     FROM storage_upload_sessions session
     WHERE session.status = 'completed'
       AND session.target_visibility = 'public'
       AND session.staging_deleted_at IS NULL
       AND (
         session.upload_bucket_name <> session.target_bucket_name
         OR session.upload_object_key <> session.target_object_key
       )
       AND session.completed_at < NOW() - INTERVAL '15 minutes'
     ORDER BY session.completed_at
     LIMIT $1`,
    [batchSize],
  );
  for (const value of stagedCopies) {
    const row = value as Row;
    try {
      await deleteStorageObject(locationFor(row));
      await sql.query(
        `UPDATE storage_upload_sessions
         SET staging_deleted_at = NOW()
         WHERE storage_object_id = $1
           AND staging_deleted_at IS NULL`,
        [row.id],
      );
    } catch (error) {
      failed += 1;
      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          message: "R2 private staging cleanup failed.",
          id: row.id,
          error: error instanceof Error ? error.message : "Unknown error",
        })}\n`,
      );
    }
  }
}

if (!dryRun) {
  await sql.query(
    `DELETE FROM storage_upload_rate_limits
     WHERE window_start < NOW() - INTERVAL '1 day'`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: failed > 0 ? "warn" : "info",
    message: "R2 cleanup finished.",
    dryRun,
    inspected: removed + failed,
    removed,
    failed,
  })}\n`,
);

if (failed > 0) process.exitCode = 1;
