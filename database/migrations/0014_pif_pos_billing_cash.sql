-- =============================================================================
-- Migration 0014: pif.pos_bills, pif.pos_bill_items, pif.cash_movements
-- Phase 2 Rev1 Section 06, 18, 21.
-- pos_bills unifies COUNTER and ONLINE sales in one table (Section 18/28).
-- cash_movements (NEW — Revision 1) is the append-only cash ledger behind
-- the entire cash/COD model (Section 21).
-- =============================================================================

CREATE TABLE pif.pos_bills (
  id                  uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  bill_number         text          NOT NULL,
  source              text          NOT NULL,
  shift_id            uuid,
  cashier_id          uuid,
  customer_id         uuid,
  online_order_id     uuid,
  status              text          NOT NULL DEFAULT 'OPEN',
  subtotal            numeric(12,2) NOT NULL DEFAULT 0,
  discount_total       numeric(12,2) NOT NULL DEFAULT 0,
  tax_total           numeric(12,2) NOT NULL DEFAULT 0,
  grand_total         numeric(12,2) NOT NULL DEFAULT 0,
  cash_received       numeric(12,2),
  change_given        numeric(12,2),
  finalized_at        timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pif_pos_bills_pk PRIMARY KEY (id),
  CONSTRAINT pif_pos_bills_number_uq UNIQUE (bill_number),
  CONSTRAINT pif_pos_bills_shift_fk FOREIGN KEY (shift_id) REFERENCES pif.cashier_shifts (id),
  CONSTRAINT pif_pos_bills_online_order_fk FOREIGN KEY (online_order_id) REFERENCES pif.orders (id),
  CONSTRAINT pif_pos_bills_online_order_uq UNIQUE (online_order_id),
  CONSTRAINT pif_pos_bills_source_chk CHECK (source IN ('COUNTER','ONLINE')),
  CONSTRAINT pif_pos_bills_status_chk CHECK (status IN ('OPEN','FINALIZED','CANCELLED','RETURNED')),
  CONSTRAINT pif_pos_bills_grand_total_chk CHECK (grand_total >= 0),
  CONSTRAINT pif_pos_bills_source_shift_chk CHECK (
    (source = 'COUNTER' AND shift_id IS NOT NULL AND cashier_id IS NOT NULL) OR
    (source = 'ONLINE'  AND shift_id IS NULL      AND online_order_id IS NOT NULL)
  )
);
CREATE INDEX pif_pos_bills_source_idx ON pif.pos_bills (source);
CREATE INDEX pif_pos_bills_status_idx ON pif.pos_bills (status);
CREATE INDEX pif_pos_bills_customer_idx ON pif.pos_bills (customer_id);
CREATE INDEX pif_pos_bills_finalized_at_idx ON pif.pos_bills (finalized_at);
COMMENT ON COLUMN pif.pos_bills.cashier_id IS 'shared.users.id, required for COUNTER; app/trigger-validated, not a physical FK.';
COMMENT ON COLUMN pif.pos_bills.customer_id IS 'Null allowed for an anonymous counter sale; always set for ONLINE. App/trigger-validated, not a physical FK.';
COMMENT ON COLUMN pif.pos_bills.online_order_id IS 'Set only when source=ONLINE — the single authoritative direction of the order<->bill relationship (Revision 1); pif.orders carries no reciprocal bill_id.';
COMMENT ON TABLE pif.pos_bills IS 'The single source of truth for "what did PIF sell" (Section 18/28). Only FINALIZED bills count as a completed sale.';

