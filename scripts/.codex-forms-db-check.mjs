import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL || "");
const userId = "f326b6ea-37e9-4e37-805d-437b48b432c1";

const checks = [
  [
    "forms",
    `SELECT form.id,
            form.title,
            COALESCE(form.fields, '[]'::jsonb) AS fields,
            COALESCE(form.settings, '{}'::jsonb) AS settings,
            (
              SELECT COUNT(*)
              FROM form_submissions submission
              WHERE submission.form_id = form.id
            ) AS response_count
     FROM forms form
     WHERE form.created_by = $1
       AND NOT EXISTS (
         SELECT 1
         FROM events event
         WHERE event.registration_form_id = form.id
       )
     ORDER BY form.updated_at DESC`,
    [userId],
  ],
  [
    "preferences",
    `SELECT preferences
     FROM form_module_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  ],
];

for (const [name, query, parameters] of checks) {
  const startedAt = performance.now();
  const rows = await sql.query(query, parameters);
  console.log(
    JSON.stringify({
      name,
      rows: rows.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    }),
  );
}
