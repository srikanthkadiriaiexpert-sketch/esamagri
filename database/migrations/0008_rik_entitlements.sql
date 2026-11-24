-- =============================================================================
-- Migration 0008: rik.entitlement_periods, entitlements, entitlement_ledger
--                  + rik.v_entitlement_balance, rik.v_entitlement_consumption_by_product
-- Phase 2 Rev1 Section 05, 15. The two views are built per your explicit
-- approval (Sections 15/28/33 rely on them as real, required reporting
-- objects) — see docs/reconciliation-report.md. True view count: 3
-- (shared.v_customer_profile + these two), not the "1" stated in Section 01/03.
-- =============================================================================

CREATE TABLE rik.entitlement_periods (
  id          uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  name        text        NOT NULL,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  status      text        NOT NULL,
  CONSTRAINT rik_ent_periods_pk PRIMARY KEY (id),
  CONSTRAINT rik_ent_periods_name_uq UNIQUE (name),
  CONSTRAINT rik_ent_periods_dates_chk CHECK (start_date < end_date),
  CONSTRAINT rik_ent_periods_status_chk CHECK (status IN ('UPCOMING','ACTIVE','CLOSED')),
  -- Recommended (not required) in Section 05: non-overlapping periods,
  -- DB-enforced rather than left to application discipline.
  CONSTRAINT rik_ent_periods_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE rik.entitlements (
  id              uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id     uuid          NOT NULL,
  product_id      uuid,
  category_id     uuid,
  period_id       uuid          NOT NULL,
  allocated_qty   numeric(12,3) NOT NULL,
  unit            text          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT rik_entitlements_pk PRIMARY KEY (id),
  CONSTRAINT rik_entitlements_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_entitlements_category_fk FOREIGN KEY (category_id) REFERENCES rik.categories (id),
  CONSTRAINT rik_entitlements_period_fk FOREIGN KEY (period_id) REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_entitlements_allocated_chk CHECK (allocated_qty >= 0),
  CONSTRAINT rik_entitlements_mode_xor_chk CHECK (num_nonnulls(product_id, category_id) = 1)
);
CREATE INDEX rik_entitlements_customer_idx ON rik.entitlements (customer_id);
CREATE UNIQUE INDEX rik_entitlements_product_period_uq ON rik.entitlements (customer_id, product_id, period_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX rik_entitlements_category_period_uq ON rik.entitlements (customer_id, category_id, period_id) WHERE category_id IS NOT NULL;
COMMENT ON TABLE rik.entitlements IS 'One row per customer x (product|category) x period. customer_id is trigger-validated (migration 0010), not a physical FK. Phase 2 Section 05.';

CREATE TABLE rik.entitlement_ledger (
  id                  uuid          NOT NULL DEFAULT shared.uuid_generate_v7(),
  entitlement_id      uuid          NOT NULL,
  product_id          uuid,
  type                text          NOT NULL,
  qty                 numeric(12,3) NOT NULL,
  related_entry_id    uuid,
  reference_type      text,
  reference_id        uuid,
  reason              text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          uuid,
  CONSTRAINT rik_ent_ledger_pk PRIMARY KEY (id),
  CONSTRAINT rik_ent_ledger_entitlement_fk FOREIGN KEY (entitlement_id) REFERENCES rik.entitlements (id),
  CONSTRAINT rik_ent_ledger_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_ent_ledger_related_fk FOREIGN KEY (related_entry_id) REFERENCES rik.entitlement_ledger (id),
  CONSTRAINT rik_ent_ledger_type_chk CHECK (type IN ('ALLOCATE','RESERVE','ISSUE','RELEASE','ADJUST')),
  CONSTRAINT rik_ent_ledger_qty_chk CHECK (type = 'ADJUST' OR qty > 0),
  CONSTRAINT rik_ent_ledger_product_conditional_chk CHECK ((type IN ('RESERVE','RELEASE','ISSUE')) = (product_id IS NOT NULL)),
  CONSTRAINT rik_ent_ledger_related_required_chk CHECK (type NOT IN ('RELEASE','ISSUE') OR related_entry_id IS NOT NULL),
  CONSTRAINT rik_ent_ledger_reason_required_chk CHECK (type <> 'ADJUST' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX rik_ent_ledger_related_uq ON rik.entitlement_ledger (related_entry_id) WHERE related_entry_id IS NOT NULL;
CREATE INDEX rik_ent_ledger_entitlement_product_idx ON rik.entitlement_ledger (entitlement_id, product_id);
CREATE INDEX rik_ent_ledger_reference_idx ON rik.entitlement_ledger (reference_type, reference_id);
COMMENT ON TABLE rik.entitlement_ledger IS 'Append-only. Source of truth for Available (Section 15). product_id conditionally required (RESERVE/RELEASE/ISSUE only), NULL for ALLOCATE/ADJUST. reference_id is a generic polymorphic reference (e.g. RIK_ORDER + rik.orders.id), same pattern as inventory_transactions — not a physical FK, matching this documents established convention for reference_type/reference_id pairs.';

-- ---------------------------------------------------------------------------
-- rik.v_entitlement_balance — Reserved/Issued/Adjusted/Available per pool
-- (per entitlement_id, correct for both product-mode and category-mode).
-- ---------------------------------------------------------------------------
CREATE VIEW rik.v_entitlement_balance AS
SELECT
  e.id            AS entitlement_id,
  e.customer_id,
  e.product_id,
  e.category_id,
  e.period_id,
  e.allocated_qty,
  COALESCE(adj.adjusted, 0)  AS adjusted,
  COALESCE(res.reserved, 0)  AS reserved,
  COALESCE(iss.issued, 0)    AS issued,
  e.allocated_qty + COALESCE(adj.adjusted, 0) - COALESCE(res.reserved, 0) - COALESCE(iss.issued, 0) AS available
FROM rik.entitlements e
LEFT JOIN (
  SELECT entitlement_id, SUM(qty) AS adjusted
  FROM rik.entitlement_ledger
  WHERE type = 'ADJUST'
  GROUP BY entitlement_id
) adj ON adj.entitlement_id = e.id
LEFT JOIN (
  -- "still open" reservations: RESERVE rows with no closing RELEASE/ISSUE yet
  SELECT r.entitlement_id, SUM(r.qty) AS reserved
  FROM rik.entitlement_ledger r
  WHERE r.type = 'RESERVE'
    AND NOT EXISTS (
      SELECT 1 FROM rik.entitlement_ledger c
      WHERE c.related_entry_id = r.id AND c.type IN ('RELEASE','ISSUE')
    )
  GROUP BY r.entitlement_id
) res ON res.entitlement_id = e.id
LEFT JOIN (
  SELECT entitlement_id, SUM(qty) AS issued
  FROM rik.entitlement_ledger
  WHERE type = 'ISSUE'
  GROUP BY entitlement_id
) iss ON iss.entitlement_id = e.id;

COMMENT ON VIEW rik.v_entitlement_balance IS
  'Available = Allocated + Adjusted - Reserved - Issued, per entitlement_id (correct for category-mode pools shared across multiple products). Phase 2 Section 15.';

-- ---------------------------------------------------------------------------
-- rik.v_entitlement_consumption_by_product — breakdown by (entitlement_id,
-- product_id): "which SKUs actually consumed this category's pool".
-- ---------------------------------------------------------------------------
CREATE VIEW rik.v_entitlement_consumption_by_product AS
SELECT
  l.entitlement_id,
  l.product_id,
  SUM(CASE WHEN l.type = 'RESERVE' THEN l.qty ELSE 0 END) AS total_reserved,
  SUM(CASE WHEN l.type = 'RELEASE' THEN l.qty ELSE 0 END) AS total_released,
  SUM(CASE WHEN l.type = 'ISSUE'   THEN l.qty ELSE 0 END) AS total_issued,
  SUM(CASE WHEN l.type = 'RESERVE' THEN l.qty ELSE 0 END)
    - SUM(CASE WHEN l.type = 'RELEASE' THEN l.qty ELSE 0 END)
    - SUM(CASE WHEN l.type = 'ISSUE'   THEN l.qty ELSE 0 END) AS currently_reserved
FROM rik.entitlement_ledger l
WHERE l.product_id IS NOT NULL
GROUP BY l.entitlement_id, l.product_id;

COMMENT ON VIEW rik.v_entitlement_consumption_by_product IS
  'Category-mode consumption broken down by which physical product actually moved. Phase 2 Section 15.';
