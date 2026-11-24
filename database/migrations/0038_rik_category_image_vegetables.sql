-- ---------------------------------------------------------------------------
-- 0038_rik_category_image_vegetables.sql
--
-- STEP 14E — attach the Fresh Vegetables category picture.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ONE pool:
-- VEGETABLES. Nothing else. The column, its CHECK constraint and the whole
-- category picture architecture were added and approved in STEP 14B
-- (migration 0035); this migration adds no column, no constraint, no table
-- and no index. It is a one-row data change of a presentation field.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture shows
-- the item an officer takes and lives on rik.provisions; a category picture
-- is the cover of a whole allowance and belongs to the pool. They are
-- separate columns on separate tables and neither substitutes for the
-- other. Nothing here touches rik.provisions or any provision picture — in
-- particular the forty-five provisions that draw on the Fresh Vegetables
-- pool keep the pictures they already have, which were set in STEP 12B.
--
-- MILK, MEAT AND EGGS ARE NOT TOUCHED. The pictures set by 0035, 0036 and
-- 0037 are left exactly as they are; the verification block below fails if
-- any of them moves. All three steps are approved and closed.
--
-- FOURTEEN POOLS STAY WITHOUT A PICTURE, DELIBERATELY. After this
-- migration Milk, Meat, Eggs and Fresh Vegetables have one and the other
-- fourteen do not. That is the intended state, not an unfinished one:
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
-- spelling. Note that the code is VEGETABLES while the customer-facing
-- name is "Fresh Vegetables" — the code is what this migration matches on.
--
-- IDEMPOTENT. The UPDATE assigns a value that depends only on the code and
-- skips rows already holding it, so a re-run changes nothing and touches
-- no updated_at.
--
-- A NOTE ON THE ASSET. The picture was extracted under the mask rule
-- approved in STEP 14D for Eggs and subsequent Fresh categories: enclosed
-- holes inside the subject silhouette are filled before any background
-- whitening, and nothing inside the silhouette is written to. On this
-- subject the arrangement is dense and saturated, so the threshold traced
-- the whole of it and there were no enclosed holes to rescue; the rule
-- still mattered, because it also scopes the flat-white tidy-up to outside
-- the silhouette, which left 126,309 interior pixels bit-identical to the
-- source sheet. Nothing in the database depends on any of that; it is
-- recorded because it is why this asset preserves the source artwork
-- exactly.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('VEGETABLES', '/catalogue/rik/category/vegetables.png')  -- Fresh Vegetables
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
  veg_ref    text;
  stray      integer;
  r          record;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0038: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 4 THEN
    RAISE EXCEPTION 'Migration 0038: expected exactly 4 category pictures, found %.', with_image;
  END IF;

  SELECT image_ref INTO veg_ref FROM rik.entitlement_pools WHERE code = 'VEGETABLES';
  IF veg_ref IS DISTINCT FROM '/catalogue/rik/category/vegetables.png' THEN
    RAISE EXCEPTION 'Migration 0038: the Fresh Vegetables pool picture is %, not the expected path.', veg_ref;
  END IF;

  -- STEPS 14B, 14C and 14D are approved and closed; their work must be
  -- exactly where they left it.
  FOR r IN
    SELECT * FROM (VALUES
      ('MILK', '/catalogue/rik/category/milk.png'),
      ('MEAT', '/catalogue/rik/category/meat.png'),
      ('EGGS', '/catalogue/rik/category/eggs.png')
    ) AS t(code, expected)
  LOOP
    IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'Migration 0038: the % pool picture changed; expected %.', r.code, r.expected;
    END IF;
  END LOOP;

  -- The other fourteen must still be without one. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE code NOT IN ('MILK', 'MEAT', 'EGGS', 'VEGETABLES') AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0038: % pool(s) outside the approved four were given a picture.', stray;
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0038: provision pictures changed — % found, expected 173.', stray;
  END IF;
END;
$$;

RESET ROLE;
