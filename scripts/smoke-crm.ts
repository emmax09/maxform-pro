import { neon } from "@neondatabase/serverless";

const databaseUrl =
  process.env.DATABASE_URL || "";

if (!databaseUrl) {
  throw new Error("CRM smoke test requires DATABASE_URL.");
}

const sql = neon(databaseUrl);

const snapshotQuery = `
  SELECT jsonb_build_object(
    'users', (SELECT COUNT(*) FROM users),
    'companies', (SELECT COUNT(*) FROM companies),
    'contacts', (SELECT COUNT(*) FROM contacts),
    'leads', (SELECT COUNT(*) FROM leads),
    'pipelines', (SELECT COUNT(*) FROM pipelines),
    'pipeline_stages', (SELECT COUNT(*) FROM pipeline_stages),
    'deals', (SELECT COUNT(*) FROM deals),
    'deal_stage_history', (SELECT COUNT(*) FROM deal_stage_history),
    'tasks', (SELECT COUNT(*) FROM tasks),
    'crm_activities', (SELECT COUNT(*) FROM crm_activities)
  ) AS snapshot
`;

const beforeRows = await sql.query(snapshotQuery);
const before = JSON.stringify(beforeRows[0]?.snapshot || {});

await sql.query(`
  DO $crm_smoke$
    DECLARE
      smoke_user_id UUID;
      company_id UUID;
      smoke_contact_id UUID;
      contact_activity_id UUID;
      contact_list_id UUID;
    lead_id UUID;
    primary_pipeline_id UUID;
    empty_pipeline_id UUID;
    new_stage_id UUID;
    review_stage_id UUID;
    won_stage_id UUID;
    first_deal_id UUID;
    second_deal_id UUID;
      task_id UUID;
      crm_activity_id UUID;
  BEGIN
    BEGIN
      INSERT INTO users (email, password_hash, full_name, short_id)
      VALUES (
        'crm-smoke-' || gen_random_uuid()::text || '@example.test',
        'non-login-smoke-account',
        'CRM Smoke Workspace',
        UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 6))
      )
      RETURNING id INTO smoke_user_id;

      INSERT INTO contact_lists (
        user_id, name, description, list_type, filter_definition, created_by
      )
      VALUES (
        smoke_user_id, 'Smoke import list', 'Rolled back automatically',
        'static', '[]', smoke_user_id
      )
      RETURNING id INTO contact_list_id;

      INSERT INTO companies (
        user_id, name, industry, website, owner_id, revenue_cents,
        employee_count, notes
      )
      VALUES (
        smoke_user_id, 'Smoke Company', 'Testing', 'https://example.test',
        smoke_user_id, 100000, 10, 'Rolled back automatically'
      )
      RETURNING id INTO company_id;

      INSERT INTO contacts (
        email, full_name, phone, company, company_id, tags, custom_fields,
        created_by, owner_id, lifecycle_stage, source_type, last_activity_at
      )
      VALUES (
        'crm-contact-' || gen_random_uuid()::text || '@example.test',
        'CRM Smoke Contact', '+10000000000', 'Smoke Company', company_id,
        '[]', '{}', smoke_user_id, smoke_user_id, 'lead', 'manual', NOW()
      )
      RETURNING id INTO smoke_contact_id;

      WITH incoming AS (
        SELECT
          LOWER(BTRIM(record.email)) AS email,
          NULLIF(BTRIM(record.full_name), '') AS full_name,
          NULLIF(BTRIM(record.phone), '') AS phone,
          NULLIF(BTRIM(record.company), '') AS company,
          COALESCE(record.tags, '[]'::jsonb) AS tags
        FROM jsonb_to_recordset(
          '[{
            "email": "import-smoke@example.test",
            "full_name": "Import Smoke",
            "phone": "+10000000001",
            "company": "Imported Company",
            "tags": ["csv"]
          }]'::jsonb
        ) AS record(
          email TEXT,
          full_name TEXT,
          phone TEXT,
          company TEXT,
          tags JSONB
        )
      ),
      upserted AS (
        INSERT INTO contacts (
          email, full_name, phone, company, tags, custom_fields, created_by,
          lifecycle_stage, source_type, last_activity_at, created_at, updated_at
        )
        SELECT
          incoming.email, incoming.full_name, incoming.phone, incoming.company,
          incoming.tags, '{}', smoke_user_id, 'lead', 'import', NOW(), NOW(), NOW()
        FROM incoming
        ON CONFLICT (created_by, LOWER(email))
        DO UPDATE SET
          full_name = COALESCE(EXCLUDED.full_name, contacts.full_name),
          phone = COALESCE(EXCLUDED.phone, contacts.phone),
          company = COALESCE(EXCLUDED.company, contacts.company),
          tags = contacts.tags || EXCLUDED.tags,
          updated_at = NOW(),
          last_activity_at = NOW()
        RETURNING id
      )
      INSERT INTO contact_list_members (
        list_id, contact_id, source_type, added_at
      )
      SELECT contact_list_id, upserted.id, 'import', NOW()
      FROM upserted
      ON CONFLICT ON CONSTRAINT contact_list_members_pkey DO NOTHING;

      WITH incoming AS (
        SELECT
          LOWER(BTRIM(record.email)) AS email,
          NULLIF(BTRIM(record.full_name), '') AS full_name,
          NULLIF(BTRIM(record.phone), '') AS phone,
          NULLIF(BTRIM(record.company), '') AS company,
          COALESCE(record.tags, '[]'::jsonb) AS tags
        FROM jsonb_to_recordset(
          '[{
            "email": "IMPORT-SMOKE@example.test",
            "full_name": "Import Smoke Updated",
            "phone": "",
            "company": "",
            "tags": ["xlsx"]
          }]'::jsonb
        ) AS record(
          email TEXT,
          full_name TEXT,
          phone TEXT,
          company TEXT,
          tags JSONB
        )
      )
      INSERT INTO contacts (
        email, full_name, phone, company, tags, custom_fields, created_by,
        lifecycle_stage, source_type, last_activity_at, created_at, updated_at
      )
      SELECT
        incoming.email, incoming.full_name, incoming.phone, incoming.company,
        incoming.tags, '{}', smoke_user_id, 'lead', 'import', NOW(), NOW(), NOW()
      FROM incoming
      ON CONFLICT (created_by, LOWER(email))
      DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, contacts.full_name),
        phone = COALESCE(EXCLUDED.phone, contacts.phone),
        company = COALESCE(EXCLUDED.company, contacts.company),
        tags = contacts.tags || EXCLUDED.tags,
        updated_at = NOW(),
        last_activity_at = NOW();

      IF (
        SELECT COUNT(*)
        FROM contacts
        WHERE created_by = smoke_user_id
          AND LOWER(email) = 'import-smoke@example.test'
          AND full_name = 'Import Smoke Updated'
          AND phone = '+10000000001'
          AND company = 'Imported Company'
          AND tags @> '["csv", "xlsx"]'::jsonb
      ) <> 1 THEN
        RAISE EXCEPTION 'Contact import batch upsert failed';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM contact_list_members member
        JOIN contacts contact ON contact.id = member.contact_id
        WHERE member.list_id = contact_list_id
          AND contact.created_by = smoke_user_id
          AND LOWER(contact.email) = 'import-smoke@example.test'
      ) THEN
        RAISE EXCEPTION 'Contact import list attachment failed';
      END IF;

      INSERT INTO pipelines (
        user_id, name, description, color, is_default
      )
      VALUES (
        smoke_user_id, 'Smoke Sales', 'Rolled back pipeline', '#635BFF', TRUE
      )
      RETURNING id INTO primary_pipeline_id;

      INSERT INTO pipelines (
        user_id, name, description, color, is_default
      )
      VALUES (
        smoke_user_id, 'Empty Custom', 'Must remain stage-free', '#2563EB',
        FALSE
      )
      RETURNING id INTO empty_pipeline_id;

      IF EXISTS (
        SELECT 1 FROM pipeline_stages
        WHERE pipeline_id = empty_pipeline_id
      ) THEN
        RAISE EXCEPTION 'Custom pipeline unexpectedly received stages';
      END IF;

      INSERT INTO pipeline_stages (
        pipeline_id, name, order_index, probability, color, is_won, is_lost,
        required_fields, stale_after_days
      )
      VALUES (
        primary_pipeline_id, 'New', 0, 10, '#64748B', FALSE, FALSE, '{}', 30
      )
      RETURNING id INTO new_stage_id;

      INSERT INTO pipeline_stages (
        pipeline_id, name, order_index, probability, color, is_won, is_lost,
        required_fields, stale_after_days
      )
      VALUES (
        primary_pipeline_id, 'Review', 1, 55, '#7C3AED', FALSE, FALSE,
        ARRAY['value', 'expected_close_date'], 14
      )
      RETURNING id INTO review_stage_id;

      INSERT INTO pipeline_stages (
        pipeline_id, name, order_index, probability, color, is_won, is_lost,
        required_fields, stale_after_days
      )
      VALUES (
        primary_pipeline_id, 'Won', 2, 100, '#059669', TRUE, FALSE,
        ARRAY['value'], NULL
      )
      RETURNING id INTO won_stage_id;

      PERFORM crm_reorder_pipeline_stage(
        smoke_user_id, review_stage_id, -1
      );

      IF NOT EXISTS (
        SELECT 1 FROM pipeline_stages
        WHERE id = review_stage_id AND order_index = 0
      ) THEN
        RAISE EXCEPTION 'Stage reorder did not persist';
      END IF;

      PERFORM crm_update_pipeline(
        smoke_user_id,
        primary_pipeline_id,
        'Smoke Revenue',
        'Updated safely',
        '#111827',
        TRUE
      );

      IF NOT EXISTS (
        SELECT 1 FROM pipelines
        WHERE id = primary_pipeline_id
          AND name = 'Smoke Revenue'
          AND color = '#111827'
          AND is_default = TRUE
      ) THEN
        RAISE EXCEPTION 'Pipeline update did not persist';
      END IF;

      INSERT INTO deals (
        user_id, name, contact_id, company_id, pipeline_id, stage_id,
        value_cents, currency, probability, owner_id, notes
      )
      VALUES (
        smoke_user_id, 'Smoke Deal', smoke_contact_id, company_id,
        primary_pipeline_id, new_stage_id, 250000, 'USD', 10, smoke_user_id,
        'Rolled back automatically'
      )
      RETURNING id INTO first_deal_id;

      BEGIN
        PERFORM crm_move_deal_stage(
          smoke_user_id, first_deal_id, review_stage_id, ''
        );
        RAISE EXCEPTION 'Required-field blocker did not run';
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM NOT LIKE 'Add an expected close date%' THEN
            RAISE;
          END IF;
      END;

      UPDATE deals
      SET expected_close_date = CURRENT_DATE + 14
      WHERE id = first_deal_id;

      PERFORM crm_move_deal_stage(
        smoke_user_id, first_deal_id, review_stage_id, ''
      );

      IF NOT EXISTS (
        SELECT 1 FROM deals
        WHERE id = first_deal_id
          AND stage_id = review_stage_id
          AND probability = 55
      ) THEN
        RAISE EXCEPTION 'Stage default probability was not applied';
      END IF;

      UPDATE deals
      SET probability = 42, probability_pinned = TRUE
      WHERE id = first_deal_id;

      PERFORM crm_move_deal_stage(
        smoke_user_id, first_deal_id, new_stage_id, ''
      );

      IF NOT EXISTS (
        SELECT 1 FROM deals
        WHERE id = first_deal_id
          AND stage_id = new_stage_id
          AND probability = 42
          AND probability_pinned = TRUE
      ) THEN
        RAISE EXCEPTION 'Pinned probability was overwritten';
      END IF;

      PERFORM crm_move_deal_stage(
        smoke_user_id, first_deal_id, won_stage_id, ''
      );

      IF NOT EXISTS (
        SELECT 1 FROM contacts
        WHERE id = smoke_contact_id AND lifecycle_stage = 'customer'
      ) THEN
        RAISE EXCEPTION 'Won deal did not promote the contact to customer';
      END IF;

      IF (
        SELECT COUNT(*) FROM deal_stage_history
        WHERE deal_id = first_deal_id
      ) <> 3 THEN
        RAISE EXCEPTION 'Deal stage history is incomplete';
      END IF;

      INSERT INTO deals (
        user_id, name, contact_id, company_id, pipeline_id, stage_id,
        value_cents, currency, probability, expected_close_date, owner_id
      )
      VALUES (
        smoke_user_id, 'Reassignment Deal', smoke_contact_id, company_id,
        primary_pipeline_id, review_stage_id, 100000, 'USD', 55,
        CURRENT_DATE + 7, smoke_user_id
      )
      RETURNING id INTO second_deal_id;

      PERFORM crm_delete_pipeline_stage(
        smoke_user_id, review_stage_id, new_stage_id
      );

      IF NOT EXISTS (
        SELECT 1 FROM deals
        WHERE id = second_deal_id AND stage_id = new_stage_id
      ) THEN
        RAISE EXCEPTION 'Stage deletion did not reassign its deals';
      END IF;

      BEGIN
        PERFORM crm_delete_pipeline(smoke_user_id, primary_pipeline_id);
        RAISE EXCEPTION 'Pipeline with deals was deleted';
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM NOT LIKE 'This pipeline has %' THEN
            RAISE;
          END IF;
      END;

      PERFORM crm_delete_pipeline(smoke_user_id, empty_pipeline_id);

      INSERT INTO leads (
        user_id, name, email, phone, source_type, source_label, status, score,
        score_reasons, assigned_user_id, company_id, budget_cents,
        interest_notes, score_updated_at
      )
      VALUES (
        smoke_user_id, 'Smoke Lead',
        'crm-lead-' || gen_random_uuid()::text || '@example.test',
        '+10000000001', 'form', 'Smoke source', 'new', 70,
        '["First-party source"]', smoke_user_id, company_id, 250000,
        'Interested in annual plan', NOW()
      )
      RETURNING id INTO lead_id;

      UPDATE leads
      SET status = 'converted',
          converted_contact_id = smoke_contact_id,
          converted_at = NOW()
      WHERE id = lead_id;

      IF NOT EXISTS (
        SELECT 1 FROM leads
        WHERE id = lead_id
          AND status = 'converted'
          AND converted_contact_id = smoke_contact_id
      ) THEN
        RAISE EXCEPTION 'Lead conversion history was not preserved';
      END IF;

      INSERT INTO tasks (
        user_id, title, description, due_at, priority, status, contact_id,
        company_id, deal_id, assigned_user_id
      )
      VALUES (
        smoke_user_id, 'Smoke follow-up', 'Rolled back automatically',
        NOW() + INTERVAL '1 day', 'high', 'open', smoke_contact_id, company_id,
        first_deal_id, smoke_user_id
      )
      RETURNING id INTO task_id;

      INSERT INTO crm_activities (
        user_id, activity_type, title, detail, contact_id, company_id,
        deal_id, task_id, actor_user_id, metadata
      )
      VALUES (
        smoke_user_id, 'smoke_verified', 'CRM smoke verified',
        'Rolled back automatically', smoke_contact_id, company_id, first_deal_id,
        task_id, smoke_user_id, '{"non_destructive":true}'
      )
      RETURNING id INTO crm_activity_id;

      INSERT INTO contact_activity (
        contact_id, user_id, activity_type, title, detail, entity_type,
        entity_id, metadata
      )
      VALUES (
        smoke_contact_id, smoke_user_id, 'smoke_contact_activity',
        'Contact activity smoke', 'Rolled back automatically', 'contact',
        smoke_contact_id, '{"sourceModule":"crm"}'
      )
      RETURNING id INTO contact_activity_id;

      IF NOT EXISTS (
        SELECT 1
        FROM crm_timeline_events timeline
        WHERE timeline.user_id = smoke_user_id
          AND timeline.dedupe_key = 'crm_activity:' || crm_activity_id::text
          AND timeline.contact_id = smoke_contact_id
      ) THEN
        RAISE EXCEPTION 'CRM activity did not reach the universal timeline';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM crm_timeline_events timeline
        WHERE timeline.user_id = smoke_user_id
          AND timeline.dedupe_key = 'contact_activity:' || contact_activity_id::text
          AND timeline.contact_id = smoke_contact_id
      ) THEN
        RAISE EXCEPTION 'Contact activity did not reach the universal timeline';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM crm_activities activity
        JOIN tasks task ON task.id = activity.task_id
        JOIN deals deal ON deal.id = activity.deal_id
        JOIN contacts contact ON contact.id = activity.contact_id
        JOIN companies company ON company.id = activity.company_id
        WHERE activity.user_id = smoke_user_id
          AND task.user_id = smoke_user_id
          AND deal.user_id = smoke_user_id
          AND contact.created_by = smoke_user_id
          AND company.user_id = smoke_user_id
      ) THEN
        RAISE EXCEPTION 'CRM relationship timeline join failed';
      END IF;

      RAISE EXCEPTION 'crm_smoke_rollback_marker';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM <> 'crm_smoke_rollback_marker' THEN
          RAISE;
        END IF;
    END;
  END
  $crm_smoke$;
`);

