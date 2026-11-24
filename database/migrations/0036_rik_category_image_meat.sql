-- ---------------------------------------------------------------------------
-- 0036_rik_category_image_meat.sql
--
-- STEP 14C — attach the Meat category picture.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ONE pool: MEAT.
-- Nothing else. The column, its CHECK constraint and the whole category
-- picture architecture were added and approved in STEP 14B (migration
-- 0035); this migration adds no column, no constraint, no table and no
-- index. It is a one-row data change of a presentation field.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture
-- shows the item an officer takes and lives on rik.provisions; a category
-- picture is the cover of a whole allowance and belongs to the pool. They
-- are separate columns on separate tables and neither substitutes for the
-- other. Nothing here touches rik.provisions or any provision picture —
-- in particular, the provisions that draw on the Meat pool (Meat, Fish,
-- Chicken / Fowl) keep the image_ref they have today, which is none.
--
-- MILK IS NOT TOUCHED. The Milk picture set by 0035 is left exactly as it
-- is; the verification block below fails if it moves.
--
-- SIXTEEN POOLS STAY WITHOUT A PICTURE, DELIBERATELY. After this
-- migration Milk and Meat have one and the other sixteen do not. That is
-- the intended state, not an unfinished one: Eggs, Fresh Vegetables,
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
-- THE PICTURE ITSELF is a static file in the customer app's public asset
-- folder, following the convention 0035 established; this column holds the
-- path to one, never the image bytes.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('MEAT', '/catalogue/rik/category/meat.png')  -- Meat
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
  meat_ref   text;
  milk_ref   text;
  stray      integer;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0036: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 2 THEN
    RAISE EXCEPTION 'Migration 0036: expected exactly 2 category pictures (Milk, Meat), found %.', with_image;
  END IF;

  SELECT image_ref INTO meat_ref FROM rik.entitlement_pools WHERE code = 'MEAT';
  IF meat_ref IS DISTINCT FROM '/catalogue/rik/category/meat.png' THEN
    RAISE EXCEPTION 'Migration 0036: the Meat pool picture is %, not the expected path.', meat_ref;
  END IF;

  -- STEP 14B's work must be exactly where it was left.
  SELECT image_ref INTO milk_ref FROM rik.entitlement_pools WHERE code = 'MILK';
  IF milk_ref IS DISTINCT FROM '/catalogue/rik/category/milk.png' THEN
    RAISE EXCEPTION 'Migration 0036: the Milk pool picture changed to %.', milk_ref;
  END IF;

  -- The other sixteen must still be without one. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE code NOT IN ('MILK', 'MEAT') AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0036: % pool(s) other than Milk and Meat were given a picture.', stray;
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0036: provision pictures changed — % found, expected 173.', stray;
  END IF;
END;
$$;

RESET ROLE;
