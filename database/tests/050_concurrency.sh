#!/usr/bin/env bash
# Real cross-process concurrency tests (separate backend connections, not
# just separate statements in one session) for:
#   #4 Entitlement concurrency — two concurrent order-confirm transactions
#      racing against the same category-mode rik.entitlements pool.
#   #9 PIF counter-vs-online conflict — a COUNTER sale and an ONLINE
#      reservation racing against the same pif.inventory row.
#
# Both prove the SELECT ... FOR UPDATE row-lock pattern Phase 2 mandates
# (Section 15 for RIK entitlements, Section 17 for PIF inventory) actually
# serializes the two transactions and prevents over-allocation/overselling
# — not just that the CHECK constraints catch it after the fact.
set -euo pipefail

DB=esamagri_test
PSQL="sudo -u postgres psql -d ${DB} -qtA"
PSQL_NOTICE="sudo -u postgres psql -d ${DB}"

fail=0

echo "=== #4 Entitlement concurrency ==================================="

CUSTOMER_ID=$(${PSQL} -c "INSERT INTO shared.customers (id, mobile_number, name) VALUES (shared.uuid_generate_v7(), '9990000501', 'Concurrency Test Customer') RETURNING id;")
PERIOD_ID=$(${PSQL} -c "INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status) VALUES (shared.uuid_generate_v7(), 'TEST-CONC-2099', '2099-03-01', '2099-03-31', 'ACTIVE') RETURNING id;")
CATEGORY_ID=$(${PSQL} -c "INSERT INTO rik.categories (id, name) VALUES (shared.uuid_generate_v7(), 'TEST-Concurrency-Cat') RETURNING id;")
PROD_A=$(${PSQL} -c "INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES (shared.uuid_generate_v7(), 'TEST-CONC-A', 'Conc Prod A', '${CATEGORY_ID}', 'kg') RETURNING id;")
PROD_B=$(${PSQL} -c "INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES (shared.uuid_generate_v7(), 'TEST-CONC-B', 'Conc Prod B', '${CATEGORY_ID}', 'kg') RETURNING id;")
ENT_ID=$(${PSQL} -c "INSERT INTO rik.entitlements (id, customer_id, category_id, period_id, allocated_qty, unit) VALUES (shared.uuid_generate_v7(), '${CUSTOMER_ID}', '${CATEGORY_ID}', '${PERIOD_ID}', 10, 'kg') RETURNING id;")

echo "Entitlement ${ENT_ID}: allocated 10kg, category pool shared by Product A and Product B."
echo "Backend 1 will RESERVE 7kg against Product A (holds the lock for 2s), Backend 2 RESERVEs 7kg against Product B concurrently."
echo "Correct (locked) outcome: exactly one of the two succeeds; total reserved never exceeds 10."

run_backend() {
  local label=$1 product_id=$2 sleep_s=$3 outfile=$4
  ${PSQL_NOTICE} -v ON_ERROR_STOP=1 <<SQL > "${outfile}" 2>&1
DO \$\$
DECLARE
  v_available numeric;
BEGIN
  PERFORM 1 FROM rik.entitlements WHERE id = '${ENT_ID}' FOR UPDATE;
  PERFORM pg_sleep(${sleep_s});
  SELECT available INTO v_available FROM rik.v_entitlement_balance WHERE entitlement_id = '${ENT_ID}';
  IF v_available >= 7 THEN
    INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), '${ENT_ID}', '${product_id}', 'RESERVE', 7, 'TEST-CONCURRENCY', shared.uuid_generate_v7());
    RAISE NOTICE '${label}: RESERVED 7kg (available was %)', v_available;
  ELSE
    RAISE NOTICE '${label}: DECLINED (available was % < 7 needed)', v_available;
  END IF;
END;
\$\$;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
run_backend "BACKEND-1(ProductA)" "${PROD_A}" 2 "${OUT1}" &
PID1=$!
sleep 0.4   # ensure backend 1 acquires the FOR UPDATE lock first
run_backend "BACKEND-2(ProductB)" "${PROD_B}" 0 "${OUT2}" &
PID2=$!
wait "${PID1}"; wait "${PID2}"

cat "${OUT1}" "${OUT2}"

RESERVED_COUNT=$(${PSQL} -c "SELECT count(*) FROM rik.entitlement_ledger WHERE entitlement_id='${ENT_ID}' AND type='RESERVE';")
RESERVED_SUM=$(${PSQL} -c "SELECT COALESCE(SUM(qty),0)::int FROM rik.entitlement_ledger WHERE entitlement_id='${ENT_ID}' AND type='RESERVE';")
echo "RESERVE rows written: ${RESERVED_COUNT}, total qty reserved: ${RESERVED_SUM} (pool was 10)"

if [ "${RESERVED_COUNT}" -ne 1 ] || [ "${RESERVED_SUM}" != "7" ]; then
  echo "FAIL #4: expected exactly one 7kg RESERVE to win the race and the other to correctly decline; got ${RESERVED_COUNT} row(s) totaling ${RESERVED_SUM}kg"
  fail=1
else
  echo "PASS #4: SELECT ... FOR UPDATE on rik.entitlements correctly serialized two concurrent category-pool reservations — no over-allocation"
fi