const afterRows = await sql.query(snapshotQuery);
const after = JSON.stringify(afterRows[0]?.snapshot || {});

if (before !== after) {
  throw new Error(
    "CRM smoke test changed persistent row counts; the rollback guarantee failed.",
  );
}

const healthRows = await sql.query(`
  SELECT
    (
      SELECT COUNT(*)::INTEGER
      FROM deals deal
      JOIN pipeline_stages stage ON stage.id = deal.stage_id
      WHERE deal.pipeline_id <> stage.pipeline_id
    ) AS cross_pipeline_deals,
    (
      SELECT COUNT(*)::INTEGER
      FROM pipeline_stages
      WHERE probability < 0 OR probability > 100
    ) AS invalid_stage_probabilities,
    (
      SELECT COUNT(*)::INTEGER
      FROM deals
      WHERE probability < 0 OR probability > 100
    ) AS invalid_deal_probabilities,
    (
      SELECT COUNT(*)::INTEGER
      FROM pipeline_stages
      WHERE is_won AND is_lost
    ) AS conflicting_terminal_stages
`);

const health = healthRows[0] || {};
for (const [check, value] of Object.entries(health)) {
  if (Number(value) !== 0) {
    throw new Error(`CRM data health check failed: ${check}=${value}`);
  }
}

process.stdout.write(
  "CRM non-destructive smoke test passed (contact import upserts, pipeline lifecycle, stage gates, forecasting, history, lead conversion, tasks, activities, and data health).\n",
);
