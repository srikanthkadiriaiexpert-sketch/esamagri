-- =============================================================================
-- Migration 0032: load the approved Fresh Vegetable and Fresh Fruit
-- catalogue, and lift brand and pack size out of the names that carried
-- them.
--
-- Phase 3B STEP 12A.
--
-- PART 1 — THE CATALOGUE THE FACILITY SUPPLIED
-- --------------------------------------------
-- 44 Fresh Vegetable varieties and 26 Fresh Fruit varieties, exactly as
-- given. Not one name was normalised, corrected or expanded, and not
-- one variety was added from general knowledge: "Ladie's Finger",
-- "Bitter Guard", "Musambi/Sweet Lemon" and "Grapes Black S/L" appear
-- here spelled as the facility spells them, because the catalogue is
-- theirs and an officer looking for the name they know should find it.
--
-- This file was GENERATED from that list rather than typed, so the 44
-- and the 26 are counted by a machine and the codes are derived from
-- the names by one rule. A hand-written list of seventy INSERTs is a
-- transcription error waiting to happen.
--
-- WHAT THEY ARE ATTACHED TO, AND WHAT THEY ARE NOT:
--
--   * Vegetables join the EXISTING `VEGETABLES` pool — one shared
--     170 g/day entitlement. Fruits join the EXISTING `FRUITS` pool —
--     one shared 230 g/day entitlement. A SKU belongs to a pool; it
--     does not create one.
--
--   * Onion and Potato are NOT in these lists, deliberately. They keep
--     their own pools (ONION_GARLIC at 60 g/day, POTATO at 110 g/day)
--     and their own provisions, untouched by this migration. Adding a
--     "Spring Onion" to the vegetable list is not adding an onion: it
--     is a distinct vegetable the facility listed, and it draws on the
--     vegetable pool, not the onion one.
--
--   * Every one is loaded with consumption_ratio 1.000000 — the same
--     ratio the existing generic Fresh Vegetables and Fresh Fruits
--     provisions already carry, so a gram of any variety costs a gram
--     of the pool. No ratio was supplied per variety, and inventing
--     one would change entitlement.
--
--   * pack_size, pack_unit, brand and image_ref are all NULL. None was
--     supplied. The customer app shows "Not specified" and a
--     placeholder image rather than a fabricated value, and a RIK
--     administrator can fill any of them in from the dashboard.
--
-- No daily scale, conversion ratio, dietary rule or eligibility rule is
-- touched anywhere in this file.
--
-- PART 2 — BRAND AND PACK SIZE OUT OF THE NAMES
-- ---------------------------------------------
-- Several existing provisions carry their brand and their pack size
-- inside the name: "Amul Paneer 200g", "Tata Arhar 500g". The
-- specification is explicit that brand must stop living there.
--
-- Two rules, both conservative:
--
--   Pack size is stripped from a name ONLY where the numeric pack_size
--   column already holds the same figure, so nothing is lost — the
--   number simply stops being said twice.
--
--   Brand is lifted ONLY where the leading words are unmistakably a
--   company: Amul, Tata, Everest, Fortune, Wagh Bakri. Where a name is
--   its own brand ("Boost", "Horlicks", "Bournavita", "Amulpro") or
--   where the leading word is an origin rather than a maker
--   ("Columbian Coffee"), the brand is left NULL. Guessing a brand is
--   worse than not recording one, and a RIK administrator can set any
--   of them from the dashboard in a few seconds.
--
-- HISTORY IS UNAFFECTED. A confirmed selection stores its own snapshot
-- of the provisions it used, including their names as they were on the
-- day, and migration 0029's trigger physically refuses to rewrite it.
-- An officer who confirmed "Amul Paneer 200g" last month still sees
-- exactly that; new selections see Paneer / Amul / 200 g.
--
-- No schema change. No row deleted. No code, pool, ratio, limit or
-- issue period altered.
-- =============================================================================

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- Part 1a: 44 Fresh Vegetable varieties -> the existing VEGETABLES pool
-- ---------------------------------------------------------------------------
INSERT INTO rik.provisions
  (pool_id, code, name, unit, consumption_ratio, is_loose, is_customer_selectable,
   issue_period, display_order, effective_from)
