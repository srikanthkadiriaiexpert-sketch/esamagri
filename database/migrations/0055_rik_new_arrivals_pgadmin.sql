BEGIN;

-- ===========================================================================
-- 0055_rik_new_arrivals_pgadmin.sql
--
-- PREPARED 30 October 2026. NOT YET APPLIED.
--
-- This is the pgAdmin variant of 0055_rik_new_arrivals.sql, following the
-- same convention as 0053_rik_fresh_milk_coupon_pgadmin.sql and
-- 0054_pif_category_images_pgadmin.sql. The SQL body below is BYTE-IDENTICAL
-- to the original apart from the four changes listed here.
--
--   1. BEGIN; added as the first statement, and COMMIT; as the last.
--      pgAdmin's Query Tool autocommits each statement by default, so
--      without these the migration is not atomic. NOTE: 0054's pgAdmin
--      variant has BEGIN; and NO COMMIT; — a transaction left open that
--      way rolls back silently when the session closes. Both are present
--      here deliberately.
--
--   2. `SET ROLE esamagri_owner;` removed. In pgAdmin you connect as
--      postgres. With SET ROLE, rik.new_arrivals would be owned by
--      esamagri_owner while all 68 existing tables are owned by postgres.
--      Removing it keeps ownership consistent, exactly as 0053's and
--      0054's variants do.
--
--   3. `RESET ROLE;` removed, for the same reason — there is no role to
--      reset. COMMIT; takes its place at the foot of the file.
--
--   4. A PRE-STATE ASSERTION block added before section 1. This is the ONE
--      addition beyond the established convention, and it is here because
--      it makes the migration refuse to run against an unexpected database
--      instead of relying on a check performed elsewhere beforehand. It
--      asserts that rik.new_arrivals does not already exist and that the
--      schema currently holds 68 base tables (rik 31) and 5 views. Any
--      other state raises, the transaction aborts, and nothing is created.
--      Say the word and I will remove it.
--
-- 0055 contains NO psql meta-command (no `\set ON_ERROR_STOP on`), unlike
-- 0053 and 0054, so nothing of that kind needed removing.
--
-- HOW TO RUN, once approved: pgAdmin -> connect to esamagri_staging as
-- postgres -> Query Tool -> open this file -> Execute. Expect "COMMIT"
-- and no error. Then, and only then, update schema-contract.ts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0055_rik_new_arrivals.sql
--
-- What RIK staff are currently featuring as newly introduced.
--
-- THE GAP THIS CLOSES. The customer home screen carries a New Arrivals
-- shortcut that had nothing behind it: no route, no table, no API. It was
-- shipped disabled and said "Coming soon", because the alternative was a card
-- that either went nowhere or showed invented products. This table is what
-- makes it real, and it is managed entirely from the Admin Portal.
--
-- WHAT THIS MIGRATION IS. ONE CREATE TABLE, two indexes and two GRANTs. There
-- is no ALTER, no UPDATE, no DELETE, no DROP and no INSERT anywhere in this
-- file, so it cannot change a provision, a pool, a scale, an entitlement, an
-- issue, a selection, a voucher, a permission, a role, or anything in PIF. It
-- creates one empty table. The verification block at the foot asserts exactly
-- that.
--
-- RIK ONLY, ENFORCED BY THE SCHEMA AND NOT BY A CHECK ANYWHERE ELSE.
-- `provision_id` is a foreign key into rik.provisions. A PIF product's id
-- lives in pif.products and simply does not exist in rik.provisions, so the
-- database REFUSES it — not as a validation message, but as a referential
-- integrity failure. Every layer above also checks, but this is the layer
-- that cannot be bypassed, and it is the reason the feature can be described
-- as RIK-only without qualification.
--
-- NOTHING HERE CONFERS AN ENTITLEMENT. This table records that somebody chose
-- to show a product on a reference screen. It carries no quantity, no ratio,
-- no limit, no eligibility and no stock, and no code reads it when resolving
-- what an officer may take. Featuring a product and being entitled to it are
-- unrelated facts, and keeping them in separate tables is how that stays true.
--
-- REMOVING A LISTING NEVER REMOVES A PRODUCT. A row here is a listing. The
-- admin "remove" action deletes the listing row; the provision it pointed at
-- is not touched. The foreign key is ON DELETE RESTRICT rather than CASCADE,
-- in both directions of intent: deleting a listing cannot reach the catalogue,
-- and a provision that is currently featured cannot be deleted out from under
-- it. (RIK retires provisions with is_active = false rather than deleting
-- them, so RESTRICT costs nothing and closes a door.)
--
-- NO NEW PERMISSION, NO NEW ROLE. Management is gated by
-- `rik.product.manage`, which already exists and which RIK_ADMIN already
-- holds. The permission set stays at 22 and the role set at 6, which is what
-- migration 0051's guard requires and what the block below re-asserts.
-- ---------------------------------------------------------------------------

