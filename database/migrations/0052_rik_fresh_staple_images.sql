-- ---------------------------------------------------------------------------
-- 0052_rik_fresh_staple_images.sql
--
-- The seven RIK Fresh STAPLE pictures: Milk, Eggs, Onion, Potato and the
-- three Meat items.
--
-- WHAT THIS CLOSES. Through migration 0042 the catalogue had pictures for the
-- seventy Fresh VARIETIES (0033), the hundred and three Dry items (0034) and
-- the eighteen category covers (0035-0042). The staple Fresh allowances —
-- the ones an officer actually draws month by month — had none, and showed
-- the customer screen's placeholder carton. The client has now supplied a
-- seven-product sheet; these are the seven pictures from it.
--
-- WHAT THIS MIGRATION IS. One UPDATE of `image_ref` (and `updated_at`) on
-- seven EXISTING rows, matched on `code`. That shape is the whole safety
-- argument:
--
--   * it CANNOT create a provision, a product or a category — there is no
--     INSERT in this file, and the verification block asserts the provision
--     and pool counts are unchanged;
--   * it CANNOT change a business value — no name, unit, consumption ratio,
--     pool, pack size, maximum, eligibility rule, price or stock figure is
--     written. The verification block re-asserts all seven rows' name, unit,
--     ratio and pool against literals, so a stray edit fails the migration
--     rather than reaching a demo;
--   * it is IDEMPOTENT — re-running it writes the same seven values.
--
-- WHAT THIS MIGRATION IS NOT. It does not implement, prepare or imply the
-- Fresh Milk 500 ml coupon denomination. `MILK_FRESH` keeps its name, its
-- unit `ml`, its ratio of 1.0 and its selectability; `MILK_TD` is not touched
-- at all; no entitlement pool, scale, conversion or selection rule is
-- involved. The milk picture happens to show the physical coupon beside the
-- bottle because that is the subject the client supplied for that provision.
-- The denomination change is a separate, separately-approved piece of work.
--
-- A THIRD PICTURE FOLDER. 0033 asserted that every picture sat under
-- /catalogue/rik/fresh/; 0034 widened that to the dry folder when the dry
-- catalogue arrived. This step widens it once more, to
-- /catalogue/rik/fresh-staples/. The seven are kept out of the fresh folder
-- on purpose: that folder is documented as seventy files from one client
-- sheet, used byte-for-byte, and these come from a different sheet with a
-- different treatment. See apps/customer-web/public/catalogue/rik/
-- fresh-staples/README.md for the source, the exact crop boxes and the
-- processing, which was a crop, a centre-square and a Lanczos resize and
-- nothing else.
--
-- ONE NAME DELIBERATELY NOT CORRECTED. `MEAT_MUTTON` is displayed as "Meat",
-- not "Mutton", and the client's tile for it is captioned Mutton. The mapping
-- was confirmed before this file was written; the NAME IS LEFT ALONE, because
-- renaming a provision is a business decision and not part of integrating a
-- picture.
--
-- No schema change. No constraint, index, trigger, grant, role or permission
-- is touched.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

UPDATE rik.provisions v
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('MILK_FRESH',   '/catalogue/rik/fresh-staples/milk__fresh-500ml-coupon.png'),  -- Fresh Milk (bottle + RIK 500 ml coupon)
    ('EGGS_TABLE',   '/catalogue/rik/fresh-staples/eggs__table.png'),               -- Eggs
    ('ONION_FRESH',  '/catalogue/rik/fresh-staples/onion__fresh.png'),              -- Onion
    ('POTATO_FRESH', '/catalogue/rik/fresh-staples/potato__fresh.png'),             -- Potato
    ('MEAT_CHICKEN', '/catalogue/rik/fresh-staples/meat__chicken-fowl.png'),        -- Chicken / Fowl
    ('MEAT_FISH',    '/catalogue/rik/fresh-staples/meat__fish.png'),                -- Fish
    ('MEAT_MUTTON',  '/catalogue/rik/fresh-staples/meat__mutton.png')               -- Meat (the client's tile says Mutton)
  ) AS m(code, image_ref)
 WHERE v.code = m.code;

-- ---------------------------------------------------------------------------
-- Verification. Every claim the header makes is checked here, and the
-- migration refuses rather than half-applying.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  staple_count   integer;
  wrong          integer;
  fresh_count    integer;
  dry_count      integer;
  duplicated     integer;
  provision_rows integer;
  pool_rows      integer;
  altered        integer;