CREATE TABLE pif.pos_bill_items (
  id                  uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  bill_id             uuid          NOT NULL,
  product_id          uuid          NOT NULL,
  qty                 numeric(12,3) NOT NULL,
  unit_price          numeric(12,2) NOT NULL,
  discount_amt        numeric(12,2) NOT NULL DEFAULT 0,
  tax_amt             numeric(12,2) NOT NULL DEFAULT 0,
  line_total          numeric(12,2) NOT NULL,
  inventory_txn_id    uuid,
  CONSTRAINT pif_pos_bill_items_pk PRIMARY KEY (id),
  CONSTRAINT pif_pos_bill_items_bill_fk FOREIGN KEY (bill_id) REFERENCES pif.pos_bills (id),
  CONSTRAINT pif_pos_bill_items_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_pos_bill_items_inv_txn_fk FOREIGN KEY (inventory_txn_id) REFERENCES pif.inventory_transactions (id),
  CONSTRAINT pif_pos_bill_items_qty_chk CHECK (qty > 0),
  CONSTRAINT pif_pos_bill_items_price_chk CHECK (unit_price >= 0),
  CONSTRAINT pif_pos_bill_items_discount_chk CHECK (discount_amt >= 0),
  CONSTRAINT pif_pos_bill_items_tax_chk CHECK (tax_amt >= 0),
  CONSTRAINT pif_pos_bill_items_line_total_chk CHECK (line_total >= 0)
);
CREATE INDEX pif_pos_bill_items_bill_idx ON pif.pos_bill_items (bill_id);
COMMENT ON COLUMN pif.pos_bill_items.unit_price IS 'Snapshot at sale time — never re-reads products.selling_price later.';
COMMENT ON COLUMN pif.pos_bill_items.inventory_txn_id IS 'The SALE row this line created.';

CREATE TABLE pif.cash_movements (
  id              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  movement_type   text          NOT NULL,
  amount          numeric(12,2) NOT NULL,
  shift_id        uuid,
  bill_id         uuid,
  order_id        uuid,
  handled_by      uuid          NOT NULL,
  recorded_at     timestamptz   NOT NULL DEFAULT now(),
  notes           text,
  CONSTRAINT pif_cash_movements_pk PRIMARY KEY (id),
  CONSTRAINT pif_cash_movements_shift_fk FOREIGN KEY (shift_id) REFERENCES pif.cashier_shifts (id),
  CONSTRAINT pif_cash_movements_bill_fk FOREIGN KEY (bill_id) REFERENCES pif.pos_bills (id),
  CONSTRAINT pif_cash_movements_order_fk FOREIGN KEY (order_id) REFERENCES pif.orders (id),
  CONSTRAINT pif_cash_movements_type_chk CHECK (movement_type IN ('CASH_SALE','CASH_REFUND','COD_COLLECTED','CASH_IN','CASH_OUT')),
  CONSTRAINT pif_cash_movements_amount_chk CHECK (amount > 0)
);
CREATE INDEX pif_cash_movements_shift_recorded_idx ON pif.cash_movements (shift_id, recorded_at);
CREATE INDEX pif_cash_movements_type_shift_idx ON pif.cash_movements (movement_type, shift_id);
CREATE UNIQUE INDEX pif_cash_movements_cod_order_uq ON pif.cash_movements (order_id) WHERE movement_type = 'COD_COLLECTED';
COMMENT ON COLUMN pif.cash_movements.amount IS 'Always a positive magnitude; direction is carried by movement_type (SALE/COD/IN increase the till or cash-in-hand, REFUND/OUT decrease it).';
COMMENT ON COLUMN pif.cash_movements.shift_id IS 'Set for counter-originated movements (CASH_SALE, in-shift CASH_REFUND, CASH_IN, CASH_OUT); null for COD_COLLECTED, which happens at a delivery, not a till.';
COMMENT ON COLUMN pif.cash_movements.bill_id IS 'Set for CASH_SALE/CASH_REFUND — which bill this cash movement belongs to.';
COMMENT ON COLUMN pif.cash_movements.order_id IS 'Set for COD_COLLECTED — which order this COD collection answers for; UQ(order_id) WHERE movement_type=COD_COLLECTED guarantees one COD collection event per order (duplicate-prevention, Section 12).';
COMMENT ON COLUMN pif.cash_movements.handled_by IS 'The cashier or delivery-staff shared.users.id who physically handled this cash — DB-enforced via trigger validation (migration 0016), not a physical FK.';
COMMENT ON TABLE pif.cash_movements IS 'Append-only cash ledger — every rupee that physically moves, in either direction, across a counter till or a delivery handover, is one row here. Same append-only pattern as entitlement_ledger and both inventory_transactions tables (Section 21).';
