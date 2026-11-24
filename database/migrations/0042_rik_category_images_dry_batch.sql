-- ---------------------------------------------------------------------------
-- 0042_rik_category_images_dry_batch.sql
--
-- STEP 14I — attach the eleven DRY category pictures, in one batch.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ELEVEN pools — every
-- DRY category, all at once. Nothing else. No INSERT, no DELETE, no column, no
-- constraint, no table, no index, no permission, no role. The column and the
-- whole category-picture architecture were added and approved in STEP 14B
-- (migration 0035). This is an eleven-row data change of a presentation field,
-- applied as a single statement so the set lands together or not at all.
--
-- ONE MIGRATION, NOT ELEVEN. Unlike the Fresh covers, which were each cut from
-- a shared source sheet and therefore approved one at a time, these eleven were
-- created individually and approved together as a batch. They are attached the
-- same way.
--
-- THIS COMPLETES THE CATEGORY COVERS. After this migration all eighteen pools
-- carry one: seven FRESH (0035-0041) and eleven DRY (here). No pool is left
-- without a picture. The column stays nullable and the customer screen keeps
-- its neutral placeholder — that path is still reachable, still correct, and
-- still tested; it is simply no longer exercised by production data.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture shows the
-- item an officer takes and lives on rik.provisions; a category picture is the
-- cover of a whole allowance and belongs to the pool. They are separate columns
-- on separate tables and neither substitutes for the other. Nothing here
-- touches rik.provisions — the 173 provisions that carry a picture keep exactly
-- the picture they have, and the 16 that do not are not given one.
--
-- THE SEVEN FRESH COVERS ARE NOT TOUCHED. Milk (0035), Meat (0036), Eggs
-- (0037), Fresh Vegetables (0038), Fresh Fruits (0039), Onion / Garlic (0040)
-- and Potato (0041) are left exactly as they are; the verification block below
-- fails if any of them moves.
--
-- KEYED ON THE STABLE POOL CODES, READ FROM THE LIVE DATABASE. A code is
-- stable; a display name is editable from the RIK Admin dashboard. Two of these
-- are easy to get wrong and were read rather than assumed: the Sugar pool's
-- code is SUGAR_JAGGERY (name "Sugar / Jaggery"), not SUGAR, and the Cheese
-- pool's code is CHEESE_NUTRAMUL (name "Cheese / Nutramul"), not CHEESE.
--
-- IDEMPOTENT. Each row is assigned a value that depends only on its code, and
-- rows already holding it are skipped by IS DISTINCT FROM, so a re-run changes
-- nothing and touches no updated_at.
--
-- A NOTE ON THE ASSETS. These eleven were created and approved individually,
-- not cut from the Fresh sheet, so there is no extraction and no crop. They
-- arrived at 1536x1024 while the established category-cover contract is
-- 800x800, and the project owner approved a single one-time proportional
-- resize to resolve that: each image was scaled whole, 1536x1024 -> 800x533 by
-- LANCZOS, and centred on an 800x800 pure-white canvas (bands of 133 px above
-- and 134 px below). Nothing was cropped, sharpened, recoloured, stretched or
-- otherwise altered; the artwork band was verified to equal a resize of the
-- entire source and the bands to be pure white. Because it is a resize, the
-- deployed pixels are resampled and are NOT bit-identical to the approved
-- originals — no such claim is made. Nothing in the database depends on any of
-- this.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('CEREALS',            '/catalogue/rik/category/cereals.png'),              -- Cereals
    ('DAL',                '/catalogue/rik/category/dal.png'),                  -- Dal
    ('HYDROGENATED_OIL',   '/catalogue/rik/category/hydrogenated-oil.png'),     -- Hydrogenated Oil
    ('SUGAR_JAGGERY',      '/catalogue/rik/category/sugar-jaggery.png'),        -- Sugar / Jaggery
    ('TEA_COFFEE',         '/catalogue/rik/category/tea-coffee.png'),           -- Tea / Coffee
    ('DALIYA',             '/catalogue/rik/category/daliya.png'),               -- Daliya
    ('BUTTER_GHEE',        '/catalogue/rik/category/butter-ghee.png'),          -- Butter / Ghee
    ('SALT',               '/catalogue/rik/category/salt.png'),                 -- Salt
    ('CHEESE_NUTRAMUL',    '/catalogue/rik/category/cheese-nutramul.png'),      -- Cheese / Nutramul
    ('CONDIMENTS',         '/catalogue/rik/category/condiments.png'),           -- Condiments
    ('GARAM_MASALA_WHOLE', '/catalogue/rik/category/garam-masala-whole.png')    -- Garam Masala (Whole)
  ) AS m(code, image_ref)
 WHERE p.code = m.code
   AND p.image_ref IS DISTINCT FROM m.image_ref;

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-applied batch
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pool_total integer;
  with_image integer;
  stray      integer;
  r          record;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0042: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 18 THEN
    RAISE EXCEPTION 'Migration 0042: expected all 18 pools to carry a category picture, found %.', with_image;
  END IF;

  -- Every one of the eleven DRY pools, by code and exact path.
  FOR r IN
    SELECT * FROM (VALUES
      ('CEREALS',            '/catalogue/rik/category/cereals.png'),
      ('DAL',                '/catalogue/rik/category/dal.png'),
      ('HYDROGENATED_OIL',   '/catalogue/rik/category/hydrogenated-oil.png'),
      ('SUGAR_JAGGERY',      '/catalogue/rik/category/sugar-jaggery.png'),
      ('TEA_COFFEE',         '/catalogue/rik/category/tea-coffee.png'),
      ('DALIYA',             '/catalogue/rik/category/daliya.png'),
      ('BUTTER_GHEE',        '/catalogue/rik/category/butter-ghee.png'),
      ('SALT',               '/catalogue/rik/category/salt.png'),
      ('CHEESE_NUTRAMUL',    '/catalogue/rik/category/cheese-nutramul.png'),
      ('CONDIMENTS',         '/catalogue/rik/category/condiments.png'),
      ('GARAM_MASALA_WHOLE', '/catalogue/rik/category/garam-masala-whole.png')
    ) AS t(code, expected)
  LOOP
    IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'Migration 0042: the % pool picture is wrong; expected %.', r.code, r.expected;
    END IF;
  END LOOP;

  -- STEPS 14B through 14H are approved and closed; their work must be exactly
  -- where they left it.
  FOR r IN
    SELECT * FROM (VALUES
      ('MILK',         '/catalogue/rik/category/milk.png'),
      ('MEAT',         '/catalogue/rik/category/meat.png'),
      ('EGGS',         '/catalogue/rik/category/eggs.png'),
      ('VEGETABLES',   '/catalogue/rik/category/vegetables.png'),
      ('FRUITS',       '/catalogue/rik/category/fruits.png'),
      ('ONION_GARLIC', '/catalogue/rik/category/onion.png'),
      ('POTATO',       '/catalogue/rik/category/potato.png')
    ) AS t(code, expected)
  LOOP
    IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'Migration 0042: the % pool picture changed; expected %.', r.code, r.expected;
    END IF;
  END LOOP;

  -- No pool may be left without one, and no two may share a file.
  SELECT count(*) INTO stray FROM rik.entitlement_pools WHERE image_ref IS NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0042: % pool(s) still have no category picture.', stray;
  END IF;

  SELECT count(*) INTO stray FROM (
    SELECT image_ref FROM rik.entitlement_pools GROUP BY image_ref HAVING count(*) > 1
  ) d;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0042: % category picture(s) are shared by more than one pool.', stray;
  END IF;

  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE image_ref !~ '^/catalogue/rik/category/[a-z0-9-]+\.png$';
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0042: % pool picture path(s) are outside the category convention.', stray;
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0042: provision pictures changed — % found, expected 173.', stray;
  END IF;
  SELECT count(*) INTO stray FROM rik.provisions;
  IF stray <> 189 THEN
    RAISE EXCEPTION 'Migration 0042: provision count changed — % found, expected 189.', stray;
  END IF;
  SELECT count(*) INTO stray FROM rik.provisions WHERE image_ref LIKE '/catalogue/rik/category/%';
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0042: % provision(s) hold a category picture path.', stray;
  END IF;

  -- Nor is the pools' own definition, nor the entitlement configuration.
  FOR r IN
    SELECT * FROM (VALUES
      ('CEREALS','Cereals','g'), ('DAL','Dal','g'),
      ('HYDROGENATED_OIL','Hydrogenated Oil','g'), ('SUGAR_JAGGERY','Sugar / Jaggery','g'),
      ('TEA_COFFEE','Tea / Coffee','g'), ('DALIYA','Daliya','g'),
      ('BUTTER_GHEE','Butter / Ghee','g'), ('SALT','Salt','g'),
      ('CHEESE_NUTRAMUL','Cheese / Nutramul','g'), ('CONDIMENTS','Condiments','g'),
      ('GARAM_MASALA_WHOLE','Garam Masala (Whole)','g')
    ) AS t(code, nm, un)
  LOOP
    IF (SELECT name FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.nm
       OR (SELECT unit FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.un
       OR (SELECT ration_type FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM 'DRY' THEN
      RAISE EXCEPTION 'Migration 0042: the % pool definition changed; this migration must not touch it.', r.code;
    END IF;
  END LOOP;

  SELECT count(*) INTO stray FROM rik.pool_scales;
  IF stray <> 50 THEN
    RAISE EXCEPTION 'Migration 0042: entitlement scales changed — % found, expected 50.', stray;
  END IF;
  SELECT count(*) INTO stray FROM rik.pool_conversions;
  IF stray <> 7 THEN
    RAISE EXCEPTION 'Migration 0042: conversions changed — % found, expected 7.', stray;
  END IF;
  SELECT count(*) INTO stray FROM shared.roles;
  IF stray <> 6 THEN
    RAISE EXCEPTION 'Migration 0042: roles changed — % found, expected 6.', stray;
  END IF;
  SELECT count(*) INTO stray FROM shared.permissions;
  IF stray <> 20 THEN
    RAISE EXCEPTION 'Migration 0042: permissions changed — % found, expected 20.', stray;
  END IF;
END;
$$;

RESET ROLE;
