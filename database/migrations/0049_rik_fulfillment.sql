-- ---------------------------------------------------------------------------
-- 0049_rik_fulfillment.sql
--
-- PHASE E — physical fulfilment: what was actually handed over, when, by
-- whom, and what that consumed.
--
-- THE GAP THIS CLOSES. Through Phase D nothing in this database recorded that
-- ration was physically issued, or that it was not. A voucher's status could
-- not move at all: the application holds SELECT and INSERT on
-- rik.issue_vouchers and nothing else (0048 section 7). "Has this officer
-- collected?" was therefore unanswerable, and both open items — the final
-- Fresh lapse and the previous-month Dry carry-forward — depend on exactly
-- that answer. All three are closed here, from one new record.
--
-- THREE TABLES, AND WHY EACH IS NEEDED
--
--   rik.issue_voucher_outcomes      the fulfilment EVENT: collected, not
--                                   collected, out for delivery, delivered,
--                                   not delivered — and the controlled
--                                   reversal of one. Append-only.
--
--   rik.issue_voucher_issue_lines   WHAT was physically handed over against a
--                                   completing event: provision, quantity,
--                                   and — where a substitution happened — the
--                                   provision it replaced and why.
--
--   rik.dry_carry_forward           the previous month's unissued Dry balance,
--                                   frozen once, usable only in the next
--                                   month's Dry window, lapsing after it.
--
-- WHAT IS NOT HERE. No stock, no inventory quantity, no supplier, no
-- purchasing, no price. An issue line records what left the counter for one
-- officer, never what the yard holds.
--
-- THE CONFIRMED SELECTION IS NOT TOUCHED. Not by this migration and not by
-- anything it enables. The officer's selection and its rule_snapshot remain
-- the historical record; an issue line records what happened against it, and
-- 0027's protection triggers still refuse any attempt to rewrite it. A
-- substitution is a FULFILMENT fact, never an amendment of the selection.
--
-- STATUS IS A PROJECTION, NEVER A WRITE. The application still holds no
-- UPDATE on rik.issue_vouchers. A voucher's status moves only as the
-- consequence of an outcome row, applied by a SECURITY DEFINER trigger
-- function owned by esamagri_owner. So status and the outcome history can
-- never disagree, and no route, service or stray statement can move a status
-- without leaving the event that justifies it.
--
-- NO NEW STATUS IS INVENTED. The seven values 0048 locked are the seven used.
-- A lapse is NOT_COLLECTED (or NOT_DELIVERED) with reason WINDOW_CLOSED,
-- which is the truth — the ration was not taken — and is distinguishable from
-- a counter refusal by its reason and its SYSTEM actor.
--
-- NO NEW ROLE AND NO NEW PERMISSION. 0049 adds none, and the six roles and
-- twenty permissions are asserted below.
-- ---------------------------------------------------------------------------

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. The fulfilment event
--
-- ORDERED AND APPEND-ONLY. Every event for a voucher carries a sequence
-- number unique within that voucher, so two concurrent completions cannot
-- both land: the loser gets a unique violation rather than a second
-- collection. That is the concurrency guard, and it is in the database, not
-- in a service.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.issue_voucher_outcomes (
  id                uuid        PRIMARY KEY DEFAULT shared.uuid_generate_v7(),
  voucher_id        uuid        NOT NULL,
  voucher_number    text        NOT NULL,
  sequence_no       integer     NOT NULL,
  event_type        text        NOT NULL,
  outcome           text        NOT NULL,
  reason            text,
  -- The configured window open when it happened, for operational reporting.
  -- Resolved by the application from the Phase C schedule; never a rule.
  window_code       text,
  -- A CORRECTION names the event it reverses. The original stays.
  supersedes_id     uuid,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  -- NULL only for a system settlement (a window closing with nothing taken).
  recorded_by       uuid,
  recorded_by_role  text        NOT NULL,
  notes             text,

  CONSTRAINT rik_ivo_voucher_fk      FOREIGN KEY (voucher_id)    REFERENCES rik.issue_vouchers (id),
  CONSTRAINT rik_ivo_supersedes_fk   FOREIGN KEY (supersedes_id) REFERENCES rik.issue_voucher_outcomes (id),
  CONSTRAINT rik_ivo_recorded_by_fk  FOREIGN KEY (recorded_by)   REFERENCES shared.users (id),
  CONSTRAINT rik_ivo_sequence_uq     UNIQUE (voucher_id, sequence_no),
  CONSTRAINT rik_ivo_sequence_chk    CHECK (sequence_no >= 1),
  CONSTRAINT rik_ivo_event_type_chk  CHECK (event_type IN ('OUTCOME', 'CORRECTION')),
  CONSTRAINT rik_ivo_outcome_chk CHECK (
    outcome IN ('COLLECTED', 'NOT_COLLECTED',
                'OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED',
                'REVERSED')
  ),
  -- A reversal is a correction and nothing else is.
  CONSTRAINT rik_ivo_correction_shape_chk CHECK (
    (event_type = 'CORRECTION') = (outcome = 'REVERSED')
  ),
  CONSTRAINT rik_ivo_supersedes_shape_chk CHECK (
    (supersedes_id IS NOT NULL) = (event_type = 'CORRECTION')
  ),
  -- A refusal, a non-delivery and a correction must say why. A collection
  -- need not.
  CONSTRAINT rik_ivo_reason_required_chk CHECK (
    outcome NOT IN ('NOT_COLLECTED', 'NOT_DELIVERED', 'REVERSED')
    OR (reason IS NOT NULL AND btrim(reason) <> '')
  ),
  CONSTRAINT rik_ivo_actor_shape_chk CHECK (
    (recorded_by IS NULL) = (recorded_by_role = 'SYSTEM')
  ),
  CONSTRAINT rik_ivo_role_chk CHECK (btrim(recorded_by_role) <> ''),
  CONSTRAINT rik_ivo_notes_chk CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX IF NOT EXISTS rik_ivo_voucher_idx  ON rik.issue_voucher_outcomes (voucher_id, sequence_no);
CREATE INDEX IF NOT EXISTS rik_ivo_outcome_idx  ON rik.issue_voucher_outcomes (outcome);
CREATE INDEX IF NOT EXISTS rik_ivo_recorded_idx ON rik.issue_voucher_outcomes (recorded_at);

COMMENT ON TABLE rik.issue_voucher_outcomes IS
  'PHASE E. Append-only fulfilment events for an issue voucher. The voucher''s status is a projection of these rows, never written directly.';

-- ---------------------------------------------------------------------------
-- 2. What was physically handed over
--
-- One row per provision actually issued against a completing event. A
-- substitution is expressed here and ONLY here: `original_provision_id` is
-- the provision the officer confirmed, `provision_id` is what they were
-- actually given, and both are recorded with the reason.
--
-- `carry_forward_qty` is how much of this line's pool-equivalent was drawn
-- from the previous month's carried balance rather than this month's own
-- entitlement. It is what keeps the two components separately identifiable
-- all the way through consumption, and what makes double consumption
-- impossible to express.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.issue_voucher_issue_lines (
  id                    uuid           PRIMARY KEY DEFAULT shared.uuid_generate_v7(),
  outcome_id            uuid           NOT NULL,
  voucher_id            uuid           NOT NULL,
  pool_id               uuid           NOT NULL,
  provision_id          uuid           NOT NULL,
  original_provision_id uuid,
  quantity              numeric(14,4)  NOT NULL,
  consumption_ratio     numeric(14,6)  NOT NULL,
  pool_equivalent_qty   numeric(14,4)  NOT NULL,
  carry_forward_qty     numeric(14,4)  NOT NULL DEFAULT 0,
  substitution_reason   text,
  created_at            timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT rik_ivil_outcome_fk   FOREIGN KEY (outcome_id)            REFERENCES rik.issue_voucher_outcomes (id),
  CONSTRAINT rik_ivil_voucher_fk   FOREIGN KEY (voucher_id)            REFERENCES rik.issue_vouchers (id),
  CONSTRAINT rik_ivil_pool_fk      FOREIGN KEY (pool_id)               REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_ivil_provision_fk FOREIGN KEY (provision_id)          REFERENCES rik.provisions (id),
  CONSTRAINT rik_ivil_original_fk  FOREIGN KEY (original_provision_id) REFERENCES rik.provisions (id),
  CONSTRAINT rik_ivil_line_uq      UNIQUE (outcome_id, provision_id, original_provision_id),
  CONSTRAINT rik_ivil_qty_chk      CHECK (quantity > 0),
  CONSTRAINT rik_ivil_ratio_chk    CHECK (consumption_ratio > 0),
  CONSTRAINT rik_ivil_equiv_chk    CHECK (pool_equivalent_qty > 0),
  CONSTRAINT rik_ivil_carry_chk    CHECK (carry_forward_qty >= 0 AND carry_forward_qty <= pool_equivalent_qty),
  -- A substitution says why; an unsubstituted line has nothing to explain.
  CONSTRAINT rik_ivil_substitution_chk CHECK (
    (original_provision_id IS NOT NULL AND original_provision_id <> provision_id
     AND substitution_reason IS NOT NULL AND btrim(substitution_reason) <> '')
    OR (original_provision_id IS NULL AND substitution_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS rik_ivil_outcome_idx  ON rik.issue_voucher_issue_lines (outcome_id);
CREATE INDEX IF NOT EXISTS rik_ivil_voucher_idx  ON rik.issue_voucher_issue_lines (voucher_id);
CREATE INDEX IF NOT EXISTS rik_ivil_pool_idx     ON rik.issue_voucher_issue_lines (pool_id);

COMMENT ON TABLE rik.issue_voucher_issue_lines IS
  'PHASE E. The provisions and quantities physically issued against a completing fulfilment event, including approved substitutions. Never an amendment of the confirmed selection.';

-- ---------------------------------------------------------------------------
-- 3. The previous month's unissued Dry balance
--
-- Established ONCE per officer, source period and pool, from the source
-- period's own confirmed selection and its own physical issue records —
-- never from the carried component of an earlier month, which is what makes
-- stacking impossible by construction rather than by rule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.dry_carry_forward (
  id                  uuid           PRIMARY KEY DEFAULT shared.uuid_generate_v7(),
  customer_id         uuid           NOT NULL,
  source_period_id    uuid           NOT NULL,
  target_period_id    uuid           NOT NULL,
  source_selection_id uuid           NOT NULL,
  pool_id             uuid           NOT NULL,
  quantity            numeric(14,4)  NOT NULL,
  unit                text           NOT NULL,
  -- How the figure was arrived at, frozen: the entitlement, what was issued,
  -- and the outcome that proved it. A later catalogue or eligibility change
  -- cannot move it, for the same reason a rule_snapshot cannot.
  basis               jsonb          NOT NULL,
  established_at      timestamptz    NOT NULL DEFAULT now(),
  established_by      uuid,
  established_by_role text           NOT NULL,
  lapsed_at           timestamptz,
  lapse_reason        text,
  updated_at          timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT rik_dcf_source_period_fk FOREIGN KEY (source_period_id)    REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_dcf_target_period_fk FOREIGN KEY (target_period_id)    REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_dcf_selection_fk     FOREIGN KEY (source_selection_id) REFERENCES rik.entitlement_selections (id),
  CONSTRAINT rik_dcf_pool_fk          FOREIGN KEY (pool_id)             REFERENCES rik.entitlement_pools (id),
  CONSTRAINT rik_dcf_established_by_fk FOREIGN KEY (established_by)     REFERENCES shared.users (id),
  -- ONE MONTH ONLY: a source period can be drawn on exactly once per pool.
  CONSTRAINT rik_dcf_source_uq        UNIQUE (customer_id, source_period_id, pool_id),
  -- And it can only ever feed one target.
  CONSTRAINT rik_dcf_target_uq        UNIQUE (customer_id, target_period_id, pool_id),
  CONSTRAINT rik_dcf_qty_chk          CHECK (quantity > 0),
  CONSTRAINT rik_dcf_periods_chk      CHECK (source_period_id <> target_period_id),
  CONSTRAINT rik_dcf_unit_chk         CHECK (btrim(unit) <> ''),
  CONSTRAINT rik_dcf_role_chk         CHECK (btrim(established_by_role) <> ''),
  CONSTRAINT rik_dcf_lapse_shape_chk  CHECK (
    (lapsed_at IS NULL AND lapse_reason IS NULL)
    OR (lapsed_at IS NOT NULL AND lapse_reason IS NOT NULL AND btrim(lapse_reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS rik_dcf_customer_idx ON rik.dry_carry_forward (customer_id, target_period_id);
CREATE INDEX IF NOT EXISTS rik_dcf_target_idx   ON rik.dry_carry_forward (target_period_id);

COMMENT ON TABLE rik.dry_carry_forward IS
  'PHASE E. One previous month''s unissued Dry balance, frozen at establishment, usable only in the next period''s Dry window, and lapsing after it.';

-- ---------------------------------------------------------------------------
-- 4. The lifecycle, enforced where it cannot be bypassed
--
-- The locked lanes:
--   PICKUP    READY_FOR_PICKUP   -> COLLECTED | NOT_COLLECTED
--   DELIVERY  READY_FOR_DELIVERY -> OUT_FOR_DELIVERY -> DELIVERED | NOT_DELIVERED
--
-- A delivery may also be refused before it goes out, so NOT_DELIVERED is
-- reachable from either delivery state. Nothing else is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.voucher_effective_status(p_voucher_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT v.status FROM rik.issue_vouchers v WHERE v.id = p_voucher_id;
$$;

CREATE OR REPLACE FUNCTION rik.trg_issue_voucher_outcome_valid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v        record;
  current  text;
  target   record;
  terminal text[] := ARRAY['COLLECTED', 'NOT_COLLECTED', 'DELIVERED', 'NOT_DELIVERED'];
BEGIN
  SELECT id, voucher_number, fulfillment_mode, status
    INTO v
    FROM rik.issue_vouchers
   WHERE id = NEW.voucher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fulfilment event refers to issue voucher % which does not exist.', NEW.voucher_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.voucher_number IS DISTINCT FROM v.voucher_number THEN
    RAISE EXCEPTION 'Fulfilment event names voucher % but the voucher is %.',
      NEW.voucher_number, v.voucher_number USING ERRCODE = 'check_violation';
  END IF;

  current := v.status;

  -- ------------------------------------------------------------------ reversal
  IF NEW.event_type = 'CORRECTION' THEN
    SELECT * INTO target FROM rik.issue_voucher_outcomes WHERE id = NEW.supersedes_id;
    IF NOT FOUND OR target.voucher_id <> NEW.voucher_id THEN
      RAISE EXCEPTION 'A correction must reverse an event of the SAME voucher (%).', v.voucher_number
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (target.outcome = ANY (terminal)) THEN
      RAISE EXCEPTION 'Only a completed outcome can be reversed; % is not one.', target.outcome
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM rik.issue_voucher_outcomes o
       WHERE o.supersedes_id = NEW.supersedes_id AND o.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'That completion has already been reversed once; voucher %.', v.voucher_number
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- ------------------------------------------------------- an ordinary outcome
  -- At most one completion that still stands. A reversed one does not.
  IF NEW.outcome = ANY (terminal) THEN
    IF EXISTS (
      SELECT 1
        FROM rik.issue_voucher_outcomes o
       WHERE o.voucher_id = NEW.voucher_id
         AND o.outcome = ANY (terminal)
         AND NOT EXISTS (
           SELECT 1 FROM rik.issue_voucher_outcomes c WHERE c.supersedes_id = o.id
         )
    ) THEN
      RAISE EXCEPTION
        'Issue voucher % is already completed. A completed voucher is corrected by a recorded reversal, never by a second completion.',
        v.voucher_number USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  IF v.fulfillment_mode = 'PICKUP' THEN
    IF NEW.outcome NOT IN ('COLLECTED', 'NOT_COLLECTED') THEN
      RAISE EXCEPTION 'Voucher % is a PICKUP voucher; % belongs to the delivery lane.',
        v.voucher_number, NEW.outcome USING ERRCODE = 'check_violation';
    END IF;
    IF current <> 'READY_FOR_PICKUP' THEN
      RAISE EXCEPTION 'Voucher % is %, so it cannot be marked %.',
        v.voucher_number, current, NEW.outcome USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.outcome NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED') THEN
      RAISE EXCEPTION 'Voucher % is a DELIVERY voucher; % belongs to the pickup lane.',
        v.voucher_number, NEW.outcome USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome = 'OUT_FOR_DELIVERY' AND current <> 'READY_FOR_DELIVERY' THEN
      RAISE EXCEPTION 'Voucher % is %, so it cannot go out for delivery.',
        v.voucher_number, current USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome = 'DELIVERED' AND current <> 'OUT_FOR_DELIVERY' THEN
      RAISE EXCEPTION 'Voucher % is %; a delivery is recorded only after it has gone out.',
        v.voucher_number, current USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome = 'NOT_DELIVERED' AND current NOT IN ('READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY') THEN
      RAISE EXCEPTION 'Voucher % is %, so a non-delivery cannot be recorded.',
        v.voucher_number, current USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_voucher_outcome_valid ON rik.issue_voucher_outcomes;
CREATE TRIGGER issue_voucher_outcome_valid
  BEFORE INSERT ON rik.issue_voucher_outcomes
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_voucher_outcome_valid();

-- ---------------------------------------------------------------------------
-- 5. Status is applied here, by the owner, and nowhere else
--
-- SECURITY DEFINER because the application deliberately holds no UPDATE on
-- rik.issue_vouchers and must not be given one. The only way to move a
-- status is to record the event that justifies it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_apply_voucher_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = rik, pg_catalog
AS $$
DECLARE
  target  record;
  restore text;
BEGIN
  IF NEW.event_type = 'CORRECTION' THEN
    -- A reversal returns the voucher to the state the completion left from.
    SELECT o.outcome INTO target FROM rik.issue_voucher_outcomes o WHERE o.id = NEW.supersedes_id;
    SELECT CASE
             WHEN v.fulfillment_mode = 'PICKUP' THEN 'READY_FOR_PICKUP'
             WHEN target.outcome = 'NOT_DELIVERED'
              AND EXISTS (SELECT 1 FROM rik.issue_voucher_outcomes p
                           WHERE p.voucher_id = NEW.voucher_id
                             AND p.outcome = 'OUT_FOR_DELIVERY'
                             AND p.sequence_no < NEW.sequence_no)
               THEN 'OUT_FOR_DELIVERY'
             WHEN target.outcome = 'DELIVERED' THEN 'OUT_FOR_DELIVERY'
             ELSE 'READY_FOR_DELIVERY'
           END
      INTO restore
      FROM rik.issue_vouchers v WHERE v.id = NEW.voucher_id;

    UPDATE rik.issue_vouchers
       SET status = restore, updated_at = now()
     WHERE id = NEW.voucher_id;
  ELSE
    UPDATE rik.issue_vouchers
       SET status = NEW.outcome, updated_at = now()
     WHERE id = NEW.voucher_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_voucher_outcome ON rik.issue_voucher_outcomes;
CREATE TRIGGER apply_voucher_outcome
  AFTER INSERT ON rik.issue_voucher_outcomes
  FOR EACH ROW EXECUTE FUNCTION rik.trg_apply_voucher_outcome();

-- ---------------------------------------------------------------------------
-- 6. History is never rewritten
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_fulfillment_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'A fulfilment record is history (%). It is corrected by a recorded reversal, never by an update or a deletion.',
    TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS issue_voucher_outcomes_append_only ON rik.issue_voucher_outcomes;
CREATE TRIGGER issue_voucher_outcomes_append_only
  BEFORE UPDATE OR DELETE ON rik.issue_voucher_outcomes
  FOR EACH ROW EXECUTE FUNCTION rik.trg_fulfillment_append_only();

DROP TRIGGER IF EXISTS issue_voucher_issue_lines_append_only ON rik.issue_voucher_issue_lines;
CREATE TRIGGER issue_voucher_issue_lines_append_only
  BEFORE UPDATE OR DELETE ON rik.issue_voucher_issue_lines
  FOR EACH ROW EXECUTE FUNCTION rik.trg_fulfillment_append_only();

-- ---------------------------------------------------------------------------
-- 7. An issue line belongs to a completing event, and to its own voucher
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_line_valid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  o record;
  p record;
BEGIN
  SELECT * INTO o FROM rik.issue_voucher_outcomes WHERE id = NEW.outcome_id;
  IF o.voucher_id <> NEW.voucher_id THEN
    RAISE EXCEPTION 'An issue line must belong to the voucher of its own fulfilment event.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF o.outcome NOT IN ('COLLECTED', 'DELIVERED') THEN
    RAISE EXCEPTION 'Nothing is issued against a % event; issue lines belong to a collection or a delivery.',
      o.outcome USING ERRCODE = 'check_violation';
  END IF;

  SELECT pool_id INTO p FROM rik.provisions WHERE id = NEW.provision_id;
  IF p.pool_id <> NEW.pool_id THEN
    RAISE EXCEPTION 'The issued provision does not belong to the pool the line is drawn from.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A SUBSTITUTE MUST DRAW ON THE SAME POOL as the provision it replaces.
  -- That is the whole of the approved-alternative rule at the database
  -- boundary: an arbitrary product from elsewhere in the catalogue cannot be
  -- handed over against this entitlement, whatever a caller sends.
  IF NEW.original_provision_id IS NOT NULL THEN
    SELECT pool_id INTO p FROM rik.provisions WHERE id = NEW.original_provision_id;
    IF p.pool_id <> NEW.pool_id THEN
      RAISE EXCEPTION 'A substitution must stay inside the entitlement it draws on; that provision belongs to another pool.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_line_valid ON rik.issue_voucher_issue_lines;
CREATE TRIGGER issue_line_valid
  BEFORE INSERT ON rik.issue_voucher_issue_lines
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_line_valid();

-- ---------------------------------------------------------------------------
-- 8. A carried balance is frozen; only its lapse may be written, once
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_carry_forward_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A carried Dry balance is a historical record and cannot be deleted.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.source_period_id    IS DISTINCT FROM OLD.source_period_id
     OR NEW.target_period_id    IS DISTINCT FROM OLD.target_period_id
     OR NEW.source_selection_id IS DISTINCT FROM OLD.source_selection_id
     OR NEW.pool_id             IS DISTINCT FROM OLD.pool_id
     OR NEW.quantity            IS DISTINCT FROM OLD.quantity
     OR NEW.unit                IS DISTINCT FROM OLD.unit
     OR NEW.basis               IS DISTINCT FROM OLD.basis
     OR NEW.established_at      IS DISTINCT FROM OLD.established_at
     OR NEW.established_by      IS DISTINCT FROM OLD.established_by THEN
    RAISE EXCEPTION 'A carried Dry balance is frozen at establishment; only its lapse may be recorded.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.lapsed_at IS NOT NULL AND NEW.lapsed_at IS DISTINCT FROM OLD.lapsed_at THEN
    RAISE EXCEPTION 'That carried balance has already lapsed; a lapse is recorded once.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carry_forward_frozen ON rik.dry_carry_forward;
CREATE TRIGGER carry_forward_frozen
  BEFORE UPDATE OR DELETE ON rik.dry_carry_forward
  FOR EACH ROW EXECUTE FUNCTION rik.trg_carry_forward_frozen();

-- The customer reference is validated the same way every rik table does it.
DROP TRIGGER IF EXISTS validate_customer_ref ON rik.dry_carry_forward;
CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON rik.dry_carry_forward
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

-- ---------------------------------------------------------------------------
-- 9. NO STACKING, in the database rather than in a service
--
-- A carried balance is derived from a source period's OWN entitlement. If a
-- period ever received a carry-forward of its own, it may not then be a
-- source: that would compound two months into one, which the locked rule
-- forbids.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_carry_forward_no_stacking()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  src record;
  tgt record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rik.dry_carry_forward d
     WHERE d.customer_id = NEW.customer_id
       AND d.pool_id = NEW.pool_id
       AND d.target_period_id = NEW.source_period_id
  ) THEN
    RAISE EXCEPTION
      'That period already received a carried balance, so it cannot itself be carried forward. One previous month only.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT start_date, end_date INTO src FROM rik.entitlement_periods WHERE id = NEW.source_period_id;
  SELECT start_date, end_date INTO tgt FROM rik.entitlement_periods WHERE id = NEW.target_period_id;

  IF src.end_date >= tgt.start_date THEN
    RAISE EXCEPTION 'A carry-forward runs from an EARLIER period into a later one.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The source must be the period IMMEDIATELY before the target. Periods
  -- cannot overlap (rik_ent_periods_no_overlap), so "immediately before" is
  -- unambiguous: no other period may sit between them.
  IF EXISTS (
    SELECT 1 FROM rik.entitlement_periods p
     WHERE p.start_date > src.start_date AND p.end_date < tgt.end_date
       AND p.id NOT IN (NEW.source_period_id, NEW.target_period_id)
  ) THEN
    RAISE EXCEPTION
      'A carry-forward may only cross from one period into the NEXT one; another period sits between these two.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carry_forward_no_stacking ON rik.dry_carry_forward;
CREATE TRIGGER carry_forward_no_stacking
  BEFORE INSERT ON rik.dry_carry_forward
  FOR EACH ROW EXECUTE FUNCTION rik.trg_carry_forward_no_stacking();

-- ---------------------------------------------------------------------------
-- 10. How much of a carried balance is left
--
-- One function, so the rule lives in one place: established quantity minus
-- everything already drawn from it by issue lines that still stand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.dry_carry_forward_remaining(p_carry_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    0,
    d.quantity - COALESCE((
      SELECT sum(l.carry_forward_qty)
        FROM rik.issue_voucher_issue_lines l
        JOIN rik.issue_voucher_outcomes o ON o.id = l.outcome_id
        JOIN rik.issue_vouchers v         ON v.id = l.voucher_id
       WHERE v.customer_id = d.customer_id
         AND v.period_id   = d.target_period_id
         AND l.pool_id     = d.pool_id
         AND NOT EXISTS (
           SELECT 1 FROM rik.issue_voucher_outcomes c WHERE c.supersedes_id = o.id
         )
    ), 0)
  )
  FROM rik.dry_carry_forward d
  WHERE d.id = p_carry_id;
$$;

-- ---------------------------------------------------------------------------
-- 11. Privileges
--
-- 0018's ALTER DEFAULT PRIVILEGES grants app_rik SELECT/INSERT/UPDATE/DELETE
-- on every new rik table, so every narrowing below is an explicit REVOKE —
-- the 0023 precedent. The application may RECORD fulfilment and may never
-- rewrite it.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON rik.issue_voucher_outcomes     TO app_rik;
REVOKE UPDATE, DELETE ON rik.issue_voucher_outcomes  FROM app_rik;
GRANT SELECT, INSERT ON rik.issue_voucher_issue_lines  TO app_rik;
REVOKE UPDATE, DELETE ON rik.issue_voucher_issue_lines FROM app_rik;
-- The carried balance is the one place an UPDATE is needed, to record a
-- lapse; the frozen-record trigger above decides what that update may touch.
GRANT SELECT, INSERT, UPDATE ON rik.dry_carry_forward  TO app_rik;
REVOKE DELETE ON rik.dry_carry_forward               FROM app_rik;

-- And the voucher table itself is UNCHANGED: still no UPDATE for the
-- application. Status moves only through the SECURITY DEFINER projection.
REVOKE UPDATE, DELETE ON rik.issue_vouchers FROM app_rik;

GRANT SELECT ON rik.issue_voucher_outcomes    TO app_reporting_rik;
GRANT SELECT ON rik.issue_voucher_issue_lines TO app_reporting_rik;
GRANT SELECT ON rik.dry_carry_forward         TO app_reporting_rik;

-- ---------------------------------------------------------------------------
-- Verification — fail loudly rather than leave a half-applied change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n      integer;
  t      text;
  r      record;
BEGIN
  FOREACH t IN ARRAY ARRAY['issue_voucher_outcomes', 'issue_voucher_issue_lines', 'dry_carry_forward'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'rik' AND tablename = t) THEN
      RAISE EXCEPTION 'Migration 0049: rik.% was not created.', t;
    END IF;
  END LOOP;

  SELECT count(*) INTO n FROM pg_catalog.pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  IF n <> 65 THEN
    RAISE EXCEPTION 'Migration 0049: expected 65 tables, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_views WHERE schemaname IN ('shared', 'rik', 'pif');
  IF n <> 5 THEN
    RAISE EXCEPTION 'Migration 0049: expected 5 views, found %.', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_tables WHERE schemaname = 'pif';
  IF n <> 20 THEN
    RAISE EXCEPTION 'Migration 0049: pif moved — % tables, expected 20.', n;
  END IF;

  -- The application must still be unable to rewrite a voucher.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'rik' AND table_name = 'issue_vouchers'
       AND grantee = 'app_rik' AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Migration 0049: app_rik must not hold UPDATE or DELETE on rik.issue_vouchers.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'rik' AND table_name IN ('issue_voucher_outcomes', 'issue_voucher_issue_lines')
       AND grantee = 'app_rik' AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Migration 0049: fulfilment history must be append-only for app_rik.';
  END IF;

  -- The status projection must be SECURITY DEFINER, or the application could
  -- never move a status at all.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'rik' AND p.proname = 'trg_apply_voucher_outcome' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Migration 0049: the status projection must be SECURITY DEFINER.';
  END IF;

  -- The approved baseline, untouched.
  SELECT count(*) INTO n FROM shared.roles;
  IF n <> 6 THEN RAISE EXCEPTION 'Migration 0049: expected 6 roles, found %.', n; END IF;
  SELECT count(*) INTO n FROM shared.permissions;
  IF n <> 20 THEN RAISE EXCEPTION 'Migration 0049: expected 20 permissions, found %.', n; END IF;
  IF EXISTS (SELECT 1 FROM shared.roles WHERE name = 'PURCHASING') THEN
    RAISE EXCEPTION 'Migration 0049: a PURCHASING role exists; it must not.';
  END IF;
  SELECT count(*) INTO n FROM rik.entitlement_pools;
  IF n <> 18 THEN RAISE EXCEPTION 'Migration 0049: expected 18 pools, found %.', n; END IF;
  SELECT count(*) INTO n FROM rik.provisions;
  IF n <> 189 THEN RAISE EXCEPTION 'Migration 0049: expected 189 provisions, found %.', n; END IF;
  SELECT count(*) INTO n FROM rik.pool_scales;
  IF n <> 50 THEN RAISE EXCEPTION 'Migration 0049: expected 50 scales, found %.', n; END IF;
  SELECT count(image_ref) INTO n FROM rik.entitlement_pools;
  IF n <> 18 THEN RAISE EXCEPTION 'Migration 0049: the 18 category covers moved.'; END IF;

  -- Nothing here may create or alter a selection.
  SELECT count(*) INTO n FROM rik.entitlement_selections WHERE status = 'CONFIRMED' AND rule_snapshot IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 0049: % confirmed selection(s) lost their snapshot.', n;
  END IF;

  -- The lifecycle guard and the projection must both be attached.
  FOR r IN SELECT unnest(ARRAY['issue_voucher_outcome_valid', 'apply_voucher_outcome',
                               'issue_voucher_outcomes_append_only']) AS tg
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_voucher_outcomes'::regclass
         AND tgname = r.tg AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'Migration 0049: trigger % is missing.', r.tg;
    END IF;
  END LOOP;
END;
$$;

RESET ROLE;
