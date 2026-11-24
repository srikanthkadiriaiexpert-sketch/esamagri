#!/usr/bin/env bash
# Cross-session concurrency check for shared.uuid_generate_v7().
#
# Launches N concurrent psql backends (separate connections/transactions,
# not just separate statements in one session), each generating M UUIDs
# into a shared unlogged table, then verifies zero collisions across all
# N*M values combined. This is the "concurrent transactions" requirement
# that a single-session test (000_uuidv7_validation.sql) cannot exercise,
# since PostgreSQL sequences/random sources are per-backend.
set -euo pipefail

DB=esamagri_test
SESSIONS=20
PER_SESSION=20000
PSQL="sudo -u postgres psql -d ${DB} -qtA"

echo "Setting up shared collector table..."
${PSQL} -c "DROP TABLE IF EXISTS t_concurrent_uuid;"
${PSQL} -c "CREATE UNLOGGED TABLE t_concurrent_uuid (id uuid NOT NULL, session_no int NOT NULL);"

echo "Launching ${SESSIONS} concurrent backends, ${PER_SESSION} inserts each..."
pids=()
for i in $(seq 1 "${SESSIONS}"); do
  (
    ${PSQL} -c "INSERT INTO t_concurrent_uuid (id, session_no) SELECT shared.uuid_generate_v7(), ${i} FROM generate_series(1, ${PER_SESSION});"
  ) &
  pids+=($!)
done

fail=0
for pid in "${pids[@]}"; do
  wait "${pid}" || fail=1
done

if [ "${fail}" -ne 0 ]; then
  echo "FAIL: one or more concurrent sessions errored"
  exit 1
fi

echo "All ${SESSIONS} sessions completed. Verifying..."
TOTAL=$(${PSQL} -c "SELECT count(*) FROM t_concurrent_uuid;")
DISTINCT=$(${PSQL} -c "SELECT count(DISTINCT id) FROM t_concurrent_uuid;")
EXPECTED=$((SESSIONS * PER_SESSION))

echo "Expected rows: ${EXPECTED}"
echo "Actual rows:   ${TOTAL}"
echo "Distinct ids:  ${DISTINCT}"

if [ "${TOTAL}" -ne "${EXPECTED}" ]; then
  echo "FAIL: expected ${EXPECTED} total rows, got ${TOTAL} (a session may have failed silently)"
  exit 1
fi

if [ "${TOTAL}" -ne "${DISTINCT}" ]; then
  echo "FAIL: $((TOTAL - DISTINCT)) collision(s) across ${SESSIONS} concurrent sessions"
  exit 1
fi

echo "PASS: ${TOTAL} UUIDs generated across ${SESSIONS} concurrent backend sessions, zero collisions."

${PSQL} -c "DROP TABLE t_concurrent_uuid;"
echo "Cleanup done."
