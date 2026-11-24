-- ---------------------------------------------------------------------------
-- 0048_rik_issue_vouchers.sql
--
-- PHASE D — the RIK Issue Voucher: the operational document that turns a
-- confirmed monthly selection into something the yard can issue against.
--
-- WHAT A VOUCHER IS, AND WHAT IT IS NOT
--
-- It is an OPERATIONAL STATUS ENVELOPE. It is not a second copy of the
-- ration. The confirmed selection already holds the authoritative contents in
-- `rule_snapshot` — the basis, the configuration, the chosen items and the
-- elected conversions, all frozen at confirmation — so the voucher references
-- the selection and derives its contents from that snapshot. There is
-- deliberately NO voucher line-item table: a second copy of the ration would
-- be a second truth to keep in step, and the first one is already immutable.
--
-- It does NOT consume entitlement. Creating a voucher writes one row in this
-- table and nothing else: no eligible day moves, no ledger row appears, no
-- collection or delivery is recorded. Physical consumption belongs to the
-- fulfilment phase. This file enforces that with privilege as well as
-- intent — see section 7.
--
-- THE SHAPE OF THE MODEL, AS LOCKED
--
--   one confirmed monthly selection  ->  at most ONE Fresh voucher
--                                    ->  at most ONE Dry voucher
--
-- A Fresh voucher is NOT split per issue window. The same voucher, with the
-- same number, carries from Fresh Window 1 into Window 2 and into Window 3.
-- That is why this table holds NO issue-window column: pinning a window here
-- would contradict it, and would also freeze a voucher to a schedule that a
-- RIK administrator may still change (Phase C allows exactly that, and audits
-- it in rik.issue_window_revisions). The CURRENT window is resolved when the
-- voucher is read, from the configured schedule for its period and ration
-- type, so a voucher always follows the schedule in force.
--
-- WHY `UNIQUE (selection_id, ration_type)` AND NOT "one ACTIVE voucher"
--
-- The locked model allows a maximum of one Fresh and one Dry voucher per
-- confirmed selection — not one at a time, one in total. A plain unique
-- constraint is therefore both simpler and stricter than a partial index over
-- some notion of "active", and it is what makes creation idempotent: a
-- repeated request cannot insert a second row, and the application returns
-- the existing voucher. Should a later phase ever need a reissue, it adds a
-- supersede column and narrows this to a partial index then — deliberately
-- not now, because nothing in the approved model asks for a reissue.
--
-- STATUS VALUES ARE THE LOCKED LIFECYCLE, NOTHING INVENTED
--
--   PICKUP    READY_FOR_PICKUP -> COLLECTED | NOT_COLLECTED
--   DELIVERY  READY_FOR_DELIVERY -> OUT_FOR_DELIVERY -> DELIVERED | NOT_DELIVERED
--
-- All seven are declared now so the fulfilment phase needs no migration to
-- alter a CHECK, but Phase D only ever writes the two READY_* entry states:
-- it holds no UPDATE privilege on this table at all, so it cannot move a
-- voucher along that lifecycle even by mistake.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * no collection, delivery, substitution or correction behaviour. No
--     column, status, trigger or route here performs one;
--   * no Dry carry-forward. It does not exist in this database — there is no
--     previous-month Dry entitlement, no remaining-days mechanism and no
--     lapse rule anywhere in migrations 0001-0047 — so nothing here invents
--     one. The voucher reports its Dry entitlement as a LIST of source
--     components so that a second component can be added by the phase that
--     defines it, without reshaping anything; today that list always holds
--     exactly one entry, the voucher's own period. See the Phase D report;
--   * it does not touch the entitlement engine, a confirmed selection, a
--     rule snapshot, an eligible-day figure, the catalogue, or anything in
--     pif. All four configuration counts are verified unchanged.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. Voucher numbers
--
-- A FOURTH identifier namespace, unmistakable from the other three:
--   RIK-O-######      an officer                  (0044)
--   RIK-######        a confirmed selection       (0029)
--   ELIG-YYYY-######  an eligibility import batch (0045)
--   IV-YYYY-######    an issue voucher            (this file)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S' AND n.nspname = 'rik' AND c.relname = 'issue_voucher_seq'
  ) THEN
    CREATE SEQUENCE rik.issue_voucher_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
  END IF;
