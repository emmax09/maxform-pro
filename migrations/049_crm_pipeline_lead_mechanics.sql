-- Complete CRM pipeline and lead mechanics without rewriting existing records.

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS required_fields TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS stale_after_days INTEGER;
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_stages_stale_after_days_check'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_stale_after_days_check
      CHECK (stale_after_days IS NULL OR stale_after_days > 0);
  END IF;
END
$$;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS probability_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal_changed
  ON deal_stage_history(deal_id, changed_at DESC);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS status_auto_updated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname
  INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'leads'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_status_check'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_status_check
      CHECK (
        status IN (
          'new', 'contacted', 'qualified', 'unqualified', 'converted', 'archived'
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS lead_scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, signal_key)
);

CREATE TABLE IF NOT EXISTS lead_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_condition JSONB NOT NULL DEFAULT '{}',
  assign_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  round_robin_team UUID[] NOT NULL DEFAULT '{}',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION crm_update_pipeline(
  p_user_id UUID,
  p_pipeline_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_color TEXT,
  p_make_default BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM pipelines
  WHERE id = p_pipeline_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF p_make_default THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pipeline_stages
      WHERE pipeline_id = p_pipeline_id
    ) THEN
      RAISE EXCEPTION
        'Add at least one stage before making this the default pipeline';
    END IF;

    UPDATE pipelines
    SET is_default = FALSE, updated_at = NOW()
    WHERE user_id = p_user_id
      AND id <> p_pipeline_id
      AND is_default = TRUE;
  END IF;

  UPDATE pipelines
  SET name = NULLIF(BTRIM(p_name), ''),
      description = BTRIM(COALESCE(p_description, '')),
      color = COALESCE(NULLIF(BTRIM(p_color), ''), '#635BFF'),
      is_default = CASE WHEN p_make_default THEN TRUE ELSE is_default END,
      updated_at = NOW()
  WHERE id = p_pipeline_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline name is required';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION crm_move_deal_stage(
  p_user_id UUID,
  p_deal_id UUID,
  p_stage_id UUID,
  p_lost_reason TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  deal_record deals%ROWTYPE;
  target_stage pipeline_stages%ROWTYPE;
  clean_lost_reason TEXT := BTRIM(COALESCE(p_lost_reason, ''));
