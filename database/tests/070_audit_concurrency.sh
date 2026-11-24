#!/usr/bin/env bash
# Real cross-process concurrency tests added during the final Phase 2
# release audit, covering the 3 scenarios from that audit's Step 5 not
# already exercised by tests/050_concurrency.sh (#4 entitlement, #9 PIF
# counter-vs-online):
#   #A RIK inventory reservation — two concurrent RESERVE-style updates
#      racing against the same rik.inventory row's available stock.
#   #B Duplicate COD collection — two concurrent attempts to record
#      COD_COLLECTED for the same pif order.
#   #C Duplicate idempotent request — two concurrent identical
#      (idempotency_key, endpoint, principal) requests via
#      shared.claim_idempotency_key().
#
# Each proves the DB-level mechanism (row lock, or a unique index) alone
# — not application code — prevents the double-mutation, under real
# concurrent backend connections, not just separate statements in one
# session.
set -euo pipefail

DB=esamagri_test
PSQL="sudo -u postgres psql -d ${DB} -qtA"
PSQL_NOTICE="sudo -u postgres psql -d ${DB}"

fail=0

echo "=== #A RIK inventory reservation concurrency ======================"

CATEGORY_ID=$(${PSQL} -c "INSERT INTO rik.categories (id, name) VALUES (shared.uuid_generate_v7(), 'TEST-AuditConc-Cat') RETURNING id;")
PROD_ID=$(${PSQL} -c "INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES (shared.uuid_generate_v7(), 'TEST-AUDITCONC-A', 'Audit Conc Product', '${CATEGORY_ID}', 'kg') RETURNING id;")
${PSQL} -c "INSERT INTO rik.inventory (product_id, quantity_on_hand, quantity_reserved) VALUES ('${PROD_ID}', 10, 0);" > /dev/null

echo "rik.inventory for ${PROD_ID}: on_hand=10, reserved=0."
echo "Backend 1 and Backend 2 each try to RESERVE 7kg concurrently (SELECT...FOR UPDATE pattern)."
echo "Correct (locked) outcome: exactly one succeeds; reserved never exceeds on_hand."

run_rik_inv_backend() {
  local label=$1 sleep_s=$2 outfile=$3
  ${PSQL_NOTICE} -v ON_ERROR_STOP=1 <<SQL > "${outfile}" 2>&1
DO \$\$
DECLARE
  v_on_hand numeric;
  v_reserved numeric;
  v_avail numeric;
BEGIN
  SELECT quantity_on_hand, quantity_reserved INTO v_on_hand, v_reserved
  FROM rik.inventory WHERE product_id = '${PROD_ID}' FOR UPDATE;
  PERFORM pg_sleep(${sleep_s});
  SELECT quantity_on_hand, quantity_reserved INTO v_on_hand, v_reserved
  FROM rik.inventory WHERE product_id = '${PROD_ID}';
  v_avail := v_on_hand - v_reserved;
  IF v_avail >= 7 THEN
    UPDATE rik.inventory SET quantity_reserved = quantity_reserved + 7 WHERE product_id = '${PROD_ID}';
    INSERT INTO rik.inventory_transactions (id, product_id, type, qty, reason, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), '${PROD_ID}', 'RESERVE', 7, 'TEST audit concurrency', 'TEST-AUDIT-CONCURRENCY', shared.uuid_generate_v7());
    RAISE NOTICE '${label}: RESERVED 7kg (available was %)', v_avail;
  ELSE
    RAISE NOTICE '${label}: DECLINED (available was % < 7 needed)', v_avail;
  END IF;
END;
\$\$;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
run_rik_inv_backend "BACKEND-1" 2 "${OUT1}" &
PID1=$!
sleep 0.4
run_rik_inv_backend "BACKEND-2" 0 "${OUT2}" &
PID2=$!
wait "${PID1}"; wait "${PID2}"
cat "${OUT1}" "${OUT2}"

