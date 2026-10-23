ALTER TABLE forms
  ADD COLUMN IF NOT EXISTS slug VARCHAR(120);

WITH slug_bases AS (
  SELECT
    id,
    LEFT(
      COALESCE(
        NULLIF(
          TRIM(
            BOTH '-' FROM REGEXP_REPLACE(
              LOWER(COALESCE(title, '')),
              '[^a-z0-9]+',
              '-',
              'g'
            )
          ),
          ''
        ),
        'form'
      ),
      96
    ) AS base_slug
  FROM forms
  WHERE slug IS NULL
),
ranked_slugs AS (
  SELECT
    id,
    base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY base_slug
      ORDER BY id
    ) AS slug_number
  FROM slug_bases
)
UPDATE forms AS form
SET slug = CASE
  WHEN ranked.slug_number = 1 THEN ranked.base_slug
  ELSE ranked.base_slug || '-' || ranked.slug_number::text
END
FROM ranked_slugs AS ranked
WHERE form.id = ranked.id;

ALTER TABLE forms
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_slug
  ON forms(slug);
