-- =============================================================================
-- Migration 0002: shared.uuid_generate_v7()
--
-- Phase 2 Rev1 Section 11 mandates "every primary key is a UUID v7
-- default-generated surrogate" but never specifies a generation mechanism,
-- and PostgreSQL 15/16 have no built-in UUIDv7 function (native uuidv7()
-- lands in PG 18). Per your approval: implement a self-contained SQL-side
-- generator, no external extension, rigorously tested (see
-- tests/000_uuidv7_validation.sql and docs/uuidv7-test-results.md).
--
-- RFC 9562 UUIDv7 layout (128 bits, 32 hex digits):
--   bits   0-47  : unix_ts_ms       (48 bits, big-endian milliseconds since epoch)
--   bits  48-51  : version          (4 bits, fixed 0111 = 0x7)
--   bits  52-63  : rand_a           (12 bits, random)
--   bits  64-65  : variant          (2 bits, fixed 10)
--   bits  66-127 : rand_b           (62 bits, random)
--
-- This implementation sources all randomness from two core gen_random_uuid()
-- calls (a cryptographically-strong RNG built into PostgreSQL since v13,
-- no pgcrypto extension required) rather than random()'s float-based RNG,
-- to avoid the entropy/precision weaknesses of multiplying random() into a
-- 60-bit integer range.
-- =============================================================================

CREATE OR REPLACE FUNCTION shared.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  ts_ms          bigint;
  ts_hex         text;
  entropy        text;
  rand_a         text;   -- 3 hex digits  = 12 bits
  variant_nibble text;   -- 1 hex digit, top 2 bits fixed '10' -> {8,9,a,b}
  rand_b         text;   -- 15 hex digits = 60 bits
  hex32          text;
BEGIN
  ts_ms  := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  ts_hex := lpad(to_hex(ts_ms), 12, '0');

  -- 256 bits of strong randomness from two independent UUIDs; we only need
  -- 76 bits (rand_a 12 + variant-free-bits 2 + rand_b 60), so this is ample.
  entropy := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  rand_a := substr(entropy, 1, 3);

  -- Fixed top bits '10' (values 1000..1011 = 8,9,a,b in hex), low 2 bits
  -- of the nibble drawn from the entropy pool (uniform 0-15 mod 4 = uniform 0-3).
  variant_nibble := to_hex(8 + ((('x' || substr(entropy, 4, 1))::bit(4)::int) % 4));

  rand_b := substr(entropy, 5, 15);

  hex32 := ts_hex || '7' || rand_a || variant_nibble || rand_b;

  RETURN (
    substr(hex32, 1, 8)  || '-' ||
    substr(hex32, 9, 4)  || '-' ||
    substr(hex32, 13, 4) || '-' ||
    substr(hex32, 17, 4) || '-' ||
    substr(hex32, 21, 12)
  )::uuid;
END;
$$;

COMMENT ON FUNCTION shared.uuid_generate_v7() IS
  'RFC 9562 UUIDv7 generator: 48-bit ms timestamp + version 7 + 12-bit rand_a + RFC variant (10) + 62-bit rand_b. Randomness sourced from core gen_random_uuid(), no extension required. Used as DEFAULT on every table id column per Phase 2 Rev1 Section 11. See tests/000_uuidv7_validation.sql for correctness/uniqueness/ordering verification.';

-- Convenience: extract the embedded timestamp back out of a v7 UUID, used
-- only by the validation tests below (not part of the approved Phase 2
-- function inventory — this is a test helper, not application-facing).
CREATE OR REPLACE FUNCTION shared.uuid_v7_extract_timestamp(u uuid)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_timestamp(
    ('x' || substr(replace(u::text, '-', ''), 1, 12))::bit(48)::bigint / 1000.0
  );
$$;

COMMENT ON FUNCTION shared.uuid_v7_extract_timestamp(uuid) IS
  'Test/diagnostic helper only: decodes the 48-bit millisecond timestamp embedded in a shared.uuid_generate_v7() value. Not part of the Phase 2 function inventory.';
