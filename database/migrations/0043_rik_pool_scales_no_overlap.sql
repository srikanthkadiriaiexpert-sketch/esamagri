-- ---------------------------------------------------------------------------
-- 0043_rik_pool_scales_no_overlap.sql
--
-- STEP 15A (P2) — make "no two active scales for the same pool and diet may
-- cover the same day" a database invariant instead of an application
-- convention.
--
-- WHY THIS EXISTS
--
-- rik.pool_scales already carries UNIQUE (pool_id, dietary_preference,
-- effective_from). That catches only the exact-same START DATE. Two rows for
-- CEREALS/NV running 2026-01-01..open and 2026-06-01..open are both accepted
-- by the database today, and the entitlement engine then resolves the
-- ambiguity silently — its query returns both rows ordered
-- effective_from DESC and the calculator takes the first. Nothing errors and
-- nothing is logged.
--
-- The refusal has lived in the application (RikAdminConfigService raises
-- OVERLAPPING_SCALE after a daterange && test). That check is a read followed
-- by a write, so two concurrent administrators can both pass it and both
-- commit. It is also silent about an overlap arriving by SQL or by a seed.
--
-- This constraint closes that. After it, the application check remains as the
-- polite refusal with a helpful message, and the database is the boundary
-- that cannot be talked past.
--
-- THE PATTERN IS THE PROJECT'S OWN. rik.entitlement_periods has carried
--
--     CONSTRAINT rik_ent_periods_no_overlap
--       EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
--
-- since migration 0008. This is that pattern, scoped to the columns a scale
-- is actually keyed by. btree_gist — which lets a gist index carry the uuid
-- and text equality operators alongside the range overlap operator — has been
-- installed since migration 0001; nothing new is required.
--
-- THE SCOPE IS THE REAL SCOPE, AND NO WIDER
--
--   pool_id            WITH =    two different pools never conflict
--   dietary_preference WITH =    PV, EV and NV are independent rules
--   daterange(effective_from, effective_to, '[]')  WITH &&
--
-- The range is INCLUSIVE at both ends ('[]'), matching the engine's own
-- predicate `effective_from <= $1 AND (effective_to IS NULL OR
-- effective_to >= $1)`: a scale closed on the 31st and its replacement
-- starting on the 1st do not overlap, while two rows both covering the 15th
-- do. A NULL effective_to makes the range unbounded above, which is exactly
-- what an open-ended rule means.
--
--   WHERE (is_active)  a retired row is history, not configuration
--
-- The partial predicate matters. Retiring a scale and writing a replacement
-- over the same window is a legitimate administrative act, and the engine
-- already ignores inactive rows. Without WHERE (is_active) this constraint
-- would forbid it.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It adds one constraint. It writes no data. It does not touch the 50 live
-- scale rows, any quantity, any effective date, any pool, provision,
-- conversion, permission or role. It changes no entitlement mathematics. It
-- carries no unrelated schema cleanup.
--
-- PRE-FLIGHT, VERIFIED BEFORE THIS FILE WAS WRITTEN
--
--   50 scale rows, all is_active, all effective_to NULL
--   50 distinct (pool_id, dietary_preference) pairs — one open window each
--   0 overlapping pairs at this exact scope
--   btree_gist present
--   pool_id uuid, dietary_preference text, effective_from/to date — all
--     supported by btree_gist equality
--
-- The verification block below re-proves the first and last of those at
-- apply time and refuses rather than half-applying.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- Refuse to proceed if the data would not satisfy the constraint.
--
-- ADD CONSTRAINT would fail on its own in that case, but with a message
-- naming a constraint and not the rows. This names the rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  clashes integer;
  r       record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION
      'Migration 0043: the btree_gist extension is required and is not installed.';
  END IF;

  SELECT count(*) INTO clashes
    FROM rik.pool_scales a
    JOIN rik.pool_scales b
      ON b.pool_id = a.pool_id
     AND b.dietary_preference = a.dietary_preference
     AND b.id > a.id
     AND a.is_active AND b.is_active
     AND daterange(a.effective_from, a.effective_to, '[]')
      && daterange(b.effective_from, b.effective_to, '[]');

  IF clashes > 0 THEN
    FOR r IN
      SELECT p.code AS pool_code, a.dietary_preference AS diet,
             a.id AS a_id, a.effective_from AS a_from, a.effective_to AS a_to,
             b.id AS b_id, b.effective_from AS b_from, b.effective_to AS b_to
        FROM rik.pool_scales a
        JOIN rik.pool_scales b
          ON b.pool_id = a.pool_id
         AND b.dietary_preference = a.dietary_preference
         AND b.id > a.id
         AND a.is_active AND b.is_active
         AND daterange(a.effective_from, a.effective_to, '[]')
          && daterange(b.effective_from, b.effective_to, '[]')
        JOIN rik.entitlement_pools p ON p.id = a.pool_id
    LOOP
      RAISE WARNING
        'Migration 0043: % / % overlaps — % (% to %) and % (% to %).',
        r.pool_code, r.diet, r.a_id, r.a_from, COALESCE(r.a_to::text, 'open'),
        r.b_id, r.b_from, COALESCE(r.b_to::text, 'open');
    END LOOP;

    RAISE EXCEPTION
      'Migration 0043: % overlapping active scale pair(s) exist and must be resolved before this constraint can be added. Each is listed above.',
      clashes;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- The invariant. Idempotent: adding it twice is a no-op rather than an error.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.pool_scales'::regclass
       AND conname  = 'rik_pool_scales_no_overlap'
  ) THEN
    ALTER TABLE rik.pool_scales
      ADD CONSTRAINT rik_pool_scales_no_overlap
      EXCLUDE USING gist (
        pool_id            WITH =,
        dietary_preference WITH =,
        daterange(effective_from, effective_to, '[]') WITH &&
      ) WHERE (is_active);
  END IF;