BEGIN
  SELECT *
  INTO deal_record
  FROM deals
  WHERE id = p_deal_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  SELECT stage.*
  INTO target_stage
  FROM pipeline_stages stage
  JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
  WHERE stage.id = p_stage_id AND pipeline.user_id = p_user_id
  FOR UPDATE OF stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline stage not found';
  END IF;

  IF target_stage.pipeline_id <> deal_record.pipeline_id THEN
    RAISE EXCEPTION
      'A deal cannot move directly to another pipeline. Clone and archive it instead.';
  END IF;

  IF target_stage.is_lost AND clean_lost_reason = '' THEN
    RAISE EXCEPTION 'Add a lost reason before closing this deal';
  END IF;

  IF 'value' = ANY(target_stage.required_fields)
     AND deal_record.value_cents <= 0 THEN
    RAISE EXCEPTION
      'Add a deal value before moving this deal to %', target_stage.name;
  END IF;

  IF 'expected_close_date' = ANY(target_stage.required_fields)
     AND deal_record.expected_close_date IS NULL THEN
    RAISE EXCEPTION
      'Add an expected close date before moving this deal to %',
      target_stage.name;
  END IF;

  IF (
    'contact' = ANY(target_stage.required_fields)
    OR 'contact_id' = ANY(target_stage.required_fields)
  ) AND deal_record.contact_id IS NULL THEN
    RAISE EXCEPTION
      'Add a linked contact before moving this deal to %', target_stage.name;
  END IF;

  IF (
    'company' = ANY(target_stage.required_fields)
    OR 'company_id' = ANY(target_stage.required_fields)
  ) AND deal_record.company_id IS NULL THEN
    RAISE EXCEPTION
      'Add a linked company before moving this deal to %', target_stage.name;
  END IF;

  IF (
    'order' = ANY(target_stage.required_fields)
    OR 'order_id' = ANY(target_stage.required_fields)
  ) AND deal_record.order_id IS NULL THEN
    RAISE EXCEPTION
      'Add a linked order or invoice before moving this deal to %',
      target_stage.name;
  END IF;

  IF 'lost_reason' = ANY(target_stage.required_fields)
     AND clean_lost_reason = '' THEN
    RAISE EXCEPTION
      'Add a lost reason before moving this deal to %', target_stage.name;
  END IF;

  INSERT INTO deal_stage_history (
    deal_id, from_stage_id, to_stage_id, changed_by, changed_at
  )
  VALUES (
    deal_record.id, deal_record.stage_id, target_stage.id, p_user_id, NOW()
  );

  UPDATE deals
  SET stage_id = target_stage.id,
      probability = CASE
        WHEN probability_pinned THEN probability
        ELSE target_stage.probability
      END,
      lost_reason = CASE
        WHEN target_stage.is_lost THEN clean_lost_reason
        ELSE ''
      END,
      stage_entered_at = NOW(),
      updated_at = NOW()
  WHERE id = deal_record.id AND user_id = p_user_id;

  IF target_stage.is_won AND deal_record.contact_id IS NOT NULL THEN
    UPDATE contacts
    SET lifecycle_stage = 'customer',
        last_activity_at = NOW(),
        updated_at = NOW()
    WHERE id = deal_record.contact_id AND created_by = p_user_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION crm_delete_pipeline(
  p_user_id UUID,
  p_pipeline_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  pipeline_record pipelines%ROWTYPE;
  replacement_id UUID;
  deal_count INTEGER;
  pipeline_count INTEGER;
BEGIN
  SELECT *
  INTO pipeline_record
  FROM pipelines
  WHERE id = p_pipeline_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO deal_count
  FROM deals
  WHERE pipeline_id = p_pipeline_id AND user_id = p_user_id;

  IF deal_count > 0 THEN
    RAISE EXCEPTION
      'This pipeline has % deal(s). Archive or close those deals before deleting it.',
      deal_count;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO pipeline_count
  FROM pipelines
  WHERE user_id = p_user_id;

  IF pipeline_count <= 1 THEN
    RAISE EXCEPTION 'Your workspace must keep at least one pipeline';
  END IF;

  IF pipeline_record.is_default THEN
    SELECT id
    INTO replacement_id
    FROM pipelines
    WHERE user_id = p_user_id AND id <> p_pipeline_id
      AND EXISTS (
        SELECT 1
        FROM pipeline_stages
        WHERE pipeline_id = pipelines.id
      )
    ORDER BY created_at, id
    LIMIT 1
    FOR UPDATE;

    IF replacement_id IS NULL THEN
      RAISE EXCEPTION
        'Add a stage to another pipeline before deleting the default pipeline';
    END IF;

    UPDATE pipelines
    SET is_default = FALSE, updated_at = NOW()
    WHERE id = p_pipeline_id AND user_id = p_user_id;

    UPDATE pipelines
    SET is_default = TRUE, updated_at = NOW()
    WHERE id = replacement_id AND user_id = p_user_id;
  END IF;

  DELETE FROM pipelines
  WHERE id = p_pipeline_id AND user_id = p_user_id;

  RETURN replacement_id;
END
$$;

CREATE OR REPLACE FUNCTION crm_reorder_pipeline_stage(
  p_user_id UUID,
  p_stage_id UUID,
  p_direction INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  current_stage pipeline_stages%ROWTYPE;
  adjacent_stage pipeline_stages%ROWTYPE;
  current_deals INTEGER;
  adjacent_deals INTEGER;
BEGIN
  IF p_direction NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'Stage direction must be -1 or 1';
  END IF;

  SELECT stage.*
  INTO current_stage
  FROM pipeline_stages stage
  JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
  WHERE stage.id = p_stage_id AND pipeline.user_id = p_user_id
  FOR UPDATE OF stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline stage not found';
  END IF;

  SELECT *
  INTO adjacent_stage
  FROM pipeline_stages
  WHERE pipeline_id = current_stage.pipeline_id
    AND order_index = current_stage.order_index + p_direction
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO current_deals
  FROM deals
  WHERE stage_id = current_stage.id;

  SELECT COUNT(*)::INTEGER
  INTO adjacent_deals
  FROM deals
  WHERE stage_id = adjacent_stage.id;

  IF current_deals > 0 OR adjacent_deals > 0 THEN
    RAISE EXCEPTION
      'Reassign deals from both affected stages before changing their order';
  END IF;

  UPDATE pipeline_stages
  SET order_index = -1, updated_at = NOW()
  WHERE id = current_stage.id;

  UPDATE pipeline_stages
  SET order_index = current_stage.order_index, updated_at = NOW()
  WHERE id = adjacent_stage.id;

  UPDATE pipeline_stages
  SET order_index = adjacent_stage.order_index, updated_at = NOW()
  WHERE id = current_stage.id;
END
$$;

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

  UPDATE pipeline_stages
  SET order_index = order_index - 1, updated_at = NOW()
  WHERE pipeline_id = current_stage.pipeline_id
    AND order_index > current_stage.order_index;

  RETURN affected_deals;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE deal_stage_history, lead_scoring_rules, lead_assignment_rules
      TO maxform_browser;
    GRANT EXECUTE
      ON FUNCTION crm_update_pipeline(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN),
        crm_move_deal_stage(UUID, UUID, UUID, TEXT),
        crm_delete_pipeline(UUID, UUID),
        crm_reorder_pipeline_stage(UUID, UUID, INTEGER),
        crm_delete_pipeline_stage(UUID, UUID, UUID)
      TO maxform_browser;
  END IF;
END
$$;
