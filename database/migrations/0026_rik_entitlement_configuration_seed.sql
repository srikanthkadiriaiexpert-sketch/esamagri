-- =============================================================================
-- Migration 0026: RIK entitlement configuration — approved client data
-- Phase 3B STEP 11.
--
-- Every value below is CONFIGURATION, loaded as rows into the tables
-- migration 0025 created. None of it appears in application code: the
-- calculation services read these tables, so a RIK administrator can
-- change any scale, ratio, pack size, maximum or applicability later
-- without a developer touching the engine.
--
-- Ratios are stated as POOL UNITS CONSUMED PER ONE PROVISION UNIT, and
-- were COMPUTED from the approved daily equivalences rather than
-- transcribed, so no inverse-ratio error can creep in. Worked example:
-- the cereal pool runs at 450 g/day; a 1:4.5 alternative consumes 4.5 g
-- of that pool per gram issued.
--
-- Where the approved specification does not state a pack size, pack_size
-- is left NULL rather than invented. The administrator can set it later.
-- =============================================================================

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- Constraint correction carried by this migration.
--
-- 0025 required pack_size whenever max_packs was set. The approved data
-- states a pack maximum for Maggi, Hakka Noodles and Maida WITHOUT giving
-- a pack size, so that constraint is too strict for the real
-- configuration. Relaxed here rather than inventing three pack sizes.
-- ---------------------------------------------------------------------------
ALTER TABLE rik.provisions DROP CONSTRAINT IF EXISTS rik_provisions_max_packs_needs_pack_chk;

COMMENT ON COLUMN rik.provisions.max_packs IS
  'Maximum number of packs. Enforced against pack_size when one is configured; recorded but not numerically enforceable until then.';

-- ---------------------------------------------------------------------------
-- POOLS
-- ---------------------------------------------------------------------------
INSERT INTO rik.entitlement_pools (code, name, ration_type, unit, description, display_order) VALUES
  ('MILK', 'Milk', 'FRESH', 'ml', 'Fresh milk and approved milk alternatives.', 10),
  ('MEAT', 'Meat', 'FRESH', 'g', 'Meat entitlement in meat-equivalent grams. Fish and chicken/fowl draw on the same balance.', 20),
  ('EGGS', 'Eggs', 'FRESH', 'piece', 'Egg entitlement, counted in eggs.', 30),
  ('VEGETABLES', 'Fresh Vegetables', 'FRESH', 'g', 'Fresh vegetable entitlement. Onion and potato are separate pools.', 40),
  ('FRUITS', 'Fresh Fruits', 'FRESH', 'g', 'Fresh fruit entitlement; dry fruit draws on the same balance.', 50),
  ('ONION_GARLIC', 'Onion / Garlic', 'FRESH', 'g', 'Shared pool in onion-equivalent grams. Fresh garlic draws on this balance; dry condiments garlic does NOT.', 60),
  ('POTATO', 'Potato', 'FRESH', 'g', 'Potato entitlement; fresh vegetables may be taken in lieu.', 70),
  ('CEREALS', 'Cereals', 'DRY', 'g', 'Cereal entitlement. Bread draws on this pool even though it is physically issued with the fresh ration.', 110),
  ('DAL', 'Dal', 'DRY', 'g', 'Pulse entitlement; all approved dals convert one to one.', 120),
  ('HYDROGENATED_OIL', 'Hydrogenated Oil', 'DRY', 'g', 'Cooking oil entitlement; all approved oils convert one to one. No loose issue.', 130),
  ('SUGAR_JAGGERY', 'Sugar / Jaggery', 'DRY', 'g', 'Shared pool in sugar-equivalent grams.', 140),
  ('TEA_COFFEE', 'Tea / Coffee', 'DRY', 'g', 'Shared pool in tea-equivalent grams.', 150),
  ('DALIYA', 'Daliya', 'DRY', 'g', 'Daliya entitlement and its approved breakfast-cereal alternatives.', 160),
  ('BUTTER_GHEE', 'Butter / Ghee', 'DRY', 'g', 'Butter and ghee entitlement, one to one.', 170),
  ('SALT', 'Salt', 'DRY', 'g', 'Salt entitlement. No approved alternative.', 180),
  ('CHEESE_NUTRAMUL', 'Cheese / Nutramul', 'DRY', 'g', 'Shared pool in cheese-equivalent grams. Applies to PV and EV only.', 190),
  ('CONDIMENTS', 'Condiments', 'DRY', 'g', 'Ground and packaged condiments, one to one. Includes DRY condiments garlic, which is a different pool from fresh onion/garlic.', 200),
  ('GARAM_MASALA_WHOLE', 'Garam Masala (Whole)', 'DRY', 'g', 'Whole spices, one to one.', 210);

