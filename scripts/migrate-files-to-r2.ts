import { createHash } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import {
  getStorageObjectStream,
  headStorageObject,
  normalizeMimeType,
  putStorageObject,
  resolveStorageLocation,
  sanitizeStorageFileName,
  validateObjectSignature,
  validateStorageUpload,
  type StoragePurpose,
  type StorageVisibility,
} from "../server/storage-service";

type Row = Record<string, unknown>;
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = neon(databaseUrl);
const dryRun = process.argv.includes("--dry-run");
const verifyOnly = process.argv.includes("--verify-only");
const requestedBatch = Number(
  process.argv.find((value) => value.startsWith("--batch="))?.split("=")[1],
);
const batchSize = Number.isInteger(requestedBatch)
  ? Math.max(1, Math.min(100, requestedBatch))
  : 20;

const dataUrlPattern =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i;
const embeddedDataUrlPattern =
  /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[a-z0-9+/]+={0,2}/gi;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const counters = {
  discovered: 0,
  migrated: 0,
  verified: 0,
  skipped: 0,
  failed: 0,
};

const log = (
  level: "info" | "warn" | "error",
  message: string,
  detail: Record<string, unknown> = {},
) => {
  process[level === "info" ? "stdout" : "stderr"].write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...detail,
    })}\n`,
  );
};

const parseDataUrl = (value: unknown) => {
  const match = String(value || "").match(dataUrlPattern);
  if (!match) throw new Error("Legacy payload is not a valid base64 data URL.");
  const mimeType = normalizeMimeType(match[1]);
  const content = Buffer.from(match[2], "base64");
  if (content.length === 0) throw new Error("Legacy payload is empty.");
  return { mimeType, content };
};

const extensionByMimeType: Record<string, string> = {
  "application/json": ".json",
  "application/msword": ".doc",
  "application/pdf": ".pdf",
  "application/rtf": ".rtf",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/zip": ".zip",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "text/rtf": ".rtf",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

const safeSegment = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unknown";

const prefixByPurpose: Record<StoragePurpose, string> = {
  workspace_file: "workspace-files",
  form_response: "form-responses",
  form_asset: "form-assets",
  event_asset: "event-assets",
  ticket_asset: "ticket-assets",
  email_image: "email-images",
  profile_avatar: "profile-avatars",
  product_image: "product-images",
  crm_attachment: "crm-attachments",
  document_template: "document-templates",
  generated_document: "generated-documents",
  export: "exports",
};

const storedObjectFor = async (input: {
  ownerUserId: string;
  sourceId?: string | null;
  legacyArea: string;
  legacyId: string;
  purpose: StoragePurpose;
  visibility: StorageVisibility;
  fileName: string;
  dataUrl: string;
}) => {
  const { mimeType, content } = parseDataUrl(input.dataUrl);
  validateStorageUpload({
    purpose: input.purpose,
    visibility: input.visibility,
    mimeType,
    sizeBytes: content.length,
  });
  if (!validateObjectSignature(mimeType, content.subarray(0, 4_096))) {
    throw new Error("Legacy payload signature does not match its MIME type.");
  }
  const checksum = createHash("sha256").update(content).digest("hex");
  const extension =
    extensionByMimeType[mimeType] ||
    sanitizeStorageFileName(input.fileName).match(/\.[a-z0-9]{1,8}$/i)?.[0] ||
    "";
  const key = [
    "tenants",
    input.ownerUserId,
    prefixByPurpose[input.purpose],
    "legacy",
    safeSegment(input.legacyArea),
    safeSegment(input.legacyId),
    `${checksum.slice(0, 32)}${extension}`,
  ].join("/");
  const location = resolveStorageLocation(input.visibility, key);

  if (!verifyOnly) {
    await putStorageObject({
      location,
      fileName: input.fileName,
      mimeType,
      body: content,
      sizeBytes: content.length,
      metadata: {
        migrated: "true",
        "legacy-area": input.legacyArea,
        "legacy-id": input.legacyId,
        "sha256-prefix": checksum.slice(0, 32),
      },
    });
  }
  const head = await headStorageObject(location);
  if (
    head.contentLength !== content.length ||
    head.contentType !== mimeType
  ) {
    throw new Error("R2 verification did not match the legacy payload.");
  }
  const storedChecksum = await checksumStorageObject(location);
  if (storedChecksum !== checksum) {
    throw new Error("R2 checksum did not match the legacy payload.");
  }
  counters.verified += 1;
  if (verifyOnly) {
    return {
      id: "",
      objectKey: key,
      publicUrl: location.publicUrl,
      bucket: location.bucket,
      mimeType,
      sizeBytes: content.length,
      etag: head.etag,
      checksum,
    };
  }
  const rows = await sql.query(
    `INSERT INTO storage_objects (
       user_id, provider, bucket_name, object_key, file_name, mime_type,
       size_bytes, visibility, purpose, source_id, public_url, etag,
       checksum_sha256, status, scan_status, metadata, verified_at,
       created_at, updated_at
     )
     VALUES (
       $1, 'r2', $2, $3, $4, $5, $6, $7, $8, $9, $10,
       NULLIF($11, ''), $12, 'ready', 'validated',
        jsonb_build_object(
          'migratedFrom', $13::text,
          'legacyId', $14::text
        ),
       NOW(), NOW(), NOW()
     )
     ON CONFLICT (bucket_name, object_key) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       file_name = EXCLUDED.file_name,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       visibility = EXCLUDED.visibility,
       purpose = EXCLUDED.purpose,
       source_id = EXCLUDED.source_id,
       public_url = EXCLUDED.public_url,
       etag = EXCLUDED.etag,
       checksum_sha256 = EXCLUDED.checksum_sha256,
       status = 'ready',
       scan_status = 'validated',
       deleted_at = NULL,
       verified_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [
      input.ownerUserId,
      location.bucket,
      key,
      sanitizeStorageFileName(input.fileName),
      mimeType,
      content.length,
      input.visibility,
      input.purpose,
      input.sourceId && uuidPattern.test(input.sourceId)
        ? input.sourceId
        : null,
      location.publicUrl,
      head.etag,
      checksum,
      input.legacyArea,
      input.legacyId,
    ],
  );
  return {
    id: String(rows[0]?.id || ""),
    objectKey: key,
    publicUrl: location.publicUrl,
    bucket: location.bucket,
    mimeType,
    sizeBytes: content.length,
    etag: head.etag,
    checksum,
  };
};

