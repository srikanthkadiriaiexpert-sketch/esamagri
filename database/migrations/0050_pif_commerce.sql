-- ---------------------------------------------------------------------------
-- 0050_pif_commerce.sql
--
-- PHASE F — PIF as a working grocery-ordering module.
--
-- WHAT WAS ALREADY THERE, AND IS REUSED UNCHANGED. The six tables the
-- corrected PIF scope needs all exist from Phase 2 and are kept exactly as
-- they are: pif.categories (already carries parent_id, so subcategories need
-- nothing new), pif.products, pif.carts, pif.cart_items, pif.orders,
-- pif.order_items, plus pif.tax_rates for GST. The order status CHECK on
-- pif.orders already permits the whole lifecycle, and
-- pif.trg_validate_order_status_transition already enforces the legal order
-- of it. NEITHER IS REDEFINED HERE — this migration adds to that spine, it
-- does not replace it.
--
-- WHAT THIS MIGRATION ADDS, AND WHY EACH THING IS NEEDED
--
--   1. Catalogue fields a client-managed catalogue cannot do without:
--      brand, description, pack size and unit, order quantity limit,
--      availability, variant grouping, and who last changed the row.
--      Product images keep using the existing `image_ref` column — no
--      parallel image system (the RIK category covers use the same idea).
--
--   2. Money and address SNAPSHOTS on pif.orders / pif.order_items. An order
--      line records the name, SKU, unit, pack, price, tax rate and totals AS
--      THEY WERE WHEN THE ORDER WAS PLACED. A later price change, rename or
--      tax change therefore cannot move a historical order's amount — not
--      because the application is careful, but because the number is stored.
--      The arithmetic is CHECK-constrained, and a DEFERRABLE constraint
--      trigger compares each order's totals to the sum of its own lines at
--      commit time, so an order whose header disagrees with its lines cannot
--      be committed at all.
--
--   3. pif.order_events — the append-only operational history, and the ONLY
--      path by which an order's status may move. Same shape as Phase E's
--      rik.issue_voucher_outcomes, adapted: a PIF order has no entitlement,
--      no pool, no substitution, and its states are its own.
--
--   4. Two permissions the corrected scope needs and the seed does not have
--      (pif.order.manage, pif.order.prepare), and SUPER_ADMIN's explicit
--      grants across BOTH modules — authorization that is a real row in
--      shared.role_permissions, never an inference from a role's name.
--
-- WHAT IS NOT HERE, DELIBERATELY. No stock quantity, no inventory movement,
-- no supplier, no purchase order, no bill, no invoice, no cash drawer, no
-- POS. Billing happens in the facility's own separate software; this module
-- carries the order's own amounts so the customer can see what they will pay
-- and the staff can see what to collect, and stops there. The 14 superseded
-- pif.* tables from Phase 2 are left exactly as they are — untouched, empty,
-- and referenced by no code. Dropping them would be a migration against a
-- frozen baseline for no functional gain.
--
-- NO PURCHASING ROLE. No role is created at all.
--
-- RIK IS NOT TOUCHED. Not a table, not a trigger, not a privilege, not a
-- permission that governs it. The verification block at the end re-asserts
-- the RIK baseline and fails the migration if any of it moved.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

-- ===========================================================================
-- 1. Catalogue: the fields a client-managed grocery catalogue needs
-- ===========================================================================

ALTER TABLE pif.categories
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_ref   text,
  ADD COLUMN IF NOT EXISTS sort_order  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_by  uuid;

-- A category may not be its own parent, and a subcategory may not itself have
-- children: the taxonomy is category → subcategory, two levels, as specified.
CREATE OR REPLACE FUNCTION pif.trg_validate_category_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'pif.categories: a category cannot be its own parent (%)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM pif.categories c WHERE c.id = NEW.parent_id AND c.parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'pif.categories: only two levels are allowed — % is already a subcategory', NEW.parent_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- A category that already has children cannot become a subcategory itself.
  IF NEW.parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM pif.categories c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'pif.categories: % has subcategories and cannot become one', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS category_parent_valid ON pif.categories;
CREATE TRIGGER category_parent_valid
  BEFORE INSERT OR UPDATE OF parent_id ON pif.categories
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_category_parent();