# cleanup #4
${PSQL} -c "DELETE FROM rik.entitlement_ledger WHERE entitlement_id='${ENT_ID}';" > /dev/null
${PSQL} -c "DELETE FROM rik.entitlements WHERE id='${ENT_ID}';" > /dev/null
${PSQL} -c "DELETE FROM rik.products WHERE id IN ('${PROD_A}','${PROD_B}');" > /dev/null
${PSQL} -c "DELETE FROM rik.categories WHERE id='${CATEGORY_ID}';" > /dev/null
${PSQL} -c "DELETE FROM rik.entitlement_periods WHERE id='${PERIOD_ID}';" > /dev/null
${PSQL} -c "DELETE FROM shared.customers WHERE id='${CUSTOMER_ID}';" > /dev/null
rm -f "${OUT1}" "${OUT2}"

echo ""
echo "=== #9 PIF counter-vs-online conflict ============================="

PIF_PROD=$(${PSQL} -c "INSERT INTO pif.products (id, sku, name, unit, selling_price) VALUES (shared.uuid_generate_v7(), 'TEST-CONC-PIF', 'Conc PIF Product', 'kg', 50.00) RETURNING id;")
${PSQL} -c "INSERT INTO pif.inventory (product_id, quantity_on_hand) VALUES ('${PIF_PROD}', 10);" > /dev/null

echo "pif.inventory for ${PIF_PROD}: on_hand=10, reserved=0."
echo "Backend 1 (COUNTER sale) deducts 7 on_hand directly; Backend 2 (ONLINE) tries to reserve 7 concurrently."
echo "Correct (locked) outcome: exactly one succeeds; the balance never goes negative or over-reserved."

run_pif_backend() {
  local label=$1 mode=$2 sleep_s=$3 outfile=$4
  ${PSQL_NOTICE} -v ON_ERROR_STOP=1 <<SQL > "${outfile}" 2>&1
DO \$\$
DECLARE
  v_on_hand numeric;
  v_reserved numeric;
  v_avail numeric;
BEGIN
  SELECT quantity_on_hand, quantity_reserved INTO v_on_hand, v_reserved
  FROM pif.inventory WHERE product_id = '${PIF_PROD}' FOR UPDATE;
  PERFORM pg_sleep(${sleep_s});
  SELECT quantity_on_hand, quantity_reserved INTO v_on_hand, v_reserved
  FROM pif.inventory WHERE product_id = '${PIF_PROD}';
  v_avail := v_on_hand - v_reserved;
  IF v_avail >= 7 THEN
    IF '${mode}' = 'COUNTER' THEN
      UPDATE pif.inventory SET quantity_on_hand = quantity_on_hand - 7 WHERE product_id = '${PIF_PROD}';
    ELSE
      UPDATE pif.inventory SET quantity_reserved = quantity_reserved + 7 WHERE product_id = '${PIF_PROD}';
    END IF;
    RAISE NOTICE '${label}: SUCCEEDED taking 7 (available was %)', v_avail;
  ELSE
    RAISE NOTICE '${label}: DECLINED (available was % < 7 needed)', v_avail;
  END IF;
END;
\$\$;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
run_pif_backend "BACKEND-1(COUNTER)" "COUNTER" 2 "${OUT1}" &
PID1=$!
sleep 0.4
run_pif_backend "BACKEND-2(ONLINE)" "ONLINE" 0 "${OUT2}" &
PID2=$!
wait "${PID1}"; wait "${PID2}"

cat "${OUT1}" "${OUT2}"

FINAL_ON_HAND=$(${PSQL} -c "SELECT quantity_on_hand::int FROM pif.inventory WHERE product_id='${PIF_PROD}';")
FINAL_RESERVED=$(${PSQL} -c "SELECT quantity_reserved::int FROM pif.inventory WHERE product_id='${PIF_PROD}';")
echo "Final pif.inventory: on_hand=${FINAL_ON_HAND}, reserved=${FINAL_RESERVED}"

# Exactly one branch should have won: either (on_hand=3,reserved=0) if COUNTER won,
# or (on_hand=10,reserved=7) if ONLINE won — never both succeeding.
if [ "${FINAL_ON_HAND}" = "3" ] && [ "${FINAL_RESERVED}" = "0" ]; then
  echo "PASS #9: COUNTER sale won the race, ONLINE correctly declined — no overselling"
elif [ "${FINAL_ON_HAND}" = "10" ] && [ "${FINAL_RESERVED}" = "7" ]; then
  echo "PASS #9: ONLINE reservation won the race, COUNTER correctly declined — no overselling"
else
  echo "FAIL #9: expected exactly one side to win (3/0 or 10/7), got on_hand=${FINAL_ON_HAND} reserved=${FINAL_RESERVED}"
  fail=1
fi

# cleanup #9
${PSQL} -c "DELETE FROM pif.inventory WHERE product_id='${PIF_PROD}';" > /dev/null
${PSQL} -c "DELETE FROM pif.products WHERE id='${PIF_PROD}';" > /dev/null
rm -f "${OUT1}" "${OUT2}"

echo ""
if [ "${fail}" -eq 0 ]; then
  echo "=== 050_concurrency.sh: ALL CHECKS PASSED ==="
else
  echo "=== 050_concurrency.sh: FAILURES DETECTED ==="
  exit 1
fi