-- ---------------------------------------------------------------------------
-- DAILY SCALES, per pool per dietary preference.
--
-- Applicability is expressed by PRESENCE. There is deliberately no MEAT or
-- EGGS row for PV, no MEAT row for EV, and no CHEESE_NUTRAMUL row for NV.
-- ---------------------------------------------------------------------------
INSERT INTO rik.pool_scales (pool_id, dietary_preference, daily_qty, notes)
SELECT p.id, v.diet, v.qty, v.notes
  FROM (VALUES
    ('MILK', 'PV', 250, 'Base fresh milk scale before any conversion.'),
    ('MILK', 'EV', 250, 'Base fresh milk scale before any conversion.'),
    ('MILK', 'NV', 250, 'Base fresh milk scale before any conversion.'),
    ('MEAT', 'NV', 260, 'Not applicable to PV or EV — converted instead.'),
    ('EGGS', 'EV', 2, 'Not applicable to PV — converted to milk instead.'),
    ('EGGS', 'NV', 2, 'Not applicable to PV — converted to milk instead.'),
    ('VEGETABLES', 'PV', 170, NULL),
    ('VEGETABLES', 'EV', 170, NULL),
    ('VEGETABLES', 'NV', 170, NULL),
    ('FRUITS', 'PV', 230, NULL),
    ('FRUITS', 'EV', 230, NULL),
    ('FRUITS', 'NV', 230, NULL),
    ('ONION_GARLIC', 'PV', 60, 'Onion-equivalent grams.'),
    ('ONION_GARLIC', 'EV', 60, 'Onion-equivalent grams.'),
    ('ONION_GARLIC', 'NV', 60, 'Onion-equivalent grams.'),
    ('POTATO', 'PV', 110, NULL),
    ('POTATO', 'EV', 110, NULL),
    ('POTATO', 'NV', 110, NULL),
    ('CEREALS', 'PV', 450, NULL),
    ('CEREALS', 'EV', 450, NULL),
    ('CEREALS', 'NV', 450, NULL),
    ('DAL', 'PV', 40, NULL),
    ('DAL', 'EV', 40, NULL),
    ('DAL', 'NV', 40, NULL),
    ('HYDROGENATED_OIL', 'PV', 80, NULL),
    ('HYDROGENATED_OIL', 'EV', 80, NULL),
    ('HYDROGENATED_OIL', 'NV', 80, NULL),
    ('SUGAR_JAGGERY', 'PV', 90, 'Sugar-equivalent grams; jaggery draws on the same balance at half the weight.'),
    ('SUGAR_JAGGERY', 'EV', 90, 'Sugar-equivalent grams; jaggery draws on the same balance at half the weight.'),
    ('SUGAR_JAGGERY', 'NV', 90, 'Sugar-equivalent grams; jaggery draws on the same balance at half the weight.'),
    ('TEA_COFFEE', 'PV', 9, 'Tea-equivalent grams; coffee draws on the same balance.'),
    ('TEA_COFFEE', 'EV', 9, 'Tea-equivalent grams; coffee draws on the same balance.'),
    ('TEA_COFFEE', 'NV', 9, 'Tea-equivalent grams; coffee draws on the same balance.'),
    ('DALIYA', 'PV', 20, NULL),
    ('DALIYA', 'EV', 20, NULL),
    ('DALIYA', 'NV', 20, NULL),
    ('BUTTER_GHEE', 'PV', 20, NULL),
    ('BUTTER_GHEE', 'EV', 20, NULL),
    ('BUTTER_GHEE', 'NV', 20, NULL),
    ('SALT', 'PV', 20, NULL),
    ('SALT', 'EV', 20, NULL),
    ('SALT', 'NV', 20, NULL),
    ('CHEESE_NUTRAMUL', 'PV', 50, 'Applies to PV and EV only — no NV entitlement.'),
    ('CHEESE_NUTRAMUL', 'EV', 50, 'Applies to PV and EV only — no NV entitlement.'),
    ('CONDIMENTS', 'PV', 14, NULL),
    ('CONDIMENTS', 'EV', 14, NULL),
    ('CONDIMENTS', 'NV', 14, NULL),
    ('GARAM_MASALA_WHOLE', 'PV', 6, NULL),
    ('GARAM_MASALA_WHOLE', 'EV', 6, NULL),
    ('GARAM_MASALA_WHOLE', 'NV', 6, NULL)
  ) AS v(pool_code, diet, qty, notes)
  JOIN rik.entitlement_pools p ON p.code = v.pool_code;

