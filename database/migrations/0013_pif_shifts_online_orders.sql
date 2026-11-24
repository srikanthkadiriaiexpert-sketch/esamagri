-- =============================================================================
-- Migration 0013: pif.cashier_shifts, pif.carts, pif.cart_items, pif.orders,
--                  pif.order_items
-- Phase 2 Rev1 Section 06, 17, 19, 21.
--
-- Ordering note: built ahead of pos_bills/pos_bill_items/cash_movements
-- (originally slated for 0013 in the task plan) purely for FK dependency —
-- pif.pos_bills.online_order_id references pif.orders.id, and
-- pif.cash_movements references both pos_bills and pif.orders, so orders
-- must exist first. No architecture change; table set and columns are
-- exactly Phase 2 Rev1's.
-- =============================================================================

CREATE TABLE pif.cashier_shifts (
  id              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  cashier_id      uuid          NOT NULL,
  opened_at       timestamptz   NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opening_cash    numeric(12,2) NOT NULL,
  expected_cash   numeric(12,2),
  counted_cash    numeric(12,2),
  variance        numeric(12,2),
  status          text          NOT NULL DEFAULT 'OPEN',
  CONSTRAINT pif_cashier_shifts_pk PRIMARY KEY (id),
  CONSTRAINT pif_cashier_shifts_status_chk CHECK (status IN ('OPEN','CLOSED')),
  CONSTRAINT pif_cashier_shifts_opening_chk CHECK (opening_cash >= 0)
);
CREATE INDEX pif_cashier_shifts_cashier_idx ON pif.cashier_shifts (cashier_id);
CREATE UNIQUE INDEX pif_cashier_shifts_one_open_uq ON pif.cashier_shifts (cashier_id) WHERE status = 'OPEN';
COMMENT ON COLUMN pif.cashier_shifts.cashier_id IS 'shared.users.id, trigger-validated (migration 0016), same pattern as customer references.';
COMMENT ON COLUMN pif.cashier_shifts.expected_cash IS 'Revision 1: computed and snapshotted at close as opening_cash + SUM(cash_movements.amount WHERE movement_type IN (CASH_SALE,CASH_IN)) - SUM(... WHERE movement_type IN (CASH_REFUND,CASH_OUT)) for this shift_id — sourced from pif.cash_movements, not derived ad hoc from pos_bills (Section 21).';
COMMENT ON COLUMN pif.cashier_shifts.variance IS 'counted_cash - expected_cash.';

CREATE TABLE pif.carts (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id   uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'OPEN',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pif_carts_pk PRIMARY KEY (id),
  CONSTRAINT pif_carts_status_chk CHECK (status IN ('OPEN','CHECKED_OUT','ABANDONED'))
);
CREATE UNIQUE INDEX pif_carts_one_open_uq ON pif.carts (customer_id) WHERE status = 'OPEN';
COMMENT ON TABLE pif.carts IS 'Same pattern as rik.carts — completely separate table, no shared rows with RIK''s cart (Section 06).';

CREATE TABLE pif.cart_items (
  id          uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  cart_id     uuid          NOT NULL,
  product_id  uuid          NOT NULL,
  qty         numeric(12,3) NOT NULL,
  CONSTRAINT pif_cart_items_pk PRIMARY KEY (id),
  CONSTRAINT pif_cart_items_cart_fk FOREIGN KEY (cart_id) REFERENCES pif.carts (id),
  CONSTRAINT pif_cart_items_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_cart_items_qty_chk CHECK (qty > 0),
  CONSTRAINT pif_cart_items_uq UNIQUE (cart_id, product_id)
);

CREATE TABLE pif.orders (
  id                      uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  order_number            text          NOT NULL,
  customer_id             uuid          NOT NULL,
  delivery_address_id     uuid,
  status                  text          NOT NULL DEFAULT 'PLACED',
  placed_at               timestamptz,
  accepted_at             timestamptz,
  delivered_at            timestamptz,
  cod_collected_at        timestamptz,
  finalized_at            timestamptz,
  cancelled_at            timestamptz,
  cod_amount              numeric(12,2),
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pif_orders_pk PRIMARY KEY (id),
  CONSTRAINT pif_orders_number_uq UNIQUE (order_number),
  CONSTRAINT pif_orders_status_chk CHECK (status IN ('PLACED','ACCEPTED','PREPARING','READY_PICKED','OUT_FOR_DELIVERY','DELIVERED','COD_COLLECTED','SALE_FINALIZED','CANCELLED','NOT_DELIVERED')),
  CONSTRAINT pif_orders_cod_amount_chk CHECK (cod_amount IS NULL OR cod_amount >= 0)
);
CREATE INDEX pif_orders_customer_idx ON pif.orders (customer_id);
CREATE INDEX pif_orders_status_idx ON pif.orders (status);
COMMENT ON COLUMN pif.orders.customer_id IS 'App/trigger-validated against shared.customers, not a physical FK.';
COMMENT ON COLUMN pif.orders.delivery_address_id IS 'References shared.customer_addresses.id via the same app-validated pattern; defaults to the customer''s is_default address. Not a physical FK (cross-schema).';
COMMENT ON TABLE pif.orders IS 'Revision 1: no bill_id column. pif.pos_bills.online_order_id is the single authoritative 1:1 link between an online order and its bill (Section 06, 11, 19, 26) — do NOT recreate pif.orders.bill_id.';

CREATE TABLE pif.order_items (
  id                              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  order_id                        uuid          NOT NULL,
  product_id                      uuid          NOT NULL,
  qty                             numeric(12,3) NOT NULL,
  unit_price                      numeric(12,2) NOT NULL,
  inventory_reserve_txn_id        uuid,
  CONSTRAINT pif_order_items_pk PRIMARY KEY (id),
  CONSTRAINT pif_order_items_order_fk FOREIGN KEY (order_id) REFERENCES pif.orders (id),
  CONSTRAINT pif_order_items_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_order_items_inv_txn_fk FOREIGN KEY (inventory_reserve_txn_id) REFERENCES pif.inventory_transactions (id),
  CONSTRAINT pif_order_items_qty_chk CHECK (qty > 0),
  CONSTRAINT pif_order_items_price_chk CHECK (unit_price >= 0),
  CONSTRAINT pif_order_items_uq UNIQUE (order_id, product_id)
);
CREATE INDEX pif_order_items_order_idx ON pif.order_items (order_id);
COMMENT ON COLUMN pif.order_items.unit_price IS 'Snapshot at placement — never re-reads products.selling_price later.';
COMMENT ON COLUMN pif.order_items.inventory_reserve_txn_id IS 'The RESERVE row created at PLACED (Section 19).';