FINAL_RESERVED=$(${PSQL} -c "SELECT quantity_reserved::int FROM rik.inventory WHERE product_id='${PROD_ID}';")
echo "Final rik.inventory.quantity_reserved: ${FINAL_RESERVED} (on_hand was 10)"
if [ "${FINAL_RESERVED}" = "7" ]; then
  echo "PASS #A: SELECT ... FOR UPDATE on rik.inventory correctly serialized two concurrent reservations — no over-reservation"
else
  echo "FAIL #A: expected exactly one 7kg reservation to win (reserved=7), got reserved=${FINAL_RESERVED}"
  fail=1
fi

${PSQL} -c "DELETE FROM rik.inventory_transactions WHERE product_id='${PROD_ID}';" > /dev/null
${PSQL} -c "DELETE FROM rik.inventory WHERE product_id='${PROD_ID}';" > /dev/null
${PSQL} -c "DELETE FROM rik.products WHERE id='${PROD_ID}';" > /dev/null
${PSQL} -c "DELETE FROM rik.categories WHERE id='${CATEGORY_ID}';" > /dev/null
rm -f "${OUT1}" "${OUT2}"

echo ""
echo "=== #B Duplicate COD collection concurrency ========================"

STAFF_ID=$(${PSQL} -c "INSERT INTO shared.users (id, username, password_hash, display_name, status) VALUES (shared.uuid_generate_v7(), 'test.auditconc.staff', 'x', 'Audit Conc Staff', 'ACTIVE') RETURNING id;")
CUSTOMER_ID=$(${PSQL} -c "INSERT INTO shared.customers (id, mobile_number, name) VALUES (shared.uuid_generate_v7(), '9990000601', 'Audit Conc Customer') RETURNING id;")
SHIFT_ID=$(${PSQL} -c "INSERT INTO pif.cashier_shifts (id, cashier_id, opening_cash) VALUES (shared.uuid_generate_v7(), '${STAFF_ID}', 100) RETURNING id;")
ORDER_ID=$(${PSQL} -c "INSERT INTO pif.orders (id, order_number, customer_id, status, cod_amount) VALUES (shared.uuid_generate_v7(), 'TEST-AUDITCONC-ORD-1', '${CUSTOMER_ID}', 'DELIVERED', 250.00) RETURNING id;")

echo "pif.orders ${ORDER_ID}: DELIVERED, cod_amount=250. Two backends race to record COD_COLLECTED concurrently."
echo "Correct outcome: exactly one INSERT succeeds (pif_cash_movements_cod_order_uq); the other is rejected by the DB, not by app logic."

