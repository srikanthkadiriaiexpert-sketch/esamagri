-- ---------------------------------------------------------------------------
-- 0044_officer_rik_id.sql
--
-- STEP 15B PHASE A — give every officer a permanent, system-issued identifier,
-- and give the facility's eligibility sheet something stable to match against.
--
-- RECONSTRUCTED, 8 October 2026. The original 0044 was lost with the working
-- container (see RECOVERY-REPORT.md). This file is rebuilt from the approved
-- Phase A report, which specifies every object below by name, together with
-- the two defects found and corrected during Phase A. It is a reconstruction
-- from that report, NOT the recovered original bytes.
--
-- WHAT THIS ADDS
--
--   shared.officer_rik_id_seq            the number supply
--   shared.format_officer_rik_id(bigint) the only place the format is written
--   shared.customers.rik_id              RIK-O-######, permanent, unique
--   shared.customers.official_name       the facility's name for the officer
--   shared.customers.created_by          the staff member who registered them
--
-- THREE IDENTIFIER NAMESPACES, DELIBERATELY UNMISTAKABLE
--
--   RIK-O-######      an officer                 (this migration)
--   RIK-######        a confirmed selection      (migration 0029)
--   -- a third, for eligibility import batches, arrives in Phase B.
--
-- The officer namespace carries the -O- segment precisely so that no human or
-- regular expression can confuse an officer with a confirmation. The
-- selection reference system in 0029 is NOT touched here.
--
-- WHY A FORMATTING FUNCTION AND NOT to_char()
--
-- The first draft of this migration used
--
--     to_char(n, 'FM000000')
--
-- which is FIXED WIDTH: at 1,000,000 it does not widen, it overflows to the
-- literal text '######', so the millionth officer would have been issued
-- 'RIK-O-######'. The obvious repair, lpad(n::text, 6, '0'), is worse —
-- lpad TRUNCATES when the input is longer than the width, so 1000000 would
-- silently become '100000', colliding with an officer who already exists.
--
-- Hence the CASE below: pad to six digits while the number fits in six, and
-- let it grow beyond that. Six digits is the minimum, not the maximum. The
-- verification block asserts both ends, including 1,000,000 and 12,345,678.
--
-- NOTE ON PRE-EXISTING TECHNICAL DEBT. rik.selection_reference_seq
-- (migration 0029) has the same latent fixed-width overflow. It is reported
-- and deliberately NOT changed here — it is separate debt, and its
-- identifiers are already in circulation.
--
-- PERMANENCE
--
-- A RIK ID is for life. It appears on issue records, vouchers and
-- correspondence, so it may never be renumbered and may never be reused. The
-- column therefore carries a BEFORE UPDATE OF rik_id trigger that refuses any
-- change outright, and officers are deactivated rather than deleted (the
-- application has no delete path at all).
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * it collects no service number, rank, unit, Aadhaar or PAN — the
--     specification prohibits them, so there is no column to hold one;
--   * it records no eligible days. Eligibility is facility data arriving
--     through its own import (Phase B); registration does not create an
--     eligibility row;
--   * it adds no table, no view, no role and no permission. Officer
--     registration is governed by the existing rik.entitlement.allocate;
--   * it does not touch the entitlement engine, any pool, scale, conversion
--     or provision — all four counts are verified unchanged.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. The number supply
--
-- A dedicated sequence, so officer numbering can never interleave with the
-- selection reference sequence. NO CYCLE: an identifier is never reused, so
-- wrapping round to 1 must be impossible rather than merely unlikely.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S' AND n.nspname = 'shared' AND c.relname = 'officer_rik_id_seq'
  ) THEN
    CREATE SEQUENCE shared.officer_rik_id_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
  END IF;
END;
$$;

COMMENT ON SEQUENCE shared.officer_rik_id_seq IS
  'STEP 15B Phase A: supplies officer RIK ID numbers. Never reused, never cycled.';

-- ---------------------------------------------------------------------------
-- 2. The format, in exactly one place
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.format_officer_rik_id(n bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'RIK-O-' || CASE WHEN n < 1000000 THEN lpad(n::text, 6, '0') ELSE n::text END;
$$;

COMMENT ON FUNCTION shared.format_officer_rik_id(bigint) IS
  'STEP 15B Phase A: renders an officer RIK ID as RIK-O-###### — six digits minimum, widening rather than overflowing or truncating.';

-- ---------------------------------------------------------------------------
-- 3. The columns
--
-- rik_id arrives with a DEFAULT so the identifier is issued at the DATABASE
-- boundary. The application never composes one, never sends one, and cannot
-- get it wrong; the officers repository deliberately omits the column from
-- its INSERT so the default fires.
--
-- official_name is the facility's own spelling of the officer's name, kept
-- separate from `name` (which the officer may edit themselves) so that a
-- future eligibility import has a stable value to verify against.
--
-- created_by is nullable: officers who existed before this migration were not
-- registered by anyone, and inventing an actor for them would be a lie.
-- ---------------------------------------------------------------------------
ALTER TABLE shared.customers ADD COLUMN IF NOT EXISTS rik_id        text;
ALTER TABLE shared.customers ADD COLUMN IF NOT EXISTS official_name text;
ALTER TABLE shared.customers ADD COLUMN IF NOT EXISTS created_by    uuid;

-- ---------------------------------------------------------------------------
-- 4. Backfill — deterministic, and in the officers' own order
--
-- row_number() over (ORDER BY created_at, id) rather than physical order:
-- heap order is an implementation detail that VACUUM or an UPDATE can change,
-- so numbering by it would hand out different identifiers on a rebuild. `id`
-- breaks a tie on identical created_at, and because the ids are UUIDv7 that
-- tie-break is itself chronological.
-- ---------------------------------------------------------------------------
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM shared.customers
   WHERE rik_id IS NULL
)
UPDATE shared.customers c
   SET rik_id = shared.format_officer_rik_id(o.rn)
  FROM ordered o
 WHERE c.id = o.id;