END;
$$;

COMMENT ON CONSTRAINT rik_pool_scales_no_overlap ON rik.pool_scales IS
  'STEP 15A: no two ACTIVE scales for the same pool and dietary preference may cover the same day. The application refuses this first with a readable message; this is the boundary that cannot be talked past.';

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-applied change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n       integer;
  scales  integer;
  pools   integer;
  convs   integer;
  provs   integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'rik.pool_scales'::regclass
     AND conname  = 'rik_pool_scales_no_overlap'
     AND contype  = 'x';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 0043: the exclusion constraint was not created.';
  END IF;

  -- It must be the PARTIAL form. Without WHERE (is_active) it would forbid
  -- retiring a scale and writing a replacement over the same window.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'rik.pool_scales'::regclass
         AND conname  = 'rik_pool_scales_no_overlap') NOT LIKE '%WHERE (is_active)%' THEN
    RAISE EXCEPTION 'Migration 0043: the constraint is not scoped to active rows.';
  END IF;

  -- No business data moved.
  SELECT count(*) INTO scales FROM rik.pool_scales;
  IF scales <> 50 THEN
    RAISE EXCEPTION 'Migration 0043: scale rows changed — % found, expected 50.', scales;
  END IF;
  SELECT count(*) INTO pools FROM rik.entitlement_pools;
  IF pools <> 18 THEN
    RAISE EXCEPTION 'Migration 0043: pool rows changed — % found, expected 18.', pools;
  END IF;
  SELECT count(*) INTO convs FROM rik.pool_conversions;
  IF convs <> 7 THEN
    RAISE EXCEPTION 'Migration 0043: conversions changed — % found, expected 7.', convs;
  END IF;
  SELECT count(*) INTO provs FROM rik.provisions;
  IF provs <> 189 THEN
    RAISE EXCEPTION 'Migration 0043: provisions changed — % found, expected 189.', provs;
  END IF;

  -- The pre-existing unique key stays: it is a cheaper, clearer refusal for
  -- the commonest mistake (the same start date twice) and its message names
  -- that case exactly.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.pool_scales'::regclass
       AND conname  = 'rik_pool_scales_version_uq'
  ) THEN
    RAISE EXCEPTION 'Migration 0043: the existing version unique key is missing.';
  END IF;
END;
$$;

RESET ROLE;
