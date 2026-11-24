-- =============================================================================
-- Migration 0029: RIK selection fulfillment — pickup locations, the
-- availability acknowledgement, and the fulfillment a confirmation carries.
--
-- Phase 3B STEP 11E.
--
-- WHY THIS SHAPE, AND WHAT WAS DELIBERATELY NOT DONE
-- --------------------------------------------------
-- `rik.orders` already exists from Phase 2, with a `fulfillment_type`
-- column and a full PICKUP/DELIVERY status lifecycle (READY,
-- OUT_FOR_DELIVERY, COLLECTED, DELIVERED, NOT_COLLECTED) policed by a
-- transition trigger. It was tempting to create an order row at
-- confirmation and be done.
--
-- That was rejected, for two reasons.
--
--   1. It is the wrong thing being confirmed. What the customer
--      confirms is their SELECTION — the provisions drawn against an
--      entitlement. `rik.orders` describes what the facility then does
--      about it: prepares it, hands it over, records that it was
--      collected. Those are later steps, explicitly out of scope here
--      ("do not implement RIK issue staff workflow / pickup workflow"),
--      and creating half an order now would prejudge them.
--
--   2. `rik.orders` has nowhere to put this information either. It has
--      no pickup location, no delivery address and no link to a
--      selection. Adopting it would still have meant new columns, plus
--      a lifecycle nobody is ready to drive.
--
-- So fulfillment is recorded on the selection that carries it, as
-- additive columns on the table that already holds the confirmation and
-- its rule snapshot. No table is duplicated; when the order workflow
-- lands, it can read these columns rather than re-ask the customer.
--
-- ONE NEW TABLE: rik.pickup_locations. `shared.settings` (a key/value
-- JSONB store) was considered and rejected — it is the SUPER_ADMIN
-- settings surface, gated by `shared.settings.write`, and putting a RIK
-- catalogue there would hand RIK configuration to the wrong role and
-- give up per-row history. The new table instead follows the SAME shape
-- every other RIK configuration table already uses (code, name,
-- is_active, effective window, created_by/updated_by), so the STEP 11C
-- administration architecture picks it up without a new framework.
--
-- THE SNAPSHOT RULE, ENFORCED RATHER THAN DOCUMENTED
-- --------------------------------------------------
-- A confirmed selection records the pickup location's NAME as text, not
-- only its id, and the delivery address as text, never a reference to
-- `shared.customer_addresses`. Renaming a location or moving house must
-- not rewrite what a customer agreed to last month. The id is kept
-- alongside for reporting, but the text is the record.
--
-- The CHECK constraints below make the invariants impossible to violate
-- from anywhere — application, admin, or a hand-written UPDATE:
--   * a CONFIRMED selection must name a fulfillment type,
--   * PICKUP must carry a location name, and must not carry an address,
--   * DELIVERY must carry a non-blank address, and must not carry a
--     location,
--   * a CONFIRMED selection must record that the customer acknowledged
--     the availability warning.
--
-- Nothing in this migration drops, alters or weakens an existing
-- column, constraint, trigger or grant.
-- =============================================================================

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- rik.pickup_locations
--
-- Where a customer may collect a RIK issue. Business configuration: the
-- facility maintains it from the RIK administration dashboard, and no
-- developer or SQL access is needed to add, rename or retire one.
--
-- Retired rather than deleted, like every other RIK configuration
-- table, because a confirmed selection refers to one. The name is also
-- snapshotted onto the selection, so history survives even a delete
-- that somehow got through.
-- ---------------------------------------------------------------------------
CREATE TABLE rik.pickup_locations (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  code            text        NOT NULL,
  name            text        NOT NULL,
  description     text,
  display_order   integer     NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  effective_from  date        NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  CONSTRAINT rik_pickup_locations_pk PRIMARY KEY (id),
  CONSTRAINT rik_pickup_locations_code_uq UNIQUE (code),
  CONSTRAINT rik_pickup_locations_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT rik_pickup_locations_effective_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX rik_pickup_locations_active_idx
  ON rik.pickup_locations (is_active, display_order);

COMMENT ON TABLE rik.pickup_locations IS
  'Collection points a customer may choose for a RIK issue. Client-managed business configuration (STEP 11E); retired, never deleted.';
COMMENT ON COLUMN rik.pickup_locations.code IS
  'Stable machine key. The NAME is what the customer sees and what a confirmed selection snapshots.';

-- The two locations the facility operates today. Names are exactly as
-- the facility uses them, and are editable from the admin dashboard.
INSERT INTO rik.pickup_locations (code, name, display_order, effective_from)
VALUES
  ('NAVAL_PARK',   'Naval Park',   1, DATE '2026-01-01'),
  ('DOLPHIN_HILL', 'Dolphin Hill', 2, DATE '2026-01-01');

-- ---------------------------------------------------------------------------
-- Confirmation reference number
--
-- A confirmed selection needs something a customer can quote at the
-- counter. A UUID is not that. The sequence gives a short, ordered,
-- collision-free number; the format is assembled in SQL so it is the
-- same whoever writes the row.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE rik.selection_reference_seq START WITH 1000 INCREMENT BY 1;

COMMENT ON SEQUENCE rik.selection_reference_seq IS
  'Feeds the human-quotable reference on a confirmed RIK selection. STEP 11E.';

-- ---------------------------------------------------------------------------
-- Fulfillment, acknowledgement and reference on the selection itself
-- ---------------------------------------------------------------------------
ALTER TABLE rik.entitlement_selections
  ADD COLUMN reference_number            text,
  ADD COLUMN fulfillment_type            text,
  ADD COLUMN pickup_location_id          uuid,
  ADD COLUMN pickup_location_name        text,
  ADD COLUMN delivery_address            text,
  ADD COLUMN availability_acknowledged   boolean NOT NULL DEFAULT false,
  ADD COLUMN availability_acknowledged_at timestamptz;

ALTER TABLE rik.entitlement_selections
  ADD CONSTRAINT rik_entitlement_selections_reference_uq UNIQUE (reference_number);

ALTER TABLE rik.entitlement_selections
  ADD CONSTRAINT rik_entitlement_selections_pickup_location_fk
    FOREIGN KEY (pickup_location_id) REFERENCES rik.pickup_locations (id);

ALTER TABLE rik.entitlement_selections
  ADD CONSTRAINT rik_entitlement_selections_fulfillment_chk
    CHECK (fulfillment_type IS NULL OR fulfillment_type IN ('PICKUP', 'DELIVERY'));

-- A confirmed selection is a complete record or it is not confirmed.
ALTER TABLE rik.entitlement_selections
  ADD CONSTRAINT rik_entitlement_selections_confirmed_fulfillment_chk
    CHECK (
      status <> 'CONFIRMED'
      OR (
        fulfillment_type IS NOT NULL
        AND reference_number IS NOT NULL
        AND availability_acknowledged
        AND availability_acknowledged_at IS NOT NULL
      )
    );

-- PICKUP names a place and no address; DELIVERY carries an address and
-- no place. Neither can be half-recorded.
ALTER TABLE rik.entitlement_selections
  ADD CONSTRAINT rik_entitlement_selections_pickup_shape_chk
    CHECK (
      fulfillment_type IS DISTINCT FROM 'PICKUP'
      OR (
        pickup_location_name IS NOT NULL
        AND btrim(pickup_location_name) <> ''
        AND delivery_address IS NULL
      )
    );

ALTER TABLE rik.entitlement_selections
  ADD CONSTRAINT rik_entitlement_selections_delivery_shape_chk
    CHECK (
      fulfillment_type IS DISTINCT FROM 'DELIVERY'
      OR (
        delivery_address IS NOT NULL
        AND btrim(delivery_address) <> ''
        AND pickup_location_id IS NULL
        AND pickup_location_name IS NULL
      )
    );

COMMENT ON COLUMN rik.entitlement_selections.pickup_location_name IS
  'The location name AS IT WAS at confirmation. Snapshot, not a lookup: renaming a pickup point must not rewrite an issue already agreed.';
COMMENT ON COLUMN rik.entitlement_selections.delivery_address IS
  'The address exactly as the customer typed it at confirmation. Never a reference to shared.customer_addresses, which they may change afterwards.';
COMMENT ON COLUMN rik.entitlement_selections.availability_acknowledged IS
  'The customer explicitly acknowledged that provisions are subject to availability on the issue date. Required before CONFIRMED.';
COMMENT ON COLUMN rik.entitlement_selections.reference_number IS
  'Human-quotable confirmation reference, assigned once at confirmation from rik.selection_reference_seq.';

-- ---------------------------------------------------------------------------
-- Immutability of a confirmed fulfillment
--
-- Migration 0027 already refuses to DELETE a confirmed selection. This
-- refuses to REWRITE one. Together they say: once confirmed, the record
-- of what was agreed is fixed — for the application, the owner and a
-- superuser alike.
--
-- Cancellation is deliberately still permitted (status CONFIRMED →
-- CANCELLED with cancelled_at), because that is an existing, defined
-- transition in the status model and STEP 11E was told not to remove
-- behaviour. What cannot change is the substance: the snapshot, the
-- fulfillment, the acknowledgement, the reference, the basis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_protect_confirmed_selection_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'CONFIRMED' THEN
    RETURN NEW;
  END IF;

  IF NEW.rule_snapshot IS DISTINCT FROM OLD.rule_snapshot
     OR NEW.snapshot_taken_at   IS DISTINCT FROM OLD.snapshot_taken_at
     OR NEW.confirmed_at        IS DISTINCT FROM OLD.confirmed_at
     OR NEW.reference_number    IS DISTINCT FROM OLD.reference_number
     OR NEW.fulfillment_type    IS DISTINCT FROM OLD.fulfillment_type
     OR NEW.pickup_location_id  IS DISTINCT FROM OLD.pickup_location_id
     OR NEW.pickup_location_name IS DISTINCT FROM OLD.pickup_location_name
     OR NEW.delivery_address    IS DISTINCT FROM OLD.delivery_address
     OR NEW.availability_acknowledged IS DISTINCT FROM OLD.availability_acknowledged
     OR NEW.availability_acknowledged_at IS DISTINCT FROM OLD.availability_acknowledged_at
     OR NEW.dietary_preference  IS DISTINCT FROM OLD.dietary_preference
     OR NEW.eligible_days       IS DISTINCT FROM OLD.eligible_days
     OR NEW.customer_id         IS DISTINCT FROM OLD.customer_id
     OR NEW.period_id           IS DISTINCT FROM OLD.period_id
  THEN
    RAISE EXCEPTION
      'A confirmed RIK selection (%) cannot be altered. Its rule snapshot, basis and fulfillment are the historical record.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_protect_confirmed_selection_record() IS
  'Refuses any change to the substance of a CONFIRMED rik.entitlement_selections row. Binds every role including the owner. STEP 11E.';

CREATE TRIGGER protect_confirmed_selection_record
  BEFORE UPDATE ON rik.entitlement_selections
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_confirmed_selection_record();

-- A confirmed selection's LINES are equally historical. The items and
-- elections tables have no status of their own, so the check is against
-- the parent's.
CREATE OR REPLACE FUNCTION rik.trg_protect_confirmed_selection_children()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_id uuid;
  parent_status text;
BEGIN
  parent_id := COALESCE(NEW.selection_id, OLD.selection_id);
  SELECT status INTO parent_status
    FROM rik.entitlement_selections WHERE id = parent_id;

  IF parent_status = 'CONFIRMED' THEN
    RAISE EXCEPTION
      'The lines of a confirmed RIK selection (%) cannot be changed.', parent_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION rik.trg_protect_confirmed_selection_children() IS
  'Refuses insert/update/delete on the lines or elections of a CONFIRMED selection. STEP 11E.';

CREATE TRIGGER protect_confirmed_items
  BEFORE INSERT OR UPDATE OR DELETE ON rik.entitlement_selection_items
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_confirmed_selection_children();

CREATE TRIGGER protect_confirmed_elections
  BEFORE INSERT OR UPDATE OR DELETE ON rik.entitlement_elections
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_confirmed_selection_children();

-- ---------------------------------------------------------------------------
-- Grants
--
-- ALTER DEFAULT PRIVILEGES (migration 0018) already gave app_rik
-- SELECT/INSERT/UPDATE/DELETE and app_reporting_rik SELECT on new rik
-- tables. Narrow DELETE back on the new configuration table, exactly as
-- migrations 0025 and 0028 did: configuration that has been used is
-- retired, never removed.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON rik.pickup_locations FROM app_rik;

GRANT USAGE, SELECT ON SEQUENCE rik.selection_reference_seq TO app_rik;

RESET ROLE;
