-- ===========================================================================
--  PIF DELIVERY CHARGE — ROLLBACK.  esamagri_staging ONLY.
--  The exact undo of 0064_pif_delivery_charge_pgadmin.sql.
--
--  IT REFUSES IF ANY ORDER HAS ACTUALLY BEEN CHARGED. Restoring the old rule
--  (total = subtotal - discount_total + tax_total) would make every charged
--  order's total arithmetically wrong, and dropping the column would destroy
--  the record of money that was collected. The script names what it found and
--  stops rather than quietly losing it.
--
--  IF delivery_total IS ALREADY ABSENT, THIS FILE IS A TRUE NO-OP. It says so
--  and returns, having read nothing further and changed nothing at all - not
--  the trigger function, not a constraint, not a row. That is why the
--  function restore lives INSIDE the block below rather than as a statement
--  of its own: a top-level CREATE OR REPLACE would run unconditionally and a
--  no-op would not be a no-op.
--
--  THE FUNCTION BODY RESTORED BELOW IS MIGRATION 0050's, VERBATIM, taken from
--  0050_pif_commerce.sql lines 277-324. Only the dollar-quote tag differs
--  ($body$ instead of $$, because this text is nested inside two other
--  dollar-quoted strings); the tag is not part of the stored body, so what
--  lands in pg_proc.prosrc is byte-identical. The forward migration refuses
--  to run unless the live function is recognisably that original, so this
--  text is a faithful restore - and both files print the live definition
--  before changing anything.
--
--  NOTHING IS ACCEPTED ON THE STRENGTH OF ITS NAME, and nothing unrecognised
--  is dropped. The constraints are read back through the same normaliser the
--  forward migration uses, against forms measured on PostgreSQL 16.15. A
--  definition this file does not recognise is an abort, checked BEFORE any
--  DDL, so the database is left completely untouched.
--
--  NOTHING OUTSIDE PIF IS TOUCHED, and no row is written: no INSERT, UPDATE
--  or DELETE appears in this file. The fingerprint check proves it.
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 ^
--      -f C:\esamagri\staging-esamagri-app\database\migrations\0064_pif_delivery_charge_rollback.sql
-- ===========================================================================

-- BEFORE-IMAGE: the live function as it stands right now. KEEP THIS OUTPUT.
-- Reading is not changing, so this runs even on a no-op.
SELECT n.nspname || '.' || p.proname AS function_name,
       pg_get_functiondef(p.oid)     AS definition_before_this_rollback
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pif' AND p.proname = 'trg_assert_order_totals';

DO $outer$
DECLARE
  c_money_old  CONSTANT text := 'CHECKsubtotal>=0ANDdiscount_total>=0ANDtax_total>=0ANDtotal>=0ANDtotal=roundsubtotal-discount_total+tax_total,2';
  c_money_new  CONSTANT text := 'CHECKsubtotal>=0ANDdiscount_total>=0ANDtax_total>=0ANDdelivery_total>=0ANDtotal>=0ANDtotal=roundsubtotal-discount_total+tax_total+delivery_total,2';
  c_delivmode  CONSTANT text := 'CHECKfulfillment_mode=''DELIVERY''ORdelivery_total=0';

  v_charged     integer;
  v_nullable    text;
  v_moneydef    text;
  v_moneyflat   text;
  v_delivdef    text;
  v_delivflat   text;
  v_fnbody      text;
  v_fnflat      text;
  v_orders_bef  integer;
  v_orders_aft  integer;
  v_fp_before   text;
  v_fp_after    text;