BEGIN
  -- 1. Exactly seven staple pictures, and each one on exactly the right row.
  SELECT count(*) INTO staple_count
    FROM rik.provisions
   WHERE image_ref LIKE '/catalogue/rik/fresh-staples/%';
  IF staple_count <> 7 THEN
    RAISE EXCEPTION 'Migration 0052: expected 7 fresh-staple pictures, found %.', staple_count;
  END IF;

  SELECT count(*) INTO wrong
    FROM (VALUES
      ('MILK_FRESH',   '/catalogue/rik/fresh-staples/milk__fresh-500ml-coupon.png'),
      ('EGGS_TABLE',   '/catalogue/rik/fresh-staples/eggs__table.png'),
      ('ONION_FRESH',  '/catalogue/rik/fresh-staples/onion__fresh.png'),
      ('POTATO_FRESH', '/catalogue/rik/fresh-staples/potato__fresh.png'),
      ('MEAT_CHICKEN', '/catalogue/rik/fresh-staples/meat__chicken-fowl.png'),
      ('MEAT_FISH',    '/catalogue/rik/fresh-staples/meat__fish.png'),
      ('MEAT_MUTTON',  '/catalogue/rik/fresh-staples/meat__mutton.png')
    ) AS e(code, image_ref)
    LEFT JOIN rik.provisions v ON v.code = e.code
   WHERE v.id IS NULL OR v.image_ref IS DISTINCT FROM e.image_ref;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'Migration 0052: % of the seven provisions is missing or carries the wrong picture.', wrong;
  END IF;

  -- 2. THE EARLIER SETS ARE UNTOUCHED. Not "roughly right" — the same two
  --    counts 0033 and 0034 established.
  SELECT count(*) INTO fresh_count
    FROM rik.provisions WHERE image_ref LIKE '/catalogue/rik/fresh/%';
  IF fresh_count <> 70 THEN
    RAISE EXCEPTION 'Migration 0052: the fresh variety set is now % pictures, not 70.', fresh_count;
  END IF;

  SELECT count(*) INTO dry_count
    FROM rik.provisions WHERE image_ref LIKE '/catalogue/rik/dry/%';
  IF dry_count <> 103 THEN
    RAISE EXCEPTION 'Migration 0052: the dry set is now % pictures, not 103.', dry_count;
  END IF;

  -- 3. No picture may sit outside the three known folders.
  SELECT count(*) INTO wrong
    FROM rik.provisions
   WHERE image_ref IS NOT NULL
     AND image_ref NOT LIKE '/catalogue/rik/fresh/%'
     AND image_ref NOT LIKE '/catalogue/rik/dry/%'
     AND image_ref NOT LIKE '/catalogue/rik/fresh-staples/%';
  IF wrong > 0 THEN
    RAISE EXCEPTION 'Migration 0052: % provision(s) carry a picture from an unknown folder.', wrong;
  END IF;

  -- 4. One picture, one provision — across the whole catalogue.
  SELECT count(*) INTO duplicated FROM (
    SELECT image_ref FROM rik.provisions
     WHERE image_ref IS NOT NULL GROUP BY image_ref HAVING count(*) > 1
  ) d;
  IF duplicated > 0 THEN
    RAISE EXCEPTION 'Migration 0052: % picture(s) are attached to more than one provision.', duplicated;
  END IF;

  -- 5. NOTHING WAS CREATED. 189 provisions and 18 pools, as before this file.
  SELECT count(*) INTO provision_rows FROM rik.provisions;
  IF provision_rows <> 189 THEN
    RAISE EXCEPTION 'Migration 0052: the catalogue now holds % provisions, not 189 — a row was created or removed.', provision_rows;
  END IF;

  SELECT count(*) INTO pool_rows FROM rik.entitlement_pools;
  IF pool_rows <> 18 THEN
    RAISE EXCEPTION 'Migration 0052: there are now % entitlement pools, not 18.', pool_rows;
  END IF;

  -- 6. NO BUSINESS VALUE WAS WRITTEN. The seven rows' name, unit, ratio,
  --    pool and pack size, re-asserted against literals. This is what makes
  --    "images only" a checked fact rather than an intention — and it is
  --    also the guard that would catch an accidental start on the coupon
  --    denomination, which would have to change MILK_FRESH's unit and ratio.
  SELECT count(*) INTO altered
    FROM (VALUES
      ('MILK_FRESH',   'Fresh Milk',     'ml',    1.000000, 'MILK'),
      ('EGGS_TABLE',   'Eggs',           'piece', 1.000000, 'EGGS'),
      ('ONION_FRESH',  'Onion',          'g',     1.000000, 'ONION_GARLIC'),
      ('POTATO_FRESH', 'Potato',         'g',     1.000000, 'POTATO'),
      ('MEAT_CHICKEN', 'Chicken / Fowl', 'g',     1.485714, 'MEAT'),
      ('MEAT_FISH',    'Fish',           'g',     0.604651, 'MEAT'),
      ('MEAT_MUTTON',  'Meat',           'g',     1.000000, 'MEAT')
    ) AS e(code, name, unit, ratio, pool_code)
    JOIN rik.provisions v ON v.code = e.code
    JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE v.name <> e.name
      OR v.unit <> e.unit
      OR v.consumption_ratio <> e.ratio::numeric(14,6)
      OR p.code <> e.pool_code
      OR v.pack_size IS NOT NULL
      OR NOT v.is_active;
  IF altered > 0 THEN
    RAISE EXCEPTION 'Migration 0052: % of the seven provisions had a business value changed. This migration must write pictures and nothing else.', altered;
  END IF;

  -- 7. MILK_TD IS NOT TOUCHED, and the milk entitlement is exactly as it was.
  IF NOT EXISTS (
    SELECT 1 FROM rik.provisions
     WHERE code = 'MILK_TD' AND unit = 'g' AND consumption_ratio = 2.500000
       AND image_ref IS NULL AND is_customer_selectable
  ) THEN
    RAISE EXCEPTION 'Migration 0052: MILK_TD is not as it was left — it must keep unit g, ratio 2.5, no picture and its selectability.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM rik.provisions
     WHERE code = 'MILK_FRESH' AND unit = 'ml' AND consumption_ratio = 1.000000
       AND is_customer_selectable
  ) THEN
    RAISE EXCEPTION 'Migration 0052: MILK_FRESH must keep unit ml, ratio 1.0 and its selectability — the coupon denomination is NOT part of this step.';
  END IF;
END;
$$;

RESET ROLE;
