BEGIN;

-- ===========================================================================
-- 0056_new_arrivals_standalone_pgadmin.sql
--
-- NEW ARRIVALS BECOMES A STANDALONE LISTING.
--
-- WHAT CHANGED AND WHY. 0055 made every listing point at a row in
-- rik.provisions. That was the wrong shape for the business requirement: a
-- New Arrivals card is a shop-window announcement, and staff need to put one
-- up for something that is not (or not yet) in the entitlement catalogue,
-- typing a name and uploading a picture. Requiring a provision forced staff
-- to pick a catalogue product they may not want to feature at all.
--
-- WHAT THIS MIGRATION DOES — three ALTERs and three CHECKs, nothing else:
--
--   1. adds `product_name`, the staff-typed name for a standalone listing;
--   2. makes `provision_id` NULLABLE, so a listing need not reference the
--      catalogue at all;
--   3. adds three CHECK constraints that keep the table honest afterwards.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--
--   * it does NOT drop `provision_id`. The column, its foreign key and its
--     ON DELETE RESTRICT stay exactly as 0055 created them. A listing MAY
--     still be linked to a provision; it simply no longer MUST be. Dropping
--     the column would throw away a working guarantee to satisfy a
--     requirement that only asked for the dependency to stop being mandatory.
--
--   * it does NOT touch rik.provisions. No INSERT, UPDATE or DELETE against
--     the catalogue appears anywhere in this file. No provision is created,
--     renamed, retired or deleted.
--
--   * it does NOT touch any entitlement, pool, scale, conversion, selection,
--     issue window, voucher, stock or PIF object. The verification block at
--     the foot asserts the entitlement-column prohibition that 0055 set.
--
--   * it does NOT add or remove a table or a view, so the schema contract in
--     apps/api/src/database/schema-contract.ts stays at 69 tables / 5 views
--     and needs NO edit. Columns are not counted by that check.
--
--   * it does NOT add a role or a permission. Management stays gated by
--     `rik.product.manage`, which already exists.
--
-- ON THE UNIQUE INDEX. `rik_new_arrivals_provision_uq` is UNIQUE on
-- (provision_id) and is left exactly as it is. PostgreSQL treats NULLs as
-- distinct in a unique index, so any number of standalone listings coexist
-- while a provision can still be featured only once. The verification block
-- proves this rather than asserting it in a comment.
--
-- ON "RIK ONLY". 0055 argued that the feature was RIK-only because the
-- foreign key made a PIF product id unstorable. That argument still holds for
-- linked listings. A standalone listing references NO product at all — not a
-- RIK one and not a PIF one — so there is nothing to cross modules. The
-- guarantee is preserved by having no reference, rather than by constraining
-- one.
--
-- ON THE REQUIRED IMAGE. The business rule is "a listing must carry an
-- uploaded picture". That is enforced here as: a listing cannot be PUBLISHED
-- without one, unless it is linked to a provision (in which case it falls
-- back to the catalogue photograph, which is 0055's documented behaviour and
-- is preserved). A draft may exist without an image, which is what lets the
-- Admin Portal create the row first and upload the file to it immediately
-- afterwards — keeping the existing magic-byte validation, generated UUID
-- file keys and row-updated-before-file-deleted ordering untouched.
--
-- pgAdmin variant, same convention as 0053/0054/0055: explicit BEGIN; and
-- COMMIT;, no psql meta-commands, and no SET ROLE (objects stay owned by
-- postgres, consistent with all 69 existing tables).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-state assertions. Inside the transaction, so a failure aborts
--    everything and changes nothing.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  n integer;
BEGIN
  IF to_regclass('rik.new_arrivals') IS NULL THEN
    RAISE EXCEPTION
      'Migration 0056: rik.new_arrivals does not exist. Apply 0055 first.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='rik' AND table_name='new_arrivals'
                AND column_name='product_name') THEN
    RAISE EXCEPTION
      'Migration 0056: product_name already exists. This migration has already been applied.';
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE';
  IF n <> 69 THEN
    RAISE EXCEPTION
      'Migration 0056: expected 69 base tables before this migration, found %. Stop and investigate.', n;
  END IF;

  SELECT count(*) INTO n FROM information_schema.views
   WHERE table_schema IN ('shared','rik','pif');
  IF n <> 5 THEN
    RAISE EXCEPTION 'Migration 0056: expected 5 views, found %.', n;
  END IF;
END;
$pre$;

-- ---------------------------------------------------------------------------
-- 1. The staff-typed product name
--
-- Nullable, because a listing LINKED to a provision takes its name from the
-- catalogue and must not carry a second, divergent copy of it. The identity
-- constraint below is what makes sure one of the two is always present.
-- ---------------------------------------------------------------------------
ALTER TABLE rik.new_arrivals ADD COLUMN IF NOT EXISTS product_name text;

COMMENT ON COLUMN rik.new_arrivals.product_name IS
  'Staff-typed product name for a standalone listing. NULL when provision_id is set, in which case the name comes from rik.provisions. Display only: never an entitlement, catalogue or stock reference.';

-- ---------------------------------------------------------------------------
-- 2. The catalogue link becomes optional
-- ---------------------------------------------------------------------------
ALTER TABLE rik.new_arrivals ALTER COLUMN provision_id DROP NOT NULL;

