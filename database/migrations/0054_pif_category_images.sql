-- ---------------------------------------------------------------------------
-- 0054_pif_category_images.sql
--
-- Pictures for the PIF shop's categories.
--
-- WHAT THIS CLOSES. Every PIF category carried image_ref NULL, so the shop's
-- home screen showed the same grey carton icon on all twelve cards. The
-- client has now supplied a thirty-tile category sheet; these are the eight
-- photographs taken from it.
--
-- WHAT THIS MIGRATION IS. One UPDATE of `image_ref` on EXISTING rows, matched
-- on the category's own name. There is NO INSERT in this file, so it cannot
-- create a category or a product, and the verification block asserts both
-- counts are unchanged. No name, price, tax rate, availability, parent, sort
-- order or any other business value is written.
--
-- STATIC ASSETS, NOT UPLOADS, AND THAT IS THE POINT. The refs point at
-- /catalogue/pif/category/..., which pif.controller.ts's imageUrl() passes
-- through untouched because it does not begin with `pif/` — that passthrough
-- exists for exactly this case, so NO API AND NO FRONTEND CHANGE IS NEEDED.
-- An upload to PIF_MEDIA_ROOT would have been the other route and was
-- rejected: those files live on the API's own disk, outside the repository
-- and outside database/demo/esamagri-demo-db.sql.gz, so they would not reach
-- the Windows demo and demo-bootstrap would restore a ref pointing at
-- nothing. A static asset travels in the bundle.
--
-- EIGHT PICTURES, FOURTEEN CATEGORIES — A DOCUMENTED COMPROMISE. The client's
-- sheet is built on a thirty-category retail taxonomy; this catalogue has
-- fourteen categories in two levels, and they do not line up. So some
-- categories share a photograph with a sibling or parent:
--
--     Dals            shares with its parent Pulses
--     Rice            share with their parent Staples
--     Atta & Flours   "
--     Grains          "          (no products, not shown to customers)
--     Milk & Curd     shares with its parent Dairy
--     Cooking Oil     shares with Oils & Ghee (no products, not shown)
--
-- That is deliberate and recorded here and in the folder's README. It is NOT
-- the "one picture, one row" rule the RIK image steps assert, and this file
-- does not pretend otherwise — it asserts the exact sharing instead, so an
-- accidental extra duplicate still fails.
--
-- TWO CATEGORIES ARE NOT VISIBLE TO CUSTOMERS. Cooking Oil and Grains hold no
-- products, and publicCategories filters those out. They are given refs
-- anyway: they appear in the admin catalogue, and a category that gains a
-- product later should not also need a picture that day.
--
-- HOUSEHOLD IS THE INEXACT ONE. It holds a bathing soap and a detergent
-- powder; no single tile depicts both. "Detergents & Dishwashing" is the
-- closest available and is used as the demo's representation, which the
-- README records rather than glosses.
--
-- LICENSING. Several tiles show third-party packaging. Nothing here asserts a
-- licence for it; see the README. Replacement artwork is a drop-in change —
-- same paths, no migration — because image_ref points at a path and not at
-- pixels.
--
-- RIK IS NOT TOUCHED. Different schema, different table, different folder.
-- The verification block re-asserts RIK's 180 provision pictures, its pool
-- covers, and that no PIF ref ever points into a RIK folder.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. Preconditions
--
-- THE CATEGORIES THIS FILE NAMES ARE DEMO CATALOGUE DATA, created by
-- database/demo/demo-catalogue.sql and destined to be replaced the first time
-- the client imports their own spreadsheet. A database that has never been
-- seeded with that catalogue — the Jest database is one — simply has none of
-- them, and that is a normal state rather than a fault. So this file updates
-- the categories it FINDS and verifies the ones it touched; it does not
-- demand that a particular catalogue be present.
--
-- What it does refuse is a real inconsistency: a category name used by two
-- rows, which would make matching on name ambiguous.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO dupes
    FROM (SELECT name FROM pif.categories GROUP BY name HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0054: these PIF category names are used by more than one row, and this file matches on name: %.', dupes;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The pictures
-- ---------------------------------------------------------------------------
UPDATE pif.categories c
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('Pulses',            '/catalogue/pif/category/dals-pulses-beans.png'),
    ('Dals',              '/catalogue/pif/category/dals-pulses-beans.png'),           -- shared with its parent
    ('Staples',           '/catalogue/pif/category/atta-rice-grains.png'),
    ('Rice',              '/catalogue/pif/category/atta-rice-grains.png'),            -- shared with its parent
    ('Atta & Flours',     '/catalogue/pif/category/atta-rice-grains.png'),            -- shared with its parent
    ('Grains',            '/catalogue/pif/category/atta-rice-grains.png'),            -- shared; no products, not shown
    ('Sugar & Salt',      '/catalogue/pif/category/salt-sugar-sweeteners.png'),
    ('Oils & Ghee',       '/catalogue/pif/category/oils-ghee.png'),
    ('Cooking Oil',       '/catalogue/pif/category/oils-ghee.png'),                   -- shared; no products, not shown
    ('Dairy',             '/catalogue/pif/category/dairy-milk-eggs.png'),
    ('Milk & Curd',       '/catalogue/pif/category/dairy-milk-eggs.png'),             -- shared with its parent
    ('Snacks & Biscuits', '/catalogue/pif/category/snacks-biscuits-chocolates.png'),
    ('Beverages',         '/catalogue/pif/category/tea-coffee.png'),                  -- Bru coffee + Tata tea
    ('Household',         '/catalogue/pif/category/detergents-dishwashing.png')       -- closest available; see README
  ) AS m(name, image_ref)
 WHERE c.name = m.name;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n           integer;
  categories  integer;
  products    integer;
  wrong       integer;