END;
$$;

-- Six digits minimum, WIDENING beyond six. The same lesson as 0044 and 0045:
-- to_char(n, 'FM000000') is fixed width and overflows to '######' at a
-- million, and lpad() TRUNCATES, which would silently collide with a voucher
-- that already exists.
CREATE OR REPLACE FUNCTION rik.format_issue_voucher_number(n bigint, yr integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'IV-' || yr::text || '-' ||
         CASE WHEN n < 1000000 THEN lpad(n::text, 6, '0') ELSE n::text END;
$$;

COMMENT ON FUNCTION rik.format_issue_voucher_number(bigint, integer) IS
  'PHASE D: renders an issue voucher number as IV-YYYY-###### — six digits minimum, widening rather than overflowing or truncating.';

-- ---------------------------------------------------------------------------
-- 2. The voucher
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.issue_vouchers (
  id                   uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  voucher_number       text        NOT NULL,
  /** The confirmed selection this voucher issues against. */
  selection_id         uuid        NOT NULL,
  customer_id          uuid        NOT NULL,
  period_id            uuid        NOT NULL,
  ration_type          text        NOT NULL,
  fulfillment_mode     text        NOT NULL,
  /**
   * The fulfilment SNAPSHOT, copied from the selection at creation and never
   * updated. An officer who later edits their saved address does not rewrite
   * a voucher that was already issued to the old one.
   */
  pickup_location_id   uuid,
  pickup_location_name text,
  delivery_address     text,
  status               text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  /** Phase D creates a voucher released; both are set at INSERT. */
  released_at          timestamptz NOT NULL DEFAULT now(),
  released_by          uuid        NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_issue_vouchers_pk PRIMARY KEY (id),
  CONSTRAINT rik_issue_vouchers_number_uq UNIQUE (voucher_number),
  -- The locked maximum: one Fresh and one Dry per confirmed selection.
  CONSTRAINT rik_issue_vouchers_one_per_type_uq UNIQUE (selection_id, ration_type),
  CONSTRAINT rik_issue_vouchers_selection_fk FOREIGN KEY (selection_id)
    REFERENCES rik.entitlement_selections (id),
  CONSTRAINT rik_issue_vouchers_period_fk FOREIGN KEY (period_id)
    REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_issue_vouchers_pickup_location_fk FOREIGN KEY (pickup_location_id)
    REFERENCES rik.pickup_locations (id),
  CONSTRAINT rik_issue_vouchers_created_by_fk FOREIGN KEY (created_by) REFERENCES shared.users (id),
  CONSTRAINT rik_issue_vouchers_released_by_fk FOREIGN KEY (released_by) REFERENCES shared.users (id),
  CONSTRAINT rik_issue_vouchers_number_chk CHECK (voucher_number ~ '^IV-[0-9]{4}-[0-9]{6,}$'),
  CONSTRAINT rik_issue_vouchers_ration_type_chk CHECK (ration_type IN ('FRESH', 'DRY')),
  CONSTRAINT rik_issue_vouchers_fulfillment_chk CHECK (fulfillment_mode IN ('PICKUP', 'DELIVERY')),
  CONSTRAINT rik_issue_vouchers_status_chk CHECK (
    status IN (
      'READY_FOR_PICKUP', 'COLLECTED', 'NOT_COLLECTED',
      'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED'
    )
  ),
  -- A status belongs to its fulfilment lane. A delivered pickup voucher, or a
  -- collected delivery, is not a state this workflow has.
  CONSTRAINT rik_issue_vouchers_status_lane_chk CHECK (
    (fulfillment_mode = 'PICKUP'
       AND status IN ('READY_FOR_PICKUP', 'COLLECTED', 'NOT_COLLECTED'))
    OR (fulfillment_mode = 'DELIVERY'
       AND status IN ('READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED'))
  ),
  -- The same fulfilment shape the confirmed selection itself carries (0029).
  CONSTRAINT rik_issue_vouchers_pickup_shape_chk CHECK (
    fulfillment_mode <> 'PICKUP'
    OR (pickup_location_name IS NOT NULL AND btrim(pickup_location_name) <> ''
        AND delivery_address IS NULL)
  ),
  CONSTRAINT rik_issue_vouchers_delivery_shape_chk CHECK (
    fulfillment_mode <> 'DELIVERY'
    OR (delivery_address IS NOT NULL AND btrim(delivery_address) <> ''
        AND pickup_location_id IS NULL AND pickup_location_name IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS rik_issue_vouchers_customer_idx
  ON rik.issue_vouchers (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rik_issue_vouchers_selection_idx
  ON rik.issue_vouchers (selection_id);
CREATE INDEX IF NOT EXISTS rik_issue_vouchers_period_idx
  ON rik.issue_vouchers (period_id, ration_type);
CREATE INDEX IF NOT EXISTS rik_issue_vouchers_status_idx
  ON rik.issue_vouchers (status);

-- The project's existing guard that a customer id names a live customer.
DROP TRIGGER IF EXISTS validate_customer_ref ON rik.issue_vouchers;
CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE ON rik.issue_vouchers
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

-- ---------------------------------------------------------------------------
-- 3. A voucher may only issue against a CONFIRMED selection, and must agree
--    with it
--
-- The application refuses a draft selection with a sentence an administrator
-- can act on. This is the boundary that cannot be talked past: it re-reads the
-- selection and refuses a voucher whose officer, period, fulfilment mode or
-- fulfilment snapshot does not match the confirmation it claims to issue
-- against. A voucher that disagreed with its own selection would be an
-- operational document for a ration nobody confirmed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_voucher_matches_selection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sel record;
BEGIN
  SELECT status, customer_id, period_id, fulfillment_type,
         pickup_location_id, pickup_location_name, delivery_address, rule_snapshot
    INTO sel
    FROM rik.entitlement_selections
   WHERE id = NEW.selection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Issue voucher names a selection that does not exist (%).', NEW.selection_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF sel.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION
      'Issue voucher % cannot be created: selection % is %, not CONFIRMED. Only a confirmed selection can be issued against.',
      NEW.voucher_number, NEW.selection_id, sel.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF sel.rule_snapshot IS NULL THEN
    RAISE EXCEPTION
      'Issue voucher % cannot be created: selection % carries no rule snapshot, so the ration to issue is not established.',
      NEW.voucher_number, NEW.selection_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.customer_id <> sel.customer_id OR NEW.period_id <> sel.period_id THEN
    RAISE EXCEPTION
      'Issue voucher % names a different officer or period than selection % does.',
      NEW.voucher_number, NEW.selection_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.fulfillment_mode <> sel.fulfillment_type THEN
    RAISE EXCEPTION
      'Issue voucher % says % but selection % was confirmed for %. The confirmed fulfilment decides.',
      NEW.voucher_number, NEW.fulfillment_mode, NEW.selection_id, sel.fulfillment_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- The snapshot must be the selection's own, not today's saved address.
  IF NEW.fulfillment_mode = 'PICKUP' THEN
    IF NEW.pickup_location_name IS DISTINCT FROM sel.pickup_location_name
       OR NEW.pickup_location_id IS DISTINCT FROM sel.pickup_location_id THEN
      RAISE EXCEPTION
        'Issue voucher % carries a different pickup location than selection % was confirmed with.',
        NEW.voucher_number, NEW.selection_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.delivery_address IS DISTINCT FROM sel.delivery_address THEN
      RAISE EXCEPTION
        'Issue voucher % carries a different delivery address than selection % was confirmed with.',
        NEW.voucher_number, NEW.selection_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_voucher_matches_selection ON rik.issue_vouchers;
CREATE TRIGGER issue_voucher_matches_selection
  BEFORE INSERT ON rik.issue_vouchers
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_voucher_matches_selection();

-- ---------------------------------------------------------------------------
-- 4. The identity and the snapshot are permanent
--
-- Scoped to the columns that must never move. `status`, `updated_at` and the
-- release stamps are left alone so the fulfilment phase can advance a voucher
-- through its lifecycle without this trigger being rewritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_voucher_identity_permanent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.voucher_number   IS DISTINCT FROM OLD.voucher_number
     OR NEW.selection_id  IS DISTINCT FROM OLD.selection_id
     OR NEW.customer_id   IS DISTINCT FROM OLD.customer_id
     OR NEW.period_id     IS DISTINCT FROM OLD.period_id
     OR NEW.ration_type   IS DISTINCT FROM OLD.ration_type
     OR NEW.fulfillment_mode     IS DISTINCT FROM OLD.fulfillment_mode
     OR NEW.pickup_location_id   IS DISTINCT FROM OLD.pickup_location_id
     OR NEW.pickup_location_name IS DISTINCT FROM OLD.pickup_location_name
     OR NEW.delivery_address     IS DISTINCT FROM OLD.delivery_address
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at
     OR NEW.created_by    IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION
      'An issue voucher''s identity and fulfilment snapshot are permanent. Voucher % cannot be rewritten; its status may change, nothing else.',
      OLD.voucher_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_voucher_identity_permanent ON rik.issue_vouchers;
CREATE TRIGGER issue_voucher_identity_permanent
  BEFORE UPDATE ON rik.issue_vouchers
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_voucher_identity_permanent();

-- ---------------------------------------------------------------------------
-- 5. A voucher is never deleted
--
-- The same policy the confirmed selection (0027), the configuration (0028),
-- the eligibility ledger (0045) and the issue windows (0047) carry. A voucher
-- is the operational record of what the yard was asked to issue; a correction
-- is a further recorded act, never a disappearance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_voucher_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Issue voucher % cannot be deleted. A voucher is an operational record; correct it with a recorded correction instead.',
    OLD.voucher_number
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS issue_voucher_no_delete ON rik.issue_vouchers;
CREATE TRIGGER issue_voucher_no_delete
  BEFORE DELETE ON rik.issue_vouchers
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_voucher_no_delete();

-- ---------------------------------------------------------------------------
-- 6. The confirmed selection stays deletable only as it already was
--
-- Nothing here loosens 0027. The new foreign key means a confirmed selection
-- that carries a voucher cannot be removed at all, which is the correct
-- direction of travel: the operational document outlives the request.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. Grants — and the privilege that makes "no consumption" structural
--
-- Migration 0018's ALTER DEFAULT PRIVILEGES grants app_rik all four verbs on
-- every new rik table, so narrowing is an explicit REVOKE (the correction
-- 0023 made, and 0045/0046/0047 after it).
--
-- app_rik gets SELECT and INSERT and NOTHING ELSE. Phase D creates vouchers;
-- it cannot advance one through its lifecycle, cannot mark a ration collected
-- or delivered, and cannot rewrite a snapshot — not by policy, by privilege.
-- The fulfilment phase grants UPDATE when it implements the transitions, and
-- the immutability trigger above is already waiting for it.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON rik.issue_vouchers TO app_rik;
REVOKE UPDATE, DELETE ON rik.issue_vouchers FROM app_rik;
GRANT SELECT ON rik.issue_vouchers TO app_reporting_rik;
GRANT USAGE, SELECT ON SEQUENCE rik.issue_voucher_seq TO app_rik;

COMMENT ON TABLE rik.issue_vouchers IS
  'PHASE D: the operational issue voucher. An envelope over a confirmed selection — at most one Fresh and one Dry per selection — whose contents come from that selection''s rule snapshot. Holds no issue window: a Fresh voucher spans Windows 1-3 and follows the configured schedule.';

-- ---------------------------------------------------------------------------
-- 8. Verification — fail loudly rather than leave a half-applied change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pools  integer;
  scales integer;
  convs  integer;
  provs  integer;
  tabs   integer;
  vws    integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'issue_vouchers') THEN
    RAISE EXCEPTION 'Migration 0048: rik.issue_vouchers was not created.';
  END IF;

  -- The number widens past six digits and never overflows.
  IF rik.format_issue_voucher_number(1, 2026)       <> 'IV-2026-000001'  THEN
    RAISE EXCEPTION 'Migration 0048: voucher number for 1 is %.', rik.format_issue_voucher_number(1, 2026);
  END IF;
  IF rik.format_issue_voucher_number(999999, 2026)  <> 'IV-2026-999999'  THEN
    RAISE EXCEPTION 'Migration 0048: voucher number for 999999 is %.', rik.format_issue_voucher_number(999999, 2026);
  END IF;
  IF rik.format_issue_voucher_number(1000000, 2026) <> 'IV-2026-1000000' THEN
    RAISE EXCEPTION 'Migration 0048: the voucher number does not widen past six digits — %.',
      rik.format_issue_voucher_number(1000000, 2026);
  END IF;

  -- The duplicate protection is a database constraint, not a check in code.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.issue_vouchers'::regclass
       AND conname = 'rik_issue_vouchers_one_per_type_uq' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Migration 0048: the one-voucher-per-selection-and-ration-type constraint is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.issue_vouchers'::regclass
       AND conname = 'rik_issue_vouchers_number_uq' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Migration 0048: the voucher number unique constraint is missing.';
  END IF;

  -- The three guards.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_vouchers'::regclass
                   AND tgname = 'issue_voucher_matches_selection' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0048: the confirmed-selection guard is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_vouchers'::regclass
                   AND tgname = 'issue_voucher_identity_permanent' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0048: the identity-permanence guard is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_vouchers'::regclass
                   AND tgname = 'issue_voucher_no_delete' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0048: the no-delete guard is missing.';
  END IF;

  -- The table carries NO issue-window column: a Fresh voucher spans windows.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rik' AND table_name = 'issue_vouchers'
       AND column_name IN ('issue_window_id', 'window_id', 'window_code')
  ) THEN
    RAISE EXCEPTION
      'Migration 0048: rik.issue_vouchers has an issue-window column; a Fresh voucher must span Windows 1-3 and follow the configured schedule.';
  END IF;

  -- Phase D cannot move a voucher's status: it holds no UPDATE at all.
  IF has_table_privilege('app_rik', 'rik.issue_vouchers', 'UPDATE')
     OR has_table_privilege('app_rik', 'rik.issue_vouchers', 'DELETE') THEN
    RAISE EXCEPTION
      'Migration 0048: app_rik still holds UPDATE or DELETE on rik.issue_vouchers — voucher creation could then consume or complete.';
  END IF;
  IF NOT has_table_privilege('app_rik', 'rik.issue_vouchers', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.issue_vouchers', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 0048: app_rik is missing a privilege the voucher path needs.';
  END IF;

  -- No new role, no new permission, and no PURCHASING.
  IF (SELECT count(*) FROM shared.roles) <> 6
     OR (SELECT count(*) FROM shared.permissions) <> 20 THEN
    RAISE EXCEPTION 'Migration 0048: the role or permission count moved; Phase D introduces neither.';
  END IF;
  IF EXISTS (SELECT 1 FROM shared.roles WHERE name ILIKE '%PURCHAS%') THEN
    RAISE EXCEPTION 'Migration 0048: a PURCHASING role exists.';
  END IF;

  -- Nothing in the entitlement configuration moved.
  SELECT count(*) INTO pools  FROM rik.entitlement_pools;
  SELECT count(*) INTO scales FROM rik.pool_scales;
  SELECT count(*) INTO convs  FROM rik.pool_conversions;
  SELECT count(*) INTO provs  FROM rik.provisions;
  IF pools <> 18 OR scales <> 50 OR convs <> 7 OR provs <> 189 THEN
    RAISE EXCEPTION
      'Migration 0048: RIK configuration changed — pools %, scales %, conversions %, provisions %; expected 18/50/7/189.',
      pools, scales, convs, provs;
  END IF;

  -- One table added, no view added.
  SELECT count(*) INTO tabs FROM pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO vws  FROM pg_views  WHERE schemaname IN ('shared', 'rik', 'pif');
  IF tabs <> 62 OR vws <> 5 THEN
    RAISE EXCEPTION 'Migration 0048: expected 62 tables and 5 views, found % and %.', tabs, vws;
  END IF;
END;
$$;

RESET ROLE;
