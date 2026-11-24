-- ===========================================================================
--  PIF DELIVERY CHARGE — one fee per order, free at the threshold
--  esamagri_staging ONLY.
--
--  WHAT THIS DOES. Adds pif.orders.delivery_total and widens the two rules
--  that currently pin an order's total to the sum of its own lines, so a
--  delivery charge can be stored at all. It sets a fee on NO existing order
--  and changes NO existing value: there is not one INSERT, UPDATE or DELETE
--  in this file, and the money fingerprint check below proves it.
--
--  THE APPROVED RULE, for the record. Home delivery below the threshold is
--  charged once per order, never per business; at or above it, and for store
--  pickup, it is free. Eligibility is decided on the customer's payable
--  MERCHANDISE amount — subtotal - discount_total + tax_total — BEFORE the
--  delivery charge. That figure stays re-derivable from any stored order as
--  (total - delivery_total), so a past decision can always be audited.
--
--  THE FEE AND THE THRESHOLD ARE NOT IN THE DATABASE. The 20 and the 499 live
--  in PifPricingService, the single pricing authority. A CHECK naming either
--  number would mean a migration every time the facility changed its mind.
--  What IS enforced here is the one rule that cannot change without the
--  feature changing meaning: a PICKUP order carries no delivery charge.
--
--  NOTHING OUTSIDE PIF IS TOUCHED. This file names two relations, pif.orders
--  and pif.order_items, and nothing else.
--
--  NOTHING IS ACCEPTED ON THE STRENGTH OF ITS NAME. Every object this file
--  depends on is read back and compared against an exact expected form: the
--  constraints through pg_get_constraintdef and one normaliser (strip the
--  ::numeric / ::text casts PostgreSQL adds, then remove every space and
--  parenthesis); the column through all five of its properties; the trigger
--  function through its stored body. Those expected forms were MEASURED on
--  PostgreSQL 16.15, not predicted. Anything this file does not recognise is
--  an abort - it is never dropped, altered or replaced.
--
--  IT IS SAFELY RERUNNABLE. Every step is guarded by that comparison, so a
--  second run reports each piece as already correct and changes nothing. On
--  a re-run delivery_total is part of the money fingerprint, so a delivery
--  charge already recorded against an order is positively verified as
--  unchanged rather than merely left alone. A completeness gate at the end
--  refuses to finish quietly if any of the four pieces is missing.
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 ^
--      -f C:\esamagri\staging-esamagri-app\database\migrations\0064_pif_delivery_charge_pgadmin.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- BEFORE-IMAGE, printed before anything changes: the live definition of the
-- trigger function as it stands right now. KEEP THIS OUTPUT. It is the
-- authoritative copy to restore if the shipped rollback text ever disagrees
-- with what was actually installed. Zero rows means the function is absent,
-- which the preflight treats as a hard stop.
-- ---------------------------------------------------------------------------
SELECT n.nspname || '.' || p.proname AS function_name,
       pg_get_functiondef(p.oid)     AS definition_before_this_migration
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pif' AND p.proname = 'trg_assert_order_totals';

DO $$
DECLARE
  -- The expected forms, verified against PostgreSQL 16.15's own rendering.
  c_money_old  CONSTANT text := 'CHECKsubtotal>=0ANDdiscount_total>=0ANDtax_total>=0ANDtotal>=0ANDtotal=roundsubtotal-discount_total+tax_total,2';
  c_money_new  CONSTANT text := 'CHECKsubtotal>=0ANDdiscount_total>=0ANDtax_total>=0ANDdelivery_total>=0ANDtotal>=0ANDtotal=roundsubtotal-discount_total+tax_total+delivery_total,2';
  c_mode       CONSTANT text := 'CHECKfulfillment_mode=ANYARRAY[''PICKUP'',''DELIVERY'']';
  c_delivmode  CONSTANT text := 'CHECKfulfillment_mode=''DELIVERY''ORdelivery_total=0';

  v_nullable        text;
  v_modedef         text;
  v_modeflat        text;
  v_moneydef        text;
  v_moneyflat       text;
  v_delivdef        text;
  v_delivflat       text;
  v_fnoid           oid;
  v_fnbody          text;
  v_fnflat          text;
  v_bad_modes       integer;
  v_orders_before   integer;
  v_orders_after    integer;
  v_fp_expr         text;
  v_fp_stmt         text;
  v_fp_before       text;
  v_fp_after        text;
  v_charged         integer;
  v_column_existed  boolean;
  v_col_type        text;
  v_col_prec        integer;
  v_col_scale       integer;
  v_col_null        text;
  v_col_def         text;
  v_trg             record;
