-- ---------------------------------------------------------------------------
-- 0033_rik_fresh_catalogue_images.sql
--
-- STEP 12B — attach the seventy verified fresh-catalogue thumbnails to the
-- provisions they belong to.
--
-- WHAT THIS MIGRATION DOES, AND NOTHING ELSE
--
-- It writes rik.provisions.image_ref for exactly 44 Fresh Vegetable
-- varieties and exactly 26 Fresh Fruit varieties. It sets no other column.
-- There is no INSERT, no DELETE and no schema change in this file, so the
-- table and view counts the boot-time contract guards are untouched.
--
-- Names, codes, pools, daily scales, consumption ratios, conversions,
-- dietary rules, eligibility, pack sizes, pack units, brands, issue periods
-- and display order are all left exactly as they are. The entitlement engine
-- reads none of the column this migration writes.
--
-- KEYED ON THE PROVISION CODE, NOT THE DISPLAY NAME. A code is stable and a
-- display name is editable from the RIK Admin dashboard, so keying on the
-- name would silently mis-attach a picture the first time an administrator
-- corrected a spelling. The display name is carried in a comment beside each
-- row so the mapping is readable, but it takes no part in the match.
--
-- IDEMPOTENT. Each row is an assignment to a value that depends only on the
-- code, so re-running changes nothing. The WHERE clause additionally skips
-- rows that already hold the value, so a re-run touches no updated_at.
--
-- SAFE FOR CONFIRMED SELECTIONS. A confirmed selection records what was
-- chosen in its own immutable rule_snapshot and its line items carry their
-- own quantity, ratio and pool equivalent. Nothing here reaches any of them,
-- and rik.trg_protect_used_configuration would refuse it if it tried.
--
-- THE PICTURES THEMSELVES are static files in the customer app's public
-- asset folder, following the same convention as the brand assets already
-- there; this column holds the path to one, never the image bytes. See
-- apps/customer-web/public/catalogue/rik/fresh/README.md for their
-- provenance.
--
-- NOT TOUCHED: the three generic placeholder provisions VEG_FRESH
-- ("Fresh Vegetables"), FRUIT_FRESH ("Fresh Fruits") and FRUIT_DRY
-- ("Dry Fruits"). They are not named varieties and none of the seventy
-- pictures depicts them, so they keep image_ref NULL and keep showing the
-- customer screen's placeholder. The verification block below fails the
-- migration if any of them acquires a picture.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.provisions v
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('VEG_ARVI', '/catalogue/rik/fresh/01_arvi.png'),  -- Arvi
    ('VEG_ASPARAGUS', '/catalogue/rik/fresh/02_asparagus.png'),  -- Asparagus
    ('VEG_BABY_CORN', '/catalogue/rik/fresh/03_baby-corn.png'),  -- Baby Corn
    ('VEG_BEANS_FRENCH', '/catalogue/rik/fresh/04_beans-french.png'),  -- Beans French
    ('VEG_BEANS_LONG', '/catalogue/rik/fresh/05_beans-long.png'),  -- Beans Long
    ('VEG_BEETROOT', '/catalogue/rik/fresh/06_beetroot.png'),  -- Beetroot
    ('VEG_BITTER_GUARD', '/catalogue/rik/fresh/07_bitter-guard.png'),  -- Bitter Guard
    ('VEG_BOTTLE_GUARD', '/catalogue/rik/fresh/08_bottle-guard.png'),  -- Bottle Guard
    ('VEG_BRINJAL_PURPLE_AND_GREEN', '/catalogue/rik/fresh/09_brinjal-purple-green.png'),  -- Brinjal (Purple & Green)
    ('VEG_BROCCOLI', '/catalogue/rik/fresh/10_broccoli.png'),  -- Broccoli
    ('VEG_CABBAGE', '/catalogue/rik/fresh/11_cabbage.png'),  -- Cabbage
    ('VEG_CAPSICUM', '/catalogue/rik/fresh/12_capsicum.png'),  -- Capsicum
    ('VEG_CAPSICUM_RED', '/catalogue/rik/fresh/13_capsicum-red.png'),  -- Capsicum Red
    ('VEG_CAPSICUM_YELLOW', '/catalogue/rik/fresh/14_capsicum-yellow.png'),  -- Capsicum Yellow
    ('VEG_CARROT_COUNTRY', '/catalogue/rik/fresh/15_carrot-country.png'),  -- Carrot Country
    ('VEG_CARROT_RED', '/catalogue/rik/fresh/16_carrot-red.png'),  -- Carrot Red
    ('VEG_CAULIFLOWER', '/catalogue/rik/fresh/17_cauliflower.png'),  -- Cauliflower
    ('VEG_CHILLY_GREEN', '/catalogue/rik/fresh/18_chilly-green.png'),  -- Chilly Green
    ('VEG_CLUSTER_BEANS', '/catalogue/rik/fresh/19_cluster-beans.png'),  -- Cluster Beans
    ('VEG_CORIANDER_GREEN', '/catalogue/rik/fresh/20_coriander-green.png'),  -- Coriander Green
    ('VEG_COWPEAS', '/catalogue/rik/fresh/21_cowpeas.png'),  -- Cowpeas
    ('VEG_CUCUMBER', '/catalogue/rik/fresh/22_cucumber.png'),  -- Cucumber
    ('VEG_CURRY_LEAVES', '/catalogue/rik/fresh/23_curry-leaves.png'),  -- Curry Leaves
    ('VEG_DRUM_STICK', '/catalogue/rik/fresh/24_drum-stick.png'),  -- Drum Stick
    ('VEG_GINGER_GREEN', '/catalogue/rik/fresh/25_ginger-green.png'),  -- Ginger Green
    ('VEG_KHOL_KHOL', '/catalogue/rik/fresh/26_khol-khol.png'),  -- Khol Khol
    ('VEG_KUNDRI', '/catalogue/rik/fresh/27_kundri.png'),  -- Kundri
    ('VEG_LADIE_S_FINGER', '/catalogue/rik/fresh/28_ladies-finger.png'),  -- Ladie's Finger
    ('VEG_LEEK', '/catalogue/rik/fresh/29_leek.png'),  -- Leek
    ('VEG_MARROW', '/catalogue/rik/fresh/30_marrow.png'),  -- Marrow
    ('VEG_MINT_GREEN', '/catalogue/rik/fresh/31_mint-green.png'),  -- Mint Green
    ('VEG_MUSHROOM', '/catalogue/rik/fresh/32_mushroom.png'),  -- Mushroom
    ('VEG_PARWAL', '/catalogue/rik/fresh/33_parwal.png'),  -- Parwal
    ('VEG_PEAS_GREEN', '/catalogue/rik/fresh/34_peas-green.png'),  -- Peas Green
    ('VEG_PUMPKIN', '/catalogue/rik/fresh/35_pumpkin.png'),  -- Pumpkin
    ('VEG_RADISH', '/catalogue/rik/fresh/36_radish.png'),  -- Radish
    ('VEG_RIBBED_GUARD', '/catalogue/rik/fresh/37_ribbed-guard.png'),  -- Ribbed Guard
    ('VEG_SNAKE_GUARD', '/catalogue/rik/fresh/38_snake-guard.png'),  -- Snake Guard
    ('VEG_SPINACH_COUNTRY', '/catalogue/rik/fresh/39_spinach-country.png'),  -- Spinach Country
    ('VEG_SPRING_ONION', '/catalogue/rik/fresh/40_spring-onion.png'),  -- Spring Onion
    ('VEG_TINDA', '/catalogue/rik/fresh/41_tinda.png'),  -- Tinda
    ('VEG_TOMATO_RED', '/catalogue/rik/fresh/42_tomato-red.png'),  -- Tomato Red
    ('VEG_TURNIP', '/catalogue/rik/fresh/43_turnip.png'),  -- Turnip
    ('VEG_ZIMIKAND', '/catalogue/rik/fresh/44_zimikand.png'),  -- Zimikand
    ('FRUIT_APPLE_SHIMLA', '/catalogue/rik/fresh/45_apple-shimla.png'),  -- Apple Shimla
    ('FRUIT_CUSTARD_APPLE', '/catalogue/rik/fresh/46_custard-apple.png'),  -- Custard Apple
    ('FRUIT_MANGO_BANGANPALLI', '/catalogue/rik/fresh/47_mango-banganpalli.png'),  -- Mango Banganpalli
    ('FRUIT_ORANGE', '/catalogue/rik/fresh/48_orange.png'),  -- Orange
    ('FRUIT_BANANA_ROBUSTA', '/catalogue/rik/fresh/49_banana-robusta.png'),  -- Banana Robusta
    ('FRUIT_GRAPES_BLACK_S_L', '/catalogue/rik/fresh/50_grapes-black-sl.png'),  -- Grapes Black S/L
    ('FRUIT_GRAPES_S_L', '/catalogue/rik/fresh/51_grapes-sl.png'),  -- Grapes S/L
    ('FRUIT_KINNU', '/catalogue/rik/fresh/52_kinnu.png'),  -- Kinnu
    ('FRUIT_MUSAMBI_SWEET_LEMON', '/catalogue/rik/fresh/53_musambi-sweet-lemon.png'),  -- Musambi/Sweet Lemon
    ('FRUIT_MUSKMELON', '/catalogue/rik/fresh/54_muskmelon.png'),  -- Muskmelon
    ('FRUIT_PAPAYA', '/catalogue/rik/fresh/55_papaya.png'),  -- Papaya
    ('FRUIT_SOUR_LIME', '/catalogue/rik/fresh/56_sour-lime.png'),  -- Sour Lime
    ('FRUIT_WATERMELON', '/catalogue/rik/fresh/57_watermelon.png'),  -- Watermelon
    ('FRUIT_PINEAPPLE', '/catalogue/rik/fresh/58_pineapple.png'),  -- Pineapple
    ('FRUIT_MANGO_DASHERI', '/catalogue/rik/fresh/59_mango-dasheri.png'),  -- Mango Dasheri
    ('FRUIT_MANGO_LANGRA', '/catalogue/rik/fresh/60_mango-langra.png'),  -- Mango Langra
    ('FRUIT_APRICOT', '/catalogue/rik/fresh/61_apricot.png'),  -- Apricot
    ('FRUIT_LITCHI', '/catalogue/rik/fresh/62_litchi.png'),  -- Litchi
    ('FRUIT_PEARS', '/catalogue/rik/fresh/63_pears.png'),  -- Pears
    ('FRUIT_PLUM', '/catalogue/rik/fresh/64_plum.png'),  -- Plum
    ('FRUIT_STRAWBERRY', '/catalogue/rik/fresh/65_strawberry.png'),  -- Strawberry
    ('FRUIT_THAI_GUAVA', '/catalogue/rik/fresh/66_thai-guava.png'),  -- Thai Guava
    ('FRUIT_KIWI', '/catalogue/rik/fresh/67_kiwi.png'),  -- Kiwi
    ('FRUIT_DRAGON_FRUIT', '/catalogue/rik/fresh/68_dragon-fruit.png'),  -- Dragon Fruit
    ('FRUIT_CHICKOO', '/catalogue/rik/fresh/69_chickoo.png'),  -- Chickoo
    ('FRUIT_POMEGRANATE', '/catalogue/rik/fresh/70_pomegranate.png')   -- Pomegranate
  ) AS m(code, image_ref)
 WHERE v.code = m.code
   AND v.image_ref IS DISTINCT FROM m.image_ref;

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-attached catalogue
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  veg_count   integer;
  fruit_count integer;
  stray       integer;
  mismatched  integer;
