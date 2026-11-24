-- =============================================================================
-- Migration 0007: rik.categories, products, inventory, inventory_transactions
-- Phase 2 Rev1 Section 05, 16.
-- =============================================================================

CREATE TABLE rik.categories (
  id          uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  name        text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_categories_pk PRIMARY KEY (id),
  CONSTRAINT rik_categories_name_uq UNIQUE (name)
);

CREATE TABLE rik.products (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  sku           text        NOT NULL,
  name          text        NOT NULL,
  category_id   uuid,
  unit          text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  image_ref     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT rik_products_pk PRIMARY KEY (id),
  CONSTRAINT rik_products_sku_uq UNIQUE (sku),
  CONSTRAINT rik_products_category_fk FOREIGN KEY (category_id) REFERENCES rik.categories (id),
  CONSTRAINT rik_products_unit_chk CHECK (unit IN ('kg','g','litre','ml','pcs'))
);
CREATE INDEX rik_products_category_idx ON rik.products (category_id);
CREATE INDEX rik_products_name_trgm_idx ON rik.products USING gin (name gin_trgm_ops);
COMMENT ON TABLE rik.products IS 'No purchase_price/selling_price/tax columns — RIK is entitlement issuance, not billing (Section 05).';

CREATE TABLE rik.inventory (
  product_id          uuid        NOT NULL,
  quantity_on_hand    numeric(12,3) NOT NULL DEFAULT 0,
  quantity_reserved   numeric(12,3) NOT NULL DEFAULT 0,
  reorder_level       numeric(12,3),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_inventory_pk PRIMARY KEY (product_id),
  CONSTRAINT rik_inventory_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_inventory_on_hand_chk CHECK (quantity_on_hand >= 0),
  CONSTRAINT rik_inventory_reserved_chk CHECK (quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand)
);
COMMENT ON TABLE rik.inventory IS 'One row per product, 1:1 (product_id is both PK and FK). Denormalized current balance, Section 16.';

CREATE TABLE rik.inventory_transactions (
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
  CONSTRAINT rik_inv_txn_pk PRIMARY KEY (id),
  CONSTRAINT rik_inv_txn_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_inv_txn_related_fk FOREIGN KEY (related_transaction_id) REFERENCES rik.inventory_transactions (id),
  CONSTRAINT rik_inv_txn_type_chk CHECK (type IN ('RECEIVE','RESERVE','RELEASE','ISSUE','ADJUST_IN','ADJUST_OUT','DAMAGE','EXPIRED','RETURN')),
  CONSTRAINT rik_inv_txn_qty_positive_chk CHECK (qty > 0),
  CONSTRAINT rik_inv_txn_related_required_chk CHECK (type NOT IN ('RELEASE','ISSUE') OR related_transaction_id IS NOT NULL),
  CONSTRAINT rik_inv_txn_reason_required_chk CHECK (type NOT IN ('ADJUST_IN','ADJUST_OUT','DAMAGE','EXPIRED') OR reason IS NOT NULL)
);
CREATE INDEX rik_inv_txn_product_created_idx ON rik.inventory_transactions (product_id, created_at);
CREATE INDEX rik_inv_txn_reference_idx ON rik.inventory_transactions (reference_type, reference_id);
COMMENT ON TABLE rik.inventory_transactions IS 'Append-only stock ledger, 9 transaction types (Revision 1). Every rik.inventory balance mutation has exactly one corresponding row here — enforced procedurally (Section 26), not by a trigger that rewrites the balance (see docs/implementation-plan.md for why).';
