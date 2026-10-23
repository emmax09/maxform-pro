-- Lets `trigger.product_stock_low` fire exactly once per crossing.
--
-- Stock is decremented from several places, most of them inside PL/pgSQL
-- (reserve, consume, release, restock, manual adjust), so there is no single
-- TypeScript call site to hang the workflow event off. What every one of those
-- paths does share is `maxform_refresh_payment_inventory_alert`, which INSERTs
-- a row here the moment available stock crosses below the threshold and
-- resolves it when stock recovers.
--
-- That insert is therefore the crossing. Stamping each alert once it has been
-- announced turns the table into the queue: the workflow cron claims
-- un-announced open alerts, emits for them, and stamps them, so a re-crossing
-- after a resolve produces a new row and a new event while a merely-updated
-- alert produces neither.

ALTER TABLE payment_inventory_alerts
  ADD COLUMN IF NOT EXISTS workflow_notified_at TIMESTAMPTZ;

-- Partial: the sweeper only ever asks for the un-announced open ones, and that
-- set is near-empty in steady state.
CREATE INDEX IF NOT EXISTS idx_payment_inventory_alerts_workflow_pending
  ON payment_inventory_alerts(created_at)
  WHERE status = 'open' AND workflow_notified_at IS NULL;

-- Alerts already on the books predate the trigger. Announcing them would send
-- a burst of events for stock that has been low for weeks, so they start life
-- already announced and only future crossings emit.
UPDATE payment_inventory_alerts
SET workflow_notified_at = NOW()
WHERE workflow_notified_at IS NULL;

COMMENT ON COLUMN payment_inventory_alerts.workflow_notified_at IS
  'When trigger.product_stock_low was emitted for this alert; NULL means the workflow cron has not announced it yet';
