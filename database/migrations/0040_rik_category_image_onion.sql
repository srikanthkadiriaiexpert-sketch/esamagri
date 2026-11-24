-- ---------------------------------------------------------------------------
-- 0040_rik_category_image_onion.sql
--
-- STEP 14G — attach the Onion category picture.
--
-- WHAT THIS MIGRATION DOES
--
-- It writes rik.entitlement_pools.image_ref for exactly ONE pool:
-- ONION_GARLIC. Nothing else. No INSERT, no DELETE, no column, no constraint,
-- no table, no index — the column and the whole category-picture architecture
-- were added and approved in STEP 14B (migration 0035). This is a one-row data
-- change of a presentation field.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. A provision picture shows the
-- item an officer takes and lives on rik.provisions; a category picture is the
-- cover of a whole allowance and belongs to the pool. They are separate columns
-- on separate tables and neither substitutes for the other. Nothing here
-- touches rik.provisions or any provision picture — in particular the two
-- provisions that draw on this pool, ONION_FRESH and GARLIC_FRESH, keep exactly
-- the picture state they already have (both have none, and this migration does
-- not give them one; that is a separate matter under the provision-image work
-- and is not this step's business).
--
-- READ THIS BEFORE APPROVING — THE POOL IS "ONION / GARLIC", THE PICTURE IS
-- ONIONS. The live pool code is ONION_GARLIC and its customer-facing name is
-- "Onion / Garlic". The approved category-image sheet carries one card for this
-- category, captioned "Onion", and it depicts onions only; there is no garlic
-- artwork anywhere on that sheet. So this cover shows one of the pool's two
-- items. That is a characteristic of the approved source artwork, not something
-- introduced here, and it is recorded in the open in the STEP 14G report rather
-- than left implicit. Nothing about the pool's code, name, unit, ration type,
-- effective date, scales or conversions is changed by this migration — the name
-- still reads "Onion / Garlic" to the customer, exactly as before.
--
-- THE FIVE APPROVED COVERS ARE NOT TOUCHED. Milk (0035), Meat (0036), Eggs
-- (0037), Fresh Vegetables (0038) and Fresh Fruits (0039) are left exactly as
-- they are; the verification block below fails if any of them moves.
--
-- TWELVE POOLS STAY WITHOUT A PICTURE, DELIBERATELY. After this migration six
-- pools have one and the other twelve do not. That is the intended state, not
-- an unfinished one: Potato and all eleven Dry categories are each handled in
-- their own approved step, one at a time. The column is nullable and those
-- pools must keep working exactly as they do today — the customer screen shows
-- its existing neutral placeholder for them.
--
-- NOTHING ELSE MOVES. No pool code, name, unit, ration type, description,
-- display order, active flag or effective date is written. No scale, no
-- conversion, no provision, no permission, no role. The entitlement engine
-- reads none of this column.
--
-- KEYED ON THE POOL CODE. A code is stable; a display name is editable from the
-- RIK Admin dashboard. Keying on the name would silently mis-attach a picture
-- the first time an administrator corrected a spelling. The code is
-- ONION_GARLIC while the customer-facing name is "Onion / Garlic"; the code is
-- what this migration matches on, and it was read from the live database rather
-- than assumed.
--
-- IDEMPOTENT. The UPDATE assigns a value that depends only on the code and
-- skips rows already holding it, so a re-run changes nothing and touches no
-- updated_at.
--
-- A NOTE ON THE ASSET. The picture was cut from the approved combined Fresh
-- sheet (MD5 5d21b48c0fc4e32d41247da38887c24c), the same file the five closed
-- steps read, under the mask rule approved in STEP 14D: enclosed holes inside
-- the subject silhouette are filled before any background whitening, and
-- nothing inside the silhouette is written to. On this subject 139 enclosed
-- holes were found and filled, all of them at min-channel 247-255 — the pale
-- rings of the cut onion and the specular highlights on the golden onions,
-- which the threshold cannot see and the old rule would have flattened to pure
-- white. All 108,922 interior pixels left the extraction bit-identical to the
-- sheet, and no pure-white pixel was created inside the silhouette (0 new
-- regions, 0 px). Nothing in the database depends on that; it is recorded
-- because it is why this asset preserves the source artwork exactly. The
-- deployed 800x800 file is that crop enlarged once by LANCZOS to the shared
-- presentation convention, so the deployed pixels are resampled — the
-- bit-identity claim is about the extraction stage, not the shipped file.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('ONION_GARLIC', '/catalogue/rik/category/onion.png')  -- Onion / Garlic
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
  onion_ref  text;
  stray      integer;
  r          record;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0040: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 6 THEN
    RAISE EXCEPTION 'Migration 0040: expected exactly 6 category pictures, found %.', with_image;
  END IF;

  SELECT image_ref INTO onion_ref FROM rik.entitlement_pools WHERE code = 'ONION_GARLIC';
  IF onion_ref IS DISTINCT FROM '/catalogue/rik/category/onion.png' THEN
    RAISE EXCEPTION 'Migration 0040: the Onion / Garlic pool picture is %, not the expected path.', onion_ref;
  END IF;

  -- STEPS 14B, 14C, 14D, 14E and 14F are approved and closed; their work must
  -- be exactly where they left it.
  FOR r IN
    SELECT * FROM (VALUES
      ('MILK',       '/catalogue/rik/category/milk.png'),
      ('MEAT',       '/catalogue/rik/category/meat.png'),
      ('EGGS',       '/catalogue/rik/category/eggs.png'),
      ('VEGETABLES', '/catalogue/rik/category/vegetables.png'),
      ('FRUITS',     '/catalogue/rik/category/fruits.png')
    ) AS t(code, expected)
  LOOP
    IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = r.code) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'Migration 0040: the % pool picture changed; expected %.', r.code, r.expected;
    END IF;
  END LOOP;

  -- The other twelve must still be without one. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE code NOT IN ('MILK', 'MEAT', 'EGGS', 'VEGETABLES', 'FRUITS', 'ONION_GARLIC')
     AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0040: % pool(s) outside the approved six were given a picture.', stray;
  END IF;

  -- Potato is the next Fresh category and is NOT part of this step.
  IF (SELECT image_ref FROM rik.entitlement_pools WHERE code = 'POTATO') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0040: POTATO was given a picture; that is not this step.';
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0040: provision pictures changed — % found, expected 173.', stray;
  END IF;

  -- Neither is the pool's own definition.
  IF (SELECT name FROM rik.entitlement_pools WHERE code = 'ONION_GARLIC') IS DISTINCT FROM 'Onion / Garlic' THEN
    RAISE EXCEPTION 'Migration 0040: the Onion / Garlic pool name changed; this migration must not touch it.';
  END IF;
  IF (SELECT unit FROM rik.entitlement_pools WHERE code = 'ONION_GARLIC') IS DISTINCT FROM 'g' THEN
    RAISE EXCEPTION 'Migration 0040: the Onion / Garlic pool unit changed; this migration must not touch it.';
  END IF;
END;
$$;

RESET ROLE;
