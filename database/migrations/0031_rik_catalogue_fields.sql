-- =============================================================================
-- Migration 0031: the catalogue fields a RIK provision was missing —
-- brand, image and the pack's container unit.
--
-- Phase 3B STEP 12A.
--
-- WHY COLUMNS AND NOT A NEW VARIANT TABLE
-- ---------------------------------------
-- The obvious design is a provision (Paneer) with child variants
-- (Amul 200 g, Brand X 200 g). It was rejected, deliberately.
--
-- `rik.provisions` ALREADY is the variant. Each row carries its own
-- consumption ratio, pack size, unit, limits, issue period, dietary
-- applicability and active/selectable flags — everything a variant
-- needs — and every other part of the system addresses a provision by
-- id: `rik.entitlement_selection_items.provision_id`, the rule snapshot
-- a confirmed selection stores, and the whole STEP 11B engine. Moving
-- the selectable unit down a level to a new table would mean rewriting
-- the entitlement engine, the selection model and the historical
-- snapshot format — which STEP 12A is explicitly forbidden to touch,
-- and which would put every confirmed record at risk for no gain.
--
-- What was genuinely missing is narrower: a provision could not say
-- WHOSE it is (brand), what it LOOKS like (image), or what the pack is
-- CALLED (tin, packet, box). Three columns fix that.
--
-- The grouping in the specification —
--
--     Paneer
--       ├── Amul  — 200 g
--       ├── Brand X — 200 g
--       └── Brand Y — 500 g
--
-- is then three rows sharing a name and differing by brand and pack
-- size, each individually identifiable by its own id and code, each
-- individually selectable, activatable and limitable. The tree is a
-- presentation of (pool, name); it is not a second storage level.
--
-- WHAT IS NOT TOUCHED, AND WHY IT MATTERS
-- ---------------------------------------
-- `rik.provisions.unit` is the ENTITLEMENT unit. The engine multiplies
-- quantities in it by `consumption_ratio` to spend a pool measured in
-- the same unit, so it is arithmetic, not description. It keeps its
-- existing CHECK of ('g','ml','piece') and is not altered here.
--
-- The new `pack_unit` is PRESENTATION ONLY: the noun for the container
-- a customer receives ("a 500 g tin", "a 1 kg packet"). Nothing reads
-- it but a screen. That separation is the only way to offer the units
-- the specification lists — kg, litre, packet, tin, box — without
-- changing a single calculation.
--
-- No existing column, constraint, index, trigger or grant is altered
-- or dropped. No table is added, so the schema contract's table count
-- is unchanged at 56.
-- =============================================================================

SET ROLE esamagri_owner;

ALTER TABLE rik.provisions
  ADD COLUMN brand      text,
  ADD COLUMN image_ref  text,
  ADD COLUMN pack_unit  text;

-- A brand is a name, not an empty string. NULL means "no brand
-- recorded", which is the honest state for loose produce and for the
-- many provisions whose brand the facility has not supplied.
ALTER TABLE rik.provisions
  ADD CONSTRAINT rik_provisions_brand_chk
    CHECK (brand IS NULL OR btrim(brand) <> '');

ALTER TABLE rik.provisions
  ADD CONSTRAINT rik_provisions_image_ref_chk
    CHECK (image_ref IS NULL OR btrim(image_ref) <> '');

-- Exactly the units the specification names. Deliberately a closed set:
-- a free-text pack unit would drift into "pkt", "Packet", "packets"
-- across a catalogue that several people maintain.
ALTER TABLE rik.provisions
  ADD CONSTRAINT rik_provisions_pack_unit_chk
    CHECK (pack_unit IS NULL OR pack_unit IN ('g','kg','ml','litre','piece','packet','tin','box'));

-- Brand filtering and the (pool, name) grouping the catalogue screens
-- and the customer category screen both read.
CREATE INDEX rik_provisions_brand_idx ON rik.provisions (brand) WHERE brand IS NOT NULL;
CREATE INDEX rik_provisions_pool_name_idx ON rik.provisions (pool_id, name);

COMMENT ON COLUMN rik.provisions.brand IS
  'Who makes it — Amul, Tata, Everest. Separate from the name so one provision can be stocked from several brands without duplicating the item. NULL where no brand applies or none was supplied. STEP 12A.';
COMMENT ON COLUMN rik.provisions.image_ref IS
  'Reference to a catalogue image. Presentation only: it can never affect entitlement, conversion, quantity, eligibility or dietary rules. NULL until the facility supplies one, and the customer app shows a placeholder. STEP 12A.';
COMMENT ON COLUMN rik.provisions.pack_unit IS
  'What the pack is CALLED (tin, packet, box, kg). Presentation only, and deliberately NOT rik.provisions.unit, which is the entitlement unit the engine calculates in. STEP 12A.';

RESET ROLE;
