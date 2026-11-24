-- =============================================================================
-- Migration 0015: pif.returns, pif.return_items
-- Phase 2 Rev1 Section 06, 18.
-- A return never edits the original finalized bill.
-- =============================================================================

CREATE TABLE pif.returns (
  id              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  bill_id         uuid          NOT NULL,
  reason          text,
  status          text          NOT NULL DEFAULT 'REQUESTED',
  refund_amount   numeric(12,2),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT pif_returns_pk PRIMARY KEY (id),
  CONSTRAINT pif_returns_bill_fk FOREIGN KEY (bill_id) REFERENCES pif.pos_bills (id),
  CONSTRAINT pif_returns_status_chk CHECK (status IN ('REQUESTED','APPROVED','COMPLETED','REJECTED')),
  CONSTRAINT pif_returns_refund_chk CHECK (refund_amount IS NULL OR refund_amount >= 0)
);
CREATE INDEX pif_returns_bill_idx ON pif.returns (bill_id);
CREATE INDEX pif_returns_status_idx ON pif.returns (status);
COMMENT ON COLUMN pif.returns.created_by IS 'Attribution only, references shared.users.id — not trigger-validated in V1 per Phase 2 Section 12.';
COMMENT ON TABLE pif.returns IS 'A return never edits the original finalized bill (Section 18).';

CREATE TABLE pif.return_items (
  id                uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  return_id         uuid          NOT NULL,
  bill_item_id      uuid          NOT NULL,
  qty               numeric(12,3) NOT NULL,
  refund_amount     numeric(12,2) NOT NULL,
  inventory_txn_id  uuid,
  CONSTRAINT pif_return_items_pk PRIMARY KEY (id),
  CONSTRAINT pif_return_items_return_fk FOREIGN KEY (return_id) REFERENCES pif.returns (id),
  CONSTRAINT pif_return_items_bill_item_fk FOREIGN KEY (bill_item_id) REFERENCES pif.pos_bill_items (id),
  CONSTRAINT pif_return_items_inv_txn_fk FOREIGN KEY (inventory_txn_id) REFERENCES pif.inventory_transactions (id),
  CONSTRAINT pif_return_items_qty_chk CHECK (qty > 0),
  CONSTRAINT pif_return_items_refund_chk CHECK (refund_amount >= 0)
);
CREATE INDEX pif_return_items_return_idx ON pif.return_items (return_id);
COMMENT ON COLUMN pif.return_items.qty IS 'Validated at the app layer to not exceed the original line''s qty minus any prior returns against it (Section 06).';
COMMENT ON COLUMN pif.return_items.inventory_txn_id IS 'The RETURN stock-transaction row, if the item is resalable.';