-- ---------------------------------------------------------------------------
-- CROSS-POOL CONVERSIONS
--
-- AUTOMATIC: the source pool does not apply to that diet, so the
-- entitlement arrives in the target pool with no customer choice.
-- ELECTIVE:  the customer may decline the source and take the target.
--
-- PV milk therefore totals 250 (base) + 250 (in lieu of eggs)
--                          + 500 (in lieu of meat) = 1,000 ml/day.
-- ---------------------------------------------------------------------------
INSERT INTO rik.pool_conversions (code, from_pool_id, to_pool_id, from_qty, to_qty, mode, dietary_preference, description, display_order)
SELECT v.code, f.id, t.id, v.from_qty, v.to_qty, v.mode, v.diet, v.descr, v.ord
  FROM (VALUES
    ('EGGS_TO_MILK_PV', 'EGGS', 'MILK', 2, 250, 'AUTOMATIC', 'PV', 'Pure veg: the egg entitlement is received as milk.', 10),
    ('MEAT_TO_MILK_PV', 'MEAT', 'MILK', 260, 500, 'AUTOMATIC', 'PV', 'Pure veg: the meat entitlement is received as milk.', 20),
    ('MEAT_TO_EGGS_EV', 'MEAT', 'EGGS', 260, 4, 'ELECTIVE', 'EV', 'Egg veg: take the meat entitlement as four additional eggs per day.', 30),
    ('MEAT_TO_MILK_EV', 'MEAT', 'MILK', 260, 500, 'ELECTIVE', 'EV', 'Egg veg: take the meat entitlement as milk.', 40),
    ('MEAT_TO_EGGS_NV', 'MEAT', 'EGGS', 260, 4, 'ELECTIVE', 'NV', 'Non veg: take the meat entitlement as four additional eggs per day.', 50),
    ('EGGS_TO_MILK_EV', 'EGGS', 'MILK', 2, 250, 'ELECTIVE', 'EV', 'Decline the egg entitlement and take milk instead.', 60),
    ('EGGS_TO_MILK_NV', 'EGGS', 'MILK', 2, 250, 'ELECTIVE', 'NV', 'Decline the egg entitlement and take milk instead.', 70)
  ) AS v(code, from_code, to_code, from_qty, to_qty, mode, diet, descr, ord)
  JOIN rik.entitlement_pools f ON f.code = v.from_code
  JOIN rik.entitlement_pools t ON t.code = v.to_code;

