-- =============================================================================
-- Migration 0012: pif.suppliers, purchase_orders, purchase_order_items,
--                  goods_receipts, goods_receipt_items
-- Phase 2 Rev1 Section 06, 20.
-- suppliers -> purchase_orders -> purchase_order_items -> goods_receipts ->
-- goods_receipt_items -> inventory_transactions (RECEIVE).
-- Goods-receipt posting (insert goods_receipt_items, insert the matching
-- inventory_transactions RECEIVE row, increment pif.inventory.quantity_on_hand,
-- update purchase_orders.status if fully received, audit) is one application
-- transaction, same convention as rik.inventory_transactions (migration 0007):
-- no DB trigger rewrites the balance automatically.
-- =============================================================================

CREATE TABLE pif.suppliers (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  name          text        NOT NULL,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  status        text        NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT pif_suppliers_pk PRIMARY KEY (id),
  CONSTRAINT pif_suppliers_status_chk CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX pif_suppliers_name_idx ON pif.suppliers (name);
COMMENT ON COLUMN pif.suppliers.deleted_at IS 'Soft delete — historical purchase_orders still resolve the supplier (Section 06).';

CREATE TABLE pif.purchase_orders (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  po_number     text        NOT NULL,
  supplier_id   uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'DRAFT',
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  CONSTRAINT pif_po_pk PRIMARY KEY (id),
  CONSTRAINT pif_po_number_uq UNIQUE (po_number),
  CONSTRAINT pif_po_supplier_fk FOREIGN KEY (supplier_id) REFERENCES pif.suppliers (id),
  CONSTRAINT pif_po_status_chk CHECK (status IN ('DRAFT','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'))
);
CREATE INDEX pif_po_supplier_idx ON pif.purchase_orders (supplier_id);
CREATE INDEX pif_po_status_idx ON pif.purchase_orders (status);
COMMENT ON COLUMN pif.purchase_orders.created_by IS 'Attribution only, references shared.users.id — not trigger-validated in V1 per Phase 2 Section 12 (audit-trail field, not an integrity-critical join).';

CREATE TABLE pif.purchase_order_items (
  id            uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  po_id         uuid          NOT NULL,
  product_id    uuid          NOT NULL,
  ordered_qty   numeric(12,3) NOT NULL,
  unit_cost     numeric(12,2) NOT NULL,
  CONSTRAINT pif_po_items_pk PRIMARY KEY (id),
  CONSTRAINT pif_po_items_po_fk FOREIGN KEY (po_id) REFERENCES pif.purchase_orders (id),
  CONSTRAINT pif_po_items_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_po_items_qty_chk CHECK (ordered_qty > 0),
  CONSTRAINT pif_po_items_cost_chk CHECK (unit_cost >= 0),
  CONSTRAINT pif_po_items_uq UNIQUE (po_id, product_id)
);
CREATE INDEX pif_po_items_po_idx ON pif.purchase_order_items (po_id);

CREATE TABLE pif.goods_receipts (
  id                uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  po_id             uuid        NOT NULL,
  receipt_number    text        NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  received_by       uuid,
  notes             text,
  CONSTRAINT pif_goods_receipts_pk PRIMARY KEY (id),
  CONSTRAINT pif_goods_receipts_number_uq UNIQUE (receipt_number),
  CONSTRAINT pif_goods_receipts_po_fk FOREIGN KEY (po_id) REFERENCES pif.purchase_orders (id)
);
CREATE INDEX pif_goods_receipts_po_idx ON pif.goods_receipts (po_id);
COMMENT ON COLUMN pif.goods_receipts.received_by IS 'Attribution only, references shared.users.id — not trigger-validated in V1 per Phase 2 Section 12.';

CREATE TABLE pif.goods_receipt_items (
  id                  uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  receipt_id          uuid          NOT NULL,
  product_id          uuid          NOT NULL,
  po_item_id          uuid          NOT NULL,
  received_qty        numeric(12,3) NOT NULL,
  unit_cost           numeric(12,2) NOT NULL,
  discrepancy_qty     numeric(12,3),
  inventory_txn_id    uuid,
  CONSTRAINT pif_gr_items_pk PRIMARY KEY (id),
  CONSTRAINT pif_gr_items_receipt_fk FOREIGN KEY (receipt_id) REFERENCES pif.goods_receipts (id),
  CONSTRAINT pif_gr_items_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_gr_items_po_item_fk FOREIGN KEY (po_item_id) REFERENCES pif.purchase_order_items (id),
  CONSTRAINT pif_gr_items_inv_txn_fk FOREIGN KEY (inventory_txn_id) REFERENCES pif.inventory_transactions (id),
  CONSTRAINT pif_gr_items_qty_chk CHECK (received_qty > 0),
  CONSTRAINT pif_gr_items_cost_chk CHECK (unit_cost >= 0)
);
CREATE INDEX pif_gr_items_receipt_idx ON pif.goods_receipt_items (receipt_id);
CREATE UNIQUE INDEX pif_gr_items_inv_txn_uq ON pif.goods_receipt_items (inventory_txn_id) WHERE inventory_txn_id IS NOT NULL;
COMMENT ON TABLE pif.goods_receipt_items IS 'unit_cost is captured per receipt and is the authoritative historical cost — never overwrites products.purchase_price, which is only a last-known-cost convenience field (Section 20). inventory_txn_id is nullable because the RECEIVE inventory_transactions row is inserted in the same posting transaction and linked back onto this row, not created in advance.';
