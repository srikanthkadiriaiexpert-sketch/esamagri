-- =============================================================================
-- Migration 0025: RIK Entitlement & Conversion Engine — configuration schema
-- Phase 3B STEP 11.
--
-- WHY THIS MIGRATION IS REQUIRED
-- ------------------------------
-- The frozen Phase 2 schema can record a COMPUTED entitlement total
-- (rik.entitlements.allocated_qty) but none of the inputs the approved
-- business model is built from:
--
--   * a daily scale that varies by dietary preference (PV / EV / NV)
--   * eligible days per customer per issue period
--   * shared entitlement pools where several provisions draw on one balance
--   * conversion ratios between a provision and its pool
--   * cross-pool conversions (eggs -> milk, meat -> eggs, meat -> milk)
--   * pack sizes, maximum quantities, maximum packs, minimum eligible days
--   * the FRESH / DRY distinction, and the separation between the pool a
--     provision is DEDUCTED FROM and the period it is PHYSICALLY ISSUED IN
--   * effective dating, so a rule change never rewrites history
--
-- None of that can be expressed by any of the 47 existing tables, so this
-- migration adds new ones. It is ADDITIVE ONLY:
--
--   * no table is dropped
--   * no column is dropped or retyped
--   * no constraint is removed
--   * no data is deleted or rewritten
--   * rik.entitlements, rik.entitlement_periods and rik.entitlement_ledger
--     are left exactly as they are, still readable and writable
--
-- The single change to an existing table is one NULLable column added to
-- shared.customers (dietary_preference). Adding a NULLable column is
-- backward compatible: every existing row keeps working, every existing
-- query keeps returning what it returned, and NULL is a meaningful state
-- ("the officer has not stated a dietary preference yet") which the engine
-- treats as "no RIK entitlement is applicable until it is set".
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- --------------------------------------------
--   * introduces NO role and NO permission — RIK administration runs on the
--     existing STEP 7 codes (rik.entitlement.allocate / rik.entitlement.adjust
--     / rik.product.manage). No PURCHASING role is created.
--   * touches NO authentication or RBAC object
--   * introduces NO stock / inventory quantity for RIK. There is no
--     on-hand, received, reserved or warehouse quantity anywhere below.
--     Availability is an operational matter handled at issue time, not a
--     stock ledger.
--   * hard-codes NO business value. Every scale, ratio, pack size, maximum
--     and applicability below is a ROW, inserted by migration 0026, and
--     editable by a RIK administrator afterwards.
-- =============================================================================

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- shared.customers.dietary_preference
--
-- PV = Pure Veg, EV = Egg Veg, NV = Non Veg. NULL = not yet stated.
-- The engine enforces applicability from this value SERVER-SIDE; the
-- frontend never decides what a customer is entitled to.
-- ---------------------------------------------------------------------------
ALTER TABLE shared.customers
  ADD COLUMN IF NOT EXISTS dietary_preference text;

ALTER TABLE shared.customers
  DROP CONSTRAINT IF EXISTS shared_customers_dietary_preference_chk;

ALTER TABLE shared.customers
  ADD CONSTRAINT shared_customers_dietary_preference_chk
  CHECK (dietary_preference IS NULL OR dietary_preference IN ('PV','EV','NV'));

COMMENT ON COLUMN shared.customers.dietary_preference IS
  'PV / EV / NV, or NULL when the officer has not stated one. Drives RIK entitlement applicability (STEP 11). Nullable and additive — Phase 2 rows are unaffected.';

