-- Full CRM workspace built on top of the shared Contacts record.

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  address JSONB NOT NULL DEFAULT '{}',
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  revenue_cents BIGINT NOT NULL DEFAULT 0 CHECK (revenue_cents >= 0),
  employee_count INTEGER CHECK (employee_count IS NULL OR employee_count >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_user_name
  ON companies(user_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_companies_user_updated
  ON companies(user_id, updated_at DESC);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company
  ON contacts(created_by, company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner
  ON contacts(created_by, owner_id);

CREATE TABLE IF NOT EXISTS company_contacts (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'secondary'
    CHECK (relationship_type IN ('primary', 'secondary', 'advisor', 'former')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, contact_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id UUID,
  source_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'archived')),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  score_reasons JSONB NOT NULL DEFAULT '[]',
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  budget_cents BIGINT NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  interest_notes TEXT NOT NULL DEFAULT '',
  converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_user_status
  ON leads(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_user_score
  ON leads(user_id, score DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#635BFF',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_user_name
  ON pipelines(user_id, LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_user_default
  ON pipelines(user_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  color TEXT NOT NULL DEFAULT '#64748B',
  is_won BOOLEAN NOT NULL DEFAULT FALSE,
  is_lost BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pipeline_id, name),
  UNIQUE (pipeline_id, order_index),
  CHECK (NOT (is_won AND is_lost))
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  value_cents BIGINT NOT NULL DEFAULT 0 CHECK (value_cents >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  lost_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_user_pipeline_stage
  ON deals(user_id, pipeline_id, stage_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_user_close
  ON deals(user_id, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_deals_contact
  ON deals(contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_company
  ON deals(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_due
  ON tasks(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_contact
  ON tasks(contact_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_deal
  ON tasks(deal_id, status, due_at);

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_user_created
  ON crm_activities(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact
  ON crm_activities(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_company
  ON crm_activities(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_deal
  ON crm_activities(deal_id, created_at DESC);

ALTER TABLE contact_crm_settings
  ADD COLUMN IF NOT EXISTS lead_scoring_rules JSONB NOT NULL DEFAULT
    '{"source_quality":30,"engagement":30,"budget_fit":25,"profile_completeness":15}';
ALTER TABLE contact_crm_settings
  ADD COLUMN IF NOT EXISTS deduplication_rules JSONB NOT NULL DEFAULT
    '{"email":true,"phone":true,"name_company":false}';
ALTER TABLE contact_crm_settings
  ADD COLUMN IF NOT EXISTS crm_permissions JSONB NOT NULL DEFAULT
    '{"representative":"owned","manager":"all","admin":"all"}';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE companies, company_contacts, leads, pipelines,
        pipeline_stages, deals, tasks, crm_activities
      TO maxform_browser;
  END IF;
END
$$;
