-- Rich product editor metadata and product-scoped coupon eligibility.
-- Existing catalog, order, inventory, and coupon records remain compatible.

ALTER TABLE payment_products
  ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sale_price NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS image_gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS promotional_banner TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS availability_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS min_quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_quantity INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS one_per_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_when_sold_out BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_sale_price_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_sale_price_check
  CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price <= price));
ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_status_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_status_check
  CHECK (product_status IN ('active', 'draft', 'hidden', 'sold_out'));
ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_quantity_limits_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_quantity_limits_check
  CHECK (min_quantity >= 1 AND max_quantity >= min_quantity);
ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_availability_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_availability_check
  CHECK (availability_end_at IS NULL OR availability_start_at IS NULL
    OR availability_end_at > availability_start_at);

ALTER TABLE payment_product_variants
  ADD COLUMN IF NOT EXISTS sale_price NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS availability_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_end_at TIMESTAMPTZ;

ALTER TABLE payment_product_variants DROP CONSTRAINT IF EXISTS payment_product_variants_sale_price_check;
ALTER TABLE payment_product_variants ADD CONSTRAINT payment_product_variants_sale_price_check
  CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price <= price));
ALTER TABLE payment_product_variants DROP CONSTRAINT IF EXISTS payment_product_variants_weight_check;
ALTER TABLE payment_product_variants ADD CONSTRAINT payment_product_variants_weight_check
  CHECK (weight_grams >= 0);
ALTER TABLE payment_product_variants DROP CONSTRAINT IF EXISTS payment_product_variants_availability_check;
ALTER TABLE payment_product_variants ADD CONSTRAINT payment_product_variants_availability_check
  CHECK (availability_end_at IS NULL OR availability_start_at IS NULL
    OR availability_end_at > availability_start_at);

ALTER TABLE payment_coupons
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS eligible_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_payment_products_status_availability
  ON payment_products(user_id, active, product_status, availability_start_at, availability_end_at);
