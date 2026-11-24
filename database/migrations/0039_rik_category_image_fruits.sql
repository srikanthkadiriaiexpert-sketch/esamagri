-- ---------------------------------------------------------------------------
-- 0039_rik_category_image_fruits.sql
--
-- STEP 14F — attach the Fresh Fruits category picture.
--
-- RECONSTRUCTED, 9 October 2026. The original 0039 file was lost with the
-- container (recovery gate, section B) and could not be recovered. It was NOT
-- rebuilt at the recovery gate, because the client artwork it depends on was
-- also lost and a migration pointing at a missing asset is worse than an
-- absent one. The client has now supplied that artwork, so the file is
-- reconstructed here from the evidence that survived:
--
--   * migration 0040's verification block, which requires FRUITS to hold
--     exactly '/catalogue/rik/category/fruits.png' before it will apply, and
--     which expects exactly SIX pictures afterwards — fixing both this
--     migration's content and its position in the sequence;
--   * migrations 0038 and 0040, whose shape, keying, idempotence and
--     verification discipline this file follows line for line;
--   * the pool row itself: code FRUITS, name "Fresh Fruits", unit g,
--     ration type FRESH — unchanged and untouched here.
--
-- Nothing about it is invented: without this file, 0040, 0041 and 0042 can
-- never apply at all, and the FRUITS cover the client supplied would have
-- nowhere to attach.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ONE pool: FRUITS.
-- Nothing else. The column, its CHECK constraint and the whole category
-- picture architecture were added and approved in STEP 14B (migration 0035);
-- this migration adds no column, no constraint, no table and no index. It is
-- a one-row data change of a presentation field.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture shows
-- the item an officer takes and lives on rik.provisions; a category picture
-- is the cover of a whole allowance and belongs to the pool. They are
-- separate columns on separate tables and neither substitutes for the other.
-- Nothing here touches rik.provisions or any provision picture.
--
-- MILK, MEAT, EGGS AND FRESH VEGETABLES ARE NOT TOUCHED. The pictures set by
-- 0035, 0036, 0037 and 0038 are left exactly as they are; the verification
-- block below fails if any of them moves. All four steps are approved and
-- closed.
--
-- THIRTEEN POOLS STAY WITHOUT A PICTURE, DELIBERATELY. After this migration
-- Milk, Meat, Eggs, Fresh Vegetables and Fresh Fruits have one and the other
-- thirteen do not. That is the intended state, not an unfinished one:
-- Onion / Garlic, Potato and all eleven Dry categories are each handled in
-- their own approved step, one at a time. The column is nullable and those
-- pools must keep working exactly as they do today — the customer screen
-- shows its existing neutral placeholder for them.
--
-- NOTHING ELSE MOVES. No pool code, name, unit, ration type, description,
-- display order, active flag or effective date is written. No scale, no
-- conversion, no provision, no permission, no role. The entitlement engine
-- reads none of this column.
--
-- KEYED ON THE POOL CODE. A code is stable; a display name is editable from
-- the RIK Admin dashboard. Keying on the name would silently mis-attach a
-- picture the first time an administrator corrected a spelling. Note that the
-- code is FRUITS while the customer-facing name is "Fresh Fruits" — the code
-- is what this migration matches on.
--
-- IDEMPOTENT. The UPDATE assigns a value that depends only on the code and
-- skips rows already holding it, so a re-run changes nothing and touches no
-- updated_at.
--
-- A NOTE ON THE ASSET. The picture is the client-supplied Fresh Fruits
-- artwork, placed on the catalogue's 800x800 category canvas as supplied —
-- not redrawn, recoloured, composited or enhanced. Nothing in the database
-- depends on that; it is recorded because the asset's provenance is part of
-- this step.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('FRUITS', '/catalogue/rik/category/fruits.png')  -- Fresh Fruits
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
  fruit_ref  text;
  stray      integer;
  r          record;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0039: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 5 THEN
    RAISE EXCEPTION 'Migration 0039: expected exactly 5 category pictures, found %.', with_image;
  END IF;

  SELECT image_ref INTO fruit_ref FROM rik.entitlement_pools WHERE code = 'FRUITS';
  IF fruit_ref IS DISTINCT FROM '/catalogue/rik/category/fruits.png' THEN
    RAISE EXCEPTION 'Migration 0039: the Fresh Fruits pool picture is %, not the expected path.', fruit_ref;
  END IF;

  -- STEPS 14B, 14C, 14D and 14E are approved and closed; their work must be
  -- exactly where they left it.
  FOR r IN
    SELECT * FROM (VALUES
      ('MILK',       '/catalogue/rik/category/milk.png'),
      ('MEAT',       '/catalogue/rik/category/meat.png'),
      ('EGGS',       '/catalogue/rik/category/eggs.png'),
      ('VEGETABLES', '/catalogue/rik/category/vegetables.png')
    ) AS t(code, expected)
  LOOP
    IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'Migration 0039: the % pool picture changed; expected %.', r.code, r.expected;
    END IF;
  END LOOP;

  -- The other thirteen must still be without one. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE code NOT IN ('MILK', 'MEAT', 'EGGS', 'VEGETABLES', 'FRUITS')
     AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0039: % pool(s) outside the approved five were given a picture.', stray;
  END IF;

  -- Onion / Garlic and Potato are the next Fresh categories and are NOT part
  -- of this step.
  IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = 'ONION_GARLIC') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0039: ONION_GARLIC was given a picture; that is not this step.';
  END IF;
  IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = 'POTATO') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0039: POTATO was given a picture; that is not this step.';
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0039: provision pictures changed — % found, expected 173.', stray;
  END IF;

  -- Neither is the pool's own definition.
  IF (SELECT name FROM rik.entitlement_pools WHERE code = 'FRUITS') IS DISTINCT FROM 'Fresh Fruits' THEN
    RAISE EXCEPTION 'Migration 0039: the Fresh Fruits pool name changed; this migration must not touch it.';
  END IF;
  IF (SELECT unit FROM rik.entitlement_pools WHERE code = 'FRUITS') IS DISTINCT FROM 'g' THEN
    RAISE EXCEPTION 'Migration 0039: the Fresh Fruits pool unit changed; this migration must not touch it.';
  END IF;
  IF (SELECT ration_type FROM rik.entitlement_pools WHERE code = 'FRUITS') IS DISTINCT FROM 'FRESH' THEN
    RAISE EXCEPTION 'Migration 0039: the Fresh Fruits pool ration type changed; this migration must not touch it.';
  END IF;
END;
$$;

RESET ROLE;