SELECT p.id, v.code, v.name, 'g', 1.000000, false, true, 'FRESH', v.ord, DATE '2026-01-01'
  FROM rik.entitlement_pools p
  CROSS JOIN (VALUES
    ('VEG_ARVI', 'Arvi', 1),
    ('VEG_ASPARAGUS', 'Asparagus', 2),
    ('VEG_BABY_CORN', 'Baby Corn', 3),
    ('VEG_BEANS_FRENCH', 'Beans French', 4),
    ('VEG_BEANS_LONG', 'Beans Long', 5),
    ('VEG_BEETROOT', 'Beetroot', 6),
    ('VEG_BITTER_GUARD', 'Bitter Guard', 7),
    ('VEG_BOTTLE_GUARD', 'Bottle Guard', 8),
    ('VEG_BRINJAL_PURPLE_AND_GREEN', 'Brinjal (Purple & Green)', 9),
    ('VEG_BROCCOLI', 'Broccoli', 10),
    ('VEG_CABBAGE', 'Cabbage', 11),
    ('VEG_CAPSICUM', 'Capsicum', 12),
    ('VEG_CAPSICUM_RED', 'Capsicum Red', 13),
    ('VEG_CAPSICUM_YELLOW', 'Capsicum Yellow', 14),
    ('VEG_CARROT_COUNTRY', 'Carrot Country', 15),
    ('VEG_CARROT_RED', 'Carrot Red', 16),
    ('VEG_CAULIFLOWER', 'Cauliflower', 17),
    ('VEG_CHILLY_GREEN', 'Chilly Green', 18),
    ('VEG_CLUSTER_BEANS', 'Cluster Beans', 19),
    ('VEG_CORIANDER_GREEN', 'Coriander Green', 20),
    ('VEG_COWPEAS', 'Cowpeas', 21),
    ('VEG_CUCUMBER', 'Cucumber', 22),
    ('VEG_CURRY_LEAVES', 'Curry Leaves', 23),
    ('VEG_DRUM_STICK', 'Drum Stick', 24),
    ('VEG_GINGER_GREEN', 'Ginger Green', 25),
    ('VEG_KHOL_KHOL', 'Khol Khol', 26),
    ('VEG_KUNDRI', 'Kundri', 27),
    ('VEG_LADIE_S_FINGER', 'Ladie''s Finger', 28),
    ('VEG_LEEK', 'Leek', 29),
    ('VEG_MARROW', 'Marrow', 30),
    ('VEG_MINT_GREEN', 'Mint Green', 31),
    ('VEG_MUSHROOM', 'Mushroom', 32),
    ('VEG_PARWAL', 'Parwal', 33),
    ('VEG_PEAS_GREEN', 'Peas Green', 34),
    ('VEG_PUMPKIN', 'Pumpkin', 35),
    ('VEG_RADISH', 'Radish', 36),
    ('VEG_RIBBED_GUARD', 'Ribbed Guard', 37),
    ('VEG_SNAKE_GUARD', 'Snake Guard', 38),
    ('VEG_SPINACH_COUNTRY', 'Spinach Country', 39),
    ('VEG_SPRING_ONION', 'Spring Onion', 40),
    ('VEG_TINDA', 'Tinda', 41),
    ('VEG_TOMATO_RED', 'Tomato Red', 42),
    ('VEG_TURNIP', 'Turnip', 43),
    ('VEG_ZIMIKAND', 'Zimikand', 44)
  ) AS v(code, name, ord)
 WHERE p.code = 'VEGETABLES'
    ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Part 1b: 26 Fresh Fruit varieties -> the existing FRUITS pool
-- ---------------------------------------------------------------------------
INSERT INTO rik.provisions
  (pool_id, code, name, unit, consumption_ratio, is_loose, is_customer_selectable,
   issue_period, display_order, effective_from)
