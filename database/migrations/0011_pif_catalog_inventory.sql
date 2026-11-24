-- =============================================================================
-- Migration 0011: pif.categories, tax_rates, products, inventory, inventory_transactions
-- Phase 2 Rev1 Section 06, 17.
-- =============================================================================

CREATE TABLE pif.categories (
  id          uuid    NOT NULL DEFAULT shared.uuid_generate_v7(),
  name        text    NOT NULL,
  parent_id   uuid,
  active      boolean NOT NULL DEFAULT true,
  CONSTRAINT pif_categories_pk PRIMARY KEY (id),
  CONSTRAINT pif_categories_parent_fk FOREIGN KEY (parent_id) REFERENCES pif.categories (id)
);
CREATE INDEX pif_categories_parent_idx ON pif.categories (parent_id);

CREATE TABLE pif.tax_rates (
  id          uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  name        text          NOT NULL,
  rate_pct    numeric(5,2)  NOT NULL,
  active      boolean       NOT NULL DEFAULT true,
  CONSTRAINT pif_tax_rates_pk PRIMARY KEY (id),
  CONSTRAINT pif_tax_rates_rate_chk CHECK (rate_pct >= 0)
);

CREATE TABLE pif.products (
  id              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  sku             text          NOT NULL,
  barcode         text,
  name            text          NOT NULL,
  category_id     uuid,
  unit            text          NOT NULL,
  purchase_price  numeric(12,2),
  selling_price   numeric(12,2) NOT NULL,
  tax_rate_id     uuid,
  discount_pct    numeric(5,2),
  image_ref       text,
  reorder_level   numeric(12,3),
  active          boolean       NOT NULL DEFAULT true,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT pif_products_pk PRIMARY KEY (id),
  CONSTRAINT pif_products_sku_uq UNIQUE (sku),
  CONSTRAINT pif_products_category_fk FOREIGN KEY (category_id) REFERENCES pif.categories (id),
  CONSTRAINT pif_products_tax_rate_fk FOREIGN KEY (tax_rate_id) REFERENCES pif.tax_rates (id),
  CONSTRAINT pif_products_selling_price_chk CHECK (selling_price >= 0),
  CONSTRAINT pif_products_discount_chk CHECK (discount_pct IS NULL OR discount_pct BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX pif_products_barcode_uq ON pif.products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX pif_products_category_idx ON pif.products (category_id);
CREATE INDEX pif_products_name_trgm_idx ON pif.products USING gin (name gin_trgm_ops);
COMMENT ON TABLE pif.products IS 'purchase_price is reference/last-known only — authoritative historical cost lives in goods_receipt_items (Section 20).';

CREATE TABLE pif.inventory (
  product_id          uuid          NOT NULL,
  quantity_on_hand    numeric(12,3) NOT NULL DEFAULT 0,
  quantity_reserved   numeric(12,3) NOT NULL DEFAULT 0,
  reorder_level       numeric(12,3),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pif_inventory_pk PRIMARY KEY (product_id),
  CONSTRAINT pif_inventory_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_inventory_on_hand_chk CHECK (quantity_on_hand >= 0),
  CONSTRAINT pif_inventory_reserved_chk CHECK (quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand)
);

CREATE TABLE pif.inventory_transactions (
  id                        uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  product_id                uuid          NOT NULL,
  type                      text          NOT NULL,
  qty                       numeric(12,3) NOT NULL,
  related_transaction_id    uuid,
  reference_type            text,
  reference_id              uuid,
  reason                    text,
  created_at                timestamptz   NOT NULL DEFAULT now(),
  created_by                uuid,
  CONSTRAINT pif_inv_txn_pk PRIMARY KEY (id),
  CONSTRAINT pif_inv_txn_product_fk FOREIGN KEY (product_id) REFERENCES pif.products (id),
  CONSTRAINT pif_inv_txn_related_fk FOREIGN KEY (related_transaction_id) REFERENCES pif.inventory_transactions (id),
  CONSTRAINT pif_inv_txn_type_chk CHECK (type IN ('RECEIVE','RESERVE','RELEASE','SALE','ADJUST_IN','ADJUST_OUT','DAMAGE','EXPIRED','RETURN')),
  CONSTRAINT pif_inv_txn_qty_chk CHECK (qty > 0),
  CONSTRAINT pif_inv_txn_reason_required_chk CHECK (type NOT IN ('ADJUST_IN','ADJUST_OUT','DAMAGE','EXPIRED') OR reason IS NOT NULL)
);
CREATE INDEX pif_inv_txn_product_created_idx ON pif.inventory_transactions (product_id, created_at);
CREATE INDEX pif_inv_txn_reference_idx ON pif.inventory_transactions (reference_type, reference_id);
COMMENT ON TABLE pif.inventory_transactions IS 'Append-only. Both POS and online orders write here through the same code path (Section 17). Revision 1 naming: ADJUST split into ADJUST_IN/ADJUST_OUT, EXPIRE renamed EXPIRED, SALE kept (billing vocabulary).';
