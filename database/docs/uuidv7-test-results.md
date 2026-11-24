# UUIDv7 generator — validation results

`shared.uuid_generate_v7()` (migration `0002_shared_uuidv7.sql`) was tested against a live PostgreSQL 16.13 instance (satisfies the "PostgreSQL 15+" target). All checks you required were executed for real, not asserted from reading the code.

| # | Check | Method | Result |
|---|-------|--------|--------|
| 1 | Version nibble = 7 | 10,000 generated values, hex digit 13 checked | **PASS** — 0/10,000 failures |
| 2 | RFC 9562 variant bits (`10xx`) | 10,000 generated values, hex digit 17 checked ∈ {8,9,a,b} | **PASS** — 0/10,000 failures |
| 3 | Timestamp round-trip | Generate one UUID, decode its embedded ms timestamp, assert it falls inside the exact `clock_timestamp()` window bracketing generation | **PASS** — embedded timestamp `2026-09-08 16:30:28.126+00`, generation window 0.070ms |
| 4 | Monotonic time-ordering | 3 bursts of 50 values, real 50ms `pg_sleep` between bursts; asserted raw-UUID lexicographic order *and* decoded-timestamp order both increase monotonically across bursts | **PASS** — both orderings monotonic across all 3 bursts |
| 5 | Bulk uniqueness | 1,000,000 values generated in a single session, `count(*)` vs `count(DISTINCT id)` | **PASS** — 1,000,000 distinct, 0 collisions, generated in 8.7s |
| 6 | Concurrent-session uniqueness | 20 separate `psql` backend processes (real OS processes, real separate connections/transactions, not just separate statements), 20,000 inserts each, into one shared unlogged table | **PASS** — 400,000 rows, 400,000 distinct, 0 collisions across concurrent backends |

## What this does and does not claim

This implementation is **RFC 9562-shaped** (correct version nibble, correct variant bits, 48-bit millisecond timestamp in the high-order bits, time-ordered) and has been tested at the volumes above with zero failures. It is **not** claimed to be a certified/reference RFC 9562 implementation — no formal conformance test suite was run against it, and the specification allows implementation freedom in how `rand_a`/`rand_b` are sourced, which this implementation exercises by drawing entropy from two `gen_random_uuid()` calls rather than a counter or a monotonic sub-millisecond sequence.

Two properties worth flagging explicitly:

- **Sub-millisecond ordering is not guaranteed.** Two values generated inside the same millisecond are ordered by their random `rand_a`/`rand_b` bits, not by generation order. This matches the RFC 9562 default (Method 1: fixed-length dedicated random bits) and is why check #4 used a real sleep between bursts rather than asserting order on same-millisecond values.
- **No extension was installed.** Per your instruction not to add an extension without reporting it first: none was used. The implementation is pure PL/pgSQL plus PostgreSQL's built-in `gen_random_uuid()` (core since PG 13).

## Reproducing these results

```
sudo -u postgres psql -d esamagri_test -v ON_ERROR_STOP=1 -f tests/000_uuidv7_validation.sql
bash tests/000b_uuidv7_concurrency.sh
```

Both are idempotent and leave no data behind (temp tables / dropped unlogged table).
