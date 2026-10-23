-- Production commerce operations: idempotent inventory movement, audit ledger,
-- low-stock alerts, and refund-line restocking.

ALTER TABLE payment_products
  ADD COLUMN IF NOT EXISTS restock_on_refund BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE payment_product_variants
  ADD COLUMN IF NOT EXISTS restock_on_refund BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE payment_order_items
  ADD COLUMN IF NOT EXISTS refunded_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_restocked_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payment_order_items DROP CONSTRAINT IF EXISTS payment_order_items_refunded_quantity_check;
ALTER TABLE payment_order_items ADD CONSTRAINT payment_order_items_refunded_quantity_check
  CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity);
ALTER TABLE payment_order_items DROP CONSTRAINT IF EXISTS payment_order_items_inventory_restocked_quantity_check;
ALTER TABLE payment_order_items ADD CONSTRAINT payment_order_items_inventory_restocked_quantity_check
  CHECK (inventory_restocked_quantity >= 0 AND inventory_restocked_quantity <= refunded_quantity);

ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS restock_inventory BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inventory_restocked_at TIMESTAMPTZ;

ALTER TABLE payment_inventory_reservations
  ADD COLUMN IF NOT EXISTS release_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payment_refund_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL REFERENCES payment_refunds(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES payment_order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  restocked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (restocked_quantity >= 0),
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (refund_id, order_item_id),
  CHECK (restocked_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_items_refund
  ON payment_refund_items(refund_id);

CREATE TABLE IF NOT EXISTS payment_inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES payment_products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES payment_product_variants(id) ON DELETE SET NULL,
  order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  refund_id UUID REFERENCES payment_refunds(id) ON DELETE SET NULL,
  adjustment INTEGER NOT NULL CHECK (adjustment <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL CHECK (
    reason IN ('reservation', 'reservation_release', 'manual_adjustment', 'refund_restock')
  ),
  reference_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_inventory_ledger_item
  ON payment_inventory_ledger(user_id, product_id, variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_inventory_ledger_order
  ON payment_inventory_ledger(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_inventory_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES payment_products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES payment_product_variants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  threshold INTEGER NOT NULL CHECK (threshold >= 0),
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_inventory_alerts_owner
  ON payment_inventory_alerts(user_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_inventory_alerts_active_item
  ON payment_inventory_alerts(
    product_id,
    COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('open', 'acknowledged');

ALTER TABLE payment_inventory_reservations
  DROP CONSTRAINT IF EXISTS payment_inventory_reservations_variant_id_fkey;
ALTER TABLE payment_inventory_reservations
  ADD CONSTRAINT payment_inventory_reservations_variant_id_fkey
  FOREIGN KEY (variant_id) REFERENCES payment_product_variants(id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION maxform_refresh_payment_inventory_alert(
  target_product UUID,
  target_variant UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $maxform$
DECLARE
  owner_id UUID;
  tracked BOOLEAN := FALSE;
  available INTEGER := 0;
  stock_threshold INTEGER := 0;
  active_alert_id UUID;
  item_label TEXT := 'Product';
BEGIN
  IF target_variant IS NOT NULL THEN
    SELECT product.user_id,
      variant.track_inventory AND NOT variant.allow_backorder,
      variant.inventory_quantity, variant.low_stock_threshold,
      COALESCE(product.name, 'Product') || ' · ' || COALESCE(variant.name, 'Variation')
    INTO owner_id, tracked, available, stock_threshold, item_label
    FROM payment_product_variants variant
    JOIN payment_products product ON product.id = variant.product_id
    WHERE variant.id = target_variant;
  ELSE
    SELECT product.user_id,
      product.track_inventory AND NOT product.allow_backorder,
      product.inventory_quantity, product.low_stock_threshold,
      COALESCE(product.name, 'Product')
    INTO owner_id, tracked, available, stock_threshold, item_label
    FROM payment_products product
    WHERE product.id = target_product;
  END IF;

  IF owner_id IS NULL THEN RETURN; END IF;

  SELECT id INTO active_alert_id
  FROM payment_inventory_alerts
  WHERE product_id = target_product
    AND variant_id IS NOT DISTINCT FROM target_variant
    AND status IN ('open', 'acknowledged')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF tracked AND available <= stock_threshold THEN
    IF active_alert_id IS NULL THEN
      INSERT INTO payment_inventory_alerts (
        user_id, product_id, variant_id, status, quantity, threshold, message
      ) VALUES (
        owner_id, target_product, target_variant, 'open', available, stock_threshold,
        item_label || ' is low on stock (' || available || ' remaining).'
      );
    ELSE
      UPDATE payment_inventory_alerts
      SET quantity = available,
          threshold = stock_threshold,
          message = item_label || ' is low on stock (' || available || ' remaining).',
          updated_at = NOW(),
          resolved_at = NULL
      WHERE id = active_alert_id;
    END IF;
  ELSIF active_alert_id IS NOT NULL THEN
    UPDATE payment_inventory_alerts
    SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
    WHERE id = active_alert_id;
  END IF;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_adjust_payment_inventory(
  target_user UUID,
  target_product UUID,
  target_variant UUID,
  requested_adjustment INTEGER,
  adjustment_reason TEXT,
  requested_reference_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  owner_id UUID;
  current_quantity INTEGER := 0;
  next_quantity INTEGER := 0;
  tracked BOOLEAN := FALSE;
  reference_exists BOOLEAN := FALSE;
  clean_reason TEXT := LEFT(NULLIF(TRIM(adjustment_reason), ''), 500);
  clean_reference TEXT := LEFT(NULLIF(TRIM(requested_reference_key), ''), 255);
BEGIN
  IF requested_adjustment = 0 OR clean_reason IS NULL OR clean_reference IS NULL THEN
    RAISE EXCEPTION 'Inventory adjustment is incomplete';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM payment_inventory_ledger
    WHERE reference_key = clean_reference AND user_id = target_user
  ) INTO reference_exists;

  IF reference_exists THEN
    IF target_variant IS NOT NULL THEN
      SELECT inventory_quantity INTO current_quantity
      FROM payment_product_variants
      WHERE id = target_variant AND product_id = target_product;
    ELSE
      SELECT inventory_quantity INTO current_quantity
      FROM payment_products
      WHERE id = target_product;
    END IF;
    RETURN COALESCE(current_quantity, 0);
  END IF;

  IF target_variant IS NOT NULL THEN
    SELECT product.user_id, variant.track_inventory, variant.inventory_quantity
    INTO owner_id, tracked, current_quantity
    FROM payment_product_variants variant
    JOIN payment_products product ON product.id = variant.product_id
    WHERE variant.id = target_variant AND variant.product_id = target_product
    FOR UPDATE;
  ELSE
    SELECT product.user_id, product.track_inventory, product.inventory_quantity
    INTO owner_id, tracked, current_quantity
    FROM payment_products product
    WHERE product.id = target_product
    FOR UPDATE;
  END IF;

  IF owner_id IS NULL OR owner_id <> target_user THEN
    RAISE EXCEPTION 'Inventory item does not belong to this workspace';
  END IF;
  IF NOT tracked THEN
    RAISE EXCEPTION 'Enable inventory tracking before adjusting stock';
  END IF;

  next_quantity := current_quantity + requested_adjustment;
  IF next_quantity < 0 THEN
    RAISE EXCEPTION 'Inventory cannot become negative';
  END IF;

  IF target_variant IS NOT NULL THEN
    UPDATE payment_product_variants
    SET inventory_quantity = next_quantity, updated_at = NOW()
    WHERE id = target_variant;
  ELSE
    UPDATE payment_products
    SET inventory_quantity = next_quantity, updated_at = NOW()
    WHERE id = target_product;
  END IF;

  INSERT INTO payment_inventory_ledger (
    user_id, product_id, variant_id, adjustment, balance_after,
    reason, reference_key, metadata
  ) VALUES (
    target_user, target_product, target_variant, requested_adjustment,
    next_quantity, 'manual_adjustment', clean_reference,
    jsonb_build_object('reason', clean_reason)
  );
  PERFORM maxform_refresh_payment_inventory_alert(target_product, target_variant);
  RETURN next_quantity;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_release_payment_inventory(
  target_order UUID,
  release_cause TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $maxform$
DECLARE
  reservation RECORD;
  balance_after INTEGER;
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
      WHERE id = reservation.variant_id
      RETURNING inventory_quantity INTO balance_after;
    ELSE
      UPDATE payment_products
      SET inventory_quantity = inventory_quantity + reservation.quantity,
          updated_at = NOW()
      WHERE id = reservation.product_id
      RETURNING inventory_quantity INTO balance_after;
    END IF;

    INSERT INTO payment_inventory_ledger (
      user_id, product_id, variant_id, order_id, adjustment, balance_after,
      reason, reference_key, metadata
    )
    SELECT product.user_id, reservation.product_id, reservation.variant_id,
      reservation.order_id, reservation.quantity, balance_after,
      'reservation_release',
      'inventory-release:' || reservation.id::text,
      jsonb_build_object('cause', LEFT(COALESCE(release_cause, ''), 120))
    FROM payment_products product
    WHERE product.id = reservation.product_id
    ON CONFLICT (reference_key) DO NOTHING;

    PERFORM maxform_refresh_payment_inventory_alert(
      reservation.product_id, reservation.variant_id
    );
  END LOOP;

  UPDATE payment_inventory_reservations
  SET status = 'released', release_reason = LEFT(COALESCE(release_cause, ''), 120),
      updated_at = NOW()
  WHERE order_id = target_order AND status = 'held';
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_release_payment_inventory(target_order UUID)
RETURNS VOID
LANGUAGE sql
AS $maxform$
  SELECT maxform_release_payment_inventory(target_order, 'manual');
$maxform$;

CREATE OR REPLACE FUNCTION maxform_release_expired_payment_inventory()
RETURNS INTEGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  target RECORD;
  released_count INTEGER := 0;
BEGIN
  FOR target IN
    SELECT order_id
    FROM payment_inventory_reservations
    WHERE status = 'held' AND expires_at <= NOW()
    GROUP BY order_id
  LOOP
    PERFORM maxform_release_payment_inventory(target.order_id, 'expired');
    released_count := released_count + 1;
  END LOOP;
  RETURN released_count;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_reserve_payment_inventory(
  target_order UUID,
  requested_items JSONB,
  hold_minutes INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $maxform$
DECLARE
  line JSONB;
  requested_product UUID;
  requested_variant UUID;
  requested_quantity INTEGER;
  tracked BOOLEAN;
  allow_backorder BOOLEAN;
  current_quantity INTEGER := 0;
  balance_after INTEGER := 0;
  held_quantity INTEGER := 0;
  delta INTEGER := 0;
  reservation_id UUID;
  owner_id UUID;
BEGIN
  PERFORM maxform_release_expired_payment_inventory();
  SELECT user_id INTO owner_id FROM payment_orders WHERE id = target_order FOR UPDATE;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Checkout order does not exist'; END IF;
  IF jsonb_typeof(requested_items) <> 'array' THEN
    RAISE EXCEPTION 'Inventory request must be an array';
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(requested_items)
  LOOP
    requested_product := (line->>'productId')::uuid;
    requested_variant := NULLIF(line->>'variantId', '')::uuid;
    requested_quantity := GREATEST(1, LEAST(10000, (line->>'quantity')::integer));
    reservation_id := NULL;
    held_quantity := 0;

    SELECT id, quantity INTO reservation_id, held_quantity
    FROM payment_inventory_reservations
    WHERE order_id = target_order
      AND product_id = requested_product
      AND variant_id IS NOT DISTINCT FROM requested_variant
      AND status = 'held'
    FOR UPDATE;
    held_quantity := COALESCE(held_quantity, 0);

    IF requested_variant IS NOT NULL THEN
      SELECT product.user_id, variant.track_inventory,
        variant.allow_backorder, variant.inventory_quantity
      INTO owner_id, tracked, allow_backorder, current_quantity
      FROM payment_product_variants variant
      JOIN payment_products product ON product.id = variant.product_id
      WHERE variant.id = requested_variant
        AND variant.product_id = requested_product
        AND variant.active = TRUE
      FOR UPDATE;
      IF NOT FOUND OR owner_id IS NULL THEN
        RAISE EXCEPTION 'Product variant is unavailable';
      END IF;
    ELSE
      SELECT product.user_id, product.track_inventory,
        product.allow_backorder, product.inventory_quantity
      INTO owner_id, tracked, allow_backorder, current_quantity
      FROM payment_products product
      WHERE product.id = requested_product AND product.active = TRUE
      FOR UPDATE;
      IF NOT FOUND OR owner_id IS NULL THEN
        RAISE EXCEPTION 'Product is unavailable';
      END IF;
    END IF;

    tracked := COALESCE(tracked, FALSE) AND NOT COALESCE(allow_backorder, FALSE);
    delta := requested_quantity - held_quantity;

    IF tracked AND delta > 0 THEN
      IF requested_variant IS NOT NULL THEN
        UPDATE payment_product_variants
        SET inventory_quantity = inventory_quantity - delta, updated_at = NOW()
        WHERE id = requested_variant AND inventory_quantity >= delta
        RETURNING inventory_quantity INTO balance_after;
      ELSE
        UPDATE payment_products
        SET inventory_quantity = inventory_quantity - delta, updated_at = NOW()
        WHERE id = requested_product AND inventory_quantity >= delta
        RETURNING inventory_quantity INTO balance_after;
      END IF;
      IF balance_after IS NULL THEN RAISE EXCEPTION 'Product is out of stock'; END IF;
      INSERT INTO payment_inventory_ledger (
        user_id, product_id, variant_id, order_id, adjustment, balance_after,
        reason, reference_key, metadata
      ) VALUES (
        owner_id, requested_product, requested_variant, target_order, -delta,
        balance_after, 'reservation',
        'inventory-reservation:' || target_order::text || ':' ||
          requested_product::text || ':' || COALESCE(requested_variant::text, 'base') || ':' ||
          clock_timestamp()::text,
        '{}'::jsonb
      );
    ELSIF tracked AND delta < 0 THEN
      IF requested_variant IS NOT NULL THEN
        UPDATE payment_product_variants
        SET inventory_quantity = inventory_quantity + ABS(delta), updated_at = NOW()
        WHERE id = requested_variant
        RETURNING inventory_quantity INTO balance_after;
      ELSE
        UPDATE payment_products
        SET inventory_quantity = inventory_quantity + ABS(delta), updated_at = NOW()
        WHERE id = requested_product
        RETURNING inventory_quantity INTO balance_after;
      END IF;
      INSERT INTO payment_inventory_ledger (
        user_id, product_id, variant_id, order_id, adjustment, balance_after,
        reason, reference_key, metadata
      ) VALUES (
        owner_id, requested_product, requested_variant, target_order, ABS(delta),
        balance_after, 'reservation_release',
        'inventory-reservation-adjustment:' || target_order::text || ':' ||
          requested_product::text || ':' || COALESCE(requested_variant::text, 'base') || ':' ||
          clock_timestamp()::text,
        '{}'::jsonb
      );
    ELSIF NOT tracked AND held_quantity > 0 THEN
      IF requested_variant IS NOT NULL THEN
        UPDATE payment_product_variants
        SET inventory_quantity = inventory_quantity + held_quantity, updated_at = NOW()
        WHERE id = requested_variant
        RETURNING inventory_quantity INTO balance_after;
      ELSE
        UPDATE payment_products
        SET inventory_quantity = inventory_quantity + held_quantity, updated_at = NOW()
        WHERE id = requested_product
        RETURNING inventory_quantity INTO balance_after;
      END IF;
      INSERT INTO payment_inventory_ledger (
        user_id, product_id, variant_id, order_id, adjustment, balance_after,
        reason, reference_key, metadata
      ) VALUES (
        owner_id, requested_product, requested_variant, target_order, held_quantity,
        balance_after, 'reservation_release',
        'inventory-reservation-untracked:' || target_order::text || ':' ||
          requested_product::text || ':' || COALESCE(requested_variant::text, 'base') || ':' ||
          clock_timestamp()::text,
        '{}'::jsonb
      );
    END IF;

    IF tracked THEN
      IF reservation_id IS NULL THEN
        INSERT INTO payment_inventory_reservations (
          order_id, product_id, variant_id, quantity, status, expires_at
        ) VALUES (
          target_order, requested_product, requested_variant, requested_quantity,
          'held', NOW() + make_interval(mins => GREATEST(5, LEAST(120, hold_minutes)))
        ) RETURNING id INTO reservation_id;
      ELSE
        UPDATE payment_inventory_reservations
        SET quantity = requested_quantity, status = 'held', release_reason = '',
            expires_at = NOW() + make_interval(mins => GREATEST(5, LEAST(120, hold_minutes))),
            updated_at = NOW()
        WHERE id = reservation_id;
      END IF;
      PERFORM maxform_refresh_payment_inventory_alert(requested_product, requested_variant);
    ELSIF reservation_id IS NOT NULL THEN
      UPDATE payment_inventory_reservations
      SET status = 'released', release_reason = 'backorder_or_untracked', updated_at = NOW()
      WHERE id = reservation_id;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_consume_payment_inventory(target_order UUID)
RETURNS VOID
LANGUAGE sql
AS $maxform$
  UPDATE payment_inventory_reservations
  SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
  WHERE order_id = target_order AND status = 'held';
$maxform$;

CREATE OR REPLACE FUNCTION maxform_reserve_payment_refund(
  requested_user_id UUID,
  requested_order_id UUID,
  requested_refund_id UUID,
  requested_idempotency_key UUID,
  requested_amount NUMERIC,
  requested_reason TEXT,
  requested_items JSONB,
  requested_restock_inventory BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $maxform$
DECLARE
  order_record payment_orders%ROWTYPE;
  line JSONB;
  order_item RECORD;
  requested_item_id UUID;
  requested_quantity INTEGER;
  pending_quantity INTEGER;
  selected_amount NUMERIC := 0;
BEGIN
  SELECT * INTO order_record
  FROM payment_orders
  WHERE id = requested_order_id AND user_id = requested_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF EXISTS (
    SELECT 1 FROM payment_refunds
    WHERE user_id = requested_user_id AND idempotency_key = requested_idempotency_key
  ) THEN RETURN TRUE; END IF;

  IF order_record.status NOT IN ('paid', 'partially_refunded')
     OR order_record.provider IS NULL
     OR TRIM(order_record.provider_reference) = ''
     OR requested_amount <= 0
     OR requested_amount > order_record.total_amount - order_record.refunded_amount THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(COALESCE(requested_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Refund items must be an array';
  END IF;

  INSERT INTO payment_refunds (
    id, user_id, order_id, provider, provider_refund_id, amount, currency,
    reason, status, idempotency_key, restock_inventory, requested_at, created_at, updated_at
  ) VALUES (
    requested_refund_id, requested_user_id, requested_order_id,
    order_record.provider, '', requested_amount, order_record.currency,
    LEFT(TRIM(requested_reason), 500), 'pending', requested_idempotency_key,
    COALESCE(requested_restock_inventory, TRUE), NOW(), NOW(), NOW()
  );

  FOR line IN SELECT value FROM jsonb_array_elements(COALESCE(requested_items, '[]'::jsonb))
  LOOP
    requested_item_id := (line->>'orderItemId')::uuid;
    requested_quantity := GREATEST(1, LEAST(10000, (line->>'quantity')::integer));
    SELECT item.*,
      COALESCE((
        SELECT SUM(refund_item.quantity)
        FROM payment_refund_items refund_item
        JOIN payment_refunds other_refund ON other_refund.id = refund_item.refund_id
        WHERE refund_item.order_item_id = item.id
          AND other_refund.status IN ('pending', 'processing')
      ), 0)::integer AS pending_refund_quantity
    INTO order_item
    FROM payment_order_items item
    WHERE item.id = requested_item_id AND item.order_id = requested_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Refund item does not belong to this order'; END IF;
    pending_quantity := COALESCE(order_item.pending_refund_quantity, 0);
    IF requested_quantity > order_item.quantity - order_item.refunded_quantity - pending_quantity THEN
      RAISE EXCEPTION 'Refund quantity exceeds the remaining order quantity';
    END IF;
    selected_amount := selected_amount +
      (COALESCE(order_item.unit_price, 0) * requested_quantity);
    INSERT INTO payment_refund_items (
      refund_id, order_item_id, quantity, amount
    ) VALUES (
      requested_refund_id, requested_item_id, requested_quantity,
      COALESCE(order_item.unit_price, 0) * requested_quantity
    );
    UPDATE payment_order_items
    SET refunded_quantity = refunded_quantity + requested_quantity
    WHERE id = requested_item_id;
  END LOOP;

  IF selected_amount > requested_amount THEN
    RAISE EXCEPTION 'Refund line items exceed the requested refund amount';
  END IF;

  UPDATE payment_orders
  SET refunded_amount = refunded_amount + requested_amount,
      status = CASE
        WHEN refunded_amount + requested_amount >= total_amount THEN 'refunded'
        ELSE 'partially_refunded'
      END,
      updated_at = NOW()
  WHERE id = requested_order_id;
  RETURN TRUE;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_release_payment_refund(requested_refund_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $maxform$
DECLARE
  refund_record payment_refunds%ROWTYPE;
BEGIN
  SELECT * INTO refund_record
  FROM payment_refunds
  WHERE id = requested_refund_id
  FOR UPDATE;
  IF NOT FOUND OR refund_record.status NOT IN ('pending', 'processing') THEN RETURN; END IF;

  UPDATE payment_order_items item
  SET refunded_quantity = GREATEST(
    0,
    item.refunded_quantity - refund_item.quantity
  )
  FROM payment_refund_items refund_item
  WHERE refund_item.refund_id = requested_refund_id
    AND refund_item.order_item_id = item.id;

  UPDATE payment_refunds
  SET status = 'failed',
      failure_reason = 'Provider rejected the refund request',
      completed_at = NOW(), updated_at = NOW()
  WHERE id = requested_refund_id;

  UPDATE payment_orders
  SET refunded_amount = GREATEST(0, refunded_amount - refund_record.amount),
      status = CASE
        WHEN GREATEST(0, refunded_amount - refund_record.amount) = 0 THEN 'paid'
        ELSE 'partially_refunded'
      END,
      updated_at = NOW()
  WHERE id = refund_record.order_id;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_restock_payment_inventory(target_refund UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  refund_record payment_refunds%ROWTYPE;
  line RECORD;
  restore_quantity INTEGER := 0;
  restored_count INTEGER := 0;
  balance_after INTEGER := 0;
  restock_enabled BOOLEAN;
BEGIN
  SELECT * INTO refund_record
  FROM payment_refunds
  WHERE id = target_refund
  FOR UPDATE;
  IF NOT FOUND OR refund_record.status <> 'succeeded'
     OR refund_record.restock_inventory = FALSE
     OR refund_record.inventory_restocked_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  FOR line IN
    SELECT refund_item.*, order_item.product_id, order_item.variant_id,
      order_item.quantity AS order_quantity,
      product.user_id, product.restock_on_refund AS product_restock,
      product.track_inventory AS product_track,
      variant.restock_on_refund AS variant_restock,
      variant.track_inventory AS variant_track
    FROM payment_refund_items refund_item
    JOIN payment_order_items order_item ON order_item.id = refund_item.order_item_id
    LEFT JOIN payment_products product ON product.id = order_item.product_id
    LEFT JOIN payment_product_variants variant ON variant.id = order_item.variant_id
    WHERE refund_item.refund_id = target_refund
    FOR UPDATE OF refund_item, order_item
  LOOP
    restock_enabled := COALESCE(
      CASE WHEN line.variant_id IS NOT NULL THEN line.variant_restock ELSE line.product_restock END,
      TRUE
    );
    restore_quantity := GREATEST(0, line.quantity - line.restocked_quantity);
    IF restore_quantity <= 0 THEN CONTINUE; END IF;
    IF line.product_id IS NULL OR NOT restock_enabled THEN
      UPDATE payment_refund_items
      SET restocked_quantity = quantity, updated_at = NOW()
      WHERE id = line.id;
      CONTINUE;
    END IF;

    IF line.variant_id IS NOT NULL AND line.variant_track = TRUE THEN
      UPDATE payment_product_variants
      SET inventory_quantity = inventory_quantity + restore_quantity, updated_at = NOW()
      WHERE id = line.variant_id
      RETURNING inventory_quantity INTO balance_after;
    ELSIF line.variant_id IS NULL AND line.product_track = TRUE THEN
      UPDATE payment_products
      SET inventory_quantity = inventory_quantity + restore_quantity, updated_at = NOW()
      WHERE id = line.product_id
      RETURNING inventory_quantity INTO balance_after;
    ELSE
      UPDATE payment_refund_items
      SET restocked_quantity = quantity, updated_at = NOW()
      WHERE id = line.id;
      CONTINUE;
    END IF;

    IF balance_after IS NULL THEN CONTINUE; END IF;
    INSERT INTO payment_inventory_ledger (
      user_id, product_id, variant_id, order_id, refund_id,
      adjustment, balance_after, reason, reference_key, metadata
    ) VALUES (
      line.user_id, line.product_id, line.variant_id, refund_record.order_id,
      target_refund, restore_quantity, balance_after, 'refund_restock',
      'inventory-refund:' || target_refund::text || ':' || line.order_item_id::text,
      jsonb_build_object('quantity', restore_quantity)
    ) ON CONFLICT (reference_key) DO NOTHING;
    UPDATE payment_refund_items
    SET restocked_quantity = quantity, updated_at = NOW()
    WHERE id = line.id;
    UPDATE payment_order_items
    SET inventory_restocked_quantity = inventory_restocked_quantity + restore_quantity
    WHERE id = line.order_item_id;
    PERFORM maxform_refresh_payment_inventory_alert(line.product_id, line.variant_id);
    restored_count := restored_count + restore_quantity;
  END LOOP;

  UPDATE payment_refunds
  SET inventory_restocked_at = NOW(), updated_at = NOW()
  WHERE id = target_refund;
  RETURN restored_count;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_acknowledge_payment_inventory_alert(
  target_user UUID,
  target_alert UUID
)
RETURNS BOOLEAN
LANGUAGE sql
AS $maxform$
  UPDATE payment_inventory_alerts
  SET status = 'acknowledged', acknowledged_at = NOW(), updated_at = NOW()
  WHERE id = target_alert AND user_id = target_user AND status = 'open'
  RETURNING TRUE;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_set_payment_inventory(
  target_user UUID,
  target_product UUID,
  target_variant UUID,
  target_quantity INTEGER,
  adjustment_reason TEXT,
  requested_reference_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  owner_id UUID;
  current_quantity INTEGER := 0;
  tracked BOOLEAN := FALSE;
  delta INTEGER := 0;
  clean_reason TEXT := LEFT(NULLIF(TRIM(adjustment_reason), ''), 500);
  clean_reference TEXT := LEFT(NULLIF(TRIM(requested_reference_key), ''), 255);
BEGIN
  IF target_quantity < 0 OR clean_reason IS NULL OR clean_reference IS NULL THEN
    RAISE EXCEPTION 'Inventory value is incomplete';
  END IF;

  IF target_variant IS NOT NULL THEN
    SELECT product.user_id, variant.track_inventory, variant.inventory_quantity
    INTO owner_id, tracked, current_quantity
    FROM payment_product_variants variant
    JOIN payment_products product ON product.id = variant.product_id
    WHERE variant.id = target_variant AND variant.product_id = target_product
    FOR UPDATE;
  ELSE
    SELECT product.user_id, product.track_inventory, product.inventory_quantity
    INTO owner_id, tracked, current_quantity
    FROM payment_products product
    WHERE product.id = target_product
    FOR UPDATE;
  END IF;

  IF owner_id IS NULL OR owner_id <> target_user THEN
    RAISE EXCEPTION 'Inventory item does not belong to this workspace';
  END IF;
  IF NOT tracked THEN
    RETURN current_quantity;
  END IF;

  delta := target_quantity - current_quantity;
  IF delta = 0 THEN RETURN current_quantity; END IF;

  IF target_variant IS NOT NULL THEN
    UPDATE payment_product_variants
    SET inventory_quantity = target_quantity, updated_at = NOW()
    WHERE id = target_variant;
  ELSE
    UPDATE payment_products
    SET inventory_quantity = target_quantity, updated_at = NOW()
    WHERE id = target_product;
  END IF;

  INSERT INTO payment_inventory_ledger (
    user_id, product_id, variant_id, adjustment, balance_after,
    reason, reference_key, metadata
  ) VALUES (
    target_user, target_product, target_variant, delta, target_quantity,
    'manual_adjustment', clean_reference,
    jsonb_build_object('reason', clean_reason, 'source', 'product_editor')
  );
  PERFORM maxform_refresh_payment_inventory_alert(target_product, target_variant);
  RETURN target_quantity;
END;
$maxform$;