const countRows = async (queryText: string) => {
  const rows = await sql.query(
    `SELECT COUNT(*)::integer AS count FROM (${queryText}) legacy_count`,
  );
  return Number(rows[0]?.count || 0);
};

const databaseColumnExists = async (tableName: string, columnName: string) => {
  const rows = await sql.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS present`,
    [tableName, columnName],
  );
  return rows[0]?.present === true;
};

const checksumStorageObject = async (location: {
  bucket: string;
  key: string;
  publicUrl: string | null;
  visibility: StorageVisibility;
}) => {
  const stored = await getStorageObjectStream(location);
  const checksum = createHash("sha256");
  for await (const chunk of stored.body) checksum.update(chunk);
  return checksum.digest("hex");
};

async function migrateFormFiles() {
  if (!(await databaseColumnExists("form_submission_files", "content_data"))) {
    log("info", "Legacy form response payload column is already removed.");
    return;
  }
  const source = `
    SELECT file.id, file.form_id, file.file_name, file.content_data,
           form.created_by AS owner_user_id
    FROM form_submission_files file
    JOIN forms form ON form.id = file.form_id
    WHERE file.content_data IS NOT NULL`;
  if (dryRun) {
    const count = await countRows(source);
    counters.discovered += count;
    log("info", "Legacy form response files discovered.", { count });
    return;
  }
  const failedIds = new Set<string>();
  while (true) {
    const rows = await sql.query(
      `SELECT *
       FROM (${source}) legacy
       WHERE legacy.id::text <> ALL($2::text[])
       ORDER BY legacy.id
       LIMIT $1`,
      [batchSize, Array.from(failedIds)],
    );
    if (rows.length === 0) break;
    for (const value of rows) {
      const row = value as Row;
      counters.discovered += 1;
      try {
        const stored = await storedObjectFor({
          ownerUserId: String(row.owner_user_id),
          sourceId: String(row.form_id),
          legacyArea: "form_submission_files",
          legacyId: String(row.id),
          purpose: "form_response",
          visibility: "private",
          fileName: String(row.file_name || "form-upload"),
          dataUrl: String(row.content_data),
        });
        if (!verifyOnly) {
          await sql.query(
            `UPDATE form_submission_files
             SET storage_object_id = $1,
                 object_key = $2,
                 storage_provider = 'r2',
                 file_url = $3,
                 etag = NULLIF($4, ''),
                 checksum_sha256 = $5,
                 content_data = NULL
             WHERE id = $6 AND content_data IS NOT NULL`,
            [
              stored.id,
              stored.objectKey,
              stored.publicUrl,
              stored.etag,
              stored.checksum,
              row.id,
            ],
          );
          counters.migrated += 1;
        }
      } catch (error) {
        counters.failed += 1;
        failedIds.add(String(row.id));
        log("error", "Form response file migration failed.", {
          id: row.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    if (verifyOnly) break;
  }
}

async function migrateWorkspaceFiles() {
  if (!(await databaseColumnExists("workspace_files", "content_data"))) {
    log("info", "Legacy workspace payload column is already removed.");
    return;
  }
  const source = `
    SELECT id, user_id AS owner_user_id, source_id, source_type,
           name AS file_name, content_data
    FROM workspace_files
    WHERE content_data IS NOT NULL`;
  if (dryRun) {
    const count = await countRows(source);
    counters.discovered += count;
    log("info", "Legacy workspace files discovered.", { count });
    return;
  }
  const failedIds = new Set<string>();
  while (true) {
    const rows = await sql.query(
      `SELECT *
       FROM (${source}) legacy
       WHERE legacy.id::text <> ALL($2::text[])
       ORDER BY legacy.id
       LIMIT $1`,
      [batchSize, Array.from(failedIds)],
    );
    if (rows.length === 0) break;
    for (const value of rows) {
      const row = value as Row;
      counters.discovered += 1;
      try {
        const purpose: StoragePurpose =
          String(row.source_type) === "document"
            ? "generated_document"
            : "workspace_file";
        const stored = await storedObjectFor({
          ownerUserId: String(row.owner_user_id),
          sourceId: String(row.source_id || ""),
          legacyArea: "workspace_files",
          legacyId: String(row.id),
          purpose,
          visibility: "private",
          fileName: String(row.file_name || "workspace-file"),
          dataUrl: String(row.content_data),
        });
        if (!verifyOnly) {
          await sql.query(
            `UPDATE workspace_files
             SET storage_key = $1,
                 storage_object_id = $2,
                 storage_provider = 'r2',
                 file_url = $3,
                 etag = NULLIF($4, ''),
                 checksum_sha256 = $5,
                 content_data = NULL,
                 scan_status = 'validated',
                 updated_at = NOW()
             WHERE id = $6 AND content_data IS NOT NULL`,
            [
              stored.objectKey,
              stored.id,
              stored.publicUrl,
              stored.etag,
              stored.checksum,
              row.id,
            ],
          );
          counters.migrated += 1;
        }
      } catch (error) {
        counters.failed += 1;
        failedIds.add(String(row.id));
        log("error", "Workspace file migration failed.", {
          id: row.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    if (verifyOnly) break;
  }
}

type AssetSpec = {
  name: string;
  purpose: StoragePurpose;
  selectSql: string;
  updateSql: string;
  json: boolean;
};

const assetSpecs: AssetSpec[] = [
  {
    name: "profiles.avatar_url",
    purpose: "profile_avatar",
    json: false,
    selectSql:
      "SELECT id::text AS key_one, NULL::text AS key_two, user_id::text AS owner_user_id, id::text AS source_id, avatar_url AS payload FROM profiles WHERE avatar_url LIKE '%data:%;base64,%'",
    updateSql: "UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE id::text = $2",
  },
  {
    name: "company_settings.company_logo_url",
    purpose: "profile_avatar",
    json: false,
    selectSql:
      "SELECT id::text AS key_one, NULL::text AS key_two, user_id::text AS owner_user_id, id::text AS source_id, company_logo_url AS payload FROM company_settings WHERE company_logo_url LIKE '%data:%;base64,%'",
    updateSql: "UPDATE company_settings SET company_logo_url = $1, updated_at = NOW() WHERE id::text = $2",
  },
  {
    name: "payment_products.image_url",
    purpose: "product_image",
    json: false,
    selectSql:
      "SELECT id::text AS key_one, NULL::text AS key_two, user_id::text AS owner_user_id, id::text AS source_id, image_url AS payload FROM payment_products WHERE image_url LIKE '%data:%;base64,%'",
    updateSql: "UPDATE payment_products SET image_url = $1, updated_at = NOW() WHERE id::text = $2",
  },
  ...(["fields", "settings"] as const).map((column) => ({
    name: `forms.${column}`,
    purpose: "form_asset" as const,
    json: true,
    selectSql: `SELECT id::text AS key_one, NULL::text AS key_two, created_by::text AS owner_user_id, id::text AS source_id, ${column} AS payload FROM forms WHERE ${column}::text LIKE '%data:%;base64,%'`,
    updateSql: `UPDATE forms SET ${column} = $1::jsonb, updated_at = NOW() WHERE id::text = $2`,
  })),
  ...(["options", "config"] as const).map((column) => ({
    name: `form_fields.${column}`,
    purpose: "form_asset" as const,
    json: true,
    selectSql: `SELECT field.form_id::text AS key_one, field.field_id AS key_two, form.created_by::text AS owner_user_id, field.form_id::text AS source_id, field.${column} AS payload FROM form_fields field JOIN forms form ON form.id = field.form_id WHERE field.${column}::text LIKE '%data:%;base64,%'`,
    updateSql: `UPDATE form_fields SET ${column} = $1::jsonb, updated_at = NOW() WHERE form_id::text = $2 AND field_id = $3`,
  })),
  ...(["theme", "live_snapshot"] as const).map((column) => ({
    name: `form_settings.${column}`,
    purpose: "form_asset" as const,
    json: true,
    selectSql: `SELECT setting.form_id::text AS key_one, NULL::text AS key_two, form.created_by::text AS owner_user_id, setting.form_id::text AS source_id, setting.${column} AS payload FROM form_settings setting JOIN forms form ON form.id = setting.form_id WHERE setting.${column}::text LIKE '%data:%;base64,%'`,
    updateSql: `UPDATE form_settings SET ${column} = $1::jsonb, updated_at = NOW() WHERE form_id::text = $2`,
  })),
  {
    name: "form_versions.fields",
    purpose: "form_asset",
    json: true,
    selectSql:
      "SELECT version.form_id::text AS key_one, version.version_id AS key_two, form.created_by::text AS owner_user_id, version.form_id::text AS source_id, version.fields AS payload FROM form_versions version JOIN forms form ON form.id = version.form_id WHERE version.fields::text LIKE '%data:%;base64,%'",
    updateSql:
      "UPDATE form_versions SET fields = $1::jsonb WHERE form_id::text = $2 AND version_id = $3",
  },
  ...(
    ["branding", "public_sections", "section_content", "seo", "settings"] as const
  ).map(
    (column) => ({
      name: `events.${column}`,
      purpose: "event_asset" as const,
      json: true,
      selectSql: `SELECT id::text AS key_one, NULL::text AS key_two, created_by::text AS owner_user_id, id::text AS source_id, ${column} AS payload FROM events WHERE ${column}::text LIKE '%data:%;base64,%'`,
      updateSql: `UPDATE events SET ${column} = $1::jsonb, updated_at = NOW() WHERE id::text = $2`,
    }),
  ),
  ...(["front_layout", "back_layout"] as const).map((column) => ({
    name: `event_ticket_designs.${column}`,
    purpose: "ticket_asset" as const,
    json: true,
    selectSql: `SELECT design.id::text AS key_one, NULL::text AS key_two, event.created_by::text AS owner_user_id, event.id::text AS source_id, design.${column} AS payload FROM event_ticket_designs design JOIN events event ON event.id = design.event_id WHERE design.${column}::text LIKE '%data:%;base64,%'`,
    updateSql: `UPDATE event_ticket_designs SET ${column} = $1::jsonb, updated_at = NOW() WHERE id::text = $2`,
  })),
  ...(["theme", "front_layout", "back_layout"] as const).map((column) => ({
    name: `event_ticket_design_templates.${column}`,
    purpose: "ticket_asset" as const,
    json: true,
    selectSql: `SELECT id AS key_one, NULL::text AS key_two, created_by::text AS owner_user_id, NULL::text AS source_id, ${column} AS payload FROM event_ticket_design_templates WHERE created_by IS NOT NULL AND ${column}::text LIKE '%data:%;base64,%'`,
    updateSql: `UPDATE event_ticket_design_templates SET ${column} = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by IS NOT NULL`,
  })),
  {
    name: "email_templates.blocks",
    purpose: "email_image",
    json: true,
    selectSql:
      "SELECT id::text AS key_one, NULL::text AS key_two, user_id::text AS owner_user_id, id::text AS source_id, blocks AS payload FROM email_templates WHERE blocks::text LIKE '%data:%;base64,%'",
    updateSql:
      "UPDATE email_templates SET blocks = $1::jsonb, updated_at = NOW() WHERE id::text = $2",
  },
  {
    name: "email_templates.html_body",
    purpose: "email_image",
    json: false,
    selectSql:
      "SELECT id::text AS key_one, NULL::text AS key_two, user_id::text AS owner_user_id, id::text AS source_id, html_body AS payload FROM email_templates WHERE html_body LIKE '%data:%;base64,%'",
    updateSql:
      "UPDATE email_templates SET html_body = $1, updated_at = NOW() WHERE id::text = $2",
  },
];

const replaceJsonDataUrls = async (
  value: JsonValue,
  replace: (dataUrl: string) => Promise<string>,
): Promise<JsonValue> => {
  if (typeof value === "string") {
    if (dataUrlPattern.test(value)) return replace(value);
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => replaceJsonDataUrls(item, replace)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await replaceJsonDataUrls(item, replace),
        ]),
      ),
    );
  }
  return value;
};

const replaceEmbeddedDataUrls = async (
  text: string,
  replace: (dataUrl: string) => Promise<string>,
) => {
  const matches = Array.from(new Set(text.match(embeddedDataUrlPattern) || []));
  let result = text;
  for (const match of matches) result = result.split(match).join(await replace(match));
  return result;
};

async function migrateAssetSpec(spec: AssetSpec) {
  if (dryRun) {
    const count = await countRows(spec.selectSql);
    counters.discovered += count;
    log("info", "Legacy embedded assets discovered.", {
      area: spec.name,
      rows: count,
    });
    return;
  }
  const failedKeys = new Set<string>();
  while (true) {
    const rows = await sql.query(
      `SELECT *
       FROM (${spec.selectSql}) legacy
       WHERE concat(
         legacy.key_one,
         E'\\x1f',
         COALESCE(legacy.key_two, '')
       ) <> ALL($2::text[])
       LIMIT $1`,
      [batchSize, Array.from(failedKeys)],
    );
    if (rows.length === 0) break;
    for (const value of rows) {
      const row = value as Row;
      counters.discovered += 1;
      let assetIndex = 0;
      try {
        const replace = async (dataUrl: string) => {
          const { mimeType } = parseDataUrl(dataUrl);
          const stored = await storedObjectFor({
            ownerUserId: String(row.owner_user_id),
            sourceId: String(row.source_id || ""),
            legacyArea: spec.name,
            legacyId: `${String(row.key_one)}-${String(row.key_two || "")}-${assetIndex++}`,
            purpose: spec.purpose,
            visibility: "public",
            fileName: `migrated-asset-${assetIndex}${extensionByMimeType[mimeType] || ""}`,
            dataUrl,
          });
          return stored.publicUrl || "";
        };
        const payload = spec.json
          ? JSON.stringify(
              await replaceJsonDataUrls(
                (typeof row.payload === "string"
                  ? JSON.parse(row.payload)
                  : row.payload) as JsonValue,
                replace,
              ),
            )
          : await replaceEmbeddedDataUrls(String(row.payload || ""), replace);
        if (!verifyOnly) {
          const parameters = row.key_two == null
            ? [payload, row.key_one]
            : [payload, row.key_one, row.key_two];
          await sql.query(spec.updateSql, parameters);
          counters.migrated += 1;
        }
      } catch (error) {
        counters.failed += 1;
        failedKeys.add(
          `${String(row.key_one)}\u001f${String(row.key_two || "")}`,
        );
        log("error", "Embedded asset migration failed.", {
          area: spec.name,
          id: row.key_one,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    if (verifyOnly) break;
  }
}

const auditRemaining = async () => {
  const counts = await sql.query(
    `SELECT
       (SELECT COUNT(*) FROM form_submission_files
         WHERE to_jsonb(form_submission_files)->>'content_data'
           IS NOT NULL)::integer AS form_files,
       (SELECT COUNT(*) FROM workspace_files
         WHERE to_jsonb(workspace_files)->>'content_data'
           IS NOT NULL)::integer AS workspace_files,
       (
         SELECT COALESCE(SUM(count), 0)::integer
         FROM (
           SELECT COUNT(*) AS count FROM profiles
             WHERE avatar_url LIKE '%data:%;base64,%'
           UNION ALL SELECT COUNT(*) FROM company_settings
             WHERE company_logo_url LIKE '%data:%;base64,%'
           UNION ALL SELECT COUNT(*) FROM payment_products
             WHERE image_url LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM forms
              WHERE fields::text LIKE '%data:%;base64,%'
                 OR settings::text LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM form_fields
              WHERE options::text LIKE '%data:%;base64,%'
                 OR config::text LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM form_settings
              WHERE theme::text LIKE '%data:%;base64,%'
                 OR live_snapshot::text LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM form_versions
              WHERE fields::text LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM events
              WHERE branding::text LIKE '%data:%;base64,%'
                 OR public_sections::text LIKE '%data:%;base64,%'
                 OR section_content::text LIKE '%data:%;base64,%'
                 OR seo::text LIKE '%data:%;base64,%'
                 OR settings::text LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM event_ticket_designs
              WHERE front_layout::text LIKE '%data:%;base64,%'
                 OR back_layout::text LIKE '%data:%;base64,%'
            UNION ALL SELECT COUNT(*) FROM event_ticket_design_templates
              WHERE created_by IS NOT NULL
                AND (
                  theme::text LIKE '%data:%;base64,%'
                  OR front_layout::text LIKE '%data:%;base64,%'
                  OR back_layout::text LIKE '%data:%;base64,%'
                )
            UNION ALL SELECT COUNT(*) FROM email_templates
              WHERE blocks::text LIKE '%data:%;base64,%'
                 OR html_body LIKE '%data:%;base64,%'
         ) embedded
       ) AS embedded_assets`,
  );
  return counts[0] as Row;
};

const verifyCatalog = async () => {
  let cursor = "00000000-0000-0000-0000-000000000000";
  while (true) {
    const rows = await sql.query(
      `SELECT id, bucket_name, object_key, public_url, visibility,
              mime_type, size_bytes, etag, checksum_sha256
       FROM storage_objects
       WHERE status = 'ready'
         AND deleted_at IS NULL
         AND id > $1::uuid
       ORDER BY id
       LIMIT $2`,
      [cursor, batchSize],
    );
    if (rows.length === 0) break;
    for (const value of rows) {
      const row = value as Row;
      cursor = String(row.id);
      counters.discovered += 1;
      try {
        const head = await headStorageObject({
          bucket: String(row.bucket_name),
          key: String(row.object_key),
          publicUrl: row.public_url ? String(row.public_url) : null,
          visibility:
            String(row.visibility) === "public" ? "public" : "private",
        });
        if (
          head.contentLength !== Number(row.size_bytes) ||
          head.contentType !== normalizeMimeType(row.mime_type)
        ) {
          throw new Error("Stored metadata does not match R2.");
        }
        const expectedChecksum = String(row.checksum_sha256 || "").trim();
        if (expectedChecksum) {
          const actualChecksum = await checksumStorageObject({
            bucket: String(row.bucket_name),
            key: String(row.object_key),
            publicUrl: row.public_url ? String(row.public_url) : null,
            visibility:
              String(row.visibility) === "public" ? "public" : "private",
          });
          if (actualChecksum !== expectedChecksum) {
            throw new Error("Stored object checksum does not match PostgreSQL.");
          }
        }
        counters.verified += 1;
      } catch (error) {
        counters.failed += 1;
        log("error", "Catalog object verification failed.", {
          id: row.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }
};

log("info", "Cloudflare R2 migration started.", {
  dryRun,
  verifyOnly,
  batchSize,
});

if (verifyOnly) {
  await verifyCatalog();
} else {
  await migrateFormFiles();
  await migrateWorkspaceFiles();
  for (const spec of assetSpecs) await migrateAssetSpec(spec);
}

const remaining = await auditRemaining();
log("info", "Cloudflare R2 migration finished.", {
  ...counters,
  remaining,
});

if (!dryRun && counters.failed > 0) {
  process.exitCode = 1;
}