BEGIN
  SELECT count(*) INTO veg_count
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'VEGETABLES' AND v.code <> 'VEG_FRESH' AND v.image_ref IS NOT NULL;
  IF veg_count <> 44 THEN
    RAISE EXCEPTION 'Migration 0033: expected 44 Fresh Vegetable pictures, found %.', veg_count;
  END IF;

  SELECT count(*) INTO fruit_count
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'FRUITS' AND v.code NOT IN ('FRUIT_FRESH','FRUIT_DRY') AND v.image_ref IS NOT NULL;
  IF fruit_count <> 26 THEN
    RAISE EXCEPTION 'Migration 0033: expected 26 Fresh Fruit pictures, found %.', fruit_count;
  END IF;

  -- The generic placeholders must not have acquired a variety's picture.
  SELECT count(*) INTO stray
    FROM rik.provisions
   WHERE code IN ('VEG_FRESH','FRUIT_FRESH','FRUIT_DRY') AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0033: % generic placeholder provision(s) were given a picture.', stray;
  END IF;

  -- No picture may be attached anywhere outside the fresh catalogue, and
  -- every attached picture must sit under this step's own folder.
  SELECT count(*) INTO stray
    FROM rik.provisions
   WHERE image_ref IS NOT NULL AND image_ref NOT LIKE '/catalogue/rik/fresh/%';
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0033: % provision(s) carry a picture from outside this step.', stray;
  END IF;

  -- One picture, one provision.
  SELECT count(*) INTO mismatched FROM (
    SELECT image_ref FROM rik.provisions
     WHERE image_ref IS NOT NULL GROUP BY image_ref HAVING count(*) > 1
  ) d;
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'Migration 0033: % picture(s) are attached to more than one provision.', mismatched;
  END IF;
END;
$$;

RESET ROLE;
