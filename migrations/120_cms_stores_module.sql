-- Connected stores: workspace-scoped CMS/ecommerce connections and cache.
-- Credentials and webhook secrets are encrypted by the server before they
-- reach these tables. These tables are intentionally separate from generic
-- integrations and from Forms automation.

CREATE TABLE IF NOT EXISTS cms_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce', 'bigcommerce', 'wix')),
  name TEXT NOT NULL,
  store_url TEXT NOT NULL,
  external_store_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'attention' CHECK (status IN ('healthy', 'attention', 'syncing', 'disconnected')),
  credentials_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT NOT NULL,
  webhook_registered BOOLEAN NOT NULL DEFAULT FALSE,
  sync_lock_token TEXT,
  sync_lock_expires_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  last_synced_at TIMESTAMPTZ,
  last_reconciliation_at TIMESTAMPTZ,
  product_count INTEGER NOT NULL DEFAULT 0,
  category_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, platform, store_url)
);

CREATE INDEX IF NOT EXISTS idx_cms_connections_workspace ON cms_connections(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_connections_reconciliation ON cms_connections(last_reconciliation_at, status);

CREATE TABLE IF NOT EXISTS cms_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_connection_id UUID NOT NULL REFERENCES cms_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  sku TEXT NOT NULL DEFAULT '',
  price_cents BIGINT NOT NULL DEFAULT 0,
  compare_at_price_cents BIGINT,
  sale_price_cents BIGINT,
  currency TEXT NOT NULL DEFAULT 'USD',
  inventory_quantity INTEGER,
  inventory_managed BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  product_type TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_url TEXT NOT NULL DEFAULT '',
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_updated_at TIMESTAMPTZ,
  cached_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_pulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cms_connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_products_connection ON cms_products(cms_connection_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cms_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_product_id UUID NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price_cents BIGINT NOT NULL DEFAULT 0,
  compare_at_price_cents BIGINT,
  inventory_quantity INTEGER,
  inventory_managed BOOLEAN NOT NULL DEFAULT FALSE,
  image_url TEXT NOT NULL DEFAULT '',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  cached_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_pulled_at TIMESTAMPTZ,
  UNIQUE (cms_product_id, external_id)
);

CREATE TABLE IF NOT EXISTS cms_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_connection_id UUID NOT NULL REFERENCES cms_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  type TEXT NOT NULL DEFAULT 'category' CHECK (type IN ('category', 'collection')),
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_count INTEGER NOT NULL DEFAULT 0,
  cached_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_pulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cms_connection_id, external_id, type)
);

CREATE INDEX IF NOT EXISTS idx_cms_categories_connection ON cms_categories(cms_connection_id, name);

CREATE TABLE IF NOT EXISTS cms_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_connection_id UUID NOT NULL REFERENCES cms_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  order_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT NOT NULL DEFAULT '',
  total_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  payment_gateway_used TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  cached_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_created_at TIMESTAMPTZ,
  external_updated_at TIMESTAMPTZ,
  last_pulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cms_connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_orders_connection ON cms_orders(cms_connection_id, external_created_at DESC);

CREATE TABLE IF NOT EXISTS cms_sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_connection_id UUID NOT NULL REFERENCES cms_connections(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('webhook', 'reconciliation', 'manual')),
  resource TEXT NOT NULL DEFAULT 'store',
  external_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'sync',
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'processing')),
  message TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_sync_events_connection ON cms_sync_events(cms_connection_id, occurred_at DESC);
