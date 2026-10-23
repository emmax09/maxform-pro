-- Fixes a unique-constraint violation when deleting a pipeline stage.
--
-- pipeline_stages carries UNIQUE (pipeline_id, order_index). The delete
-- function closed the gap with a single `order_index = order_index - 1`
-- update, but Postgres enforces a non-deferrable unique constraint per row and
-- updates rows in an arbitrary order. Deleting any stage that has two or more
-- stages after it could therefore fail with
-- pipeline_stages_pipeline_id_order_index_key, leaving the pipeline intact but
-- the delete rejected. The reindex now runs in two passes through a negative
-- band, which can never collide with the live indexes.

CREATE OR REPLACE FUNCTION crm_delete_pipeline_stage(
  p_user_id UUID,
  p_stage_id UUID,
  p_reassign_stage_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_stage pipeline_stages%ROWTYPE;
  replacement_stage pipeline_stages%ROWTYPE;
  affected_deals INTEGER;
BEGIN
  SELECT stage.*
  INTO current_stage
  FROM pipeline_stages stage
  JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
  WHERE stage.id = p_stage_id AND pipeline.user_id = p_user_id
  FOR UPDATE OF stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline stage not found';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO affected_deals
  FROM deals
  WHERE stage_id = current_stage.id AND user_id = p_user_id;

  IF affected_deals > 0 THEN
    IF p_reassign_stage_id IS NULL THEN
      RAISE EXCEPTION
        'Choose another stage for the % deal(s) in this stage',
        affected_deals;
    END IF;

    SELECT *
    INTO replacement_stage
    FROM pipeline_stages
    WHERE id = p_reassign_stage_id
      AND pipeline_id = current_stage.pipeline_id
      AND id <> current_stage.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Choose a replacement stage in the same pipeline';
    END IF;

    IF replacement_stage.is_won OR replacement_stage.is_lost THEN
      RAISE EXCEPTION
        'Choose an open replacement stage, then close each deal normally';
    END IF;

    IF 'value' = ANY(replacement_stage.required_fields)
       AND EXISTS (
         SELECT 1 FROM deals
         WHERE stage_id = current_stage.id
           AND user_id = p_user_id
           AND value_cents <= 0
       ) THEN
      RAISE EXCEPTION
        'Add values to every affected deal before reassigning them to %',
        replacement_stage.name;
    END IF;

    IF 'expected_close_date' = ANY(replacement_stage.required_fields)
       AND EXISTS (
         SELECT 1 FROM deals
         WHERE stage_id = current_stage.id
           AND user_id = p_user_id
           AND expected_close_date IS NULL
       ) THEN
      RAISE EXCEPTION
        'Add expected close dates to every affected deal before reassigning them to %',
        replacement_stage.name;
    END IF;

    IF (
      'contact' = ANY(replacement_stage.required_fields)
      OR 'contact_id' = ANY(replacement_stage.required_fields)
    ) AND EXISTS (
      SELECT 1 FROM deals
      WHERE stage_id = current_stage.id
        AND user_id = p_user_id
        AND contact_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'Link contacts to every affected deal before reassigning them to %',
        replacement_stage.name;
    END IF;

    IF (
      'company' = ANY(replacement_stage.required_fields)
      OR 'company_id' = ANY(replacement_stage.required_fields)
    ) AND EXISTS (
      SELECT 1 FROM deals
      WHERE stage_id = current_stage.id
        AND user_id = p_user_id
        AND company_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'Link companies to every affected deal before reassigning them to %',
        replacement_stage.name;
    END IF;

    IF (
      'order' = ANY(replacement_stage.required_fields)
      OR 'order_id' = ANY(replacement_stage.required_fields)
    ) AND EXISTS (
      SELECT 1 FROM deals
      WHERE stage_id = current_stage.id
        AND user_id = p_user_id
        AND order_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'Link orders or invoices to every affected deal before reassigning them to %',
        replacement_stage.name;
    END IF;

    INSERT INTO deal_stage_history (
      deal_id, from_stage_id, to_stage_id, changed_by, changed_at
    )
    SELECT id, current_stage.id, replacement_stage.id, p_user_id, NOW()
    FROM deals
    WHERE stage_id = current_stage.id AND user_id = p_user_id;

    UPDATE deals
    SET stage_id = replacement_stage.id,
        probability = CASE
          WHEN probability_pinned THEN probability
          ELSE replacement_stage.probability
        END,
        stage_entered_at = NOW(),
        lost_reason = CASE
          WHEN replacement_stage.is_lost THEN lost_reason
          ELSE ''
        END,
        updated_at = NOW()
    WHERE stage_id = current_stage.id AND user_id = p_user_id;
  END IF;

  DELETE FROM pipeline_stages
  WHERE id = current_stage.id;

  -- UNIQUE (pipeline_id, order_index) is checked row by row, and a plain
  -- decrement updates rows in an arbitrary order, so shifting 3 -> 2 while 2
  -- still exists aborts the delete. Park the affected rows in a negative band
  -- first, then bring them back down; negatives can never collide with the
  -- live indexes.
  UPDATE pipeline_stages
  SET order_index = -order_index - 1
  WHERE pipeline_id = current_stage.pipeline_id
    AND order_index > current_stage.order_index;

  UPDATE pipeline_stages
  SET order_index = -order_index - 2, updated_at = NOW()
  WHERE pipeline_id = current_stage.pipeline_id
    AND order_index < 0;

  RETURN affected_deals;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    GRANT EXECUTE
      ON FUNCTION crm_delete_pipeline_stage(UUID, UUID, UUID)
      TO maxform_browser;
  END IF;
END
$$;
