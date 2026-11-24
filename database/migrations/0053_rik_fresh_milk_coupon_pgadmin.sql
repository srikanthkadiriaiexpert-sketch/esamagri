 BEGIN;
---------------------------------------------------------------------------
-- 0053_rik_fresh_milk_coupon.sql
--
-- Fresh Milk becomes a PHYSICAL 500 ml COUPON that the officer selects as an
-- ordinary RIK provision.
--
-- THE WHOLE IDEA, IN ONE LINE. A coupon is a provision counted in whole units
-- whose consumption ratio is 500: one coupon costs 500 ml of the MILK pool.
-- Everything the requirement asks for then falls out of machinery that has
-- been in place since STEP 11 and needs no engine change:
--
--     maxProvisionQuantity(remaining, 500) = floor(remaining / 500)
--
-- so 2,500 ml offers exactly 5 coupons and 1,750 ml offers exactly 3, leaving
-- 250 ml in the pool; poolEquivalent(n, 500) = 500n is summed into the SAME
-- per-pool total as Milk TD, so the two remain selectable together and the
-- existing EXCEEDS_ENTITLEMENT check governs the pair; and a remainder is
-- simply unspent pool, available to Milk TD at the approved 2.5 ratio
-- (250 ml buys exactly 100 g) under rules this file does not touch.
--
-- WHAT IS DELIBERATELY NOT HERE. No digital coupon, no code, no QR, no
-- scanning, no redemption workflow, no coupon table, no coupon status, no
-- coupon screen. The physical coupons are handed over by RIK staff at the
-- stand or sent with a home delivery, and the system's record of that is the
-- issue voucher and its issue lines, exactly as they already work. This file
-- adds ONE provision row and ONE configuration column. It creates no table,
-- no view, no role, no permission and no status.
--
-- WHY A NEW PROVISION RATHER THAN REDEFINING MILK_FRESH. A draft selection
-- stores a quantity against a provision id; redefining Fresh Milk from
-- millilitres at ratio 1 to coupons at ratio 500 would reinterpret a stored
-- 1,500 as 1,500 COUPONS. A new row cannot do that to anything.
--
-- WHY MILK_FRESH IS RETIRED WITH is_customer_selectable AND NOT BY
-- END-DATING. The engine sums consumption over the provisions inside the
-- active effective window (rik-entitlement.service.ts). End-dating a
-- provision therefore makes any existing line on it STOP COUNTING silently —
-- the officer's remaining balance would rise while the row sat unseen in
-- entitlement_selection_items. Clearing is_customer_selectable keeps the row
-- inside the window, so its consumption still counts and history still
-- resolves, while removing it from the officer's catalogue entirely: the
-- engine lists neither it nor an "unavailable" entry for it, and a crafted
-- request naming it is refused with the message that already exists for this
-- case — "This provision is issued at the counter and cannot be selected
-- here."
--
-- A PRE-FLIGHT WAS RUN. No DRAFT selection — in fact no selection item of any
-- status — referenced MILK_FRESH in either database before this file ran.
--
-- THE PICTURE MOVES WITH THE PROVISION. Migration 0052 attached the milk
-- bottle + physical RIK 500 ml coupon photograph to MILK_FRESH. That picture
-- depicts a coupon, so it belongs to the coupon provision: it is moved, and
-- MILK_FRESH is left with image_ref NULL rather than displaying a coupon it
-- no longer represents. One picture, one provision, as every image step has
-- asserted.
--
-- WHAT IS NOT TOUCHED. MILK_TD keeps its name, unit g, ratio 2.500000 and its
-- selectability. The MILK pool keeps its 250 ml/day scale for PV, EV and NV.
-- No conversion, no other pool, no other provision, no pack size, no
-- max_packs, no entitlement record, no confirmed selection, no rule snapshot,
-- no voucher and no fulfilment record is changed. The verification block
-- re-asserts all of it.
-- ---------------------------------------------------------------------------