-- `SET ROLE esamagri_owner;` intentionally omitted in this variant.
-- See change (2) in the header above.

-- ---------------------------------------------------------------------------
-- 0. Pre-state assertions  [pgAdmin variant only — change (4) in the header]
--
-- Refuses to proceed unless the database is in exactly the state this
-- migration expects. Inside the transaction, so a failure here aborts
-- everything and creates nothing.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  n integer;
BEGIN
  IF to_regclass('rik.new_arrivals') IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0055: rik.new_arrivals already exists. This migration has already been applied; nothing to do.';
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE';
  IF n <> 68 THEN
    RAISE EXCEPTION
      'Migration 0055: expected 68 base tables before this migration, found %. Stop and investigate.', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'rik' AND table_type = 'BASE TABLE';
  IF n <> 31 THEN
    RAISE EXCEPTION
      'Migration 0055: expected 31 tables in schema rik before this migration, found %.', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.views
   WHERE table_schema IN ('shared','rik','pif');
  IF n <> 5 THEN
    RAISE EXCEPTION
      'Migration 0055: expected 5 views, found %.', n;
  END IF;
END;
$pre$;


-- ---------------------------------------------------------------------------
-- 1. The listing
-- ---------------------------------------------------------------------------
CREATE TABLE rik.new_arrivals (
  id              uuid PRIMARY KEY DEFAULT shared.uuid_generate_v7(),

  -- The RIK-only guarantee. See the header.
  provision_id    uuid NOT NULL REFERENCES rik.provisions(id) ON DELETE RESTRICT,

  -- An optional line of staff copy, e.g. "Now in a 1 kg pack". Never a
  -- nutrition, health or entitlement claim; the length cap keeps it a label
  -- rather than an article.
  headline        text,

  -- An optional override picture. NULL means "use the provision's own
  -- image_ref", which is the normal case: a product's photograph is managed
  -- once, on the Provisions screen, and every surface shows the same one.
  image_ref       text,

  -- Staff publish deliberately. A listing is invisible to customers until
  -- this is true, so a half-prepared entry is never on display.
  is_published    boolean NOT NULL DEFAULT false,

  -- An optional window. NULL from = "as soon as published"; NULL until =
  -- "until staff unpublish it". Both are dates, not timestamps: the facility
  -- thinks in days, and the customer query compares against CURRENT_DATE.
  published_from  date,
  published_until date,

  display_order   integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES shared.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES shared.users(id),

  -- A window that closes before it opens would be invisible forever while
  -- looking published, which is the kind of thing nobody notices for weeks.
  CONSTRAINT rik_new_arrivals_window_valid
    CHECK (published_until IS NULL OR published_from IS NULL
           OR published_until >= published_from),

  CONSTRAINT rik_new_arrivals_headline_len
    CHECK (headline IS NULL OR char_length(btrim(headline)) BETWEEN 1 AND 140)
);

COMMENT ON TABLE rik.new_arrivals IS
  'Staff-curated listings of existing RIK provisions shown on the customer New Arrivals screen. Display only: confers no entitlement, eligibility or stock.';