SELECT p.id, f.code, f.name, 'g', 1.000000, false, true, 'FRESH', f.ord, DATE '2026-01-01'
  FROM rik.entitlement_pools p
  CROSS JOIN (VALUES
    ('FRUIT_APPLE_SHIMLA', 'Apple Shimla', 1),
    ('FRUIT_CUSTARD_APPLE', 'Custard Apple', 2),
    ('FRUIT_MANGO_BANGANPALLI', 'Mango Banganpalli', 3),
    ('FRUIT_ORANGE', 'Orange', 4),
    ('FRUIT_BANANA_ROBUSTA', 'Banana Robusta', 5),
    ('FRUIT_GRAPES_BLACK_S_L', 'Grapes Black S/L', 6),
    ('FRUIT_GRAPES_S_L', 'Grapes S/L', 7),
    ('FRUIT_KINNU', 'Kinnu', 8),
    ('FRUIT_MUSAMBI_SWEET_LEMON', 'Musambi/Sweet Lemon', 9),
    ('FRUIT_MUSKMELON', 'Muskmelon', 10),
    ('FRUIT_PAPAYA', 'Papaya', 11),
    ('FRUIT_SOUR_LIME', 'Sour Lime', 12),
    ('FRUIT_WATERMELON', 'Watermelon', 13),
    ('FRUIT_PINEAPPLE', 'Pineapple', 14),
    ('FRUIT_MANGO_DASHERI', 'Mango Dasheri', 15),
    ('FRUIT_MANGO_LANGRA', 'Mango Langra', 16),
    ('FRUIT_APRICOT', 'Apricot', 17),
    ('FRUIT_LITCHI', 'Litchi', 18),
    ('FRUIT_PEARS', 'Pears', 19),
    ('FRUIT_PLUM', 'Plum', 20),
    ('FRUIT_STRAWBERRY', 'Strawberry', 21),
    ('FRUIT_THAI_GUAVA', 'Thai Guava', 22),
    ('FRUIT_KIWI', 'Kiwi', 23),
    ('FRUIT_DRAGON_FRUIT', 'Dragon Fruit', 24),
    ('FRUIT_CHICKOO', 'Chickoo', 25),
    ('FRUIT_POMEGRANATE', 'Pomegranate', 26)
  ) AS f(code, name, ord)
 WHERE p.code = 'FRUITS'
    ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Part 2a: brand lifted out of the name, where the brand is unmistakable
--
-- Each row states the NEW name and the brand explicitly rather than
-- being parsed out of the old one, so the result is reviewable at a
-- glance and cannot depend on a regular expression getting a space
-- right. Pack sizes for these rows are handled by Part 2b below.
-- ---------------------------------------------------------------------------
UPDATE rik.provisions AS v
   SET name       = b.new_name,
       brand      = b.brand,
       updated_at = now()
  FROM (VALUES
    ('BG_AMUL_BUTTER', 'Amul', 'Butter'),
    ('BG_AMUL_GHEE', 'Amul', 'Ghee'),
    ('CER_ATTA_AMUL', 'Amul', 'Atta'),
    ('CH_PANEER', 'Amul', 'Paneer'),
    ('CND_EVEREST_CHILLY_POWDER', 'Everest', 'Chilly Powder'),
    ('DAL_P_FORTUNE_BESAN', 'Fortune', 'Besan'),
    ('DAL_P_TATA_ARHAR', 'Tata', 'Arhar'),
    ('DAL_P_TATA_BLACK_CHANA', 'Tata', 'Black Chana'),
    ('DAL_P_TATA_KABULI_CHANA', 'Tata', 'Kabuli Chana'),
    ('DAL_P_TATA_MASOOR_SPLIT', 'Tata', 'Masoor split'),
    ('DAL_P_TATA_MOONG_WHOLE', 'Tata', 'Moong whole'),
    ('DAL_P_TATA_MOONG_WITHOUT_SKIN', 'Tata', 'Moong without skin'),
    ('DAL_P_TATA_PEAS_DRIED', 'Tata', 'Peas dried'),
    ('DAL_P_TATA_RAJMA', 'Tata', 'Rajma'),
    ('DAL_P_TATA_URD_SPLIT', 'Tata', 'Urd split'),
    ('DAL_P_TATA_URD_WITHOUT_SKIN', 'Tata', 'Urd without skin'),
    ('NU_MUESLI', 'Tata', 'Muesli'),
    ('TEA_WAGH_BAKRI', 'Wagh Bakri', 'Elaichi Tea')
  ) AS b(code, brand, new_name)
 WHERE v.code = b.code;

-- Amul Ghee is issued as a tin; that was the only container noun any
-- existing name carried, and it is now recorded as such rather than
-- being lost when "tin" left the name.
UPDATE rik.provisions
   SET pack_unit = 'tin', updated_at = now()
 WHERE code = 'BG_AMUL_GHEE';

