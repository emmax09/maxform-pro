-- Production form commerce: catalog variants, stock, shipping, tax, and
-- reservation-safe order lines.

ALTER TABLE payment_products
  ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requires_shipping BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inventory_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS allow_backorder BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_tax_rate_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_tax_rate_check
  CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_inventory_quantity_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_inventory_quantity_check
  CHECK (inventory_quantity >= 0);
ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_low_stock_threshold_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_low_stock_threshold_check
  CHECK (low_stock_threshold >= 0);
ALTER TABLE payment_products DROP CONSTRAINT IF EXISTS payment_products_weight_grams_check;
ALTER TABLE payment_products ADD CONSTRAINT payment_products_weight_grams_check
  CHECK (weight_grams >= 0);

CREATE TABLE IF NOT EXISTS payment_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES payment_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  option_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  image_url TEXT NOT NULL DEFAULT '',
  track_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_quantity INTEGER NOT NULL DEFAULT 0 CHECK (inventory_quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  allow_backorder BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_product_variants_sku
  ON payment_product_variants(product_id, UPPER(sku))
  WHERE sku <> '';
CREATE INDEX IF NOT EXISTS idx_payment_product_variants_product
  ON payment_product_variants(product_id, active, sort_order, created_at);

ALTER TABLE payment_order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES payment_product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS variant_name TEXT NOT NULL DEFAULT '';

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_shipping_amount_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_shipping_amount_check
  CHECK (shipping_amount >= 0);

CREATE TABLE IF NOT EXISTS payment_inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES payment_products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES payment_product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'consumed', 'released')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_inventory_reservations_expiry
  ON payment_inventory_reservations(status, expires_at)
  WHERE status = 'held';

CREATE OR REPLACE FUNCTION maxform_release_payment_inventory(target_order UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  reservation RECORD;
BEGIN
  FOR reservation IN
    SELECT * FROM payment_inventory_reservations
    WHERE order_id = target_order AND status = 'held'
    FOR UPDATE
  LOOP
    IF reservation.variant_id IS NOT NULL THEN
      UPDATE payment_product_variants
      SET inventory_quantity = inventory_quantity + reservation.quantity,
          updated_at = NOW()
      WHERE id = reservation.variant_id;
    ELSE
      UPDATE payment_products
      SET inventory_quantity = inventory_quantity + reservation.quantity,
          updated_at = NOW()
      WHERE id = reservation.product_id;
    END IF;
  END LOOP;

  UPDATE payment_inventory_reservations
  SET status = 'released', updated_at = NOW()
  WHERE order_id = target_order AND status = 'held';
END;
$$;

CREATE OR REPLACE FUNCTION maxform_release_expired_payment_inventory()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  target RECORD;
  released_count INTEGER := 0;
BEGIN
  FOR target IN
    SELECT DISTINCT order_id
    FROM payment_inventory_reservations
    WHERE status = 'held' AND expires_at <= NOW()
  LOOP
    PERFORM maxform_release_payment_inventory(target.order_id);
    released_count := released_count + 1;
  END LOOP;
  RETURN released_count;
END;
$$;

CREATE OR REPLACE FUNCTION maxform_reserve_payment_inventory(
  target_order UUID,
  requested_items JSONB,
  hold_minutes INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  line JSONB;
  requested_product UUID;
  requested_variant UUID;
  requested_quantity INTEGER;
  tracked BOOLEAN;
  changed UUID;
BEGIN
  PERFORM maxform_release_expired_payment_inventory();

  IF jsonb_typeof(requested_items) <> 'array' THEN
    RAISE EXCEPTION 'Inventory request must be an array';
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(requested_items)
  LOOP
    requested_product := (line->>'productId')::uuid;
    requested_variant := NULLIF(line->>'variantId', '')::uuid;
    requested_quantity := GREATEST(1, LEAST(10000, (line->>'quantity')::integer));
    changed := NULL;

    IF NOT EXISTS (
      SELECT 1 FROM payment_orders payment_order
      JOIN payment_products product ON product.id = requested_product
      WHERE payment_order.id = target_order
        AND payment_order.user_id = product.user_id
    ) THEN
      RAISE EXCEPTION 'Product does not belong to this order';
    END IF;

    IF requested_variant IS NOT NULL THEN
      SELECT variant.track_inventory AND NOT variant.allow_backorder INTO tracked
      FROM payment_product_variants variant
      WHERE variant.id = requested_variant
        AND variant.product_id = requested_product
        AND variant.active = TRUE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Product variant is unavailable'; END IF;

      IF tracked THEN
        UPDATE payment_product_variants
        SET inventory_quantity = inventory_quantity - requested_quantity,
            updated_at = NOW()
        WHERE id = requested_variant
          AND (allow_backorder OR inventory_quantity >= requested_quantity)
        RETURNING id INTO changed;
        IF changed IS NULL THEN RAISE EXCEPTION 'Product variant is out of stock'; END IF;
      END IF;
    ELSE
      SELECT product.track_inventory AND NOT product.allow_backorder INTO tracked
      FROM payment_products product
      WHERE product.id = requested_product AND product.active = TRUE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Product is unavailable'; END IF;

      IF tracked THEN
        UPDATE payment_products
        SET inventory_quantity = inventory_quantity - requested_quantity,
            updated_at = NOW()
        WHERE id = requested_product
          AND (allow_backorder OR inventory_quantity >= requested_quantity)
        RETURNING id INTO changed;
        IF changed IS NULL THEN RAISE EXCEPTION 'Product is out of stock'; END IF;
      END IF;
    END IF;

    IF tracked THEN
      INSERT INTO payment_inventory_reservations (
        order_id, product_id, variant_id, quantity, status, expires_at
      ) VALUES (
        target_order, requested_product, requested_variant, requested_quantity,
        'held', NOW() + make_interval(mins => GREATEST(5, LEAST(120, hold_minutes)))
      )
      ON CONFLICT (order_id, product_id, variant_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, status = 'held',
        expires_at = EXCLUDED.expires_at, updated_at = NOW();
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION maxform_consume_payment_inventory(target_order UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE payment_inventory_reservations
  SET status = 'consumed', updated_at = NOW()
  WHERE order_id = target_order AND status = 'held';
$$;