-- ---------------------------------------------------------------------------
-- 1. whole_units_only — the configuration that makes "whole coupons" a rule
--
-- Scoped by configuration, not by name: the engine never knows what a
-- provision is called. Defaults false, so EVERY existing provision keeps its
-- behaviour exactly — cereals with a pack size are untouched, and so are
-- Eggs, which remain selectable in fractions precisely as before. Only the
-- coupon row sets it, which is what "apply the whole-coupon rule to Fresh
-- Milk only" means in a data-driven engine.
-- ---------------------------------------------------------------------------
ALTER TABLE rik.provisions
  ADD COLUMN IF NOT EXISTS whole_units_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN rik.provisions.whole_units_only IS
  'When true a selected quantity must be a whole number of this provision''s own units — a physical coupon cannot be issued in halves. Independent of pack_size, which is a quantity ceiling and not a step.';

-- ---------------------------------------------------------------------------
-- 2. 'coupon' becomes a permitted pack unit
--
-- pack_unit is PRESENTATION ONLY (0031) — the noun for the container, never
-- an input to any calculation — so widening its CHECK by one value carries no
-- entitlement risk. It is what lets the screens say "3 coupons" instead of
-- "3 piece" without any code deciding that from a provision's name.
-- ---------------------------------------------------------------------------
ALTER TABLE rik.provisions DROP CONSTRAINT IF EXISTS rik_provisions_pack_unit_chk;
ALTER TABLE rik.provisions
  ADD CONSTRAINT rik_provisions_pack_unit_chk
    CHECK (pack_unit IS NULL OR pack_unit IN ('g','kg','ml','litre','piece','packet','tin','box','coupon'));

-- ---------------------------------------------------------------------------
-- 3. The coupon provision
--
-- unit 'piece' because the CHECK on rik.provisions.unit is the approved
-- ('g','ml','piece') and a coupon is counted, not measured; the word
-- "coupon" is carried by pack_unit, which is where display nouns live.
--
-- pack_size stays NULL ON PURPOSE. pack_size is denominated in the
-- provision's OWN unit, so 500 here would mean "a pack of 500 coupons" and
-- would make the customer screen's +/- keys step by 500. The 500 ml lives in
-- the consumption ratio, which is exactly what a ratio is for.
-- ---------------------------------------------------------------------------
INSERT INTO rik.provisions
  (pool_id, code, name, unit, consumption_ratio, pack_size, pack_unit, is_loose,
   is_customer_selectable, whole_units_only, max_quantity, max_packs,
   min_eligible_days, issue_period, display_order)
SELECT p.id, 'MILK_FRESH_COUPON', 'Fresh Milk (500 ml coupon)', 'piece', 500.000000,
       NULL::numeric, 'coupon', false, true, true,
       NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10
  FROM rik.entitlement_pools p
 WHERE p.code = 'MILK'
   AND NOT EXISTS (SELECT 1 FROM rik.provisions WHERE code = 'MILK_FRESH_COUPON');

-- ---------------------------------------------------------------------------
-- 4. The picture moves to the provision it depicts
-- ---------------------------------------------------------------------------
UPDATE rik.provisions
   SET image_ref = '/catalogue/rik/fresh-staples/milk__fresh-500ml-coupon.png',
       updated_at = now()
 WHERE code = 'MILK_FRESH_COUPON';

UPDATE rik.provisions
   SET image_ref = NULL,
       updated_at = now()
 WHERE code = 'MILK_FRESH';

-- ---------------------------------------------------------------------------
-- 5. Loose millilitre Fresh Milk is retired from the officer's catalogue
--
-- The row stays active and in its effective window. Nothing is deleted and
-- nothing is end-dated.
-- ---------------------------------------------------------------------------
UPDATE rik.provisions
   SET is_customer_selectable = false,
       updated_at = now()
 WHERE code = 'MILK_FRESH';

-- ---------------------------------------------------------------------------
-- 6. Verification — every claim the header makes, checked
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n          integer;
  provisions integer;
  pools      integer;