run_cod_backend() {
  local label=$1 outfile=$2
  ${PSQL_NOTICE} -v ON_ERROR_STOP=1 <<SQL > "${outfile}" 2>&1
DO \$\$
BEGIN
  BEGIN
    INSERT INTO pif.cash_movements (id, movement_type, amount, shift_id, order_id, handled_by)
    VALUES (shared.uuid_generate_v7(), 'COD_COLLECTED', 250.00, '${SHIFT_ID}', '${ORDER_ID}', '${STAFF_ID}');
    RAISE NOTICE '${label}: SUCCEEDED recording COD_COLLECTED';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '${label}: REJECTED — pif_cash_movements_cod_order_uq already claimed for this order';
  END;
END;
\$\$;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
run_cod_backend "BACKEND-1" "${OUT1}" &
PID1=$!
run_cod_backend "BACKEND-2" "${OUT2}" &
PID2=$!
wait "${PID1}"; wait "${PID2}"
cat "${OUT1}" "${OUT2}"

COD_COUNT=$(${PSQL} -c "SELECT count(*) FROM pif.cash_movements WHERE order_id='${ORDER_ID}' AND movement_type='COD_COLLECTED';")
echo "COD_COLLECTED rows for this order: ${COD_COUNT}"
if [ "${COD_COUNT}" = "1" ]; then
  echo "PASS #B: exactly one COD_COLLECTED movement recorded under true concurrency — pif_cash_movements_cod_order_uq holds"
else
  echo "FAIL #B: expected exactly 1 COD_COLLECTED row, got ${COD_COUNT}"
  fail=1
fi

${PSQL} -c "DELETE FROM pif.cash_movements WHERE order_id='${ORDER_ID}';" > /dev/null
${PSQL} -c "DELETE FROM pif.orders WHERE id='${ORDER_ID}';" > /dev/null
${PSQL} -c "DELETE FROM pif.cashier_shifts WHERE id='${SHIFT_ID}';" > /dev/null
${PSQL} -c "DELETE FROM shared.customers WHERE id='${CUSTOMER_ID}';" > /dev/null
${PSQL} -c "DELETE FROM shared.users WHERE id='${STAFF_ID}';" > /dev/null
rm -f "${OUT1}" "${OUT2}"

echo ""
echo "=== #C Duplicate idempotent request concurrency ===================="

IDEM_KEY="TEST-AUDITCONC-IDEMPOTENCY-KEY-1"
ENDPOINT="/test/audit-concurrency-probe"
PRINCIPAL_ID=$(${PSQL} -c "SELECT shared.uuid_generate_v7();")

echo "Two backends concurrently call shared.claim_idempotency_key() with the SAME (key, endpoint, principal)."
echo "Correct outcome: exactly one gets a real id back (performs the business mutation); the other gets NULL (must not mutate)."

run_idem_backend() {
  local label=$1 outfile=$2
  ${PSQL_NOTICE} -v ON_ERROR_STOP=1 <<SQL > "${outfile}" 2>&1
DO \$\$
DECLARE
  v_id uuid;
BEGIN
  SELECT shared.claim_idempotency_key('${IDEM_KEY}', '${ENDPOINT}', '${PRINCIPAL_ID}') INTO v_id;
  IF v_id IS NOT NULL THEN
    RAISE NOTICE '${label}: CLAIMED (id=%) — this backend performs the business mutation', v_id;
  ELSE
    RAISE NOTICE '${label}: DUPLICATE — key already claimed, must NOT repeat the business mutation';
  END IF;
END;
\$\$;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
run_idem_backend "BACKEND-1" "${OUT1}" &
PID1=$!
run_idem_backend "BACKEND-2" "${OUT2}" &
PID2=$!
wait "${PID1}"; wait "${PID2}"
cat "${OUT1}" "${OUT2}"

CLAIM_COUNT=$(${PSQL} -c "SELECT count(*) FROM shared.idempotency_keys WHERE idempotency_key='${IDEM_KEY}' AND endpoint='${ENDPOINT}';")
CLAIMED_SUCCESS=$(grep -c "CLAIMED" "${OUT1}" "${OUT2}" | awk -F: '{sum+=$2} END {print sum}')
echo "idempotency_keys rows for this (key,endpoint): ${CLAIM_COUNT}; backends that saw CLAIMED: ${CLAIMED_SUCCESS}"
if [ "${CLAIM_COUNT}" = "1" ] && [ "${CLAIMED_SUCCESS}" = "1" ]; then
  echo "PASS #C: exactly one backend claimed the idempotency key under true concurrency — only one business mutation would occur"
else
  echo "FAIL #C: expected exactly 1 stored key and exactly 1 backend to see CLAIMED, got ${CLAIM_COUNT} row(s) / ${CLAIMED_SUCCESS} claim(s)"
  fail=1
fi

${PSQL} -c "DELETE FROM shared.idempotency_keys WHERE idempotency_key='${IDEM_KEY}' AND endpoint='${ENDPOINT}';" > /dev/null
rm -f "${OUT1}" "${OUT2}"

echo ""
if [ "${fail}" -eq 0 ]; then
  echo "=== 070_audit_concurrency.sh: ALL CHECKS PASSED ==="
else
  echo "=== 070_audit_concurrency.sh: FAILURES DETECTED ==="
  exit 1
fi