-- Advance the sequence past whatever the backfill consumed, so the next
-- registration cannot be issued an identifier that already exists. Skipped
-- entirely on an empty table, because setval(…, 0) is not a legal value.
DO $$
DECLARE
  issued bigint;
BEGIN
  SELECT count(*) INTO issued FROM shared.customers WHERE rik_id IS NOT NULL;
  IF issued > 0 THEN
    PERFORM setval('shared.officer_rik_id_seq', issued, true);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Now the column can be required, and defaulted
-- ---------------------------------------------------------------------------
ALTER TABLE shared.customers
  ALTER COLUMN rik_id SET DEFAULT shared.format_officer_rik_id(nextval('shared.officer_rik_id_seq'));

ALTER TABLE shared.customers ALTER COLUMN rik_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Constraints
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'shared.customers'::regclass AND conname = 'customers_rik_id_uq'
  ) THEN
    ALTER TABLE shared.customers ADD CONSTRAINT customers_rik_id_uq UNIQUE (rik_id);
  END IF;

  -- Six digits MINIMUM, not exactly six: the pattern must keep accepting the
  -- identifier after the number widens past 999,999.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'shared.customers'::regclass AND conname = 'shared_customers_rik_id_chk'
  ) THEN
    ALTER TABLE shared.customers
      ADD CONSTRAINT shared_customers_rik_id_chk CHECK (rik_id ~ '^RIK-O-[0-9]{6,}$');
  END IF;

  -- Absent is a legitimate state; blank is not. A whitespace-only official
  -- name would silently defeat the import's name verification.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'shared.customers'::regclass AND conname = 'shared_customers_official_name_chk'
  ) THEN
    ALTER TABLE shared.customers
      ADD CONSTRAINT shared_customers_official_name_chk
      CHECK (official_name IS NULL OR btrim(official_name) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'shared.customers'::regclass AND conname = 'customers_created_by_fk'
  ) THEN
    ALTER TABLE shared.customers
      ADD CONSTRAINT customers_created_by_fk FOREIGN KEY (created_by) REFERENCES shared.users (id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS customers_created_by_idx ON shared.customers (created_by);

-- ---------------------------------------------------------------------------
-- 7. Permanence — the identifier cannot be renumbered
--
-- Scoped to UPDATE OF rik_id so that every other column on the row stays
-- freely editable: an officer may change their name, their diet or their
-- status without fighting this trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.trg_protect_officer_rik_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rik_id IS NOT DISTINCT FROM OLD.rik_id THEN
    RETURN NEW; -- not a change to the identifier
  END IF;

  RAISE EXCEPTION
    'A RIK ID is permanent. Officer % cannot be renumbered from % to %.',
    OLD.id, OLD.rik_id, NEW.rik_id
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS protect_officer_rik_id ON shared.customers;
CREATE TRIGGER protect_officer_rik_id
  BEFORE UPDATE OF rik_id ON shared.customers
  FOR EACH ROW EXECUTE FUNCTION shared.trg_protect_officer_rik_id();

-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- The DEFAULT above calls nextval() as the INSERTING role, so the application
-- role needs USAGE on the sequence or every registration fails.
-- ---------------------------------------------------------------------------
GRANT USAGE, SELECT ON SEQUENCE shared.officer_rik_id_seq TO app_shared;

COMMENT ON COLUMN shared.customers.rik_id IS
  'STEP 15B Phase A: permanent system-issued officer identifier, RIK-O-######. Never reused, never renumbered.';
COMMENT ON COLUMN shared.customers.official_name IS
  'STEP 15B Phase A: the facility''s own spelling of the officer''s name, used to verify an eligibility import. Distinct from `name`, which the officer may edit.';
COMMENT ON COLUMN shared.customers.created_by IS
  'STEP 15B Phase A: the staff member who registered this officer. NULL for officers who predate administrative registration.';

-- ---------------------------------------------------------------------------
-- 9. Verification — fail loudly rather than leave a half-applied change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pools   integer;
  scales  integer;
  convs   integer;
  provs   integer;
  tabs    integer;
  vws     integer;
  nulls   integer;
  bad     integer;
  dupes   integer;
BEGIN
  -- The format function widens, and never overflows or truncates.
  IF shared.format_officer_rik_id(1)        <> 'RIK-O-000001'   THEN
    RAISE EXCEPTION 'Migration 0044: RIK ID for 1 is %.', shared.format_officer_rik_id(1);
  END IF;
  IF shared.format_officer_rik_id(999999)   <> 'RIK-O-999999'   THEN
    RAISE EXCEPTION 'Migration 0044: RIK ID for 999999 is %.', shared.format_officer_rik_id(999999);
  END IF;
  IF shared.format_officer_rik_id(1000000)  <> 'RIK-O-1000000'  THEN
    RAISE EXCEPTION 'Migration 0044: the RIK ID does not widen past six digits — %.',
      shared.format_officer_rik_id(1000000);
  END IF;
  IF shared.format_officer_rik_id(12345678) <> 'RIK-O-12345678' THEN
    RAISE EXCEPTION 'Migration 0044: RIK ID for 12345678 is %.', shared.format_officer_rik_id(12345678);
  END IF;

  -- Every officer carries one, in the approved format, and no two share it.
  SELECT count(*) INTO nulls FROM shared.customers WHERE rik_id IS NULL;
  IF nulls > 0 THEN
    RAISE EXCEPTION 'Migration 0044: % officer(s) have no RIK ID after the backfill.', nulls;
  END IF;
  SELECT count(*) INTO bad FROM shared.customers WHERE rik_id !~ '^RIK-O-[0-9]{6,}$';
  IF bad > 0 THEN
    RAISE EXCEPTION 'Migration 0044: % officer RIK ID(s) are not in the approved format.', bad;
  END IF;
  SELECT count(*) INTO dupes FROM (
    SELECT rik_id FROM shared.customers GROUP BY rik_id HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'Migration 0044: % officer RIK ID(s) are shared by more than one officer.', dupes;
  END IF;

  -- The structures themselves.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'shared.customers'::regclass
       AND tgname = 'protect_officer_rik_id' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 0044: the RIK ID permanence trigger is missing.';
  END IF;
  IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger
       WHERE tgrelid = 'shared.customers'::regclass AND tgname = 'protect_officer_rik_id')
     NOT LIKE '%BEFORE UPDATE OF rik_id%' THEN
    RAISE EXCEPTION 'Migration 0044: the permanence trigger is not scoped to UPDATE OF rik_id.';
  END IF;
  IF (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
       WHERE adrelid = 'shared.customers'::regclass
         AND adnum = (SELECT attnum FROM pg_attribute
                       WHERE attrelid = 'shared.customers'::regclass AND attname = 'rik_id'))
     NOT LIKE '%format_officer_rik_id%' THEN
    RAISE EXCEPTION 'Migration 0044: rik_id does not default to the formatting function.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'shared.customers'::regclass
       AND conname IN ('customers_rik_id_uq')
  ) THEN
    RAISE EXCEPTION 'Migration 0044: the RIK ID unique constraint is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'shared.customers'::regclass
       AND conname = 'customers_created_by_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Migration 0044: the created_by foreign key is missing.';
  END IF;

  -- The prohibited identity columns were NOT added.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'shared' AND table_name = 'customers'
       AND column_name IN ('service_number', 'rank', 'unit', 'aadhaar', 'aadhaar_number', 'pan', 'pan_number')
  ) THEN
    RAISE EXCEPTION 'Migration 0044: a prohibited identity column exists on shared.customers.';
  END IF;

  -- The selection reference namespace is untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S' AND n.nspname = 'rik' AND c.relname = 'selection_reference_seq'
  ) THEN
    RAISE EXCEPTION 'Migration 0044: the selection reference sequence is missing.';
  END IF;

  -- Nothing in the entitlement configuration moved.
  SELECT count(*) INTO pools  FROM rik.entitlement_pools;
  SELECT count(*) INTO scales FROM rik.pool_scales;
  SELECT count(*) INTO convs  FROM rik.pool_conversions;
  SELECT count(*) INTO provs  FROM rik.provisions;
  IF pools <> 18 OR scales <> 50 OR convs <> 7 OR provs <> 189 THEN
    RAISE EXCEPTION
      'Migration 0044: RIK configuration changed — pools %, scales %, conversions %, provisions %; expected 18/50/7/189.',
      pools, scales, convs, provs;
  END IF;

  -- Columns are not tables: the schema contract does not move for this file.
  SELECT count(*) INTO tabs FROM pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO vws  FROM pg_views  WHERE schemaname IN ('shared', 'rik', 'pif');
  IF tabs <> 56 OR vws <> 5 THEN
    RAISE EXCEPTION 'Migration 0044: expected 56 tables and 5 views, found % and %.', tabs, vws;
  END IF;
END;
$$;

RESET ROLE;
