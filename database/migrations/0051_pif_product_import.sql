-- ---------------------------------------------------------------------------
-- 0051_pif_product_import.sql
--
-- LAUNCH PREPARATION — bulk product import from the client's own spreadsheet.
--
-- WHY THIS EXISTS. The facility's catalogue will arrive as an Excel or CSV
-- file of several hundred SKUs. Typing them one by one into the admin screen
-- is a week of work and a guarantee of typos, and the Phase F authorisation
-- allowed an import "if feasible within the deadline" — reliable manual
-- creation first, which is already done and unchanged by this migration.
--
-- WHY IT IS TWO TABLES AND NOT A ONE-SHOT UPLOAD. A real client spreadsheet
-- is messy: a category spelled two ways, a GST rate that is not configured,
-- a price with three decimals, the same SKU twice. An import that applied
-- such a file directly would either refuse everything (and tell the operator
-- nothing useful) or half-apply it (and leave the catalogue in a state nobody
-- can describe). So an upload is PARSED AND JUDGED FIRST and stored as a
-- batch of judged rows — a preview the operator reads, row by row, before
-- anything is written to the catalogue. Applying it is a separate, deliberate
-- act, and so is throwing it away.
--
--   pif.product_import_batches   one uploaded file: who uploaded it, when,
--                                its size and shape, what the preview found,
--                                and what was eventually decided.
--   pif.product_import_rows      one spreadsheet row: the values as parsed,
--                                the verdict (create / update / invalid), the
--                                problems found, the product it targets, and
--                                whether it has been applied.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
--   * It does not touch pif.products, pif.categories or pif.tax_rates. An
--     import is a different way to call the SAME catalogue rules that the
--     admin screen calls; it is not a second, laxer way into the catalogue.
--     Every row is validated by PifCatalogueService's own guards, so a SKU,
--     price, tax rate, category or quantity limit that the admin screen
--     would refuse is refused here too.
--   * It introduces NO stock, quantity-on-hand, supplier, purchase order or
--     cost-of-goods concept. A spreadsheet column named "stock" is not
--     imported; availability stays the administrator's flag.
--   * It is PIF only. Nothing here references a rik table, a rik role or a
--     rik permission, and no permission is added: importing products is
--     `pif.product.manage`, which PIF_ADMIN and SUPER_ADMIN already hold and
--     RIK_ADMIN does not.
--   * It adds no new error path to the order or voucher spines — these two
--     tables are referenced by nothing but the import itself.
--
-- PRIVILEGES. The application may read, insert and update these two tables
-- (a batch legitimately moves PREVIEW -> APPLIED / DISCARDED / FAILED, and a
-- row records when it was applied) but may NOT delete: the record of an
-- import that went wrong is exactly the record someone will want. Only the
-- owner can remove an old batch, and the rows cascade with it.
--
-- Tables after this migration: 68 (shared 14 / rik 31 / pif 23). Views: 5.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

-- --------------------------------------------------------------- the batch
CREATE TABLE IF NOT EXISTS pif.product_import_batches (
  id              uuid PRIMARY KEY DEFAULT shared.uuid_generate_v7(),

  source_filename text NOT NULL CHECK (btrim(source_filename) <> ''),
  source_format   text NOT NULL CHECK (source_format IN ('XLSX', 'CSV')),
  byte_size       integer NOT NULL CHECK (byte_size > 0),

  -- PREVIEW   parsed and judged; nothing written to the catalogue yet.
  -- APPLIED    the operator confirmed it and the rows were written.
  -- DISCARDED  the operator threw it away.
  -- FAILED     applying it stopped part-way; failure_reason says why, and
  --            each row's applied_at says exactly how far it got.
  status          text NOT NULL DEFAULT 'PREVIEW'
                    CHECK (status IN ('PREVIEW', 'APPLIED', 'DISCARDED', 'FAILED')),

  total_rows      integer NOT NULL DEFAULT 0 CHECK (total_rows   >= 0),
  create_rows     integer NOT NULL DEFAULT 0 CHECK (create_rows  >= 0),
  update_rows     integer NOT NULL DEFAULT 0 CHECK (update_rows  >= 0),
  invalid_rows    integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  applied_rows    integer NOT NULL DEFAULT 0 CHECK (applied_rows >= 0),

  failure_reason  text,

  uploaded_by     uuid NOT NULL REFERENCES shared.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid REFERENCES shared.users(id),

  -- A batch is either still awaiting a decision or carries the decision and
  -- who made it. There is no third state, and no decided batch without a
  -- decider: "who applied this file" must always have an answer.
  CONSTRAINT pif_import_batch_decision_chk
    CHECK ((status = 'PREVIEW') = (decided_at IS NULL)),
  CONSTRAINT pif_import_batch_decider_chk
    CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  -- The verdict counts must add up to the rows that were read.
  CONSTRAINT pif_import_batch_counts_chk
    CHECK (create_rows + update_rows + invalid_rows = total_rows),
  -- Nothing can have been applied beyond what was applicable.
  CONSTRAINT pif_import_batch_applied_chk
    CHECK (applied_rows <= create_rows + update_rows),
  -- A failure is explained, and a success is not pretending to be one.
  CONSTRAINT pif_import_batch_failure_chk
    CHECK ((failure_reason IS NULL) OR (status = 'FAILED'))
);