COMMENT ON COLUMN rik.new_arrivals.provision_id IS
  'Optional link to the RIK provision this listing features. NULL for a standalone listing. When set, the foreign key is still ON DELETE RESTRICT, so a featured provision cannot be deleted out from under its listing.';

-- ---------------------------------------------------------------------------
-- 3. Constraints that keep the table honest
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- A name, if given, is a label rather than an article; blank is not a name.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='rik.new_arrivals'::regclass
                    AND conname='rik_new_arrivals_product_name_len') THEN
    ALTER TABLE rik.new_arrivals
      ADD CONSTRAINT rik_new_arrivals_product_name_len
      CHECK (product_name IS NULL
             OR char_length(btrim(product_name)) BETWEEN 1 AND 140);
  END IF;

  -- Every listing names its product exactly one way: from the catalogue, or
  -- by hand. A row with neither has nothing to show a customer.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='rik.new_arrivals'::regclass
                    AND conname='rik_new_arrivals_identity_chk') THEN
    ALTER TABLE rik.new_arrivals
      ADD CONSTRAINT rik_new_arrivals_identity_chk
      CHECK (provision_id IS NOT NULL
             OR btrim(coalesce(product_name, '')) <> '');
  END IF;

  -- A standalone listing cannot go live without a picture. A linked one may,
  -- because it falls back to the provision's own photograph.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='rik.new_arrivals'::regclass
                    AND conname='rik_new_arrivals_publishable_chk') THEN
    ALTER TABLE rik.new_arrivals
      ADD CONSTRAINT rik_new_arrivals_publishable_chk
      CHECK (is_published = false
             OR provision_id IS NOT NULL
             OR image_ref IS NOT NULL);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  n integer;
BEGIN
  -- The column exists and is nullable.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='rik' AND table_name='new_arrivals'
                    AND column_name='product_name' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'Migration 0056: product_name is missing or not nullable.';
  END IF;

  -- provision_id is now optional.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='rik' AND table_name='new_arrivals'
                AND column_name='provision_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Migration 0056: provision_id is still NOT NULL.';
  END IF;

  -- The foreign key and its RESTRICT survived untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class child  ON child.oid  = c.conrelid
      JOIN pg_class parent ON parent.oid = c.confrelid
      JOIN pg_namespace cn ON cn.oid = child.relnamespace
      JOIN pg_namespace pn ON pn.oid = parent.relnamespace
     WHERE c.contype='f'
       AND cn.nspname='rik' AND child.relname='new_arrivals'
       AND pn.nspname='rik' AND parent.relname='provisions'
       AND c.confdeltype='r'
  ) THEN
    RAISE EXCEPTION 'Migration 0056: the foreign key to rik.provisions is missing or is no longer ON DELETE RESTRICT.';
  END IF;

  -- The provision uniqueness index is still there.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='rik' AND tablename='new_arrivals'
                    AND indexname='rik_new_arrivals_provision_uq') THEN
    RAISE EXCEPTION 'Migration 0056: rik_new_arrivals_provision_uq is missing.';
  END IF;

  -- Grants are unchanged: app_rik writes, app_reporting_rik reads, no PIF role.
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='rik' AND table_name='new_arrivals'
                AND grantee IN ('app_pif','app_reporting_pif')) THEN
    RAISE EXCEPTION 'Migration 0056: a PIF role has access to rik.new_arrivals.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                  WHERE table_schema='rik' AND table_name='new_arrivals'
                    AND grantee='app_rik' AND privilege_type='INSERT') THEN
    RAISE EXCEPTION 'Migration 0056: app_rik can no longer write to rik.new_arrivals.';
  END IF;

  -- No entitlement or stock concept reached the table. Same list 0055 used.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='rik' AND table_name='new_arrivals'
                AND column_name IN ('consumption_ratio','max_quantity','max_packs',
                                    'min_eligible_days','pack_size','quantity',
                                    'stock_qty','is_eligible')) THEN
    RAISE EXCEPTION 'Migration 0056: an entitlement or stock column reached rik.new_arrivals.';
  END IF;

  -- The catalogue is untouched and still populated.
  SELECT count(*) INTO n FROM rik.provisions;
  IF n = 0 THEN
    RAISE EXCEPTION 'Migration 0056: rik.provisions is empty; this migration must never alter the catalogue.';
  END IF;

  -- Still 69 tables and 5 views: this migration adds neither.
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema IN ('shared','rik','pif') AND table_type='BASE TABLE';
  IF n <> 69 THEN
    RAISE EXCEPTION 'Migration 0056: table count changed to %. It must stay 69.', n;
  END IF;

  -- Permissions and roles unchanged.
  SELECT count(*) INTO n FROM shared.permissions;
  IF n <> 22 THEN
    RAISE EXCEPTION 'Migration 0056: expected 22 permissions, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM shared.roles;
  IF n <> 6 THEN
    RAISE EXCEPTION 'Migration 0056: expected 6 roles, found %.', n;
  END IF;
END;
$verify$;

COMMIT;

-- ===========================================================================
-- After COMMIT the table still numbers 69 of 69, so schema-contract.ts needs
-- NO change and the API does not need restarting for the contract's sake.
-- The application code that reads product_name does need to land, and the
-- New Arrivals endpoints will fail until it does.
-- ===========================================================================