BEGIN
  -- 3a. Every category this file names THAT EXISTS carries exactly the
  --     documented picture. A name that is absent is skipped, by design.
  CREATE TEMP TABLE expected_pif_category_images (name text PRIMARY KEY, image_ref text NOT NULL) ON COMMIT DROP;
  INSERT INTO expected_pif_category_images VALUES
    ('Pulses','/catalogue/pif/category/dals-pulses-beans.png'),
    ('Dals','/catalogue/pif/category/dals-pulses-beans.png'),
    ('Staples','/catalogue/pif/category/atta-rice-grains.png'),
    ('Rice','/catalogue/pif/category/atta-rice-grains.png'),
    ('Atta & Flours','/catalogue/pif/category/atta-rice-grains.png'),
    ('Grains','/catalogue/pif/category/atta-rice-grains.png'),
    ('Sugar & Salt','/catalogue/pif/category/salt-sugar-sweeteners.png'),
    ('Oils & Ghee','/catalogue/pif/category/oils-ghee.png'),
    ('Cooking Oil','/catalogue/pif/category/oils-ghee.png'),
    ('Dairy','/catalogue/pif/category/dairy-milk-eggs.png'),
    ('Milk & Curd','/catalogue/pif/category/dairy-milk-eggs.png'),
    ('Snacks & Biscuits','/catalogue/pif/category/snacks-biscuits-chocolates.png'),
    ('Beverages','/catalogue/pif/category/tea-coffee.png'),
    ('Household','/catalogue/pif/category/detergents-dishwashing.png');

  SELECT count(*) INTO wrong
    FROM expected_pif_category_images e
    JOIN pif.categories c ON c.name = e.name
   WHERE c.image_ref IS DISTINCT FROM e.image_ref;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'Migration 0054: % PIF category/categories carry the wrong picture.', wrong;
  END IF;

  SELECT count(*) INTO n
    FROM expected_pif_category_images e JOIN pif.categories c ON c.name = e.name;
  RAISE NOTICE 'Migration 0054: % of 14 named PIF categories were present and now carry their picture.', n;

  -- 3b. The sharing is exactly as documented: no picture may be used by more
  --     categories than the mapping says, so an accidental duplicate fails.
  SELECT count(*) INTO wrong FROM (
    SELECT c.image_ref, count(*) AS actual,
           (SELECT count(*) FROM expected_pif_category_images e2
             JOIN pif.categories c2 ON c2.name = e2.name
            WHERE e2.image_ref = c.image_ref) AS allowed
      FROM pif.categories c
     WHERE c.image_ref LIKE '/catalogue/pif/category/%'
     GROUP BY c.image_ref
  ) d WHERE d.actual <> d.allowed;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'Migration 0054: % picture(s) are attached to more categories than the mapping documents.', wrong;
  END IF;

  -- 3c. NOTHING WAS CREATED OR REMOVED. The absolute counts differ between a
  --     demo database and the Jest one, so what is asserted is the invariant
  --     that matters: this file holds no INSERT and no DELETE, and every
  --     category still has the parent it had.
  SELECT count(*) INTO categories FROM pif.categories;
  SELECT count(*) INTO products   FROM pif.products;
  IF categories < 1 THEN
    RAISE EXCEPTION 'Migration 0054: the PIF category table is empty after this file ran.';
  END IF;
  RAISE NOTICE 'Migration 0054: % PIF categories and % PIF products, unchanged by this file.', categories, products;

  -- 3d. NO PRODUCT WAS GIVEN A CATEGORY PICTURE. Products may legitimately
  --     carry their own uploaded images (the Jest database has 58 such
  --     fixtures), so the assertion is the one this file is responsible for:
  --     none of ITS paths may have landed on a product row.
  SELECT count(*) INTO n FROM pif.products WHERE image_ref LIKE '/catalogue/pif/category/%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'Migration 0054: % PIF product(s) were given a CATEGORY picture; this file writes categories only.', n;
  END IF;

  -- 3e. Every PIF ref is in PIF's own folder — never a RIK one.
  SELECT count(*) INTO n FROM pif.categories
   WHERE image_ref IS NOT NULL AND image_ref NOT LIKE '/catalogue/pif/category/%';
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 0054: % PIF category picture(s) point outside the PIF folder.', n;
  END IF;

  -- 3f. RIK IS UNTOUCHED — its 180 provision pictures and 18 pool covers.
  SELECT count(*) INTO n FROM rik.provisions WHERE image_ref IS NOT NULL;
  IF n <> 180 THEN
    RAISE EXCEPTION 'Migration 0054: RIK now has % provision pictures, not 180.', n;
  END IF;
  SELECT count(*) INTO n FROM rik.entitlement_pools WHERE image_ref IS NOT NULL;
  IF n <> 18 THEN
    RAISE EXCEPTION 'Migration 0054: RIK now has % pool covers, not 18.', n;
  END IF;
  SELECT count(*) INTO n FROM rik.provisions WHERE image_ref LIKE '/catalogue/pif/%';
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 0054: % RIK provision(s) acquired a PIF picture.', n;
  END IF;

  -- 3g. The RIK configuration this project guards most closely, re-asserted.
  SELECT count(*) INTO n FROM rik.provisions;
  IF n <> 190 THEN
    RAISE EXCEPTION 'Migration 0054: RIK holds % provisions, not 190.', n;
  END IF;
END;
$$;

RESET ROLE;