BEGIN
  -- 6a. The coupon exists, exactly once, and is configured exactly so.
  SELECT count(*) INTO n
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE v.code = 'MILK_FRESH_COUPON'
     AND p.code = 'MILK'
     AND v.unit = 'piece'
     AND v.consumption_ratio = 500.000000
     AND v.pack_size IS NULL
     AND v.pack_unit = 'coupon'
     AND v.whole_units_only
     AND v.is_customer_selectable
     AND v.is_active
     AND v.issue_period = 'FRESH'
     AND v.max_quantity IS NULL AND v.max_packs IS NULL AND v.min_eligible_days IS NULL
     AND v.image_ref = '/catalogue/rik/fresh-staples/milk__fresh-500ml-coupon.png';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 0053: the coupon provision is missing or misconfigured (matched % rows, expected 1).', n;
  END IF;

  -- 6b. Exactly ONE provision in the whole catalogue is whole-units-only.
  --     This is the assertion that "Fresh Milk only" rests on.
  SELECT count(*) INTO n FROM rik.provisions WHERE whole_units_only;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 0053: % provisions are whole-units-only; exactly 1 (the coupon) must be.', n;
  END IF;

  -- 6c. Loose Fresh Milk is retired, NOT deleted, NOT end-dated, and no
  --     longer carries the coupon picture.
  SELECT count(*) INTO n
    FROM rik.provisions
   WHERE code = 'MILK_FRESH'
     AND NOT is_customer_selectable
     AND is_active
     AND effective_to IS NULL
     AND unit = 'ml'
     AND consumption_ratio = 1.000000
     AND image_ref IS NULL
     AND NOT whole_units_only;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 0053: MILK_FRESH must remain active and in-window, be non-selectable, keep unit ml and ratio 1.0, and hold no picture.';
  END IF;

  -- 6d. MILK_TD IS UNTOUCHED — the approved alternative, unchanged.
  SELECT count(*) INTO n
    FROM rik.provisions
   WHERE code = 'MILK_TD' AND unit = 'g' AND consumption_ratio = 2.500000
     AND is_customer_selectable AND is_active AND NOT whole_units_only
     AND pack_size IS NULL AND image_ref IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 0053: MILK_TD is not as it was. It must keep unit g, ratio 2.5, no pack size, no picture and its selectability.';
  END IF;

  -- 6e. The MILK entitlement itself did not move: 250 ml a day for all three
  --     dietary preferences, as seeded.
  SELECT count(*) INTO n
    FROM rik.pool_scales s JOIN rik.entitlement_pools p ON p.id = s.pool_id
   WHERE p.code = 'MILK' AND s.daily_qty = 250 AND s.is_active
     AND s.dietary_preference IN ('PV','EV','NV');
  IF n <> 3 THEN
    RAISE EXCEPTION 'Migration 0053: the MILK daily scale is no longer 250 ml for PV, EV and NV (found % rows).', n;
  END IF;

  -- 6f. EXACTLY ONE provision was created, and no pool was.
  SELECT count(*) INTO provisions FROM rik.provisions;
  IF provisions <> 190 THEN
    RAISE EXCEPTION 'Migration 0053: the catalogue holds % provisions, not 190 (189 before this file, plus the coupon).', provisions;
  END IF;

  SELECT count(*) INTO pools FROM rik.entitlement_pools;
  IF pools <> 18 THEN
    RAISE EXCEPTION 'Migration 0053: there are now % entitlement pools, not 18.', pools;
  END IF;

  -- 6g. Nothing else became a coupon, and nothing else acquired a pack unit
  --     it did not have. Only the new row uses 'coupon'.
  SELECT count(*) INTO n FROM rik.provisions WHERE pack_unit = 'coupon';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 0053: % provisions carry the pack unit "coupon"; only the coupon may.', n;
  END IF;

  -- 6h. THE CEREAL PACK SIZES ARE UNTOUCHED — the explicit instruction.
  SELECT count(*) INTO n
    FROM rik.provisions
   WHERE code IN ('CER_MAGGI','CER_HAKKA_NOODLES','CER_MAIDA')
     AND max_packs = 2 AND pack_size IS NOT NULL AND NOT whole_units_only;
  IF n <> 3 THEN
    RAISE EXCEPTION 'Migration 0053: the three packed cereal items no longer have their pack size, their 2-pack limit, or have become whole-units-only.';
  END IF;

  -- 6i. The picture set is still 180, and still one picture per provision.
  SELECT count(*) INTO n FROM rik.provisions WHERE image_ref IS NOT NULL;
  IF n <> 180 THEN
    RAISE EXCEPTION 'Migration 0053: % provisions carry a picture, not 180 — the milk picture was moved, not copied.', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT image_ref FROM rik.provisions
     WHERE image_ref IS NOT NULL GROUP BY image_ref HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 0053: % picture(s) are attached to more than one provision.', n;
  END IF;
END;
$$;

RESET ROLE;
COMMIT;
