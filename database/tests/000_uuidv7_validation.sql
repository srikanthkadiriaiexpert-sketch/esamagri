-- =============================================================================
-- UUIDv7 generator validation — run BEFORE trusting shared.uuid_generate_v7()
-- as the PK default for the rest of Phase 3A.
--
-- Checks, per your explicit requirements:
--   1. Version nibble is 7 on every generated value
--   2. Variant bits are RFC-compatible (top 2 bits of byte 8 = '10')
--   3. Timestamp bits round-trip correctly against the wall clock
--   4. Values generated later have a later (or equal) embedded timestamp —
--      i.e. genuinely time-ordered, not random
--   5. Bulk uniqueness at volume (1,000,000 values, zero collisions)
--   6. No collisions across concurrent, separate backend sessions
--
-- Every check RAISEs an EXCEPTION on failure, so a clean run to completion
-- with only NOTICEs is a pass. This file is idempotent and leaves no data
-- behind (temp tables only).
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1 & 2: version + variant bits, sampled across 10,000 generated values
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad_version int;
  bad_variant int;
BEGIN
  CREATE TEMP TABLE t_uuid_sample AS
  SELECT shared.uuid_generate_v7() AS id FROM generate_series(1, 10000);

  SELECT count(*) INTO bad_version
  FROM t_uuid_sample
  WHERE substr(replace(id::text, '-', ''), 13, 1) <> '7';

  IF bad_version <> 0 THEN
    RAISE EXCEPTION 'UUIDv7 FAIL: % of 10000 values do not have version nibble = 7', bad_version;
  END IF;
  RAISE NOTICE 'PASS: version nibble is 7 on all 10000 sampled values';

  -- Variant nibble (hex digit 17, 1-indexed into the 32-hex-digit string)
  -- must be in {8,9,a,b} — top two bits '10'.
  SELECT count(*) INTO bad_variant
  FROM t_uuid_sample
  WHERE substr(replace(id::text, '-', ''), 17, 1) NOT IN ('8','9','a','b');

  IF bad_variant <> 0 THEN
    RAISE EXCEPTION 'UUIDv7 FAIL: % of 10000 values do not have RFC variant bits (10xx)', bad_variant;
  END IF;
  RAISE NOTICE 'PASS: RFC variant bits (10xx) correct on all 10000 sampled values';

  DROP TABLE t_uuid_sample;
END $$;

-- ---------------------------------------------------------------------------
-- 3: timestamp round-trip — embedded timestamp must be within a tight
--    tolerance of clock_timestamp() at generation time
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_before timestamptz := clock_timestamp();
  v_extracted timestamptz;
  v_after timestamptz;
  v_drift_ms numeric;
BEGIN
  v_id := shared.uuid_generate_v7();
  v_after := clock_timestamp();
  v_extracted := shared.uuid_v7_extract_timestamp(v_id);

  IF v_extracted < v_before - interval '50 milliseconds'
     OR v_extracted > v_after + interval '50 milliseconds' THEN
    RAISE EXCEPTION 'UUIDv7 FAIL: extracted timestamp % not within [%, %] (generation window)',
      v_extracted, v_before, v_after;
  END IF;

  v_drift_ms := extract(epoch FROM (v_after - v_before)) * 1000;
  RAISE NOTICE 'PASS: embedded timestamp % round-trips correctly (generation window was %ms)', v_extracted, round(v_drift_ms, 3);
END $$;

-- ---------------------------------------------------------------------------
-- 4: monotonic time-ordering — generate in three separate bursts with a
--    real sleep between them; each burst's values must sort after the
--    previous burst's, both by raw UUID value (lexicographic = chronological
--    for UUIDv7 by design) and by the extracted timestamp.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  max_burst1 uuid;
  min_burst2 uuid;
  max_burst2 uuid;
  min_burst3 uuid;
  ts1 timestamptz;
  ts2 timestamptz;
BEGIN
  CREATE TEMP TABLE t_ordering (burst int, id uuid);

  INSERT INTO t_ordering SELECT 1, shared.uuid_generate_v7() FROM generate_series(1,50);
  PERFORM pg_sleep(0.05);
  INSERT INTO t_ordering SELECT 2, shared.uuid_generate_v7() FROM generate_series(1,50);
  PERFORM pg_sleep(0.05);
  INSERT INTO t_ordering SELECT 3, shared.uuid_generate_v7() FROM generate_series(1,50);

  SELECT id INTO max_burst1 FROM t_ordering WHERE burst = 1 ORDER BY id DESC LIMIT 1;
  SELECT id INTO min_burst2 FROM t_ordering WHERE burst = 2 ORDER BY id ASC  LIMIT 1;
  SELECT id INTO max_burst2 FROM t_ordering WHERE burst = 2 ORDER BY id DESC LIMIT 1;
  SELECT id INTO min_burst3 FROM t_ordering WHERE burst = 3 ORDER BY id ASC  LIMIT 1;

  -- Raw UUID (text/byte) ordering must reflect chronological order, since
  -- that is the entire point of putting the timestamp in the high bits.
  IF NOT (max_burst1 < min_burst2 AND max_burst2 < min_burst3) THEN
    RAISE EXCEPTION 'UUIDv7 FAIL: raw UUID ordering is not chronological across sleep-separated bursts (max_burst1=%, min_burst2=%, max_burst2=%, min_burst3=%)',
      max_burst1, min_burst2, max_burst2, min_burst3;
  END IF;
  RAISE NOTICE 'PASS: raw UUID lexicographic order matches generation order across 3 sleep-separated bursts of 50';

  SELECT shared.uuid_v7_extract_timestamp(max_burst1) INTO ts1;
  SELECT shared.uuid_v7_extract_timestamp(min_burst2) INTO ts2;
  IF ts2 < ts1 THEN
    RAISE EXCEPTION 'UUIDv7 FAIL: extracted timestamps not monotonic across bursts (burst1 max ts=%, burst2 min ts=%)', ts1, ts2;
  END IF;
  RAISE NOTICE 'PASS: extracted timestamps are monotonic across bursts (burst1 max=%, burst2 min=%)', ts1, ts2;

  DROP TABLE t_ordering;
END $$;

-- ---------------------------------------------------------------------------
-- 5: bulk uniqueness at volume — 1,000,000 values, zero duplicates
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_total bigint;
  v_distinct bigint;
  v_start timestamptz := clock_timestamp();
  v_elapsed_ms numeric;
BEGIN
  CREATE TEMP TABLE t_bulk AS
  SELECT shared.uuid_generate_v7() AS id FROM generate_series(1, 1000000);

  SELECT count(*), count(DISTINCT id) INTO v_total, v_distinct FROM t_bulk;
  v_elapsed_ms := extract(epoch FROM (clock_timestamp() - v_start)) * 1000;

  IF v_total <> v_distinct THEN
    RAISE EXCEPTION 'UUIDv7 FAIL: % duplicate value(s) found in 1,000,000 generated UUIDs (% distinct of % total)',
      (v_total - v_distinct), v_distinct, v_total;
  END IF;
  RAISE NOTICE 'PASS: 1,000,000 values generated in %ms, all % distinct, zero collisions', round(v_elapsed_ms,1), v_distinct;

  DROP TABLE t_bulk;
END $$;

\echo 'Single-session validation (checks 1-5) complete — see NOTICEs above for results.'
\echo 'Run tests/000b_uuidv7_concurrency.sh next for the cross-session concurrency check (requires shell access, not plain psql).'