-- ---------------------------------------------------------------------------
-- rik.entitlement_pools
--
-- A POOL is the unit of entitlement. Several provisions may draw on one
-- pool (Onion and Garlic share one; Sugar and Jaggery share another), and
-- the pool's own unit is the equivalence currency for everything in it.
--
-- ration_type is the entitlement family (FRESH / DRY). It is NOT the
-- physical issue period — see rik.provisions.issue_period, which is what
-- lets bread be handed over during a Fresh issue while still being
-- deducted from the DRY Cereals pool.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.entitlement_pools (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  code            text        NOT NULL,
  name            text        NOT NULL,
  ration_type     text        NOT NULL,
  unit            text        NOT NULL,
  description     text,
  display_order   integer     NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  effective_from  date        NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  CONSTRAINT rik_entitlement_pools_pk PRIMARY KEY (id),
  CONSTRAINT rik_entitlement_pools_code_uq UNIQUE (code),
  CONSTRAINT rik_entitlement_pools_ration_type_chk CHECK (ration_type IN ('FRESH','DRY')),
  CONSTRAINT rik_entitlement_pools_unit_chk CHECK (unit IN ('g','ml','piece')),
  CONSTRAINT rik_entitlement_pools_effective_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX rik_entitlement_pools_type_idx ON rik.entitlement_pools (ration_type, display_order);
CREATE INDEX rik_entitlement_pools_active_idx ON rik.entitlement_pools (is_active, effective_from, effective_to);

COMMENT ON TABLE rik.entitlement_pools IS
  'A RIK entitlement pool: the balance a set of provisions draws on, in one equivalence unit. STEP 11.';
COMMENT ON COLUMN rik.entitlement_pools.ration_type IS
  'FRESH or DRY — the entitlement family. NOT the physical issue period; see rik.provisions.issue_period.';

-- ---------------------------------------------------------------------------
-- rik.pool_scales
--
-- The daily scale, PER POOL PER DIETARY PREFERENCE, effective-dated.
--
-- Applicability is expressed by PRESENCE: a pool applies to a dietary
-- preference if and only if an active, in-date scale row exists for that
-- pair. That is how Meat and Eggs simply do not exist for a PV officer,
-- and how Cheese does not exist for NV — no row, no entitlement, enforced
-- by the engine reading this table rather than by any UI filter.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.pool_scales (
  id                  uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  pool_id             uuid        NOT NULL,
  dietary_preference  text        NOT NULL,
  daily_qty           numeric(14,4) NOT NULL,
  notes               text,
  is_active           boolean     NOT NULL DEFAULT true,
  effective_from      date        NOT NULL DEFAULT CURRENT_DATE,
  effective_to        date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  CONSTRAINT rik_pool_scales_pk PRIMARY KEY (id),
  CONSTRAINT rik_pool_scales_pool_fk FOREIGN KEY (pool_id) REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_pool_scales_dietary_chk CHECK (dietary_preference IN ('PV','EV','NV')),
  CONSTRAINT rik_pool_scales_qty_chk CHECK (daily_qty >= 0),
  CONSTRAINT rik_pool_scales_effective_chk CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT rik_pool_scales_version_uq UNIQUE (pool_id, dietary_preference, effective_from)
);

CREATE INDEX rik_pool_scales_lookup_idx
  ON rik.pool_scales (pool_id, dietary_preference, is_active, effective_from, effective_to);

COMMENT ON TABLE rik.pool_scales IS
  'Daily entitlement scale per pool per dietary preference, effective-dated. No row for a (pool, diet) pair means that pool does not apply to that diet. STEP 11.';

-- ---------------------------------------------------------------------------
-- rik.pool_conversions
--
-- CROSS-POOL conversion. Two modes, both configuration:
--
--   AUTOMATIC — the source pool does not apply to this dietary preference,
--               so its entitlement is granted in the target pool instead.
--               A PV officer receives +250 ml milk in lieu of eggs and
--               +500 ml milk in lieu of meat, giving 1,000 ml/day in total
--               together with the 250 ml base scale. No customer choice.
--
--   ELECTIVE  — the customer may decline the source entitlement and take
--               the target instead. An EV officer may convert the meat
--               entitlement to +4 eggs or +500 ml milk.
--
-- from_qty / to_qty are DAILY quantities and state the equivalence in the
-- client's own terms, so the customer can be shown "500 ml milk in lieu of
-- 260 g meat" without any of that being written in code.
--
-- Conversion WITHIN a pool (onion to garlic, sugar to jaggery, rice to
-- bread) is not expressed here — it is the provision's consumption_ratio.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.pool_conversions (
  id                  uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  code                text        NOT NULL,
  from_pool_id        uuid        NOT NULL,
  to_pool_id          uuid        NOT NULL,
  from_qty            numeric(14,4) NOT NULL,
  to_qty              numeric(14,4) NOT NULL,
  mode                text        NOT NULL,
  dietary_preference  text,
  description         text,
  display_order       integer     NOT NULL DEFAULT 0,
  is_active           boolean     NOT NULL DEFAULT true,
  effective_from      date        NOT NULL DEFAULT CURRENT_DATE,
  effective_to        date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,
  CONSTRAINT rik_pool_conversions_pk PRIMARY KEY (id),
  CONSTRAINT rik_pool_conversions_code_uq UNIQUE (code),
  CONSTRAINT rik_pool_conversions_from_fk FOREIGN KEY (from_pool_id) REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_pool_conversions_to_fk FOREIGN KEY (to_pool_id) REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_pool_conversions_mode_chk CHECK (mode IN ('AUTOMATIC','ELECTIVE')),
  CONSTRAINT rik_pool_conversions_dietary_chk CHECK (dietary_preference IS NULL OR dietary_preference IN ('PV','EV','NV')),
  CONSTRAINT rik_pool_conversions_qty_chk CHECK (from_qty > 0 AND to_qty > 0),
  CONSTRAINT rik_pool_conversions_distinct_chk CHECK (from_pool_id <> to_pool_id),
  CONSTRAINT rik_pool_conversions_effective_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX rik_pool_conversions_lookup_idx
  ON rik.pool_conversions (mode, dietary_preference, is_active, effective_from, effective_to);
CREATE INDEX rik_pool_conversions_from_idx ON rik.pool_conversions (from_pool_id);
CREATE INDEX rik_pool_conversions_to_idx ON rik.pool_conversions (to_pool_id);

COMMENT ON TABLE rik.pool_conversions IS
  'Cross-pool entitlement conversion. AUTOMATIC when the source pool does not apply to the diet; ELECTIVE when the customer may choose it. STEP 11.';

-- ---------------------------------------------------------------------------
-- rik.provisions
--
-- A selectable item, drawing on exactly one pool.
--
-- consumption_ratio is POOL UNITS CONSUMED PER ONE PROVISION UNIT, and the
-- direction matters: a 1:4.5 cereal alternative means one gram of it
-- consumes 4.5 g of the cereal pool, so consumption_ratio = 4.5. A 1:1
-- alternative is 1.0. Garlic at 60 g onion = 10 g garlic is 6.0.
--
-- issue_period is the PHYSICAL issue the item is handed over in. It is
-- independent of the pool's ration_type: bread sits in the DRY Cereals
-- pool but is issued FRESH because of its shelf life, and is still
-- deducted from the monthly Cereals entitlement. There is no separate
-- bread entitlement.
--
-- dietary_preference NULL means "inherit whatever the pool applies to";
-- a value restricts this one provision further.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.provisions (
  id                      uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  pool_id                 uuid        NOT NULL,
  code                    text        NOT NULL,
  name                    text        NOT NULL,
  unit                    text        NOT NULL,
  consumption_ratio       numeric(14,6) NOT NULL,
  pack_size               numeric(14,4),
  is_loose                boolean     NOT NULL DEFAULT false,
  is_customer_selectable  boolean     NOT NULL DEFAULT true,
  max_quantity            numeric(14,4),
  max_packs               integer,
  min_eligible_days       integer,
  issue_period            text        NOT NULL,
  dietary_preference      text,
  product_id              uuid,
  display_order           integer     NOT NULL DEFAULT 0,
  is_active               boolean     NOT NULL DEFAULT true,
  effective_from          date        NOT NULL DEFAULT CURRENT_DATE,
  effective_to            date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_by              uuid,
  CONSTRAINT rik_provisions_pk PRIMARY KEY (id),
  CONSTRAINT rik_provisions_code_uq UNIQUE (code),
  CONSTRAINT rik_provisions_pool_fk FOREIGN KEY (pool_id) REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_provisions_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_provisions_unit_chk CHECK (unit IN ('g','ml','piece')),
  CONSTRAINT rik_provisions_ratio_chk CHECK (consumption_ratio > 0),
  CONSTRAINT rik_provisions_issue_period_chk CHECK (issue_period IN ('FRESH','DRY')),
  CONSTRAINT rik_provisions_dietary_chk CHECK (dietary_preference IS NULL OR dietary_preference IN ('PV','EV','NV')),
  CONSTRAINT rik_provisions_pack_chk CHECK (pack_size IS NULL OR pack_size > 0),
  CONSTRAINT rik_provisions_max_qty_chk CHECK (max_quantity IS NULL OR max_quantity > 0),
  CONSTRAINT rik_provisions_max_packs_chk CHECK (max_packs IS NULL OR max_packs > 0),
  CONSTRAINT rik_provisions_min_days_chk CHECK (min_eligible_days IS NULL OR min_eligible_days > 0),
  CONSTRAINT rik_provisions_loose_pack_chk CHECK (NOT (is_loose AND pack_size IS NOT NULL)),
  CONSTRAINT rik_provisions_max_packs_needs_pack_chk CHECK (max_packs IS NULL OR pack_size IS NOT NULL),
  CONSTRAINT rik_provisions_effective_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX rik_provisions_pool_idx ON rik.provisions (pool_id, display_order);
CREATE INDEX rik_provisions_active_idx ON rik.provisions (is_active, effective_from, effective_to);
CREATE INDEX rik_provisions_issue_period_idx ON rik.provisions (issue_period);
CREATE INDEX rik_provisions_selectable_idx ON rik.provisions (is_customer_selectable) WHERE is_customer_selectable;

COMMENT ON TABLE rik.provisions IS
  'A selectable RIK provision drawing on one entitlement pool. STEP 11. Holds no stock quantity — RIK keeps no inventory.';
COMMENT ON COLUMN rik.provisions.consumption_ratio IS
  'Pool units consumed per ONE unit of this provision. 1:4.5 => 4.5. Never the inverse.';
COMMENT ON COLUMN rik.provisions.issue_period IS
  'The physical issue this item is handed over in, independent of the pool it is deducted from. Bread: DRY pool, FRESH issue.';

-- ---------------------------------------------------------------------------
-- rik.customer_period_eligibility
--
-- Eligible days per customer per issue period — the second factor in
-- (daily scale x eligible days). Never derived from a calendar month: the
-- number is supplied per officer per period by RIK staff, so 28, 29, 30,
-- 31 or any partial figure after leave all work without code changes.
--
-- customer_id follows the established cross-schema pattern: validated by
-- trigger against shared.customers, not by a foreign key.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.customer_period_eligibility (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id     uuid        NOT NULL,
  period_id       uuid        NOT NULL,
  eligible_days   integer     NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  CONSTRAINT rik_customer_period_eligibility_pk PRIMARY KEY (id),
  CONSTRAINT rik_customer_period_eligibility_period_fk FOREIGN KEY (period_id) REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_customer_period_eligibility_uq UNIQUE (customer_id, period_id),
  CONSTRAINT rik_customer_period_eligibility_days_chk CHECK (eligible_days >= 0 AND eligible_days <= 366)
);

CREATE INDEX rik_customer_period_eligibility_period_idx ON rik.customer_period_eligibility (period_id);

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE ON rik.customer_period_eligibility
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

COMMENT ON TABLE rik.customer_period_eligibility IS
  'Eligible ration days per customer per issue period. Supplied by RIK staff; never inferred from the length of a calendar month. STEP 11.';

-- ---------------------------------------------------------------------------
-- rik.entitlement_selections / rik.entitlement_selection_items
--
-- What the customer chose, and the rules that were in force when they
-- chose it.
--
-- Historical reproducibility (STEP 11 Section 2/11) is guaranteed by
-- snapshotting at confirmation: the dietary preference, the eligible days,
-- the per-item consumption_ratio actually applied, and a full JSONB
-- snapshot of the pool/scale/conversion configuration used. A later
-- administrative change to the master configuration therefore cannot
-- alter a confirmed selection — the engine reads the snapshot, not the
-- live tables, when reproducing history.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.entitlement_selections (
  id                  uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id         uuid        NOT NULL,
  period_id           uuid        NOT NULL,
  status              text        NOT NULL DEFAULT 'DRAFT',
  dietary_preference  text        NOT NULL,
  eligible_days       integer     NOT NULL,
  rule_snapshot       jsonb,
  snapshot_taken_at   timestamptz,
  confirmed_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_entitlement_selections_pk PRIMARY KEY (id),
  CONSTRAINT rik_entitlement_selections_period_fk FOREIGN KEY (period_id) REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_entitlement_selections_status_chk CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  CONSTRAINT rik_entitlement_selections_dietary_chk CHECK (dietary_preference IN ('PV','EV','NV')),
  CONSTRAINT rik_entitlement_selections_days_chk CHECK (eligible_days >= 0 AND eligible_days <= 366),
  CONSTRAINT rik_entitlement_selections_confirmed_snapshot_chk
    CHECK (status <> 'CONFIRMED' OR (rule_snapshot IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE INDEX rik_entitlement_selections_customer_idx ON rik.entitlement_selections (customer_id, period_id);
CREATE INDEX rik_entitlement_selections_status_idx ON rik.entitlement_selections (status);
CREATE UNIQUE INDEX rik_entitlement_selections_one_open_uq
  ON rik.entitlement_selections (customer_id, period_id)
  WHERE status = 'DRAFT';

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE ON rik.entitlement_selections
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

COMMENT ON TABLE rik.entitlement_selections IS
  'A customer''s RIK provision selection for one issue period, with the rule snapshot that makes a confirmed selection reproducible after configuration changes. STEP 11.';

CREATE TABLE rik.entitlement_selection_items (
  id                    uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  selection_id          uuid        NOT NULL,
  provision_id          uuid        NOT NULL,
  pool_id               uuid        NOT NULL,
  quantity              numeric(14,4) NOT NULL,
  consumption_ratio     numeric(14,6) NOT NULL,
  pool_equivalent_qty   numeric(14,4) NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_entitlement_selection_items_pk PRIMARY KEY (id),
  CONSTRAINT rik_entitlement_selection_items_selection_fk
    FOREIGN KEY (selection_id) REFERENCES rik.entitlement_selections (id) ON DELETE CASCADE,
  CONSTRAINT rik_entitlement_selection_items_provision_fk FOREIGN KEY (provision_id) REFERENCES rik.provisions (id),
  CONSTRAINT rik_entitlement_selection_items_pool_fk FOREIGN KEY (pool_id) REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_entitlement_selection_items_qty_chk CHECK (quantity > 0),
  CONSTRAINT rik_entitlement_selection_items_ratio_chk CHECK (consumption_ratio > 0),
  CONSTRAINT rik_entitlement_selection_items_equiv_chk CHECK (pool_equivalent_qty > 0),
  CONSTRAINT rik_entitlement_selection_items_uq UNIQUE (selection_id, provision_id)
);

CREATE INDEX rik_entitlement_selection_items_selection_idx ON rik.entitlement_selection_items (selection_id);
CREATE INDEX rik_entitlement_selection_items_pool_idx ON rik.entitlement_selection_items (pool_id);

COMMENT ON COLUMN rik.entitlement_selection_items.consumption_ratio IS
  'The ratio actually applied when this line was chosen — snapshotted, so a later configuration change cannot restate history.';

-- ---------------------------------------------------------------------------
-- rik.entitlement_elections
--
-- Which ELECTIVE cross-pool conversions this customer took for a period
-- (for example, an EV officer converting the meat entitlement to eggs
-- rather than to milk). Stored per selection so the entitlement the engine
-- computes is reproducible alongside the chosen provisions.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.entitlement_elections (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  selection_id    uuid        NOT NULL,
  conversion_id   uuid        NOT NULL,
  from_qty        numeric(14,4) NOT NULL,
  to_qty          numeric(14,4) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_entitlement_elections_pk PRIMARY KEY (id),
  CONSTRAINT rik_entitlement_elections_selection_fk
    FOREIGN KEY (selection_id) REFERENCES rik.entitlement_selections (id) ON DELETE CASCADE,
  CONSTRAINT rik_entitlement_elections_conversion_fk
    FOREIGN KEY (conversion_id) REFERENCES rik.pool_conversions (id),
  CONSTRAINT rik_entitlement_elections_uq UNIQUE (selection_id, conversion_id),
  CONSTRAINT rik_entitlement_elections_qty_chk CHECK (from_qty > 0 AND to_qty > 0)
);

CREATE INDEX rik_entitlement_elections_selection_idx ON rik.entitlement_elections (selection_id);

COMMENT ON TABLE rik.entitlement_elections IS
  'ELECTIVE cross-pool conversions a customer took for one period, with the daily equivalence snapshotted. STEP 11.';

-- ---------------------------------------------------------------------------
-- Grants
--
-- ALTER DEFAULT PRIVILEGES (migration 0018) already granted app_rik
-- SELECT/INSERT/UPDATE/DELETE and app_reporting_rik SELECT on every new
-- table in the rik schema. Narrow that back where a soft policy applies,
-- matching the approach migration 0023 took for rik.issue_schedules.
--
-- Configuration is DEACTIVATED (is_active = false) or CLOSED
-- (effective_to), never deleted — deleting a rule would destroy the
-- history a confirmed selection depends on.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON rik.entitlement_pools        FROM app_rik;
REVOKE DELETE ON rik.pool_scales              FROM app_rik;
REVOKE DELETE ON rik.pool_conversions         FROM app_rik;
REVOKE DELETE ON rik.provisions               FROM app_rik;
REVOKE DELETE ON rik.entitlement_selections   FROM app_rik;

-- Draft editing genuinely removes a line the customer changed their mind
-- about, so DELETE stays on the two child tables. A CONFIRMED selection is
-- protected by application logic and by the snapshot, not by the grant.

-- app_pif has no business reason to read any RIK entitlement object.
-- No grant is issued — matching the least-privilege split already in force.

-- shared.customers.dietary_preference inherits the existing table grants;
-- app_shared already holds SELECT/INSERT/UPDATE on shared.customers.

RESET ROLE;
