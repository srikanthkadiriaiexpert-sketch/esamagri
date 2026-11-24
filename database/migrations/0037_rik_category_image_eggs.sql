-- ---------------------------------------------------------------------------
-- 0037_rik_category_image_eggs.sql
--
-- STEP 14D — attach the Eggs category picture.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ONE pool: EGGS.
-- Nothing else. The column, its CHECK constraint and the whole category
-- picture architecture were added and approved in STEP 14B (migration
-- 0035); this migration adds no column, no constraint, no table and no
-- index. It is a one-row data change of a presentation field.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture
-- shows the item an officer takes and lives on rik.provisions; a category
-- picture is the cover of a whole allowance and belongs to the pool. They
-- are separate columns on separate tables and neither substitutes for the
-- other. Nothing here touches rik.provisions or any provision picture.
--
-- MILK AND MEAT ARE NOT TOUCHED. The pictures set by 0035 and 0036 are
-- left exactly as they are; the verification block below fails if either
-- moves. Both steps are approved and closed.
--
-- FIFTEEN POOLS STAY WITHOUT A PICTURE, DELIBERATELY. After this
-- migration Milk, Meat and Eggs have one and the other fifteen do not.
-- That is the intended state, not an unfinished one: Fresh Vegetables,
-- Fresh Fruits, Onion / Garlic, Potato and all eleven Dry categories are
-- each handled in their own approved step, one at a time. The column is
-- nullable and those pools must keep working exactly as they do today —
-- the customer screen shows its existing neutral placeholder for them.
--
-- NOTHING ELSE MOVES. No pool code, name, unit, ration type, description,
-- display order, active flag or effective date is written. No scale, no
-- conversion, no provision, no permission, no role. The entitlement engine
-- reads none of this column.
--
-- KEYED ON THE POOL CODE. A code is stable; a display name is editable
-- from the RIK Admin dashboard. Keying on the name would silently
-- mis-attach a picture the first time an administrator corrected a
-- spelling.
--
-- IDEMPOTENT. The UPDATE assigns a value that depends only on the code and
-- skips rows already holding it, so a re-run changes nothing and touches
-- no updated_at.
--
-- A NOTE ON THE ASSET. The Eggs picture was extracted under an amended
-- mask rule, approved for Eggs and subsequent Fresh categories: enclosed
-- holes inside the subject silhouette are filled before any background
-- whitening, so that the bright interior of a white subject is recognised
-- as artwork rather than as background. Nothing in the database changes on
-- account of that; it is recorded here because it is the reason this
-- asset's interior pixels are bit-identical to the source sheet while the
-- earlier, rejected candidate's were not. Milk and Meat were NOT
-- re-extracted and migrations 0035 and 0036 are untouched.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('EGGS', '/catalogue/rik/category/eggs.png')  -- Eggs
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
  eggs_ref   text;
  milk_ref   text;
  meat_ref   text;
  stray      integer;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0037: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 3 THEN
    RAISE EXCEPTION 'Migration 0037: expected exactly 3 category pictures (Milk, Meat, Eggs), found %.', with_image;
  END IF;

  SELECT image_ref INTO eggs_ref FROM rik.entitlement_pools WHERE code = 'EGGS';
  IF eggs_ref IS DISTINCT FROM '/catalogue/rik/category/eggs.png' THEN
    RAISE EXCEPTION 'Migration 0037: the Eggs pool picture is %, not the expected path.', eggs_ref;
  END IF;

  -- STEPS 14B and 14C are approved and closed; their work must be exactly
  -- where they left it.
  SELECT image_ref INTO milk_ref FROM rik.entitlement_pools WHERE code = 'MILK';
  IF milk_ref IS DISTINCT FROM '/catalogue/rik/category/milk.png' THEN
    RAISE EXCEPTION 'Migration 0037: the Milk pool picture changed to %.', milk_ref;
  END IF;

  SELECT image_ref INTO meat_ref FROM rik.entitlement_pools WHERE code = 'MEAT';
  IF meat_ref IS DISTINCT FROM '/catalogue/rik/category/meat.png' THEN
    RAISE EXCEPTION 'Migration 0037: the Meat pool picture changed to %.', meat_ref;
  END IF;

  -- The other fifteen must still be without one. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE code NOT IN ('MILK', 'MEAT', 'EGGS') AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0037: % pool(s) other than Milk, Meat and Eggs were given a picture.', stray;
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0037: provision pictures changed — % found, expected 173.', stray;
  END IF;
END;
$$;

RESET ROLE;