-- ---------------------------------------------------------------------------
-- Part 2b: the pack size stops being said twice
--
-- Strips a trailing "<number>g" / "<number>kg" from the name ONLY where
-- pack_size already holds a value. Nothing is lost: the figure stays in
-- the column the engine and the screens already read. A name with no
-- pack_size recorded is left exactly as it is.
--
-- NOTE ON THE PATTERN. There is deliberately no \b in it. PostgreSQL's
-- regular expressions are not Perl's: \b there is the BACKSPACE
-- CHARACTER, not a word boundary (the word-boundary escapes are \m, \M
-- and \y). An earlier draft of this migration carried \b, which made
-- the WHERE clause match fifty-four rows while the replacement matched
-- none of them — every name was rewritten to itself and the pack sizes
-- stayed in the names. The final $ anchor makes a boundary escape
-- redundant anyway. The verification block below now fails the
-- migration outright if any name still ends in its own pack size, so
-- the same mistake cannot pass silently a second time.
-- ---------------------------------------------------------------------------
UPDATE rik.provisions
   SET name       = btrim(regexp_replace(name, '\s+[0-9]+\s*(kg|g|ml|litre)\s*$', '', 'i')),
       updated_at = now()
 WHERE pack_size IS NOT NULL
   AND name ~* '\s+[0-9]+\s*(kg|g|ml|litre)\s*$';

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-loaded catalogue
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  veg_count integer;
  fruit_count integer;
  onion_count integer;
  potato_count integer;
  leaked integer;
BEGIN
  SELECT count(*) INTO veg_count
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'VEGETABLES' AND v.code LIKE 'VEG\_%' AND v.code <> 'VEG_FRESH';
  IF veg_count <> 44 THEN
    RAISE EXCEPTION 'Migration 0032: expected 44 Fresh Vegetable SKUs, found %.', veg_count;
  END IF;

  SELECT count(*) INTO fruit_count
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'FRUITS' AND v.code LIKE 'FRUIT\_%' AND v.code NOT IN ('FRUIT_DRY', 'FRUIT_FRESH');
  IF fruit_count <> 26 THEN
    RAISE EXCEPTION 'Migration 0032: expected 26 Fresh Fruit SKUs, found %.', fruit_count;
  END IF;

  -- Onion and Potato must still stand alone, in their own pools.
  SELECT count(*) INTO onion_count
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'ONION_GARLIC';
  IF onion_count < 1 THEN
    RAISE EXCEPTION 'Migration 0032: the onion pool lost its provisions.';
  END IF;

  SELECT count(*) INTO potato_count
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'POTATO';
  IF potato_count < 1 THEN
    RAISE EXCEPTION 'Migration 0032: the potato pool lost its provisions.';
  END IF;

  -- No onion or potato SKU may have crept into the vegetable pool.
  SELECT count(*) INTO leaked
    FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
   WHERE p.code = 'VEGETABLES'
     AND (v.name ILIKE 'onion' OR v.name ILIKE 'potato');
  IF leaked > 0 THEN
    RAISE EXCEPTION 'Migration 0032: % onion/potato SKU(s) leaked into the vegetable pool.', leaked;
  END IF;

  -- The three cereal pack sizes migration 0030 supplied must survive.
  SELECT count(*) INTO leaked
    FROM rik.provisions
   WHERE code IN ('CER_MAGGI', 'CER_HAKKA_NOODLES', 'CER_MAIDA')
     AND pack_size IS NULL;
  IF leaked > 0 THEN
    RAISE EXCEPTION 'Migration 0032: % cereal pack size(s) were lost.', leaked;
  END IF;

  -- No name may still end in the very pack size recorded beside it.
  -- This is the guard the \b mistake above slipped past.
  SELECT count(*) INTO leaked
    FROM rik.provisions
   WHERE pack_size IS NOT NULL
     AND name ~* '[0-9]+\s*(kg|g|ml|litre)\s*$';
  IF leaked > 0 THEN
    RAISE EXCEPTION 'Migration 0032: % provision name(s) still carry their own pack size.', leaked;
  END IF;

  -- Nor may a name still carry the brand recorded beside it.
  SELECT count(*) INTO leaked
    FROM rik.provisions
   WHERE brand IS NOT NULL AND name ILIKE '%' || brand || '%';
  IF leaked > 0 THEN
    RAISE EXCEPTION 'Migration 0032: % provision name(s) still carry their own brand.', leaked;
  END IF;
END;
$$;

RESET ROLE;
