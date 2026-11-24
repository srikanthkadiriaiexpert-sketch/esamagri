-- =============================================================================
-- Migration 0009: rik.carts, cart_items, orders, order_items, order_status_history
-- Phase 2 Rev1 Section 05, 08.
-- =============================================================================

CREATE TABLE rik.carts (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id   uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'OPEN',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_carts_pk PRIMARY KEY (id),
  CONSTRAINT rik_carts_status_chk CHECK (status IN ('OPEN','CHECKED_OUT','ABANDONED'))
);
CREATE UNIQUE INDEX rik_carts_one_open_uq ON rik.carts (customer_id) WHERE status = 'OPEN';

CREATE TABLE rik.cart_items (
  id          uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  cart_id     uuid          NOT NULL,
  product_id  uuid          NOT NULL,
  qty         numeric(12,3) NOT NULL,
  CONSTRAINT rik_cart_items_pk PRIMARY KEY (id),
  CONSTRAINT rik_cart_items_cart_fk FOREIGN KEY (cart_id) REFERENCES rik.carts (id),
  CONSTRAINT rik_cart_items_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_cart_items_qty_chk CHECK (qty > 0),
  CONSTRAINT rik_cart_items_uq UNIQUE (cart_id, product_id)
);

CREATE TABLE rik.orders (
  id                      uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  order_number            text        NOT NULL,
  customer_id             uuid        NOT NULL,
  status                  text        NOT NULL DEFAULT 'DRAFT',
  fulfillment_type        text        NOT NULL,
  confirmed_at            timestamptz,
  ready_at                timestamptz,
  out_for_delivery_at     timestamptz,
  collected_at            timestamptz,
  delivered_at            timestamptz,
  not_collected_at        timestamptz,
  cancelled_at            timestamptz,
  closed_at               timestamptz,
  ttl_expires_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_orders_pk PRIMARY KEY (id),
  CONSTRAINT rik_orders_number_uq UNIQUE (order_number),
  CONSTRAINT rik_orders_status_chk CHECK (status IN ('DRAFT','CONFIRMED','READY','OUT_FOR_DELIVERY','COLLECTED','DELIVERED','NOT_COLLECTED','CANCELLED','CLOSED')),
  CONSTRAINT rik_orders_fulfillment_chk CHECK (fulfillment_type IN ('PICKUP','DELIVERY'))
);
CREATE INDEX rik_orders_status_idx ON rik.orders (status);
CREATE INDEX rik_orders_ttl_idx ON rik.orders (ttl_expires_at);
CREATE INDEX rik_orders_customer_idx ON rik.orders (customer_id);

CREATE TABLE rik.order_items (
  id                              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  order_id                        uuid          NOT NULL,
  product_id                      uuid          NOT NULL,
  qty                             numeric(12,3) NOT NULL,
  entitlement_ledger_reserve_id   uuid,
  inventory_reserve_txn_id        uuid,
  CONSTRAINT rik_order_items_pk PRIMARY KEY (id),
  CONSTRAINT rik_order_items_order_fk FOREIGN KEY (order_id) REFERENCES rik.orders (id),
  CONSTRAINT rik_order_items_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_order_items_ledger_fk FOREIGN KEY (entitlement_ledger_reserve_id) REFERENCES rik.entitlement_ledger (id),
  CONSTRAINT rik_order_items_inv_txn_fk FOREIGN KEY (inventory_reserve_txn_id) REFERENCES rik.inventory_transactions (id),
  CONSTRAINT rik_order_items_qty_chk CHECK (qty > 0),
  CONSTRAINT rik_order_items_uq UNIQUE (order_id, product_id)
);
CREATE INDEX rik_order_items_order_idx ON rik.order_items (order_id);

CREATE TABLE rik.order_status_history (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  order_id      uuid        NOT NULL,
  from_status   text,
  to_status     text        NOT NULL,
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  reason        text,
  CONSTRAINT rik_order_status_history_pk PRIMARY KEY (id),
  CONSTRAINT rik_order_status_history_order_fk FOREIGN KEY (order_id) REFERENCES rik.orders (id)
);
CREATE INDEX rik_order_status_history_order_idx ON rik.order_status_history (order_id);
