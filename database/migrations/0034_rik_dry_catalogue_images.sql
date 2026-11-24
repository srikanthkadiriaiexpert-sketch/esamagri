-- ---------------------------------------------------------------------------
-- 0034_rik_dry_catalogue_images.sql
--
-- STEP 12C-2 — attach the 103 verified dry-catalogue thumbnails to the
-- provisions they belong to.
--
-- WHAT THIS MIGRATION DOES, AND NOTHING ELSE
--
-- It writes rik.provisions.image_ref for 103 of the 106 dry provisions. It
-- sets no other column. There is no INSERT, no DELETE and no schema change
-- in this file, so the table and view counts the boot-time contract guards
-- are untouched and no provision is created, deleted or retired.
--
-- Names, codes, brands, pack sizes, pack units, entitlement units, pools,
-- daily scales, consumption ratios, conversions, limits, availability,
-- active and customer-selectable flags, display order and effective dates
-- are all left exactly as they are. The entitlement engine reads none of
-- the column this migration writes.
--
-- KEYED ON THE PROVISION CODE, NOT THE DISPLAY NAME. A code is stable and a
-- display name is editable from the RIK Admin dashboard, so keying on the
-- name would silently mis-attach a picture the first time an administrator
-- corrected a spelling. The display name is carried in a comment beside each
-- row so the mapping is readable, but it takes no part in the match.
--
-- IDEMPOTENT. Each row is an assignment to a value that depends only on the
-- code, so re-running changes nothing; the WHERE clause additionally skips
-- rows that already hold the value, so a re-run touches no updated_at.
--
-- SAFE FOR CONFIRMED SELECTIONS. A confirmed selection records what was
-- chosen in its own immutable rule_snapshot and its line items carry their
-- own quantity, ratio and pool equivalent. Nothing here reaches any of them.
--
-- THREE DRY PROVISIONS ARE DELIBERATELY LEFT WITHOUT A PICTURE:
--   OIL_HYDROGENATED, TEA_LOOSE, COFFEE_LOOSE
-- No supplied sheet depicts them. Their image_ref stays NULL and the
-- customer screen shows its neutral placeholder. Lending one of them another
-- product's photograph would misrepresent what an officer is choosing, so
-- the verification block below fails the migration if any of them acquires
-- a picture.
--
-- THE FOUR OIL SKUs EACH GET THEIR OWN PICTURE. The source sheet shows one
-- sunflower bottle and one mustard bottle while the catalogue carries each
-- in two pack sizes, so each visual exists twice — once labelled 500 ml and
-- once 1 Litre. The verification block asserts all four paths are distinct.
--
-- ON THE OIL PACK UNIT — READ THIS BEFORE "FIXING" ANYTHING. The catalogue
-- records these four packs as pack_size 500 / 1000 with the ENTITLEMENT unit
-- 'g', and pack_unit NULL, while the approved images read "500 ml" and
-- "1 Litre". That difference is KNOWN, DOCUMENTED AND DELIBERATELY
-- UNRESOLVED (see docs/reports/step-12c-2-dry-image-integration-report.md).
-- This migration does not touch pack_size, pack_unit or unit on any row, and
-- an image label is not evidence about a stored quantity. Correcting the
-- catalogue's measurement is a business decision, not a migration.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.provisions v
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('BG_AMUL_BUTTER', '/catalogue/rik/dry/butter-ghee/butter-ghee__butter__amul__100g.png'),  -- Butter
    ('BG_AMUL_GHEE', '/catalogue/rik/dry/butter-ghee/butter-ghee__ghee__amul__500g.png'),  -- Ghee
    ('CER_ATTA_AASHIRVAAD', '/catalogue/rik/dry/cereals/cereals__aashirvaad-atta.png'),  -- Aashirvaad Atta
    ('CER_MAIDA', '/catalogue/rik/dry/cereals/cereals__all-purpose-flour-maida__500g.png'),  -- All Purpose Flour / Maida
    ('CER_ATTA_AMUL', '/catalogue/rik/dry/cereals/cereals__atta__amul.png'),  -- Atta
    ('CER_RICE_SONA_MASOORI', '/catalogue/rik/dry/cereals/cereals__bell-rice-sona-masoori.png'),  -- Bell Rice Sona Masoori
    ('CER_BREAD_BROWN', '/catalogue/rik/dry/cereals/cereals__brown-bread.png'),  -- Brown Bread
    ('CER_BURGER_BUN', '/catalogue/rik/dry/cereals/cereals__burger-bun.png'),  -- Burger Bun
    ('CER_CREAM_ROLL', '/catalogue/rik/dry/cereals/cereals__cream-roll.png'),  -- Cream Roll
    ('CER_CUP_CAKE', '/catalogue/rik/dry/cereals/cereals__cup-cake.png'),  -- Cup Cake
    ('CER_HAKKA_NOODLES', '/catalogue/rik/dry/cereals/cereals__hakka-noodles__1000g.png'),  -- Hakka Noodles
    ('CER_RICE_HERITAGE', '/catalogue/rik/dry/cereals/cereals__heritage-basmati-rice-dawat.png'),  -- Heritage Basmati Rice (Dawat)
    ('CER_MAGGI', '/catalogue/rik/dry/cereals/cereals__maggi__280g.png'),  -- Maggi
    ('CER_MILLETS', '/catalogue/rik/dry/cereals/cereals__millets.png'),  -- Millets
    ('CER_BREAD_MULTIGRAIN', '/catalogue/rik/dry/cereals/cereals__multigrain-bread.png'),  -- Multigrain Bread
    ('CER_BREAD_PAV', '/catalogue/rik/dry/cereals/cereals__pav-bread.png'),  -- Pav Bread
    ('CER_ATTA_PILLSBURY', '/catalogue/rik/dry/cereals/cereals__pillsbury-chakki-fresh-atta.png'),  -- Pillsbury Chakki Fresh Atta
    ('CER_PIZZA_BASE', '/catalogue/rik/dry/cereals/cereals__pizza-base.png'),  -- Pizza Base
    ('CER_RICE_ROZANA', '/catalogue/rik/dry/cereals/cereals__rozana-basmati-rice-dawat.png'),  -- Rozana Basmati Rice (Dawat)
    ('CER_RUSK', '/catalogue/rik/dry/cereals/cereals__rusk.png'),  -- Rusk
    ('CER_BREAD_SANDWICH', '/catalogue/rik/dry/cereals/cereals__sandwich-bread.png'),  -- Sandwich Bread
    ('CER_RICE_SUPER_BASMATI', '/catalogue/rik/dry/cereals/cereals__super-basmati-rice-dawat.png'),  -- Super Basmati Rice (Dawat)
    ('NU_AMULPRO', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__amulpro__500g.png'),  -- Amulpro
    ('NU_BOOST', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__boost__500g.png'),  -- Boost
    ('NU_BOURNVITA', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__bournavita__500g.png'),  -- Bournavita
    ('CH_BLOCK', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__cheese-block__200g.png'),  -- Cheese Block
    ('CH_MOZZARELLA', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__cheese-mozzarella__200g.png'),  -- Cheese Mozzarella
    ('CH_SLICES', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__cheese-slices__200g.png'),  -- Cheese Slices
    ('CH_SPREAD', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__cheese-spread__200g.png'),  -- Cheese Spread
    ('CH_TIN', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__cheese-td-tin-cheese__400g.png'),  -- Cheese TD / Tin Cheese
    ('NU_HORLICKS', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__horlicks__500g.png'),  -- Horlicks
    ('NU_MUESLI', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__muesli__tata.png'),  -- Muesli
    ('CH_PANEER', '/catalogue/rik/dry/cheese-nutramul/cheese-nutramul__paneer__amul__200g.png'),  -- Paneer
    ('CND_AMCHUR_MASALA', '/catalogue/rik/dry/condiments/condiments__amchur-masala__50g.png'),  -- Amchur Masala
    ('CND_CHANA_MASALA', '/catalogue/rik/dry/condiments/condiments__chana-masala__50g.png'),  -- Chana Masala
    ('CND_CHICKEN_MASALA', '/catalogue/rik/dry/condiments/condiments__chicken-masala__50g.png'),  -- Chicken Masala
    ('CND_EVEREST_CHILLY_POWDER', '/catalogue/rik/dry/condiments/condiments__chilly-powder__everest__100g.png'),  -- Chilly Powder
    ('CND_CHOLE_MASALA', '/catalogue/rik/dry/condiments/condiments__chole-masala__50g.png'),  -- Chole Masala
    ('CND_CORIANDER_POWDER', '/catalogue/rik/dry/condiments/condiments__coriander-powder__100g.png'),  -- Coriander Powder
    ('CND_CORIANDER_SEEDS', '/catalogue/rik/dry/condiments/condiments__coriander-seeds__100g.png'),  -- Coriander Seeds
    ('CND_CUMIN_SEEDS', '/catalogue/rik/dry/condiments/condiments__cumin-seeds__100g.png'),  -- Cumin Seeds
    ('CND_GARAM_MASALA', '/catalogue/rik/dry/condiments/condiments__garam-masala__50g.png'),  -- Garam Masala
    ('CND_GARLIC', '/catalogue/rik/dry/condiments/condiments__garlic-100g-dry-condiment__100g.png'),  -- Garlic 100g (dry condiment)
    ('CND_KITCHEN_KING_MASALA', '/catalogue/rik/dry/condiments/condiments__kitchen-king-masala__50g.png'),  -- Kitchen King Masala
    ('CND_PANI_PURI_MASALA', '/catalogue/rik/dry/condiments/condiments__pani-puri-masala__50g.png'),  -- Pani Puri Masala
    ('CND_PAV_BHAJI_MASALA', '/catalogue/rik/dry/condiments/condiments__pav-bhaji-masala__50g.png'),  -- Pav Bhaji Masala
    ('CND_RASAM_MASALA', '/catalogue/rik/dry/condiments/condiments__rasam-masala__50g.png'),  -- Rasam Masala
    ('CND_SABJI_MASALA', '/catalogue/rik/dry/condiments/condiments__sabji-masala__50g.png'),  -- Sabji Masala
    ('CND_SAMBAR_MASALA', '/catalogue/rik/dry/condiments/condiments__sambar-masala__100g.png'),  -- Sambar Masala
    ('CND_SHAHI_BIRYANI_MASALA', '/catalogue/rik/dry/condiments/condiments__shahi-biryani-masala__50g.png'),  -- Shahi Biryani Masala
    ('CND_SHAHI_PANEER_MASALA', '/catalogue/rik/dry/condiments/condiments__shahi-paneer-masala__50g.png'),  -- Shahi Paneer Masala
    ('CND_TAMARIND', '/catalogue/rik/dry/condiments/condiments__tamarind__100g.png'),  -- Tamarind
    ('CND_TANDOORI_MASALA', '/catalogue/rik/dry/condiments/condiments__tandoori-masala__50g.png'),  -- Tandoori Masala
    ('CND_TURMERIC_POWDER', '/catalogue/rik/dry/condiments/condiments__turmeric-powder__100g.png'),  -- Turmeric Powder
    ('DAL_P_TATA_ARHAR', '/catalogue/rik/dry/dal-pulses/dal-pulses__arhar__tata__500g.png'),  -- Arhar
    ('DAL_P_FORTUNE_BESAN', '/catalogue/rik/dry/dal-pulses/dal-pulses__besan__fortune__500g.png'),  -- Besan
    ('DAL_P_TATA_BLACK_CHANA', '/catalogue/rik/dry/dal-pulses/dal-pulses__black-chana__tata__500g.png'),  -- Black Chana
    ('DAL_L_CHANNA_DAL', '/catalogue/rik/dry/dal-pulses/dal-pulses__channa-dal-loose.png'),  -- Channa Dal (loose)
    ('DAL_L_DAL_ARHAR', '/catalogue/rik/dry/dal-pulses/dal-pulses__dal-arhar-loose.png'),  -- Dal Arhar (loose)
    ('DAL_L_KABULI_CHANA', '/catalogue/rik/dry/dal-pulses/dal-pulses__kabuli-chana-loose.png'),  -- Kabuli Chana (loose)
    ('DAL_P_TATA_KABULI_CHANA', '/catalogue/rik/dry/dal-pulses/dal-pulses__kabuli-chana__tata__500g.png'),  -- Kabuli Chana
    ('DAL_L_MASOOR_DAL_WHOLE', '/catalogue/rik/dry/dal-pulses/dal-pulses__masoor-dal-whole-loose.png'),  -- Masoor Dal whole (loose)
    ('DAL_P_TATA_MASOOR_SPLIT', '/catalogue/rik/dry/dal-pulses/dal-pulses__masoor-split__tata__500g.png'),  -- Masoor split
    ('DAL_P_TATA_MOONG_WHOLE', '/catalogue/rik/dry/dal-pulses/dal-pulses__moong-whole__tata__500g.png'),  -- Moong whole
    ('DAL_P_TATA_MOONG_WITHOUT_SKIN', '/catalogue/rik/dry/dal-pulses/dal-pulses__moong-without-skin__tata__500g.png'),  -- Moong without skin
    ('DAL_L_MOONG_YELLOW', '/catalogue/rik/dry/dal-pulses/dal-pulses__moong-yellow-loose.png'),  -- Moong Yellow (loose)
    ('DAL_P_TATA_PEAS_DRIED', '/catalogue/rik/dry/dal-pulses/dal-pulses__peas-dried__tata__500g.png'),  -- Peas dried
    ('DAL_L_RAJMA', '/catalogue/rik/dry/dal-pulses/dal-pulses__rajma-loose.png'),  -- Rajma (loose)
    ('DAL_P_TATA_RAJMA', '/catalogue/rik/dry/dal-pulses/dal-pulses__rajma__tata__500g.png'),  -- Rajma
    ('DAL_L_URD_DAL_WHOLE', '/catalogue/rik/dry/dal-pulses/dal-pulses__urd-dal-whole-loose.png'),  -- Urd Dal whole (loose)
    ('DAL_L_URD_DAL_WITHOUT_SKIN', '/catalogue/rik/dry/dal-pulses/dal-pulses__urd-dal-without-skin-loose.png'),  -- Urd Dal without skin (loose)
    ('DAL_P_TATA_URD_SPLIT', '/catalogue/rik/dry/dal-pulses/dal-pulses__urd-split__tata__500g.png'),  -- Urd split
    ('DAL_P_TATA_URD_WITHOUT_SKIN', '/catalogue/rik/dry/dal-pulses/dal-pulses__urd-without-skin__tata__500g.png'),  -- Urd without skin
    ('DAL_CORN_FLOUR', '/catalogue/rik/dry/daliya/daliya__corn-flour__100g.png'),  -- Corn Flour
    ('DAL_CORNFLAKES', '/catalogue/rik/dry/daliya/daliya__cornflakes__500g.png'),  -- Cornflakes
    ('DAL_CUSTARD', '/catalogue/rik/dry/daliya/daliya__custard-powder__100g.png'),  -- Custard Powder
    ('DAL_DALIYA', '/catalogue/rik/dry/daliya/daliya__dalia__500g.png'),  -- Dalia
    ('DAL_OATS', '/catalogue/rik/dry/daliya/daliya__oats__600g.png'),  -- Oats
    ('DAL_SAGO', '/catalogue/rik/dry/daliya/daliya__sago__200g.png'),  -- Sago
    ('DAL_SEMOLINA', '/catalogue/rik/dry/daliya/daliya__semolina.png'),  -- Semolina
    ('GMW_AJWAIN', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__ajwain__50g.png'),  -- Ajwain
    ('GMW_ANISE_SEEDS', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__anise-seeds__50g.png'),  -- Anise Seeds
    ('GMW_ASAFOETIDA', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__asafoetida__50g.png'),  -- Asafoetida
    ('GMW_BAY_LEAF', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__bay-leaf__50g.png'),  -- Bay Leaf
    ('GMW_CINNAMON_STICK', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__cinnamon-stick__50g.png'),  -- Cinnamon Stick
    ('GMW_CLOVES', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__cloves__50g.png'),  -- Cloves
    ('GMW_FENUGREEK', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__fenugreek__50g.png'),  -- Fenugreek
    ('GMW_KASHMIRI_CHILLI', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__kashmiri-chilli__100g.png'),  -- Kashmiri Chilli
    ('GMW_LARGE_CARDAMOM', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__large-cardamom__50g.png'),  -- Large Cardamom
    ('GMW_POPPY_SEEDS', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__poppy-seeds__50g.png'),  -- Poppy Seeds
    ('GMW_WHOLE_PEPPER', '/catalogue/rik/dry/garam-masala-whole/garam-masala-whole__whole-pepper__50g.png'),  -- Whole Pepper
    ('OIL_GROUNDNUT', '/catalogue/rik/dry/oil/oil__groundnut-oil__1000g.png'),  -- Groundnut Oil
    ('OIL_MUSTARD_1000', '/catalogue/rik/dry/oil/oil__mustard-oil__1litre.png'),  -- Mustard Oil
    ('OIL_MUSTARD_500', '/catalogue/rik/dry/oil/oil__mustard-oil__500ml.png'),  -- Mustard Oil
    ('OIL_RICE_BRAN', '/catalogue/rik/dry/oil/oil__rice-bran-oil__1000g.png'),  -- Rice Bran Oil
    ('OIL_SUNFLOWER_1000', '/catalogue/rik/dry/oil/oil__sunflower-refined-oil__1litre.png'),  -- Sunflower Refined Oil
    ('OIL_SUNFLOWER_500', '/catalogue/rik/dry/oil/oil__sunflower-refined-oil__500ml.png'),  -- Sunflower Refined Oil
    ('SALT_TABLE', '/catalogue/rik/dry/salt/salt__salt__500g.png'),  -- Salt
    ('JAGGERY', '/catalogue/rik/dry/sugar/sugar__jaggery.png'),  -- Jaggery
    ('SUGAR', '/catalogue/rik/dry/sugar/sugar__sugar.png'),  -- Sugar
    ('TEA_CHAHAT', '/catalogue/rik/dry/tea-coffee/tea-coffee__chahat-society-tea__250g.png'),  -- Chahat Society Tea
    ('COFFEE_COLUMBIAN', '/catalogue/rik/dry/tea-coffee/tea-coffee__columbian-coffee__50g.png'),  -- Columbian Coffee
    ('TEA_WAGH_BAKRI', '/catalogue/rik/dry/tea-coffee/tea-coffee__elaichi-tea__wagh-bakri__250g.png')   -- Elaichi Tea
  ) AS m(code, image_ref)
 WHERE v.code = m.code
   AND v.image_ref IS DISTINCT FROM m.image_ref;

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-attached catalogue
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dry_total  integer;
  dry_with   integer;
  stray      integer;
  fresh_with integer;
  oil_paths  integer;
BEGIN
  SELECT count(*), count(v.image_ref) INTO dry_total, dry_with
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code IN ('CEREALS', 'DAL', 'HYDROGENATED_OIL', 'SUGAR_JAGGERY', 'TEA_COFFEE', 'DALIYA', 'BUTTER_GHEE', 'SALT', 'CHEESE_NUTRAMUL', 'CONDIMENTS', 'GARAM_MASALA_WHOLE');
  IF dry_total <> 106 THEN
    RAISE EXCEPTION 'Migration 0034: expected 106 dry provisions, found %.', dry_total;
  END IF;
  IF dry_with <> 103 THEN
    RAISE EXCEPTION 'Migration 0034: expected 103 dry pictures, found %.', dry_with;
  END IF;

  -- The three without a picture must still be without one.
  SELECT count(*) INTO stray FROM rik.provisions
   WHERE code IN ('OIL_HYDROGENATED','TEA_LOOSE','COFFEE_LOOSE') AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0034: % provision(s) that should have no picture were given one.', stray;
  END IF;

  -- The fresh catalogue is not this migration's business.
  SELECT count(v.image_ref) INTO fresh_with
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code IN ('VEGETABLES','FRUITS');
  IF fresh_with <> 70 THEN
    RAISE EXCEPTION 'Migration 0034: the fresh catalogue changed — % pictures, expected 70.', fresh_with;
  END IF;

  -- One picture, one provision, across the whole catalogue.
  SELECT count(*) INTO stray FROM (
    SELECT image_ref FROM rik.provisions
     WHERE image_ref IS NOT NULL GROUP BY image_ref HAVING count(*) > 1
  ) d;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0034: % picture(s) are attached to more than one provision.', stray;
  END IF;

  -- The four oil SKUs must not end up sharing a picture.
  SELECT count(DISTINCT image_ref) INTO oil_paths FROM rik.provisions
   WHERE code IN ('OIL_SUNFLOWER_500','OIL_SUNFLOWER_1000','OIL_MUSTARD_500','OIL_MUSTARD_1000');
  IF oil_paths <> 4 THEN
    RAISE EXCEPTION 'Migration 0034: the four oil SKUs share pictures — % distinct paths.', oil_paths;
  END IF;

  -- And their stored measurements must be exactly as they were.
  SELECT count(*) INTO stray FROM rik.provisions
   WHERE code IN ('OIL_SUNFLOWER_500','OIL_MUSTARD_500')
     AND NOT (pack_size = 500 AND unit = 'g' AND pack_unit IS NULL);
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0034: a 500 oil row no longer reads 500 / g / NULL.';
  END IF;
  SELECT count(*) INTO stray FROM rik.provisions
   WHERE code IN ('OIL_SUNFLOWER_1000','OIL_MUSTARD_1000')
     AND NOT (pack_size = 1000 AND unit = 'g' AND pack_unit IS NULL);
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0034: a 1000 oil row no longer reads 1000 / g / NULL.';
  END IF;
END;
$$;

RESET ROLE;