CREATE INDEX IF NOT EXISTS pif_import_batches_recent_idx
  ON pif.product_import_batches (created_at DESC);
CREATE INDEX IF NOT EXISTS pif_import_batches_status_idx
  ON pif.product_import_batches (status, created_at DESC);

-- ---------------------------------------------------------------- the rows
CREATE TABLE IF NOT EXISTS pif.product_import_rows (
  id                uuid PRIMARY KEY DEFAULT shared.uuid_generate_v7(),
  batch_id          uuid NOT NULL
                      REFERENCES pif.product_import_batches(id) ON DELETE CASCADE,

  -- The row number IN THE OPERATOR'S FILE, header included, so a problem
  -- can be reported as "row 42" and found by opening the spreadsheet.
  row_no            integer NOT NULL CHECK (row_no > 0),

  verdict           text NOT NULL CHECK (verdict IN ('CREATE', 'UPDATE', 'INVALID')),

  sku               text,
  name              text,
  -- Set when the SKU already exists: the product this row would update.
  target_product_id uuid REFERENCES pif.products(id),

  -- The row as parsed and resolved (category and tax rate already looked up
  -- by name and rate, prices already numbers) — what WOULD be written.
  parsed            jsonb NOT NULL,
  -- Every reason this row cannot be applied, in the operator's words.
  problems          jsonb NOT NULL DEFAULT '[]'::jsonb,

  applied_at        timestamptz,

  CONSTRAINT pif_import_rows_uq UNIQUE (batch_id, row_no),
  CONSTRAINT pif_import_rows_parsed_chk   CHECK (jsonb_typeof(parsed)   = 'object'),
  CONSTRAINT pif_import_rows_problems_chk CHECK (jsonb_typeof(problems) = 'array'),
  -- INVALID and "has problems" are the same fact, stated once. A row cannot
  -- be invalid for no reason, and cannot be applicable with a reason.
  CONSTRAINT pif_import_rows_verdict_chk
    CHECK ((verdict = 'INVALID') = (jsonb_array_length(problems) > 0)),
  -- An invalid row can never be applied. This is the guard that makes
  -- "the preview is the truth" structural rather than a promise.
  CONSTRAINT pif_import_rows_applied_chk
    CHECK (applied_at IS NULL OR verdict <> 'INVALID'),
  -- An UPDATE row must name the product it will overwrite — a row that
  -- claims to update something without saying what is a bug, not a row.
  -- The reverse is NOT required: once a CREATE row has been applied, this
  -- column records the product it created, which is how an operator gets
  -- from "row 42 of the file I uploaded" to the product now in the shop.
  CONSTRAINT pif_import_rows_target_chk
    CHECK (verdict <> 'UPDATE' OR target_product_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pif_import_rows_batch_idx
  ON pif.product_import_rows (batch_id, row_no);
CREATE INDEX IF NOT EXISTS pif_import_rows_verdict_idx
  ON pif.product_import_rows (batch_id, verdict);

-- ------------------------------------------------------------------ grants
--
-- Migration 0018 set ALTER DEFAULT PRIVILEGES so that a new pif table is
-- born with SELECT/INSERT/UPDATE/DELETE for app_pif. DELETE is taken away
-- here deliberately: an import record is history. The explicit GRANT is
-- stated anyway so this file reads correctly on its own and does not depend
-- on a default set thirty-three migrations ago.
GRANT SELECT, INSERT, UPDATE ON pif.product_import_batches TO app_pif;
GRANT SELECT, INSERT, UPDATE ON pif.product_import_rows    TO app_pif;
REVOKE DELETE ON pif.product_import_batches FROM app_pif;
REVOKE DELETE ON pif.product_import_rows    FROM app_pif;

GRANT SELECT ON pif.product_import_batches TO app_reporting_pif;
GRANT SELECT ON pif.product_import_rows    TO app_reporting_pif;

-- ------------------------------------------------------------ verification
DO $$
DECLARE
  n integer;
BEGIN
  -- The two tables exist, and the schema is where it should be.
  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'pif'
     AND table_name IN ('product_import_batches', 'product_import_rows')
     AND table_type = 'BASE TABLE';
  IF n <> 2 THEN
    RAISE EXCEPTION 'Migration 0051: expected the 2 import tables, found %.', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema IN ('shared', 'rik', 'pif') AND table_type = 'BASE TABLE';
  IF n <> 68 THEN
    RAISE EXCEPTION 'Migration 0051: expected 68 base tables after this migration, found %.', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'pif' AND table_type = 'BASE TABLE';
  IF n <> 23 THEN
    RAISE EXCEPTION 'Migration 0051: expected 23 pif base tables, found %.', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.views
   WHERE table_schema IN ('shared', 'rik', 'pif');
  IF n <> 5 THEN
    RAISE EXCEPTION 'Migration 0051: expected 5 views, found %.', n;
  END IF;

  -- The application cannot delete an import record.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'pif'
       AND table_name IN ('product_import_batches', 'product_import_rows')
       AND grantee = 'app_pif' AND privilege_type = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'Migration 0051: app_pif must not hold DELETE on the import tables.';
  END IF;

  -- ...and it can do the three things it must.
  SELECT count(*) INTO n
    FROM information_schema.role_table_grants
   WHERE table_schema = 'pif'
     AND table_name IN ('product_import_batches', 'product_import_rows')
     AND grantee = 'app_pif'
     AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE');
  IF n <> 6 THEN
    RAISE EXCEPTION 'Migration 0051: app_pif needs SELECT/INSERT/UPDATE on both import tables, found % grants.', n;
  END IF;

  -- No RIK role may reach a PIF import, in either direction.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'pif'
       AND table_name IN ('product_import_batches', 'product_import_rows')
       AND grantee IN ('app_rik', 'app_reporting_rik')
  ) THEN
    RAISE EXCEPTION 'Migration 0051: a rik role was granted access to the PIF import tables.';
  END IF;

  -- The permission set is UNCHANGED: importing is pif.product.manage, which
  -- already exists. This migration adds no permission and no role.
  SELECT count(*) INTO n FROM shared.permissions;
  IF n <> 22 THEN
    RAISE EXCEPTION 'Migration 0051: expected the permission set to stay at 22, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM shared.roles;
  IF n <> 6 THEN
    RAISE EXCEPTION 'Migration 0051: expected 6 roles, found %.', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shared.permissions WHERE code = 'pif.product.manage') THEN
    RAISE EXCEPTION 'Migration 0051: pif.product.manage is missing; the import has no permission to require.';
  END IF;
  IF EXISTS (SELECT 1 FROM shared.roles WHERE name = 'PURCHASING') THEN
    RAISE EXCEPTION 'Migration 0051: a PURCHASING role exists; it must not.';
  END IF;

  -- Still no stock, and no supplier, anywhere in PIF products.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'pif' AND table_name = 'products'
       AND column_name IN ('stock_qty', 'on_hand', 'quantity_available', 'supplier_id')
  ) THEN
    RAISE EXCEPTION 'Migration 0051: a stock or supplier column appeared on pif.products; it must not.';
  END IF;

  -- The RIK baseline, untouched by a PIF import feature.
  SELECT count(*) INTO n FROM rik.entitlement_pools;
  IF n <> 18 THEN RAISE EXCEPTION 'Migration 0051: expected 18 RIK pools, found %.', n; END IF;
  SELECT count(*) INTO n FROM rik.provisions;
  IF n <> 189 THEN RAISE EXCEPTION 'Migration 0051: expected 189 provisions, found %.', n; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'rik' AND table_name = 'issue_vouchers'
       AND grantee = 'app_rik' AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Migration 0051: RIK voucher privileges changed.';
  END IF;
END;
$$;

RESET ROLE;
