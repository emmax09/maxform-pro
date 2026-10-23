-- Compact 128-bit bearer tokens keep validator URLs short without making
-- them predictable. Existing UUID links are replaced once by this migration.
ALTER TABLE workspace_ticket_validator_links
  ALTER COLUMN masked_id DROP DEFAULT;

ALTER TABLE workspace_ticket_validator_links
  ALTER COLUMN masked_id TYPE TEXT USING masked_id::text;

UPDATE workspace_ticket_validator_links
SET masked_id = RTRIM(
      REPLACE(
        REPLACE(
          ENCODE(DECODE(REPLACE(masked_id, '-', ''), 'hex'), 'base64'),
          '+',
          '-'
        ),
        '/',
        '_'
      ),
      '='
    ),
    rotated_at = NOW(),
    updated_at = NOW();

ALTER TABLE workspace_ticket_validator_links
  DROP CONSTRAINT IF EXISTS workspace_ticket_validator_masked_id_format;

ALTER TABLE workspace_ticket_validator_links
  ADD CONSTRAINT workspace_ticket_validator_masked_id_format
  CHECK (masked_id ~ '^[A-Za-z0-9_-]{22}$');