ALTER TABLE pif.products
  ADD COLUMN IF NOT EXISTS brand          text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS pack_size      numeric(12,3),
  ADD COLUMN IF NOT EXISTS pack_unit      text,
  -- The permitted order quantity. NOT a stock level: it caps one order, it
  -- does not count what the facility holds.
  ADD COLUMN IF NOT EXISTS max_order_qty  numeric(12,3),
  ADD COLUMN IF NOT EXISTS min_order_qty  numeric(12,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_step       numeric(12,3) NOT NULL DEFAULT 1,
  -- AVAILABILITY, which is not stock. `active` says the product exists in
  -- the catalogue at all; `available` says it can be ordered today. Both are
  -- administrator-set flags. There is no quantity on hand anywhere in PIF.
  ADD COLUMN IF NOT EXISTS available      boolean NOT NULL DEFAULT true,
  -- Variants of one product family (e.g. 500 g / 1 kg of the same item) share
  -- a variant_group; variant_label is what distinguishes them on screen.
  ADD COLUMN IF NOT EXISTS variant_group  text,
  ADD COLUMN IF NOT EXISTS variant_label  text,
  ADD COLUMN IF NOT EXISTS created_by     uuid,
  ADD COLUMN IF NOT EXISTS updated_by     uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_products_pack_chk') THEN
    ALTER TABLE pif.products
      ADD CONSTRAINT pif_products_pack_chk CHECK (pack_size IS NULL OR pack_size > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_products_order_qty_chk') THEN
    ALTER TABLE pif.products
      ADD CONSTRAINT pif_products_order_qty_chk CHECK (
        min_order_qty > 0
        AND qty_step > 0
        AND (max_order_qty IS NULL OR max_order_qty >= min_order_qty)
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS pif_products_available_idx
  ON pif.products (active, available) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pif_products_variant_idx
  ON pif.products (variant_group) WHERE variant_group IS NOT NULL;
CREATE INDEX IF NOT EXISTS pif_products_sku_trgm_idx
  ON pif.products USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pif_categories_sort_idx
  ON pif.categories (parent_id, sort_order);

-- ===========================================================================
-- 2. The order, and its frozen amounts
-- ===========================================================================

ALTER TABLE pif.orders
  ADD COLUMN IF NOT EXISTS fulfillment_mode    text NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN IF NOT EXISTS payment_method      text NOT NULL DEFAULT 'COD',
  -- Snapshots: where it is going and who to call, as recorded at placement.
  -- A later edit of the customer's saved address cannot rewrite a placed
  -- order, exactly as a RIK voucher's address cannot be rewritten.
  ADD COLUMN IF NOT EXISTS delivery_address_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_name        text,
  ADD COLUMN IF NOT EXISTS contact_mobile      text,
  ADD COLUMN IF NOT EXISTS customer_note       text,
  ADD COLUMN IF NOT EXISTS subtotal            numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total      numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total           numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total               numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ready_at            timestamptz,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparing_at        timestamptz,
  ADD COLUMN IF NOT EXISTS not_delivered_at    timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_orders_mode_chk') THEN
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_mode_chk CHECK (fulfillment_mode IN ('PICKUP', 'DELIVERY'));
  END IF;
  -- Cash on delivery is the only method this module supports. A second value
  -- would mean an online payment flow, which the approved scope excludes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_orders_payment_chk') THEN
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_payment_chk CHECK (payment_method = 'COD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_orders_money_chk') THEN
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_money_chk CHECK (
        subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND total >= 0
        AND total = round(subtotal - discount_total + tax_total, 2)
      );
  END IF;
  -- A delivery order must say where. A pickup order must not pretend to.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_orders_address_chk') THEN
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_address_chk CHECK (
        (fulfillment_mode = 'DELIVERY' AND delivery_address_id IS NOT NULL
           AND delivery_address_snapshot IS NOT NULL)
        OR (fulfillment_mode = 'PICKUP' AND delivery_address_id IS NULL)
      );
  END IF;
END;
$$;

-- The delivery address must be one of THIS customer's own addresses. Written
-- as a trigger rather than a foreign key to stay with the convention this
-- schema already uses for cross-schema references (pif.trg_validate_customer_ref
-- and shared.assert_customer_exists) — and it checks something a foreign key
-- could not: ownership.
CREATE OR REPLACE FUNCTION pif.trg_validate_order_address()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_address_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM shared.customer_addresses a
        WHERE a.id = NEW.delivery_address_id AND a.customer_id = NEW.customer_id
     ) THEN
    RAISE EXCEPTION 'pif.orders: address % does not belong to customer %',
      NEW.delivery_address_id, NEW.customer_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_address_valid ON pif.orders;
CREATE TRIGGER order_address_valid
  BEFORE INSERT OR UPDATE OF delivery_address_id, customer_id ON pif.orders
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_order_address();

ALTER TABLE pif.order_items
  -- The catalogue, frozen. Everything a historical order needs to be read
  -- back, without consulting a product row that may since have changed.
  ADD COLUMN IF NOT EXISTS sku            text,
  ADD COLUMN IF NOT EXISTS product_name   text,
  ADD COLUMN IF NOT EXISTS brand          text,
  ADD COLUMN IF NOT EXISTS unit           text,
  ADD COLUMN IF NOT EXISTS pack_size      numeric(12,3),
  ADD COLUMN IF NOT EXISTS pack_unit      text,
  ADD COLUMN IF NOT EXISTS tax_rate_name  text,
  ADD COLUMN IF NOT EXISTS tax_rate_pct   numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct   numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discount  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_tax       numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total     numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_order_items_money_chk') THEN
    ALTER TABLE pif.order_items
      ADD CONSTRAINT pif_order_items_money_chk CHECK (
        tax_rate_pct >= 0 AND discount_pct >= 0 AND discount_pct <= 100
        AND line_subtotal >= 0 AND line_discount >= 0 AND line_tax >= 0 AND line_total >= 0
        -- The arithmetic itself, enforced: a line cannot be stored with a
        -- total that does not follow from its own quantity and price.
        AND line_subtotal = round(qty * unit_price, 2)
        AND line_total    = round(line_subtotal - line_discount + line_tax, 2)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pif_order_items_snapshot_chk') THEN
    ALTER TABLE pif.order_items
      ADD CONSTRAINT pif_order_items_snapshot_chk CHECK (
        sku IS NOT NULL AND product_name IS NOT NULL AND unit IS NOT NULL
      );
  END IF;
END;
$$;

-- An order's header must agree with its own lines. Checked at COMMIT, because
-- the header is inserted before the lines it totals.
CREATE OR REPLACE FUNCTION pif.trg_assert_order_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target  uuid;
  o       record;
  s       record;
BEGIN
  -- IF rather than CASE: plpgsql resolves every branch of a CASE
  -- expression against the trigger's own NEW record, and NEW has no
  -- order_id when this fires on pif.orders.
  IF TG_TABLE_NAME = 'orders' THEN
    target := NEW.id;
  ELSE
    target := NEW.order_id;
  END IF;

  SELECT id, subtotal, discount_total, tax_total, total INTO o
    FROM pif.orders WHERE id = target;
  IF NOT FOUND THEN
    RETURN NULL;  -- the order was rolled away in the same transaction
  END IF;

  SELECT count(*)                            AS lines,
         coalesce(sum(line_subtotal), 0)      AS subtotal,
         coalesce(sum(line_discount), 0)      AS discount_total,
         coalesce(sum(line_tax), 0)           AS tax_total,
         coalesce(sum(line_total), 0)         AS total
    INTO s
    FROM pif.order_items WHERE order_id = target;

  IF s.lines = 0 THEN
    RAISE EXCEPTION 'pif.orders %: an order must have at least one line', target
      USING ERRCODE = 'check_violation';
  END IF;

  IF o.subtotal <> s.subtotal OR o.discount_total <> s.discount_total
     OR o.tax_total <> s.tax_total OR o.total <> s.total THEN
    RAISE EXCEPTION 'pif.orders %: header totals (%, %, %, %) disagree with its lines (%, %, %, %)',
      target, o.subtotal, o.discount_total, o.tax_total, o.total,
      s.subtotal, s.discount_total, s.tax_total, s.total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_totals_agree ON pif.orders;
CREATE CONSTRAINT TRIGGER order_totals_agree
  AFTER INSERT ON pif.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pif.trg_assert_order_totals();

DROP TRIGGER IF EXISTS order_item_totals_agree ON pif.order_items;
CREATE CONSTRAINT TRIGGER order_item_totals_agree
  AFTER INSERT ON pif.order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pif.trg_assert_order_totals();

-- ===========================================================================
-- 3. pif.order_events — the only way an order's status moves
-- ===========================================================================

CREATE TABLE IF NOT EXISTS pif.order_events (
  id               uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  order_id         uuid        NOT NULL,
  order_number     text        NOT NULL,
  sequence_no      integer     NOT NULL,
  event_type       text        NOT NULL,
  status           text,
  reason           text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      uuid,
  recorded_by_role text        NOT NULL,
  notes            text,
  CONSTRAINT pif_order_events_pk PRIMARY KEY (id),
  CONSTRAINT pif_order_events_order_fk FOREIGN KEY (order_id) REFERENCES pif.orders (id),
  -- The concurrency guard. Two staff members acting in the same instant
  -- compute the same next sequence number; exactly one of them can store it.
  CONSTRAINT pif_order_events_seq_uq UNIQUE (order_id, sequence_no),
  CONSTRAINT pif_order_events_seq_chk CHECK (sequence_no > 0),
  CONSTRAINT pif_order_events_type_chk CHECK (event_type IN ('PLACEMENT', 'STATUS', 'COD', 'NOTE')),
  CONSTRAINT pif_order_events_status_chk CHECK (
    (event_type IN ('PLACEMENT', 'STATUS', 'COD')) = (status IS NOT NULL)
  ),
  CONSTRAINT pif_order_events_status_value_chk CHECK (
    status IS NULL OR status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY_PICKED',
                                 'OUT_FOR_DELIVERY', 'DELIVERED', 'COD_COLLECTED',
                                 'SALE_FINALIZED', 'CANCELLED', 'NOT_DELIVERED')
  ),
  -- An order that did not complete says why, in words, every time.
  CONSTRAINT pif_order_events_reason_chk CHECK (
    status IS NULL OR status NOT IN ('CANCELLED', 'NOT_DELIVERED')
    OR (reason IS NOT NULL AND length(btrim(reason)) >= 3)
  ),
  -- Either a person acted, or the system did. Never neither, never both.
  CONSTRAINT pif_order_events_actor_chk CHECK (
    (recorded_by IS NULL) = (recorded_by_role = 'SYSTEM')
  ),
  CONSTRAINT pif_order_events_role_chk CHECK (length(btrim(recorded_by_role)) > 0)
);

CREATE INDEX IF NOT EXISTS pif_order_events_order_idx ON pif.order_events (order_id, sequence_no);
CREATE INDEX IF NOT EXISTS pif_order_events_recorded_idx ON pif.order_events (recorded_at DESC);

-- The first event of an order is its placement, and placement is first.
CREATE OR REPLACE FUNCTION pif.trg_validate_order_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
BEGIN
  SELECT status INTO current_status FROM pif.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pif.order_events: order % does not exist', NEW.order_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.event_type = 'PLACEMENT' THEN
    IF NEW.sequence_no <> 1 OR NEW.status <> 'PLACED' THEN
      RAISE EXCEPTION 'pif.order_events: a PLACEMENT event must be sequence 1 with status PLACED'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.sequence_no = 1 THEN
    RAISE EXCEPTION 'pif.order_events: the first event of an order must be its PLACEMENT'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Nothing may be recorded against an order that has finished for good.
  IF current_status IN ('CANCELLED', 'NOT_DELIVERED', 'SALE_FINALIZED')
     AND NEW.event_type <> 'NOTE' THEN
    RAISE EXCEPTION 'pif.order_events: order % is % — no further operational event is possible',
      NEW.order_number, current_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_event_valid ON pif.order_events;
CREATE TRIGGER order_event_valid
  BEFORE INSERT ON pif.order_events
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_order_event();

-- The projection. SECURITY DEFINER because the application holds no UPDATE on
-- pif.orders at all (section 5): a status can only come from an event, so the
-- status and the history can never disagree. The legality of the move itself
-- is NOT decided here — the UPDATE below passes through the Phase 2 trigger
-- pif.trg_validate_order_status_transition, which remains the authority.
CREATE OR REPLACE FUNCTION pif.trg_apply_order_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pif, shared
AS $$
BEGIN
  IF NEW.status IS NULL THEN
    RETURN NULL;   -- a NOTE records words, never a state
  END IF;

  UPDATE pif.orders
     SET status              = NEW.status,
         placed_at           = CASE WHEN NEW.status = 'PLACED'           THEN coalesce(placed_at, NEW.recorded_at) ELSE placed_at END,
         accepted_at         = CASE WHEN NEW.status = 'ACCEPTED'         THEN NEW.recorded_at ELSE accepted_at END,
         preparing_at        = CASE WHEN NEW.status = 'PREPARING'        THEN NEW.recorded_at ELSE preparing_at END,
         ready_at            = CASE WHEN NEW.status = 'READY_PICKED'     THEN NEW.recorded_at ELSE ready_at END,
         out_for_delivery_at = CASE WHEN NEW.status = 'OUT_FOR_DELIVERY' THEN NEW.recorded_at ELSE out_for_delivery_at END,
         delivered_at        = CASE WHEN NEW.status = 'DELIVERED'        THEN NEW.recorded_at ELSE delivered_at END,
         cod_collected_at    = CASE WHEN NEW.status = 'COD_COLLECTED'    THEN NEW.recorded_at ELSE cod_collected_at END,
         cancelled_at        = CASE WHEN NEW.status = 'CANCELLED'        THEN NEW.recorded_at ELSE cancelled_at END,
         not_delivered_at    = CASE WHEN NEW.status = 'NOT_DELIVERED'    THEN NEW.recorded_at ELSE not_delivered_at END,
         updated_at          = now()
   WHERE id = NEW.order_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS apply_order_event ON pif.order_events;
CREATE TRIGGER apply_order_event
  AFTER INSERT ON pif.order_events
  FOR EACH ROW EXECUTE FUNCTION pif.trg_apply_order_event();

-- History is written once.
CREATE OR REPLACE FUNCTION pif.trg_order_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pif.order_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS order_events_append_only ON pif.order_events;
CREATE TRIGGER order_events_append_only
  BEFORE UPDATE OR DELETE ON pif.order_events
  FOR EACH ROW EXECUTE FUNCTION pif.trg_order_events_append_only();

-- So is an order line: a placed order's contents are historical record.
CREATE OR REPLACE FUNCTION pif.trg_order_items_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pif.order_items is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS order_items_append_only ON pif.order_items;
CREATE TRIGGER order_items_append_only
  BEFORE UPDATE OR DELETE ON pif.order_items
  FOR EACH ROW EXECUTE FUNCTION pif.trg_order_items_append_only();

-- ===========================================================================
-- 4. Permissions — two new PIF codes, and SUPER_ADMIN's explicit grants
-- ===========================================================================

INSERT INTO shared.permissions (code, module, description) VALUES
  ('pif.order.manage',  'pif', 'Manage PIF customer orders: accept, cancel and record handover.'),
  ('pif.order.prepare', 'pif', 'View and prepare PIF customer orders for handover.')
ON CONFLICT (code) DO NOTHING;

-- PIF_ADMIN runs the PIF order desk. PIF_CASHIER (authorized PIF staff)
-- prepares orders and nothing else. Neither gains anything in RIK.
INSERT INTO shared.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM shared.roles r
  JOIN shared.permissions p ON p.code = ANY (ARRAY['pif.order.manage', 'pif.order.prepare'])
 WHERE r.name = 'PIF_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO shared.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM shared.roles r
  JOIN shared.permissions p ON p.code = 'pif.order.prepare'
 WHERE r.name = 'PIF_CASHIER'
ON CONFLICT DO NOTHING;

-- SUPER_ADMIN — "overall boss of both entities" — now holds BOTH modules
-- EXPLICITLY, as rows. Until this migration it held only shared.* codes, so
-- every rik.* and pif.* route refused it: authorization was never inferred
-- from the role's name, and this is the fix for that, not an exception to it.
--
-- The four superseded codes are deliberately NOT granted: pif.pos.open_bill,
-- pif.pos.finalize_bill, pif.pos.return and pif.purchase_order.approve
-- govern a point of sale and a purchasing workflow that the corrected PIF
-- scope says will never exist. Granting them would advertise functionality
-- this application does not have.
INSERT INTO shared.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM shared.roles r
  JOIN shared.permissions p
    ON p.module IN ('rik', 'pif')
   AND p.code NOT IN ('pif.pos.open_bill', 'pif.pos.finalize_bill',
                      'pif.pos.return', 'pif.purchase_order.approve')
 WHERE r.name = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 5. Privileges — the application cannot rewrite an order or its history
-- ===========================================================================

GRANT SELECT, INSERT ON pif.order_events TO app_pif;

-- shared.idempotency_keys has existed since Phase 2 and carried no
-- application grant, because nothing had used it yet. PIF checkout is the
-- first caller: a key is claimed inside the placing transaction, against the
-- table's own UNIQUE index, so a double tap cannot produce two orders.
-- SELECT and INSERT only — a claimed key is never rewritten or released.
GRANT SELECT, INSERT ON shared.idempotency_keys TO app_shared;
REVOKE UPDATE, DELETE ON shared.idempotency_keys FROM app_shared;
GRANT SELECT ON pif.order_events TO app_reporting_pif;

-- 0018's ALTER DEFAULT PRIVILEGES hands app_pif SELECT/INSERT/UPDATE/DELETE
-- on every new pif table, so narrowing needs an explicit revoke (the
-- precedent is 0023).
REVOKE UPDATE, DELETE ON pif.order_events FROM app_pif;

-- An order's status comes from an event, never from an UPDATE; its lines and
-- its amounts are historical record; and nothing deletes either.
REVOKE UPDATE, DELETE ON pif.orders FROM app_pif;
REVOKE UPDATE, DELETE ON pif.order_items FROM app_pif;

-- Catalogue rows are deactivated, never deleted — an order's product must
-- remain readable for as long as the order exists.
REVOKE DELETE ON pif.products FROM app_pif;
REVOKE DELETE ON pif.categories FROM app_pif;

-- ===========================================================================
-- 6. Verification — this migration fails loudly rather than half-applying
-- ===========================================================================

DO $$
DECLARE
  n integer;
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'pif' AND tablename = 'order_events') THEN
    RAISE EXCEPTION 'Migration 0050: pif.order_events was not created.';
  END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  IF n <> 66 THEN
    RAISE EXCEPTION 'Migration 0050: expected 66 tables, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_views WHERE schemaname IN ('shared', 'rik', 'pif');
  IF n <> 5 THEN
    RAISE EXCEPTION 'Migration 0050: expected 5 views, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_tables WHERE schemaname = 'pif';
  IF n <> 21 THEN
    RAISE EXCEPTION 'Migration 0050: pif should hold 21 tables, found %.', n;
  END IF;

  -- The new catalogue and money columns must all exist.
  FOREACH t IN ARRAY ARRAY['brand', 'description', 'pack_size', 'pack_unit', 'max_order_qty',
                           'available', 'variant_group', 'variant_label'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'pif' AND table_name = 'products' AND column_name = t) THEN
      RAISE EXCEPTION 'Migration 0050: pif.products.% is missing.', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['subtotal', 'discount_total', 'tax_total', 'total',
                           'fulfillment_mode', 'payment_method', 'delivery_address_snapshot'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'pif' AND table_name = 'orders' AND column_name = t) THEN
      RAISE EXCEPTION 'Migration 0050: pif.orders.% is missing.', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['sku', 'product_name', 'unit', 'tax_rate_pct',
                           'line_subtotal', 'line_tax', 'line_total'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'pif' AND table_name = 'order_items' AND column_name = t) THEN
      RAISE EXCEPTION 'Migration 0050: pif.order_items.% is missing.', t;
    END IF;
  END LOOP;

  -- The application must not be able to move a status or rewrite history.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'pif' AND table_name IN ('orders', 'order_items', 'order_events')
       AND grantee = 'app_pif' AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Migration 0050: app_pif must hold no UPDATE or DELETE on orders, order_items or order_events.';
  END IF;

  -- The idempotency facility must be reachable, and append-only.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'shared' AND table_name = 'idempotency_keys'
       AND grantee = 'app_shared' AND privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Migration 0050: app_shared must hold INSERT on shared.idempotency_keys.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'shared' AND table_name = 'idempotency_keys'
       AND grantee = 'app_shared' AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Migration 0050: idempotency keys must be append-only for app_shared.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'pif' AND p.proname = 'trg_apply_order_event' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Migration 0050: the order status projection must be SECURITY DEFINER.';
  END IF;

  -- The Phase 2 transition trigger must still be the authority on the graph.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'pif.orders'::regclass
       AND tgname = 'validate_status_transition' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 0050: pif.orders lost its status-transition trigger.';
  END IF;

  -- Roles: six, still. Permissions: the two PIF codes added, nothing else.
  SELECT count(*) INTO n FROM shared.roles;
  IF n <> 6 THEN RAISE EXCEPTION 'Migration 0050: expected 6 roles, found %.', n; END IF;
  IF EXISTS (SELECT 1 FROM shared.roles WHERE name = 'PURCHASING') THEN
    RAISE EXCEPTION 'Migration 0050: a PURCHASING role exists; it must not.';
  END IF;
  SELECT count(*) INTO n FROM shared.permissions;
  IF n <> 22 THEN RAISE EXCEPTION 'Migration 0050: expected 22 permissions, found %.', n; END IF;
  SELECT count(*) INTO n FROM shared.permissions WHERE module = 'rik';
  IF n <> 7 THEN RAISE EXCEPTION 'Migration 0050: the rik.* permission set moved — % codes.', n; END IF;

  -- SUPER_ADMIN must now hold both modules, explicitly.
  SELECT count(*) INTO n
    FROM shared.roles r
    JOIN shared.role_permissions rp ON rp.role_id = r.id
    JOIN shared.permissions p ON p.id = rp.permission_id
   WHERE r.name = 'SUPER_ADMIN' AND p.module = 'rik';
  IF n <> 7 THEN RAISE EXCEPTION 'Migration 0050: SUPER_ADMIN holds % rik permissions, expected 7.', n; END IF;
  SELECT count(*) INTO n
    FROM shared.roles r
    JOIN shared.role_permissions rp ON rp.role_id = r.id
    JOIN shared.permissions p ON p.id = rp.permission_id
   WHERE r.name = 'SUPER_ADMIN' AND p.module = 'pif';
  IF n <> 6 THEN RAISE EXCEPTION 'Migration 0050: SUPER_ADMIN holds % pif permissions, expected 6.', n; END IF;

  -- RIK_ADMIN gains no PIF, PIF_ADMIN gains no RIK.
  IF EXISTS (
    SELECT 1 FROM shared.roles r
      JOIN shared.role_permissions rp ON rp.role_id = r.id
      JOIN shared.permissions p ON p.id = rp.permission_id
     WHERE r.name = 'RIK_ADMIN' AND p.module = 'pif'
  ) THEN
    RAISE EXCEPTION 'Migration 0050: RIK_ADMIN must hold no pif permission.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shared.roles r
      JOIN shared.role_permissions rp ON rp.role_id = r.id
      JOIN shared.permissions p ON p.id = rp.permission_id
     WHERE r.name = 'PIF_ADMIN' AND p.module = 'rik'
  ) THEN
    RAISE EXCEPTION 'Migration 0050: PIF_ADMIN must hold no rik permission.';
  END IF;

  -- The RIK baseline, untouched.
  SELECT count(*) INTO n FROM rik.entitlement_pools;
  IF n <> 18 THEN RAISE EXCEPTION 'Migration 0050: expected 18 RIK pools, found %.', n; END IF;
  SELECT count(*) INTO n FROM rik.provisions;
  IF n <> 189 THEN RAISE EXCEPTION 'Migration 0050: expected 189 provisions, found %.', n; END IF;
  SELECT count(*) INTO n FROM rik.pool_scales;
  IF n <> 50 THEN RAISE EXCEPTION 'Migration 0050: expected 50 scales, found %.', n; END IF;
  SELECT count(image_ref) INTO n FROM rik.entitlement_pools;
  IF n <> 18 THEN RAISE EXCEPTION 'Migration 0050: the 18 RIK category covers moved.'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'rik' AND table_name = 'issue_vouchers'
       AND grantee = 'app_rik' AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Migration 0050: RIK voucher privileges changed.';
  END IF;

  -- Nothing here may have introduced a PIF stock quantity.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pif' AND table_name = 'products'
                AND column_name IN ('stock_qty', 'on_hand', 'quantity_available')) THEN
    RAISE EXCEPTION 'Migration 0050: a stock quantity column was introduced on pif.products; it must not be.';
  END IF;
END;
$$;

RESET ROLE;