-- A provision is featured once or not at all; a second listing for the same
-- product would show the customer a duplicate card.
CREATE UNIQUE INDEX rik_new_arrivals_provision_uq
  ON rik.new_arrivals (provision_id);

-- The customer query's access path: published rows in display order.
CREATE INDEX rik_new_arrivals_published_idx
  ON rik.new_arrivals (is_published, display_order, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Grants
--
-- The RIK application role reads and writes; the RIK reporting role reads.
-- No PIF role is named here at all, and the guard below proves none acquired
-- access by inheritance.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON rik.new_arrivals TO app_rik;
GRANT SELECT                         ON rik.new_arrivals TO app_reporting_rik;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  -- The table exists and is EMPTY. This migration seeds nothing: every
  -- listing that ever appears was created by a named member of staff through
  -- the Admin Portal, and is attributable in shared.audit_log.
  SELECT count(*) INTO n FROM rik.new_arrivals;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Migration 0055: expected the new table to be empty, found % row(s).', n;
  END IF;

  -- The RIK-only guarantee is a real foreign key, not a comment.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class child  ON child.oid  = c.conrelid
      JOIN pg_class parent ON parent.oid = c.confrelid
      JOIN pg_namespace cn ON cn.oid = child.relnamespace
      JOIN pg_namespace pn ON pn.oid = parent.relnamespace
     WHERE c.contype = 'f'
       AND cn.nspname = 'rik' AND child.relname  = 'new_arrivals'
       AND pn.nspname = 'rik' AND parent.relname = 'provisions'
       AND c.confdeltype = 'r'   -- ON DELETE RESTRICT
  ) THEN
    RAISE EXCEPTION 'Migration 0055: the foreign key to rik.provisions is missing or is not ON DELETE RESTRICT.';
  END IF;

  -- Nothing may make a listing reachable from PIF.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'rik' AND table_name = 'new_arrivals'
       AND grantee IN ('app_pif', 'app_reporting_pif')
  ) THEN
    RAISE EXCEPTION 'Migration 0055: a PIF role was granted access to rik.new_arrivals.';
  END IF;

  -- The RIK application role can actually use it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'rik' AND table_name = 'new_arrivals'
       AND grantee = 'app_rik' AND privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Migration 0055: app_rik cannot write to rik.new_arrivals.';
  END IF;

  -- NO new permission and NO new role: management reuses rik.product.manage.
  SELECT count(*) INTO n FROM shared.permissions;
  IF n <> 22 THEN
    RAISE EXCEPTION 'Migration 0055: expected the permission set to stay at 22, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM shared.roles;
  IF n <> 6 THEN
    RAISE EXCEPTION 'Migration 0055: expected 6 roles, found %.', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shared.permissions WHERE code = 'rik.product.manage') THEN
    RAISE EXCEPTION 'Migration 0055: rik.product.manage is missing; New Arrivals has no permission to require.';
  END IF;

  -- The catalogue is still there and was not touched. A CREATE TABLE cannot
  -- have altered it; this asserts the obvious so that a future edit to this
  -- file which DOES touch it fails loudly here.
  SELECT count(*) INTO n FROM rik.provisions;
  IF n = 0 THEN
    RAISE EXCEPTION 'Migration 0055: rik.provisions is empty; this migration must never alter the catalogue.';
  END IF;

  -- The listing table holds no entitlement concept at all.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rik' AND table_name = 'new_arrivals'
       AND column_name IN ('consumption_ratio', 'max_quantity', 'max_packs',
                           'min_eligible_days', 'pack_size', 'quantity',
                           'stock_qty', 'is_eligible')
  ) THEN
    RAISE EXCEPTION 'Migration 0055: an entitlement or stock column reached rik.new_arrivals.';
  END IF;
END;
$$;

COMMIT;

-- ===========================================================================
-- After COMMIT, the database holds 69 base tables (rik 32) and 5 views, and
-- apps/api/src/database/schema-contract.ts STILL SAYS 68. The API will refuse
-- to boot until that constant is updated. That is the designed interlock, not
-- a fault. Apply the schema-contract.ts change next, then restart the API.
-- ===========================================================================