BEGIN
  -- === P1. the right database, and the two relations this file names =======
  IF to_regclass('pif.orders') IS NULL THEN
    RAISE EXCEPTION 'pif-delivery: pif.orders does not exist - wrong database?';
  END IF;
  IF to_regclass('pif.order_items') IS NULL THEN
    RAISE EXCEPTION 'pif-delivery: pif.order_items does not exist - wrong database?';
  END IF;

  -- === P2. fulfillment_mode must be NOT NULL ===============================
  -- The pickup rule is "mode = DELIVERY OR delivery_total = 0". A NULL mode
  -- would make that CHECK evaluate to NULL, which SQL accepts - so a NULL
  -- mode could silently carry a delivery charge. Refuse rather than allow it.
  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'orders'
     AND column_name = 'fulfillment_mode';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pif-delivery: pif.orders has no fulfillment_mode column. Migration 0050 is not applied. - ABORTING';
  END IF;
  IF v_nullable <> 'NO' THEN
    RAISE EXCEPTION 'pif-delivery: pif.orders.fulfillment_mode is nullable. The pickup rule would not hold for a NULL mode. - ABORTING';
  END IF;

  -- === P3. its allowed values must be exactly PICKUP and DELIVERY ==========
  -- Verified three ways: the constraint is attached to THIS table, its
  -- definition is exactly the expected one, and no stored row holds a third
  -- value.
  SELECT pg_get_constraintdef(oid) INTO v_modedef
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_mode_chk';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pif-delivery: pif_orders_mode_chk is not attached to pif.orders. The set of fulfillment modes is unverified. - ABORTING';
  END IF;
  v_modeflat := regexp_replace(regexp_replace(v_modedef, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g');
  IF v_modeflat <> c_mode THEN
    RAISE EXCEPTION 'pif-delivery: pif_orders_mode_chk is not the definition this migration was written against. - ABORTING%',
      chr(10) || '  found:    ' || v_modeflat
      || chr(10) || '  expected: ' || c_mode
      || chr(10) || '  live:     ' || v_modedef;
  END IF;

  SELECT count(*) INTO v_bad_modes
    FROM pif.orders WHERE fulfillment_mode NOT IN ('PICKUP', 'DELIVERY');
  IF v_bad_modes > 0 THEN
    RAISE EXCEPTION 'pif-delivery: % order(s) hold a fulfillment_mode that is neither PICKUP nor DELIVERY. - ABORTING', v_bad_modes;
  END IF;

  -- === P4. the trigger function must be one we can faithfully roll back ====
  -- Comments are stripped and whitespace removed before comparing, so
  -- reformatting does not matter; the distinguishing comparison does.
  SELECT p.oid, p.prosrc INTO v_fnoid, v_fnbody
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_assert_order_totals';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pif-delivery: pif.trg_assert_order_totals() does not exist. Migration 0050 is not applied. - ABORTING';
  END IF;
  v_fnflat := regexp_replace(regexp_replace(v_fnbody, '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]', '', 'g');

  IF v_fnflat LIKE '%o.total<>round(s.total+o.delivery_total,2)%' THEN
    RAISE NOTICE 'pif-delivery: the trigger function is already this migration''s version.';
  ELSIF v_fnflat LIKE '%o.total<>s.total%' THEN
    RAISE NOTICE 'pif-delivery: the trigger function is migration 0050''s original, as expected.';
  ELSE
    RAISE EXCEPTION 'pif-delivery: the live trigger function is neither migration 0050''s original nor this migration''s version. The rollback script shipped with this migration would NOT restore what is actually installed. Save the BEFORE-IMAGE printed above, then decide. - ABORTING';
  END IF;

  -- === P5. both triggers: attached where expected, and deferred ============
  FOR v_trg IN
    SELECT * FROM (VALUES ('order_totals_agree', 'pif.orders'),
                          ('order_item_totals_agree', 'pif.order_items')) AS t(name, rel)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = v_trg.name
                      AND tgrelid = v_trg.rel::regclass
                      AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'pif-delivery: trigger % is not attached to %. - ABORTING', v_trg.name, v_trg.rel;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = v_trg.name AND tgrelid = v_trg.rel::regclass
                      AND NOT tgisinternal
                      AND tgdeferrable AND tginitdeferred
                      AND tgconstraint <> 0
                      AND tgfoid = v_fnoid) THEN
      RAISE EXCEPTION 'pif-delivery: trigger % on % is not a DEFERRABLE INITIALLY DEFERRED constraint trigger calling pif.trg_assert_order_totals(). An order''s header is then checked at the wrong moment, or by the wrong code. - ABORTING', v_trg.name, v_trg.rel;
    END IF;
  END LOOP;

  v_column_existed := EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = 'pif' AND table_name = 'orders'
                                 AND column_name = 'delivery_total');

  -- === P6. an EXISTING delivery_total must be exactly the right column =====
  -- A re-run must not accept a column that merely shares the name. All five
  -- properties are checked, because each one changes behaviour: a different
  -- scale rounds money differently, a nullable column defeats both the
  -- pickup rule and the money identity (a NULL makes a CHECK pass), a
  -- missing default breaks every insert that omits the column, and a
  -- non-zero default would charge delivery on orders nobody priced.
  -- The expected reporting was MEASURED on PostgreSQL 16.15: data_type
  -- 'numeric', precision 12, scale 2, is_nullable 'NO', column_default '0'.
  -- A column that differs is an abort; it is never altered here.
  IF v_column_existed THEN
    SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default
      INTO v_col_type, v_col_prec, v_col_scale, v_col_null, v_col_def
      FROM information_schema.columns
     WHERE table_schema = 'pif' AND table_name = 'orders'
       AND column_name = 'delivery_total';

    IF v_col_type  IS DISTINCT FROM 'numeric'
       OR v_col_prec  IS DISTINCT FROM 12
       OR v_col_scale IS DISTINCT FROM 2
       OR v_col_null  IS DISTINCT FROM 'NO'
       OR v_col_def   IS DISTINCT FROM '0' THEN
      RAISE EXCEPTION 'pif-delivery: pif.orders.delivery_total already exists but is not the column this migration defines. It is NOT being altered. Inspect it, then either correct it deliberately or drop it, and re-run. - ABORTING%',
        chr(10) || '  found:    ' || coalesce(v_col_type, '<no type>')
                || '(' || coalesce(v_col_prec::text, '?') || ',' || coalesce(v_col_scale::text, '?') || ')'
                || ', nullable=' || coalesce(v_col_null, '?')
                || ', default=' || coalesce(quote_literal(v_col_def), '<none>')
        || chr(10) || '  expected: numeric(12,2), nullable=NO, default=''0''';
    END IF;
    RAISE NOTICE 'pif-delivery: the existing delivery_total is numeric(12,2) NOT NULL DEFAULT 0, as expected.';
  END IF;

  -- === P7. fingerprint the money, so "no data changed" is proved ==========
  -- delivery_total is part of the fingerprint whenever the column ALREADY
  -- exists - that is, on every re-run - so a delivery charge already recorded
  -- against an order is positively verified as unchanged, not merely left
  -- alone. On the first run the column does not exist yet and cannot be
  -- fingerprinted, so the same statement is used for both images (keeping the
  -- comparison like-for-like) and the assertion further down proves instead
  -- that every row is 0.
  --
  -- Dynamic SQL is necessary precisely because the column may not exist:
  -- static SQL naming it would fail at plan time on the first run.
  v_fp_expr := 'o.id::text || '':'' || o.subtotal::text || '':'' || o.discount_total::text'
            || ' || '':'' || o.tax_total::text || '':'' || o.total::text'
            || ' || '':'' || coalesce(o.cod_amount::text, ''-'')'
            || ' || '':'' || o.fulfillment_mode';
  IF v_column_existed THEN
    v_fp_expr := v_fp_expr || ' || '':'' || o.delivery_total::text';
  END IF;
  v_fp_stmt := 'SELECT coalesce(md5(string_agg(f, ''|'' ORDER BY f)), ''NO-ORDERS'')'
            || '  FROM (SELECT ' || v_fp_expr || ' AS f FROM pif.orders o) z';

  SELECT count(*) INTO v_orders_before FROM pif.orders;
  EXECUTE v_fp_stmt INTO v_fp_before;

  -- === 1. the column ======================================================
  ALTER TABLE pif.orders
    ADD COLUMN IF NOT EXISTS delivery_total numeric(12,2) NOT NULL DEFAULT 0;

  -- Freshly added means every row must be 0. On a RE-RUN the column already
  -- existed and real orders may legitimately carry a charge, so this is
  -- asserted only when we are the ones who just added it - and on a re-run
  -- those charges are covered by the fingerprint instead.
  IF NOT v_column_existed THEN
    SELECT count(*) INTO v_charged FROM pif.orders WHERE delivery_total <> 0;
    IF v_charged > 0 THEN
      RAISE EXCEPTION 'pif-delivery: % order(s) carry a delivery_total on a column just created with DEFAULT 0. - ABORTING', v_charged;
    END IF;
  END IF;

  -- === 2. the money rule: three-way, never a substring test ===============
  SELECT pg_get_constraintdef(oid) INTO v_moneydef
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_money_chk';
  v_moneyflat := CASE WHEN v_moneydef IS NULL THEN NULL
                 ELSE regexp_replace(regexp_replace(v_moneydef, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;

  IF v_moneyflat IS NULL THEN
    RAISE EXCEPTION 'pif-delivery: pif_orders_money_chk is not attached to pif.orders at all. The order money rule is missing and this migration will not invent one. - ABORTING';
  ELSIF v_moneyflat = c_money_new THEN
    RAISE NOTICE 'pif-delivery: pif_orders_money_chk already enforces the delivery-inclusive identity.';
  ELSIF v_moneyflat = c_money_old THEN
    ALTER TABLE pif.orders DROP CONSTRAINT pif_orders_money_chk;
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_money_chk CHECK (
        subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
        AND delivery_total >= 0 AND total >= 0
        AND total = round(subtotal - discount_total + tax_total + delivery_total, 2)
      );
    RAISE NOTICE 'pif-delivery: pif_orders_money_chk replaced (0050 form -> delivery-inclusive form).';
  ELSE
    RAISE EXCEPTION 'pif-delivery: pif_orders_money_chk is neither migration 0050''s form nor this migration''s form. Something else has changed the order money rule, and replacing it would discard that change. - ABORTING%',
      chr(10) || '  found:          ' || v_moneyflat
      || chr(10) || '  expected (0050): ' || c_money_old
      || chr(10) || '  expected (0064): ' || c_money_new
      || chr(10) || '  live:            ' || v_moneydef;
  END IF;

  -- === 3. store pickup is always free, in the schema ======================
  -- Created when absent; accepted when it is exactly ours; ABORTED otherwise.
  -- A constraint whose definition this migration does not recognise is never
  -- dropped or replaced, even though the name is one this migration owns -
  -- something else put it there, and silently discarding it would discard a
  -- rule somebody meant.
  SELECT pg_get_constraintdef(oid) INTO v_delivdef
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_delivery_mode_chk';
  v_delivflat := CASE WHEN v_delivdef IS NULL THEN NULL
                 ELSE regexp_replace(regexp_replace(v_delivdef, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;

  IF v_delivflat IS NULL THEN
    ALTER TABLE pif.orders
      ADD CONSTRAINT pif_orders_delivery_mode_chk CHECK (
        fulfillment_mode = 'DELIVERY' OR delivery_total = 0
      );
    RAISE NOTICE 'pif-delivery: pif_orders_delivery_mode_chk installed.';
  ELSIF v_delivflat = c_delivmode THEN
    RAISE NOTICE 'pif-delivery: pif_orders_delivery_mode_chk already enforces the pickup rule.';
  ELSE
    RAISE EXCEPTION 'pif-delivery: pif_orders_delivery_mode_chk already exists with a definition this migration does not recognise. It is NOT being replaced. Inspect it, and either make it the expected rule or remove it deliberately, then re-run. - ABORTING%',
      chr(10) || '  found:    ' || v_delivflat
      || chr(10) || '  expected: ' || c_delivmode
      || chr(10) || '  live:     ' || v_delivdef;
  END IF;

  -- === P8. prove nothing was written ======================================
  -- The SAME statement as the before-image, so the two are comparable.
  SELECT count(*) INTO v_orders_after FROM pif.orders;
  EXECUTE v_fp_stmt INTO v_fp_after;

  IF v_orders_after <> v_orders_before THEN
    RAISE EXCEPTION 'pif-delivery: order count changed from % to % during a schema-only migration. - ABORTING', v_orders_before, v_orders_after;
  END IF;
  IF v_fp_after <> v_fp_before THEN
    RAISE EXCEPTION 'pif-delivery: order money data changed during a schema-only migration (% -> %). - ABORTING', v_fp_before, v_fp_after;
  END IF;

  RAISE NOTICE 'pif-delivery: schema step done. % order(s), money fingerprint unchanged (%)%.',
    v_orders_after, v_fp_after,
    CASE WHEN v_column_existed
         THEN ' - delivery_total was included in the fingerprint and is verified unchanged'
         ELSE ' - delivery_total was newly added, and every row is 0' END;
END;
$$;

-- ---------------------------------------------------------------------------
-- The header must still agree with its own lines - now allowing for the one
-- figure that is NOT a sum of lines.
--
-- CREATE OR REPLACE, deliberately: the two CONSTRAINT TRIGGERs stay bound to
-- this function, so they must NOT be dropped and recreated. Dropping them
-- would briefly leave orders unguarded, and recreating them is unnecessary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pif.trg_assert_order_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

  SELECT id, subtotal, discount_total, tax_total, delivery_total, total INTO o
    FROM pif.orders WHERE id = target;
  IF NOT FOUND THEN
    RETURN NULL;  -- the order was rolled away in the same transaction
  END IF;

  SELECT count(*)                        AS lines,
         coalesce(sum(line_subtotal), 0)  AS subtotal,
         coalesce(sum(line_discount), 0)  AS discount_total,
         coalesce(sum(line_tax), 0)       AS tax_total,
         coalesce(sum(line_total), 0)     AS total
    INTO s
    FROM pif.order_items WHERE order_id = target;

  IF s.lines = 0 THEN
    RAISE EXCEPTION 'pif.orders %: an order must have at least one line', target
      USING ERRCODE = 'check_violation';
  END IF;

  -- subtotal, discount and tax remain EXACTLY the sum of the lines. Only the
  -- total carries the delivery charge on top of them.
  IF o.subtotal <> s.subtotal OR o.discount_total <> s.discount_total
     OR o.tax_total <> s.tax_total
     OR o.total <> round(s.total + o.delivery_total, 2) THEN
    RAISE EXCEPTION 'pif.orders %: header totals (sub %, disc %, tax %, delivery %, total %) disagree with its lines (%, %, %, %)',
      target, o.subtotal, o.discount_total, o.tax_total, o.delivery_total, o.total,
      s.subtotal, s.discount_total, s.tax_total, s.total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- COMPLETENESS GATE. Refuses to let the file finish quietly if any of the
-- four pieces is missing or wrong - which is what a partially applied
-- migration looks like. Re-running the whole file is the fix.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_money_new CONSTANT text := 'CHECKsubtotal>=0ANDdiscount_total>=0ANDtax_total>=0ANDdelivery_total>=0ANDtotal>=0ANDtotal=roundsubtotal-discount_total+tax_total+delivery_total,2';
  c_delivmode CONSTANT text := 'CHECKfulfillment_mode=''DELIVERY''ORdelivery_total=0';
  missing text[] := '{}';
  v_def   text;
  v_flat  text;
  v_body  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'pif' AND table_name = 'orders'
                    AND column_name = 'delivery_total'
                    AND data_type = 'numeric' AND numeric_precision = 12
                    AND numeric_scale = 2 AND is_nullable = 'NO'
                    AND column_default = '0') THEN
    missing := missing || 'column pif.orders.delivery_total as numeric(12,2) NOT NULL DEFAULT 0';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_money_chk';
  v_flat := CASE WHEN v_def IS NULL THEN NULL
            ELSE regexp_replace(regexp_replace(v_def, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;
  IF v_flat IS DISTINCT FROM c_money_new THEN
    missing := missing || 'pif_orders_money_chk enforcing the delivery-inclusive identity';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'pif.orders'::regclass AND conname = 'pif_orders_delivery_mode_chk';
  v_flat := CASE WHEN v_def IS NULL THEN NULL
            ELSE regexp_replace(regexp_replace(v_def, '::(numeric|text)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') END;
  IF v_flat IS DISTINCT FROM c_delivmode THEN
    missing := missing || 'pif_orders_delivery_mode_chk enforcing the pickup rule';
  END IF;

  SELECT p.prosrc INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_assert_order_totals';
  IF v_body IS NULL
     OR regexp_replace(regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]', '', 'g')
        NOT LIKE '%o.total<>round(s.total+o.delivery_total,2)%' THEN
    missing := missing || 'function pif.trg_assert_order_totals() allowing for delivery_total';
  END IF;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'pif-delivery: PARTIALLY APPLIED. Missing or wrong: %. Re-run this file. - ABORTING', array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'pif-delivery: fully applied and verified - column, both constraints and the trigger function.';
END;
$$;

-- ===========================================================================
--  committed verification
-- ===========================================================================
SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'pif' AND table_name = 'orders' AND column_name = 'delivery_total';
-- expect: numeric, 12, 2, NO, 0

SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'pif.orders'::regclass
   AND conname IN ('pif_orders_money_chk', 'pif_orders_delivery_mode_chk', 'pif_orders_mode_chk')
 ORDER BY conname;
-- expect three rows, all on pif.orders; money_chk must name delivery_total

SELECT tgname, tgrelid::regclass AS attached_to, tgdeferrable, tginitdeferred
  FROM pg_trigger
 WHERE tgname IN ('order_totals_agree', 'order_item_totals_agree') AND NOT tgisinternal
 ORDER BY tgname;
-- expect both still attached, both t / t

SELECT count(*) AS orders,
       count(*) FILTER (WHERE delivery_total <> 0) AS charged,
       count(*) FILTER (WHERE fulfillment_mode = 'PICKUP' AND delivery_total <> 0) AS illegal_pickup_charges,
       count(*) FILTER (WHERE total <> round(subtotal - discount_total + tax_total + delivery_total, 2)) AS inconsistent
  FROM pif.orders;
-- expect illegal_pickup_charges = 0 and inconsistent = 0; charged = 0 on a
-- first application, and whatever the desk has legitimately charged later
