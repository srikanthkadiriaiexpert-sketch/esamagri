-- ---------------------------------------------------------------------------
-- 0041_rik_category_image_potato.sql
--
-- STEP 14H — attach the Potato category picture.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ONE pool: POTATO.
-- Nothing else. No INSERT, no DELETE, no column, no constraint, no table, no
-- index, no permission, no role — the column and the whole category-picture
-- architecture were added and approved in STEP 14B (migration 0035). This is a
-- one-row data change of a presentation field.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture shows the
-- item an officer takes and lives on rik.provisions; a category picture is the
-- cover of a whole allowance and belongs to the pool. They are separate columns
-- on separate tables and neither substitutes for the other. Nothing here
-- touches rik.provisions or any provision picture — in particular the two
-- provisions that draw on this pool, POTATO_FRESH and POTATO_ALT_VEGETABLES,
-- keep exactly the picture state they already have (both have none, and this
-- migration does not give them one).
--
-- THIS COMPLETES THE FRESH CATEGORIES. Seven of the eighteen pools are FRESH,
-- and after this migration all seven carry a cover: Milk (0035), Meat (0036),
-- Eggs (0037), Fresh Vegetables (0038), Fresh Fruits (0039), Onion / Garlic
-- (0040) and Potato (here). The ELEVEN remaining pools are all DRY and all
-- stay without a picture, deliberately — each is handled in its own approved
-- step. The column is nullable and those pools must keep working exactly as
-- they do today; the customer screen shows its existing neutral placeholder for
-- them.
--
-- THE SIX APPROVED COVERS ARE NOT TOUCHED. The verification block below fails
-- if any of them moves.
--
-- NOTHING ELSE MOVES. No pool code, name, unit, ration type, description,
-- display order, active flag or effective date is written. No scale, no
-- conversion, no provision, no permission, no role, no selection, no historical
-- record. The entitlement engine reads none of this column.
--
-- KEYED ON THE STABLE POOL CODE. A code is stable; a display name is editable
-- from the RIK Admin dashboard. Keying on the name would silently mis-attach a
-- picture the first time an administrator corrected a spelling. The code is
-- POTATO and the customer-facing name is "Potato"; the code is what this
-- migration matches on, and it was read from the live database rather than
-- assumed.
--
-- IDEMPOTENT. The UPDATE assigns a value that depends only on the code and
-- skips rows already holding it, so a re-run changes nothing and — because the
-- row is not written at all — does not touch updated_at.
--
-- A NOTE ON THE ASSET. The picture was cut from the approved combined Fresh
-- sheet (MD5 5d21b48c0fc4e32d41247da38887c24c), the same file every earlier
-- cover came from, under the mask rule approved in STEP 14D. On this subject
-- there were ZERO enclosed holes and therefore ZERO rescued pixels: the potato
-- flesh is yellow, so its blue channel sits between roughly 127 and 160 even at
-- its palest, far below the 246 threshold, and the threshold traced the whole
-- subject with nothing left for hole-filling to recover. The rule still
-- mattered, because it also scopes the flat-white tidy-up to outside the
-- silhouette, which left all 130,470 interior pixels bit-identical to the
-- sheet. The deployed 800x800 file is that crop enlarged once by LANCZOS, so
-- the deployed pixels are resampled — the bit-identity claim is about the
-- extraction stage, not the shipped file. Nothing in the database depends on
-- any of this; it is recorded because it is why this asset preserves the source
-- artwork exactly.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('POTATO', '/catalogue/rik/category/potato.png')  -- Potato
  ) AS m(code, image_ref)
 WHERE p.code = m.code
   AND p.image_ref IS DISTINCT FROM m.image_ref;

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-applied change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pool_total integer;
  with_image integer;
  potato_ref text;
  stray      integer;
  r          record;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0041: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 7 THEN
    RAISE EXCEPTION 'Migration 0041: expected exactly 7 category pictures, found %.', with_image;
  END IF;

  SELECT image_ref INTO potato_ref FROM rik.entitlement_pools WHERE code = 'POTATO';
  IF potato_ref IS DISTINCT FROM '/catalogue/rik/category/potato.png' THEN
    RAISE EXCEPTION 'Migration 0041: the Potato pool picture is %, not the expected path.', potato_ref;
  END IF;

  -- STEPS 14B through 14G are approved and closed; their work must be exactly
  -- where they left it.
  FOR r IN
    SELECT * FROM (VALUES
      ('MILK',         '/catalogue/rik/category/milk.png'),
      ('MEAT',         '/catalogue/rik/category/meat.png'),
      ('EGGS',         '/catalogue/rik/category/eggs.png'),
      ('VEGETABLES',   '/catalogue/rik/category/vegetables.png'),
      ('FRUITS',       '/catalogue/rik/category/fruits.png'),
      ('ONION_GARLIC', '/catalogue/rik/category/onion.png')
    ) AS t(code, expected)
  LOOP
    IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'Migration 0041: the % pool picture changed; expected %.', r.code, r.expected;
    END IF;
  END LOOP;

  -- Every remaining pool must still be without one, and every one of them must
  -- be a DRY category. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE image_ref IS NULL AND ration_type <> 'DRY';
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0041: % FRESH pool(s) are still without a picture; all seven should now have one.', stray;
  END IF;

  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE ration_type = 'DRY' AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0041: % DRY pool(s) were given a picture; no DRY category is part of this step.', stray;
  END IF;

  SELECT count(*) INTO stray FROM rik.entitlement_pools WHERE image_ref IS NULL;
  IF stray <> 11 THEN
    RAISE EXCEPTION 'Migration 0041: expected 11 pools still without a picture, found %.', stray;
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0041: provision pictures changed — % found, expected 173.', stray;
  END IF;

  SELECT count(*) INTO stray FROM rik.provisions;
  IF stray <> 189 THEN
    RAISE EXCEPTION 'Migration 0041: provision count changed — % found, expected 189.', stray;
  END IF;

  -- No category cover may sit on a provision, and no pool may carry a
  -- provision path.
  SELECT count(*) INTO stray FROM rik.provisions WHERE image_ref LIKE '/catalogue/rik/category/%';
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0041: % provision(s) hold a category picture path.', stray;
  END IF;

  -- Neither is the pool's own definition, nor the entitlement configuration.
  IF (SELECT name FROM rik.entitlement_pools WHERE code = 'POTATO') IS DISTINCT FROM 'Potato' THEN
    RAISE EXCEPTION 'Migration 0041: the Potato pool name changed; this migration must not touch it.';
  END IF;
  IF (SELECT unit FROM rik.entitlement_pools WHERE code = 'POTATO') IS DISTINCT FROM 'g' THEN
    RAISE EXCEPTION 'Migration 0041: the Potato pool unit changed; this migration must not touch it.';
  END IF;
  IF (SELECT ration_type FROM rik.entitlement_pools WHERE code = 'POTATO') IS DISTINCT FROM 'FRESH' THEN
    RAISE EXCEPTION 'Migration 0041: the Potato pool ration type changed; this migration must not touch it.';
  END IF;

  SELECT count(*) INTO stray FROM rik.pool_scales;
  IF stray <> 50 THEN
    RAISE EXCEPTION 'Migration 0041: entitlement scales changed — % found, expected 50.', stray;
  END IF;
  SELECT count(*) INTO stray FROM rik.pool_conversions;
  IF stray <> 7 THEN
    RAISE EXCEPTION 'Migration 0041: conversions changed — % found, expected 7.', stray;
  END IF;
END;
$$;

RESET ROLE;