-- ---------------------------------------------------------------------------
-- PROVISIONS
--
-- consumption_ratio = pool units consumed per ONE unit of the provision.
-- ---------------------------------------------------------------------------
INSERT INTO rik.provisions
  (pool_id, code, name, unit, consumption_ratio, pack_size, is_loose,
   is_customer_selectable, max_quantity, max_packs, min_eligible_days,
   issue_period, display_order)
SELECT p.id, v.code, v.name, v.unit, v.ratio, v.pack, v.loose,
       v.sel, v.maxq, v.maxp, v.mind, v.issue, v.ord
  FROM (VALUES
    ('MILK', 'MILK_FRESH', 'Fresh Milk', 'ml', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('MILK', 'MILK_TD', 'Milk TD / Milkmaid', 'g', 2.500000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 20),
    ('MEAT', 'MEAT_MUTTON', 'Meat', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('MEAT', 'MEAT_FISH', 'Fish', 'g', 0.604651, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 20),
    ('MEAT', 'MEAT_CHICKEN', 'Chicken / Fowl', 'g', 1.485714, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 30),
    ('EGGS', 'EGGS_TABLE', 'Eggs', 'piece', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('VEGETABLES', 'VEG_FRESH', 'Fresh Vegetables', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('FRUITS', 'FRUIT_FRESH', 'Fresh Fruits', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('FRUITS', 'FRUIT_DRY', 'Dry Fruits', 'g', 8.214286, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 20),
    ('ONION_GARLIC', 'ONION_FRESH', 'Onion', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('ONION_GARLIC', 'GARLIC_FRESH', 'Garlic (Fresh)', 'g', 6.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 20),
    ('POTATO', 'POTATO_FRESH', 'Potato', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('POTATO', 'POTATO_ALT_VEGETABLES', 'Fresh Vegetables (in lieu of potato)', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 20),
    ('CEREALS', 'CER_BREAD_SANDWICH', 'Sandwich Bread', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 10),
    ('CEREALS', 'CER_BREAD_BROWN', 'Brown Bread', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 20),
    ('CEREALS', 'CER_BREAD_MULTIGRAIN', 'Multigrain Bread', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 30),
    ('CEREALS', 'CER_BREAD_PAV', 'Pav Bread', 'g', 3.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'FRESH', 40),
    ('CEREALS', 'CER_RUSK', 'Rusk', 'g', 3.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('CEREALS', 'CER_CUP_CAKE', 'Cup Cake', 'g', 7.500000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 60),
    ('CEREALS', 'CER_PIZZA_BASE', 'Pizza Base', 'g', 4.500000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('CEREALS', 'CER_CREAM_ROLL', 'Cream Roll', 'g', 4.500000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 80),
    ('CEREALS', 'CER_BURGER_BUN', 'Burger Bun', 'g', 4.500000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 90),
    ('CEREALS', 'CER_RICE_SUPER_BASMATI', 'Super Basmati Rice (Dawat)', 'g', 1.500000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 100),
    ('CEREALS', 'CER_RICE_ROZANA', 'Rozana Basmati Rice (Dawat)', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 110),
    ('CEREALS', 'CER_RICE_HERITAGE', 'Heritage Basmati Rice (Dawat)', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 120),
    ('CEREALS', 'CER_RICE_SONA_MASOORI', 'Bell Rice Sona Masoori', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 130),
    ('CEREALS', 'CER_ATTA_AASHIRVAAD', 'Aashirvaad Atta', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 140),
    ('CEREALS', 'CER_ATTA_PILLSBURY', 'Pillsbury Chakki Fresh Atta', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 150),
    ('CEREALS', 'CER_ATTA_AMUL', 'Amul Atta', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 160),
    ('CEREALS', 'CER_MAGGI', 'Maggi', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, 2::integer, NULL::integer, 'DRY', 200),
    ('CEREALS', 'CER_HAKKA_NOODLES', 'Hakka Noodles', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, 2::integer, NULL::integer, 'DRY', 210),
    ('CEREALS', 'CER_MAIDA', 'All Purpose Flour / Maida', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, 2::integer, NULL::integer, 'DRY', 220),
    ('CEREALS', 'CER_MILLETS', 'Millets', 'g', 1.000000, NULL::numeric, false, true, 1000::numeric, NULL::integer, NULL::integer, 'DRY', 230),
    ('DAL', 'DAL_P_TATA_ARHAR', 'Tata Arhar 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('DAL', 'DAL_P_TATA_KABULI_CHANA', 'Tata Kabuli Chana 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('DAL', 'DAL_P_TATA_MOONG_WITHOUT_SKIN', 'Tata Moong without skin 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('DAL', 'DAL_P_TATA_URD_WITHOUT_SKIN', 'Tata Urd without skin 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('DAL', 'DAL_P_TATA_MOONG_WHOLE', 'Tata Moong whole 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('DAL', 'DAL_P_TATA_MASOOR_SPLIT', 'Tata Masoor split 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 60),
    ('DAL', 'DAL_P_TATA_BLACK_CHANA', 'Tata Black Chana 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('DAL', 'DAL_P_TATA_URD_SPLIT', 'Tata Urd split 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 80),
    ('DAL', 'DAL_P_FORTUNE_BESAN', 'Fortune Besan 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 90),
    ('DAL', 'DAL_P_TATA_RAJMA', 'Tata Rajma 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 100),
    ('DAL', 'DAL_P_TATA_PEAS_DRIED', 'Tata Peas dried 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 110),
    ('DAL', 'DAL_L_DAL_ARHAR', 'Dal Arhar (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 210),
    ('DAL', 'DAL_L_KABULI_CHANA', 'Kabuli Chana (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 220),
    ('DAL', 'DAL_L_MOONG_YELLOW', 'Moong Yellow (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 230),
    ('DAL', 'DAL_L_CHANNA_DAL', 'Channa Dal (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 240),
    ('DAL', 'DAL_L_URD_DAL_WITHOUT_SKIN', 'Urd Dal without skin (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 250),
    ('DAL', 'DAL_L_MASOOR_DAL_WHOLE', 'Masoor Dal whole (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 260),
    ('DAL', 'DAL_L_URD_DAL_WHOLE', 'Urd Dal whole (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 270),
    ('DAL', 'DAL_L_RAJMA', 'Rajma (loose)', 'g', 1.000000, NULL::numeric, true, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 280),
    ('HYDROGENATED_OIL', 'OIL_HYDROGENATED', 'Hydrogenated Oil', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('HYDROGENATED_OIL', 'OIL_GROUNDNUT', 'Groundnut Oil 1kg', 'g', 1.000000, 1000::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('HYDROGENATED_OIL', 'OIL_RICE_BRAN', 'Rice Bran Oil 1kg', 'g', 1.000000, 1000::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('HYDROGENATED_OIL', 'OIL_SUNFLOWER_500', 'Sunflower Refined Oil 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('HYDROGENATED_OIL', 'OIL_SUNFLOWER_1000', 'Sunflower Refined Oil 1kg', 'g', 1.000000, 1000::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('HYDROGENATED_OIL', 'OIL_MUSTARD_500', 'Mustard Oil 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 60),
    ('HYDROGENATED_OIL', 'OIL_MUSTARD_1000', 'Mustard Oil 1kg', 'g', 1.000000, 1000::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('SUGAR_JAGGERY', 'SUGAR', 'Sugar', 'g', 1.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('SUGAR_JAGGERY', 'JAGGERY', 'Jaggery', 'g', 2.000000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('TEA_COFFEE', 'TEA_CHAHAT', 'Chahat Society Tea 250g', 'g', 1.000000, 250::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('TEA_COFFEE', 'TEA_WAGH_BAKRI', 'Wagh Bakri Elaichi Tea 250g', 'g', 1.000000, 250::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('TEA_COFFEE', 'COFFEE_COLUMBIAN', 'Columbian Coffee 50g', 'g', 2.250000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('TEA_COFFEE', 'TEA_LOOSE', 'Tea (loose, counter issue)', 'g', 1.000000, NULL::numeric, true, false, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('TEA_COFFEE', 'COFFEE_LOOSE', 'Coffee (loose, counter issue)', 'g', 2.250000, NULL::numeric, true, false, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('DALIYA', 'DAL_DALIYA', 'Dalia 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('DALIYA', 'DAL_SAGO', 'Sago 200g', 'g', 2.857143, 200::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('DALIYA', 'DAL_CORN_FLOUR', 'Corn Flour 100g', 'g', 2.857143, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('DALIYA', 'DAL_CUSTARD', 'Custard Powder 100g', 'g', 2.857143, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('DALIYA', 'DAL_OATS', 'Oats 600g', 'g', 1.000000, 600::numeric, false, true, NULL::numeric, NULL::integer, 30::integer, 'DRY', 50),
    ('DALIYA', 'DAL_CORNFLAKES', 'Cornflakes 500g', 'g', 0.666667, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 60),
    ('DALIYA', 'DAL_SEMOLINA', 'Semolina', 'g', 0.666667, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('BUTTER_GHEE', 'BG_AMUL_GHEE', 'Amul Ghee 500g tin', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('BUTTER_GHEE', 'BG_AMUL_BUTTER', 'Amul Butter 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('SALT', 'SALT_TABLE', 'Salt 500g', 'g', 1.000000, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('CHEESE_NUTRAMUL', 'CH_PANEER', 'Amul Paneer 200g', 'g', 1.000000, 200::numeric, false, true, NULL::numeric, 3::integer, NULL::integer, 'DRY', 10),
    ('CHEESE_NUTRAMUL', 'CH_SLICES', 'Cheese Slices 200g', 'g', 1.000000, 200::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('CHEESE_NUTRAMUL', 'CH_BLOCK', 'Cheese Block 200g', 'g', 1.000000, 200::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('CHEESE_NUTRAMUL', 'CH_SPREAD', 'Cheese Spread 200g', 'g', 1.000000, 200::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('CHEESE_NUTRAMUL', 'CH_MOZZARELLA', 'Cheese Mozzarella 200g', 'g', 1.000000, 200::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('CHEESE_NUTRAMUL', 'CH_TIN', 'Cheese TD / Tin Cheese 400g', 'g', 1.000000, 400::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('CHEESE_NUTRAMUL', 'NU_AMULPRO', 'Amulpro 500g', 'g', 0.833333, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 80),
    ('CHEESE_NUTRAMUL', 'NU_HORLICKS', 'Horlicks 500g', 'g', 0.833333, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 90),
    ('CHEESE_NUTRAMUL', 'NU_BOURNVITA', 'Bournavita 500g', 'g', 0.833333, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 100),
    ('CHEESE_NUTRAMUL', 'NU_BOOST', 'Boost 500g', 'g', 0.833333, 500::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 110),
    ('CHEESE_NUTRAMUL', 'NU_MUESLI', 'Tata Muesli', 'g', 1.400000, NULL::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 130),
    ('CONDIMENTS', 'CND_EVEREST_CHILLY_POWDER', 'Everest Chilly Powder 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('CONDIMENTS', 'CND_TURMERIC_POWDER', 'Turmeric Powder 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('CONDIMENTS', 'CND_CORIANDER_POWDER', 'Coriander Powder 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('CONDIMENTS', 'CND_SHAHI_PANEER_MASALA', 'Shahi Paneer Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('CONDIMENTS', 'CND_PANI_PURI_MASALA', 'Pani Puri Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('CONDIMENTS', 'CND_SABJI_MASALA', 'Sabji Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 60),
    ('CONDIMENTS', 'CND_TANDOORI_MASALA', 'Tandoori Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('CONDIMENTS', 'CND_RASAM_MASALA', 'Rasam Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 80),
    ('CONDIMENTS', 'CND_KITCHEN_KING_MASALA', 'Kitchen King Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 90),
    ('CONDIMENTS', 'CND_CHICKEN_MASALA', 'Chicken Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 100),
    ('CONDIMENTS', 'CND_GARAM_MASALA', 'Garam Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 110),
    ('CONDIMENTS', 'CND_SHAHI_BIRYANI_MASALA', 'Shahi Biryani Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 120),
    ('CONDIMENTS', 'CND_CHOLE_MASALA', 'Chole Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 130),
    ('CONDIMENTS', 'CND_AMCHUR_MASALA', 'Amchur Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 140),
    ('CONDIMENTS', 'CND_CHANA_MASALA', 'Chana Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 150),
    ('CONDIMENTS', 'CND_PAV_BHAJI_MASALA', 'Pav Bhaji Masala 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 160),
    ('CONDIMENTS', 'CND_SAMBAR_MASALA', 'Sambar Masala 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 170),
    ('CONDIMENTS', 'CND_CUMIN_SEEDS', 'Cumin Seeds 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 180),
    ('CONDIMENTS', 'CND_CORIANDER_SEEDS', 'Coriander Seeds 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 190),
    ('CONDIMENTS', 'CND_TAMARIND', 'Tamarind 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 200),
    ('CONDIMENTS', 'CND_GARLIC', 'Garlic 100g (dry condiment)', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 210),
    ('GARAM_MASALA_WHOLE', 'GMW_CLOVES', 'Cloves 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 10),
    ('GARAM_MASALA_WHOLE', 'GMW_ANISE_SEEDS', 'Anise Seeds 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 20),
    ('GARAM_MASALA_WHOLE', 'GMW_BAY_LEAF', 'Bay Leaf 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 30),
    ('GARAM_MASALA_WHOLE', 'GMW_FENUGREEK', 'Fenugreek 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 40),
    ('GARAM_MASALA_WHOLE', 'GMW_POPPY_SEEDS', 'Poppy Seeds 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 50),
    ('GARAM_MASALA_WHOLE', 'GMW_ASAFOETIDA', 'Asafoetida 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 60),
    ('GARAM_MASALA_WHOLE', 'GMW_WHOLE_PEPPER', 'Whole Pepper 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 70),
    ('GARAM_MASALA_WHOLE', 'GMW_AJWAIN', 'Ajwain 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 80),
    ('GARAM_MASALA_WHOLE', 'GMW_KASHMIRI_CHILLI', 'Kashmiri Chilli 100g', 'g', 1.000000, 100::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 90),
    ('GARAM_MASALA_WHOLE', 'GMW_LARGE_CARDAMOM', 'Large Cardamom 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 100),
    ('GARAM_MASALA_WHOLE', 'GMW_CINNAMON_STICK', 'Cinnamon Stick 50g', 'g', 1.000000, 50::numeric, false, true, NULL::numeric, NULL::integer, NULL::integer, 'DRY', 110)
  ) AS v(pool_code, code, name, unit, ratio, pack, loose, sel, maxq, maxp, mind, issue, ord)
  JOIN rik.entitlement_pools p ON p.code = v.pool_code;

-- ---------------------------------------------------------------------------
-- EFFECTIVE FROM
--
-- The columns default to CURRENT_DATE, which would pin this entire
-- configuration to whatever day the migration was applied — and a period
-- ending before that day would then resolve NO active configuration at
-- all. The approved configuration is not new as of the deployment date,
-- so it is given an explicit start well before any period the system
-- will be asked about.
-- ---------------------------------------------------------------------------
UPDATE rik.entitlement_pools  SET effective_from = DATE '2026-01-01' WHERE effective_from > DATE '2026-01-01';
UPDATE rik.pool_scales        SET effective_from = DATE '2026-01-01' WHERE effective_from > DATE '2026-01-01';
UPDATE rik.pool_conversions   SET effective_from = DATE '2026-01-01' WHERE effective_from > DATE '2026-01-01';
UPDATE rik.provisions         SET effective_from = DATE '2026-01-01' WHERE effective_from > DATE '2026-01-01';

RESET ROLE;