BEGIN
  IF to_regclass('pif.orders') IS NULL THEN
    RAISE EXCEPTION 'pif-delivery-rollback: pif.orders does not exist - wrong database?';
  END IF;

  -- === THE NO-OP. Nothing below this point runs if there is nothing to undo.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'pif' AND table_name = 'orders'
                    AND column_name = 'delivery_total') THEN
    RAISE NOTICE 'pif-delivery-rollback: delivery_total is not present. Nothing to undo - no constraint, no column and no function has been touched.';
    RETURN;
  END IF;

  -- === THE REFUSAL. Charged orders make this rollback destructive. =========
  SELECT count(*) INTO v_charged FROM pif.orders WHERE delivery_total <> 0;
  IF v_charged > 0 THEN
    RAISE EXCEPTION 'pif-delivery-rollback: % order(s) carry a delivery charge. Dropping the column would destroy that record, and restoring the old total rule would leave their totals arithmetically wrong. Reverse or re-total those orders first, or keep the migration. - ABORTING', v_charged;
  END IF;

  -- fulfillment_mode must still be as the forward migration found it.
  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'orders'
     AND column_name = 'fulfillment_mode';
  IF NOT FOUND OR v_nullable <> 'NO' THEN
    RAISE EXCEPTION 'pif-delivery-rollback: pif.orders.fulfillment_mode is missing or nullable. The database is not in the state this rollback was written for. - ABORTING';
  END IF;

  -- === the money rule must be ours (or already reverted) ==================
  SELECT pg_get_constraintdef(oid) INTO v_moneydef
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_money_chk';
  v_moneyflat := CASE WHEN v_moneydef IS NULL THEN NULL
                 ELSE regexp_replace(regexp_replace(v_moneydef, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;
  IF v_moneyflat IS NULL THEN
    RAISE EXCEPTION 'pif-delivery-rollback: pif_orders_money_chk is not attached to pif.orders. The order money rule is missing; this rollback will not guess what it should be. - ABORTING';
  ELSIF v_moneyflat = c_money_old THEN
    RAISE NOTICE 'pif-delivery-rollback: pif_orders_money_chk is already migration 0050''s form.';
  ELSIF v_moneyflat <> c_money_new THEN
    RAISE EXCEPTION 'pif-delivery-rollback: pif_orders_money_chk is neither this migration''s form nor migration 0050''s. Something else has changed the order money rule. - ABORTING%',
      chr(10) || '  found:          ' || v_moneyflat
      || chr(10) || '  expected (0064): ' || c_money_new
      || chr(10) || '  expected (0050): ' || c_money_old
      || chr(10) || '  live:            ' || v_moneydef;
  END IF;

  -- === the pickup constraint must be exactly ours before it is dropped ====
  -- Checked BEFORE any DDL, so an unrecognised definition leaves the
  -- database completely untouched. A name this migration owns is not licence
  -- to drop a rule somebody else wrote under it.
  SELECT pg_get_constraintdef(oid) INTO v_delivdef
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_delivery_mode_chk';
  v_delivflat := CASE WHEN v_delivdef IS NULL THEN NULL
                 ELSE regexp_replace(regexp_replace(v_delivdef, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;
  IF v_delivflat IS NOT NULL AND v_delivflat <> c_delivmode THEN
    RAISE EXCEPTION 'pif-delivery-rollback: pif_orders_delivery_mode_chk exists with a definition this rollback does not recognise. It is NOT being dropped. Inspect it and remove it deliberately if that is what you intend, then re-run. - ABORTING%',
      chr(10) || '  found:    ' || v_delivflat
      || chr(10) || '  expected: ' || c_delivmode
      || chr(10) || '  live:     ' || v_delivdef;
  END IF;

  -- === the trigger function must be ours (or already reverted) ============
  SELECT p.prosrc INTO v_fnbody
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_assert_order_totals';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pif-delivery-rollback: pif.trg_assert_order_totals() does not exist. - ABORTING';
  END IF;
  v_fnflat := regexp_replace(regexp_replace(v_fnbody, '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]', '', 'g');
  IF v_fnflat NOT LIKE '%o.total<>round(s.total+o.delivery_total,2)%'
     AND v_fnflat NOT LIKE '%o.total<>s.total%' THEN
    RAISE EXCEPTION 'pif-delivery-rollback: the live trigger function is neither this migration''s version nor migration 0050''s original. Restoring the 0050 text would discard whatever is actually installed. Save the BEFORE-IMAGE printed above, then decide. - ABORTING';
  END IF;

  SELECT count(*) INTO v_orders_bef FROM pif.orders;
  SELECT coalesce(md5(string_agg(f, '|' ORDER BY f)), 'NO-ORDERS') INTO v_fp_before
    FROM (SELECT o.id::text || ':' || o.subtotal::text || ':' || o.discount_total::text
                 || ':' || o.tax_total::text || ':' || o.total::text
                 || ':' || coalesce(o.cod_amount::text, '-')
                 || ':' || o.fulfillment_mode AS f
            FROM pif.orders o) z;

  -- === undo, in reverse order of the forward migration ====================
  IF v_delivflat IS NOT NULL THEN
    ALTER TABLE pif.orders DROP CONSTRAINT pif_orders_delivery_mode_chk;
    RAISE NOTICE 'pif-delivery-rollback: pif_orders_delivery_mode_chk dropped.';
  END IF;

  IF v_moneyflat = c_money_new THEN
    ALTER TABLE pif.orders DROP CONSTRAINT pif_orders_money_chk;
    -- Re-added BEFORE the column is dropped: this definition does not name
    -- delivery_total, and every row holds 0, so all rows satisfy it.
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_money_chk CHECK (
        subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND total >= 0
        AND total = round(subtotal - discount_total + tax_total, 2)
      );
    RAISE NOTICE 'pif-delivery-rollback: pif_orders_money_chk restored to migration 0050''s form.';
  END IF;

  ALTER TABLE pif.orders DROP COLUMN delivery_total;
  RAISE NOTICE 'pif-delivery-rollback: delivery_total dropped.';

  -- === the function, back to migration 0050's body ========================
  -- Inside this block, and only reached when there was something to undo.
  -- Skipped when it is already the original, so a half-finished rollback that
  -- is re-run does not rewrite a function that is already correct.
  IF v_fnflat LIKE '%o.total<>round(s.total+o.delivery_total,2)%' THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION pif.trg_assert_order_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
DECLARE
  target  uuid;
  o       record;
  s       record;
BEGIN
  -- IF rather than CASE: plpgsql resolves every branch of a CASE
  -- expression against the trigger's own NEW record, and NEW has no
  -- order_id when this fires on pif.orders.
  IF TG_TABLE_NAME = 'orders' THEN
    target := NEW.id;
  ELSE
    target := NEW.order_id;
  END IF;

  SELECT id, subtotal, discount_total, tax_total, total INTO o
    FROM pif.orders WHERE id = target;
  IF NOT FOUND THEN
    RETURN NULL;  -- the order was rolled away in the same transaction
  END IF;

  SELECT count(*)                            AS lines,
         coalesce(sum(line_subtotal), 0)      AS subtotal,
         coalesce(sum(line_discount), 0)      AS discount_total,
         coalesce(sum(line_tax), 0)           AS tax_total,
         coalesce(sum(line_total), 0)         AS total
    INTO s
    FROM pif.order_items WHERE order_id = target;

  IF s.lines = 0 THEN
    RAISE EXCEPTION 'pif.orders %: an order must have at least one line', target
      USING ERRCODE = 'check_violation';
  END IF;

  IF o.subtotal <> s.subtotal OR o.discount_total <> s.discount_total
     OR o.tax_total <> s.tax_total OR o.total <> s.total THEN
    RAISE EXCEPTION 'pif.orders %: header totals (%, %, %, %) disagree with its lines (%, %, %, %)',
      target, o.subtotal, o.discount_total, o.tax_total, o.total,
      s.subtotal, s.discount_total, s.tax_total, s.total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$body$;
$fn$;
    RAISE NOTICE 'pif-delivery-rollback: pif.trg_assert_order_totals() restored to migration 0050''s body.';
  ELSE
    RAISE NOTICE 'pif-delivery-rollback: the trigger function was already migration 0050''s original; left untouched.';
  END IF;

  -- === prove nothing was written ==========================================
  -- delivery_total is deliberately absent from this fingerprint: the column
  -- is being removed, and every value in it is known to be 0 because the
  -- refusal above would have stopped the script otherwise.
  SELECT count(*) INTO v_orders_aft FROM pif.orders;
  SELECT coalesce(md5(string_agg(f, '|' ORDER BY f)), 'NO-ORDERS') INTO v_fp_after
    FROM (SELECT o.id::text || ':' || o.subtotal::text || ':' || o.discount_total::text
                 || ':' || o.tax_total::text || ':' || o.total::text
                 || ':' || coalesce(o.cod_amount::text, '-')
                 || ':' || o.fulfillment_mode AS f
            FROM pif.orders o) z;
  IF v_orders_aft <> v_orders_bef THEN
    RAISE EXCEPTION 'pif-delivery-rollback: order count changed from % to %. - ABORTING', v_orders_bef, v_orders_aft;
  END IF;
  IF v_fp_after <> v_fp_before THEN
    RAISE EXCEPTION 'pif-delivery-rollback: order money data changed (% -> %). - ABORTING', v_fp_before, v_fp_after;
  END IF;

  RAISE NOTICE 'pif-delivery-rollback: done. % order(s), money fingerprint unchanged (%).', v_orders_aft, v_fp_after;
END;
$outer$;

-- ---------------------------------------------------------------------------
-- COMPLETENESS GATE. Read-only: it asserts the end state and changes nothing,
-- so it is safe to run after a no-op as well. If it reports that the function
-- still allows for delivery_total while the column is gone, the database is
-- in a state this rollback deliberately did not touch - re-apply the forward
-- migration, or restore the function from the BEFORE-IMAGE above.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
  c_money_old CONSTANT text := 'CHECKsubtotal>=0ANDdiscount_total>=0ANDtax_total>=0ANDtotal>=0ANDtotal=roundsubtotal-discount_total+tax_total,2';
  remaining text[] := '{}';
  v_def     text;
  v_flat    text;
  v_body    text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pif' AND table_name = 'orders'
                AND column_name = 'delivery_total') THEN
    remaining := remaining || 'column pif.orders.delivery_total';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'pif.orders'::regclass
                AND conname  = 'pif_orders_delivery_mode_chk') THEN
    remaining := remaining || 'constraint pif_orders_delivery_mode_chk';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_money_chk';
  v_flat := CASE WHEN v_def IS NULL THEN NULL
            ELSE regexp_replace(regexp_replace(v_def, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;
  IF v_flat IS DISTINCT FROM c_money_old THEN
    remaining := remaining || 'pif_orders_money_chk restored to migration 0050''s form';
  END IF;

  SELECT p.prosrc INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_assert_order_totals';
  IF v_body IS NULL
     OR regexp_replace(regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]', '', 'g')
        NOT LIKE '%o.total<>s.total%' THEN
    remaining := remaining || 'function pif.trg_assert_order_totals() restored to migration 0050''s body';
  END IF;

  IF array_length(remaining, 1) > 0 THEN
    RAISE EXCEPTION 'pif-delivery-rollback: NOT in the migration-0050 state. Still wrong or present: %. - ABORTING', array_to_string(remaining, ', ');
  END IF;

  RAISE NOTICE 'pif-delivery-rollback: verified - the database is in the migration-0050 state.';
END;
$gate$;

-- ===========================================================================
--  committed verification
-- ===========================================================================
SELECT count(*) AS delivery_total_columns
  FROM information_schema.columns
 WHERE table_schema = 'pif' AND table_name = 'orders' AND column_name = 'delivery_total';
-- expect 0

SELECT count(*) AS delivery_mode_constraints
  FROM pg_constraint
 WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_delivery_mode_chk';
-- expect 0

SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'pif.orders'::regclass
   AND conname IN ('pif_orders_money_chk', 'pif_orders_mode_chk')
 ORDER BY conname;
-- expect no mention of delivery_total

SELECT count(*) AS orders,
       count(*) FILTER (WHERE total <> round(subtotal - discount_total + tax_total, 2)) AS inconsistent
  FROM pif.orders;
-- expect inconsistent = 0
