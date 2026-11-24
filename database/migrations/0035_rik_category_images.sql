-- ---------------------------------------------------------------------------
-- 0035_rik_category_images.sql
--
-- STEP 14B — give an entitlement pool somewhere to keep its category
-- picture, and attach the first one.
--
-- WHAT THIS MIGRATION DOES
--
-- Part 1 adds ONE nullable column, rik.entitlement_pools.image_ref, with
-- the same non-blank CHECK that rik.provisions.image_ref already carries.
-- Part 2 writes that column for exactly ONE pool: MILK.
--
-- A CATEGORY PICTURE IS NOT A PROVISION PICTURE. The customer catalogue
-- has two levels. A provision picture shows the item an officer takes and
-- lives on rik.provisions; a category picture is the cover of the whole
-- allowance — Milk, Meat, Cereals — and belongs to the pool. They are
-- separate columns on separate tables and neither substitutes for the
-- other. Nothing here touches rik.provisions or any provision picture.
--
-- NO NEW TABLE. A column on the pool is the smallest thing that works:
-- the pool already IS the category the customer browses, it already has a
-- code, a name and a display order, and every screen that shows a category
-- is already reading that row. A separate category table would duplicate
-- the pool's identity and create two places to keep in step.
--
-- NULLABLE, AND STAYS NULLABLE. Seventeen of the eighteen pools have no
-- picture after this migration and must keep working exactly as they do
-- today — the customer screen shows its existing neutral placeholder for
-- them. That is the deliberate state, not an unfinished one: the
-- remaining Fresh categories and all eleven Dry categories are handled in
-- their own approved steps, one at a time.
--
-- NOTHING ELSE MOVES. No pool code, name, unit, ration type, description,
-- display order, active flag or effective date is written. No scale, no
-- conversion, no provision, no permission, no role. The entitlement engine
-- reads none of the column this migration adds.
--
-- KEYED ON THE POOL CODE. A code is stable; a display name is editable
-- from the RIK Admin dashboard. Keying on the name would silently
-- mis-attach a picture the first time an administrator corrected a
-- spelling.
--
-- IDEMPOTENT. The column is added with IF NOT EXISTS and the constraint
-- only when it is absent, so Part 1 re-runs cleanly. Part 2 assigns a
-- value that depends only on the code and skips rows already holding it,
-- so a re-run changes nothing and touches no updated_at.
--
-- THE PICTURE ITSELF is a static file in the customer app's public asset
-- folder, following the same convention as the provision images; this
-- column holds the path to one, never the image bytes.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- Part 1 — the column
-- ---------------------------------------------------------------------------
ALTER TABLE rik.entitlement_pools
  ADD COLUMN IF NOT EXISTS image_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rik_entitlement_pools_image_ref_chk'
       AND conrelid = 'rik.entitlement_pools'::regclass
  ) THEN
    ALTER TABLE rik.entitlement_pools
      ADD CONSTRAINT rik_entitlement_pools_image_ref_chk
        CHECK (image_ref IS NULL OR btrim(image_ref) <> '');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Part 2 — the first category picture, and only the first
-- ---------------------------------------------------------------------------
UPDATE rik.entitlement_pools p
   SET image_ref = m.image_ref,
       updated_at = now()
  FROM (VALUES
    ('MILK', '/catalogue/rik/category/milk.png')  -- Milk
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
  milk_ref   text;
  stray      integer;
BEGIN
  SELECT count(*) INTO pool_total FROM rik.entitlement_pools;
  IF pool_total <> 18 THEN
    RAISE EXCEPTION 'Migration 0035: expected 18 entitlement pools, found %.', pool_total;
  END IF;

  SELECT count(image_ref) INTO with_image FROM rik.entitlement_pools;
  IF with_image <> 1 THEN
    RAISE EXCEPTION 'Migration 0035: expected exactly 1 category picture, found %.', with_image;
  END IF;

  SELECT image_ref INTO milk_ref FROM rik.entitlement_pools WHERE code = 'MILK';
  IF milk_ref IS DISTINCT FROM '/catalogue/rik/category/milk.png' THEN
    RAISE EXCEPTION 'Migration 0035: the Milk pool picture is %, not the expected path.', milk_ref;
  END IF;

  -- The other seventeen must still be without one. This is deliberate.
  SELECT count(*) INTO stray FROM rik.entitlement_pools
   WHERE code <> 'MILK' AND image_ref IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Migration 0035: % pool(s) other than Milk were given a picture.', stray;
  END IF;

  -- The provision catalogue is not this migration's business.
  SELECT count(image_ref) INTO stray FROM rik.provisions;
  IF stray <> 173 THEN
    RAISE EXCEPTION 'Migration 0035: provision pictures changed — % found, expected 173.', stray;
  END IF;
END;
$$;

RESET ROLE;
