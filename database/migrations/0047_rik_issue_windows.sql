-- ---------------------------------------------------------------------------
-- 0047_rik_issue_windows.sql
--
-- STEP 15B PHASE C — CONFIGURABLE RIK ISSUE WINDOWS.
--
-- The facility issues rations in windows: three for FRESH and one for DRY.
-- Until now the system had nowhere to record WHEN those windows run, so the
-- question "when may this officer draw their fresh ration?" had no answer in
-- the database at all.
--
-- WHAT IS CONFIGURABLE, AND WHY EVERYTHING IS
--
-- Holidays move. Local operational decisions move issue days. So this
-- migration hardcodes NOTHING about the calendar:
--
--   * no 7-day week. A window is a start date and an end date, and its issue
--     days are an explicit list of dates — not a weekday mask. A mask cannot
--     express "Tuesday, but not that Tuesday, because it is a holiday", and
--     it quietly assumes a seven-day cycle that the facility never agreed to;
--   * no 30-day month. A window's bounds come from its PERIOD, whatever
--     length the facility gave that period;
--   * no named weekdays. Tuesday/Wednesday/Friday appear nowhere, in no
--     default, no CHECK and no seed;
--   * no holiday table and no holiday rule. A closed day is simply a date
--     that is not in the list.
--
-- THE IDENTIFIER AND THE ORDER ARE THE SAME FACT
--
--   FRESH_1, FRESH_2, FRESH_3   the three fresh windows, in that order
--   DRY                         the dry window
--
-- `window_code` and `sequence_no` are checked against each other and against
-- `ration_type` by one CHECK constraint, so a row cannot claim to be FRESH_3
-- while sorting second, cannot be a FRESH window called DRY, and cannot
-- invent FRESH_4. The chronological order of the three fresh windows is then
-- forced to agree with their numbering by a trigger: FRESH_2 cannot start
-- before FRESH_1. "Fresh Window 1/2/3 is deterministic" is therefore a
-- property of the database, not a convention the application remembers.
--
-- DRY IS SEPARATE FROM FRESH, BY SCOPE
--
-- The overlap exclusion is scoped to (period, ration_type). Two FRESH windows
-- may not cover the same day; two DRY windows may not either; a DRY window and
-- a FRESH window MAY, because a dry issue running during a fresh week is a
-- normal arrangement and forbidding it would be inventing a rule nobody asked
-- for.
--
-- THE OVERLAP CONSTRAINT FOLLOWS MIGRATION 0043
--
--     EXCLUDE USING gist (period_id WITH =, ration_type WITH =,
--                         daterange(start_date, end_date, '[]') WITH &&)
--       WHERE (is_active)
--
-- Inclusive at both ends, so a window ending on the 7th and the next starting
-- on the 8th do not overlap while two both covering the 7th do. Partial on
-- is_active, because a deactivated window is history and replacing it over
-- the same dates is a legitimate administrative act — the same reasoning, and
-- the same shape, as rik_pool_scales_no_overlap.
--
-- SCHEDULE CHANGES MUST BE AUDITABLE, SO THEY ARE RECORDED BY CONSTRUCTION
--
-- A later phase will let a voucher follow an updated schedule, which only
-- works if "the schedule changed, from this to that, by this staff member, at
-- this moment" is answerable afterwards. rik.issue_window_revisions holds that
-- history, and it is written by a TRIGGER on rik.issue_windows rather than by
-- the application — the same inverted control as the Phase B eligibility
-- ledger. An administrator cannot change a window without leaving a revision,
-- because the write that changes it is the write that records it.
--
-- Following the Phase B precedent (and shared.audit_log before it), the
-- history table carries NO foreign key to the window: a history row must
-- outlive what it describes, and an append-only row with a RESTRICT key would
-- pin its parent forever. The reference is validated when it is written
-- instead, which is stricter than a key.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * it does not touch rik.issue_schedules. That table is per-date,
--     per-category availability with no notion of a window, a period or an
--     operating-day list; retrofitting the new model onto it would mean
--     widening a frozen table and reinterpreting its existing rows. It is
--     left exactly as it is, still serving its read-only STEP 10 route;
--   * it implements no voucher, no physical issue, no pickup completion, no
--     delivery status, no substitution, no fresh lapse and no dry
--     carry-forward. There is no table, column, status or trigger here for
--     any of them;
--   * it does not touch the entitlement engine, any pool, scale, conversion
--     or provision — all four counts are verified unchanged;
--   * it does not touch a selection, a rule_snapshot, eligibility, an import
--     batch, the adjustment ledger, PIF, inventory or purchasing;
--   * it adds no permission and no role.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. Operating-day validation
--
-- Two IMMUTABLE functions so the rules can live in CHECK constraints, which
-- cannot contain a subquery of their own. Neither reads a table; both are
-- pure functions of their arguments, which is what makes them safe there.
-- ---------------------------------------------------------------------------

/**
 * A usable list of issue days: at least one, no duplicates, strictly
 * ascending. Sortedness is required rather than tolerated so that the stored
 * array IS the order a reviewer reads, and so two configurations of the same
 * days cannot differ by permutation.
 */
CREATE OR REPLACE FUNCTION rik.issue_days_well_formed(days date[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(days) BETWEEN 1 AND 366
     AND NOT EXISTS (
           SELECT 1 FROM generate_subscripts(days, 1) AS i
            WHERE i > 1 AND days[i] <= days[i - 1]);
$$;

COMMENT ON FUNCTION rik.issue_days_well_formed(date[]) IS
  'STEP 15B Phase C: true when an operating-day list is non-empty, duplicate-free and strictly ascending.';

/** Every issue day falls inside the window it belongs to. */
CREATE OR REPLACE FUNCTION rik.issue_days_within(days date[], window_start date, window_end date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(days) AS d
     WHERE d < window_start OR d > window_end);
$$;

COMMENT ON FUNCTION rik.issue_days_within(date[], date, date) IS
  'STEP 15B Phase C: true when every operating day lies within the window''s own start and end dates.';

-- ---------------------------------------------------------------------------
-- 2. The windows themselves
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.issue_windows (
  id             uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  period_id      uuid        NOT NULL,
  ration_type    text        NOT NULL,
  /** FRESH_1 | FRESH_2 | FRESH_3 | DRY — checked against ration_type and sequence_no. */
  window_code    text        NOT NULL,
  /** 1..3 for FRESH, 1 for DRY. The sort order, and part of the identifier. */
  sequence_no    smallint    NOT NULL,
  start_date     date        NOT NULL,
  end_date       date        NOT NULL,
  /**
   * The days the facility actually issues within this window. An explicit
   * list of dates, never a weekday pattern: a holiday is simply a date that
   * is not here.
   */
  operating_days date[]      NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,

  CONSTRAINT rik_issue_windows_pk PRIMARY KEY (id),
  CONSTRAINT rik_issue_windows_period_fk FOREIGN KEY (period_id)
    REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_issue_windows_created_by_fk FOREIGN KEY (created_by) REFERENCES shared.users (id),
  CONSTRAINT rik_issue_windows_updated_by_fk FOREIGN KEY (updated_by) REFERENCES shared.users (id),

  -- One constraint, four mistakes refused: an unknown ration type, an
  -- identifier that disagrees with the ration type, an identifier that
  -- disagrees with the sort order, and an invented fourth fresh window.
  CONSTRAINT rik_issue_windows_identity_chk CHECK (
    (ration_type = 'FRESH' AND sequence_no BETWEEN 1 AND 3
       AND window_code = 'FRESH_' || sequence_no::text)
    OR
    (ration_type = 'DRY' AND sequence_no = 1 AND window_code = 'DRY')
  ),

  -- A one-day window is legitimate, so this is <= and not <.
  CONSTRAINT rik_issue_windows_dates_chk CHECK (start_date <= end_date),

  CONSTRAINT rik_issue_windows_days_shape_chk CHECK (rik.issue_days_well_formed(operating_days)),
  CONSTRAINT rik_issue_windows_days_within_chk CHECK (
    rik.issue_days_within(operating_days, start_date, end_date)),

  CONSTRAINT rik_issue_windows_notes_chk CHECK (notes IS NULL OR btrim(notes) <> '')
);

-- One active window per identifier per period. Partial, so a window can be
-- deactivated and replaced; the deactivated row stays as history.
CREATE UNIQUE INDEX IF NOT EXISTS rik_issue_windows_code_uq
  ON rik.issue_windows (period_id, window_code)
  WHERE is_active;

-- No two active windows of the SAME ration type may cover the same day.
-- FRESH and DRY are independent by design — see the header.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.issue_windows'::regclass
       AND conname = 'rik_issue_windows_no_overlap'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
      RAISE EXCEPTION 'Migration 0047: the btree_gist extension is required and is not installed.';
    END IF;
    ALTER TABLE rik.issue_windows
      ADD CONSTRAINT rik_issue_windows_no_overlap
      EXCLUDE USING gist (
        period_id   WITH =,
        ration_type WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      ) WHERE (is_active);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS rik_issue_windows_period_idx
  ON rik.issue_windows (period_id, ration_type, sequence_no);
CREATE INDEX IF NOT EXISTS rik_issue_windows_active_idx
  ON rik.issue_windows (period_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS rik_issue_windows_dates_idx
  ON rik.issue_windows (start_date, end_date);

COMMENT ON TABLE rik.issue_windows IS
  'STEP 15B Phase C: the facility''s configurable issue windows — FRESH_1/2/3 and DRY — with explicit operating days. No weekday pattern, no holiday rule, no calendar assumption.';
COMMENT ON COLUMN rik.issue_windows.operating_days IS
  'The exact dates this window issues on. A closed day is a date that is absent; this is deliberately not a weekday mask.';

-- `validate_staff_ref` is the project's existing guard that created_by and
-- updated_by name real staff users; reused here rather than reinvented.
DROP TRIGGER IF EXISTS validate_staff_ref ON rik.issue_windows;
CREATE TRIGGER validate_staff_ref
  BEFORE INSERT OR UPDATE OF created_by, updated_by ON rik.issue_windows
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_staff_ref();

-- ---------------------------------------------------------------------------
-- 3. A window belongs to its period, and lives inside it
--
-- A cross-table rule, so a trigger rather than a CHECK. This is what makes
-- every date in the system derive from the period the facility opened: a
-- window cannot run past the end of the period it belongs to, and the tests
-- therefore have no calendar literal to write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_window_within_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p record;
BEGIN
  SELECT name, start_date, end_date INTO p
    FROM rik.entitlement_periods WHERE id = NEW.period_id;

  IF NOT FOUND THEN
    -- The foreign key says this too; reaching it first gives the better message.
    RAISE EXCEPTION 'Issue window names an entitlement period that does not exist (%).', NEW.period_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.start_date < p.start_date OR NEW.end_date > p.end_date THEN
    RAISE EXCEPTION
      'Issue window % runs % to %, which is outside its period "%" (% to %).',
      NEW.window_code, NEW.start_date, NEW.end_date, p.name, p.start_date, p.end_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_window_within_period ON rik.issue_windows;
CREATE TRIGGER issue_window_within_period
  BEFORE INSERT OR UPDATE OF period_id, start_date, end_date ON rik.issue_windows
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_window_within_period();

-- ---------------------------------------------------------------------------
-- 4. FRESH_1 then FRESH_2 then FRESH_3 — numbering must match the calendar
--
-- The exclusion constraint already forbids two active windows of the same
-- ration type covering the same day. This forbids the remaining nonsense:
-- windows that do not overlap but run in the wrong order.
--
-- Overlapping pairs are deliberately IGNORED here. They are the exclusion
-- constraint's business, and reporting them as an ordering fault would give
-- the administrator the wrong explanation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_window_sequence_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  other record;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW; -- a retired window is history; it orders nothing
  END IF;

  SELECT o.window_code, o.start_date, o.end_date, o.sequence_no INTO other
    FROM rik.issue_windows o
   WHERE o.period_id = NEW.period_id
     AND o.ration_type = NEW.ration_type
     AND o.id <> NEW.id
     AND o.is_active
     AND NOT (daterange(o.start_date, o.end_date, '[]')
           && daterange(NEW.start_date, NEW.end_date, '[]'))
     AND (
          (o.sequence_no > NEW.sequence_no AND o.start_date < NEW.start_date)
       OR (o.sequence_no < NEW.sequence_no AND o.start_date > NEW.start_date)
     )
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Issue window % (% to %) is out of order with % (% to %): window 1 must run before window 2, and window 2 before window 3.',
      NEW.window_code, NEW.start_date, NEW.end_date,
      other.window_code, other.start_date, other.end_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_window_sequence_order ON rik.issue_windows;
CREATE TRIGGER issue_window_sequence_order
  BEFORE INSERT OR UPDATE OF period_id, ration_type, sequence_no, start_date, end_date, is_active
  ON rik.issue_windows
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_window_sequence_order();

-- ---------------------------------------------------------------------------
-- 5. Configuration is retired, never deleted
--
-- The same policy migration 0028 applies to the entitlement configuration: a
-- window appears in the schedule an officer was shown and, from the next
-- phase, in the voucher that follows it. Deleting one would remove the
-- explanation of a past issue day. `is_active = false` is how a window goes
-- away. app_rik also holds no DELETE on the table (section 8), so this
-- trigger is the second of two independent refusals.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_issue_window_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Issue window % cannot be deleted. Deactivate it (is_active = false) instead — the schedule an officer was shown has to stay explicable.',
    OLD.window_code
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS issue_window_no_delete ON rik.issue_windows;
CREATE TRIGGER issue_window_no_delete
  BEFORE DELETE ON rik.issue_windows
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_window_no_delete();

-- ---------------------------------------------------------------------------
-- 6. The revision history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.issue_window_revisions (
  id            uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  /** No FK, by design — see the header. Validated on INSERT instead. */
  window_id     uuid        NOT NULL,
  revision_no   integer     NOT NULL,
  change_type   text        NOT NULL,
  /** Denormalised so the history is queryable without the window it describes. */
  period_id     uuid        NOT NULL,
  ration_type   text        NOT NULL,
  window_code   text        NOT NULL,
  /** The whole window before the change (NULL when it was created) and after it. */
  before_state  jsonb,
  after_state   jsonb       NOT NULL,
  changed_by    uuid        NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rik_issue_window_revisions_pk PRIMARY KEY (id),
  CONSTRAINT rik_issue_window_revisions_no_uq UNIQUE (window_id, revision_no),
  CONSTRAINT rik_issue_window_revisions_no_chk CHECK (revision_no >= 1),
  CONSTRAINT rik_issue_window_revisions_type_chk CHECK (
    change_type IN ('CREATED', 'UPDATED', 'ACTIVATED', 'DEACTIVATED')),
  -- The first revision is the creation, and only the creation has no before.
  CONSTRAINT rik_issue_window_revisions_shape_chk CHECK (
    (change_type = 'CREATED' AND revision_no = 1 AND before_state IS NULL)
    OR (change_type <> 'CREATED' AND revision_no > 1 AND before_state IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS rik_issue_window_revisions_window_idx
  ON rik.issue_window_revisions (window_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS rik_issue_window_revisions_period_idx
  ON rik.issue_window_revisions (period_id, changed_at DESC);

COMMENT ON TABLE rik.issue_window_revisions IS
  'STEP 15B Phase C: append-only history of every change to an issue window, written by a trigger on rik.issue_windows so a schedule cannot change unrecorded.';

/** The state of a window, as the history stores it. */
CREATE OR REPLACE FUNCTION rik.issue_window_state(w rik.issue_windows)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'periodId',      w.period_id,
    'rationType',    w.ration_type,
    'windowCode',    w.window_code,
    'sequenceNo',    w.sequence_no,
    'startDate',     w.start_date,
    'endDate',       w.end_date,
    'operatingDays', to_jsonb(w.operating_days),
    'isActive',      w.is_active,
    'notes',         w.notes
  );
$$;

/** A history row cannot be rewritten, and the window it names must exist. */
CREATE OR REPLACE FUNCTION rik.trg_issue_window_revision_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'rik.issue_window_revisions is append-only. A schedule change cannot be % once recorded.',
      lower(TG_OP)
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM rik.issue_windows WHERE id = NEW.window_id) THEN
    RAISE EXCEPTION 'Issue window revision names a window that does not exist (%).', NEW.window_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shared.users WHERE id = NEW.changed_by) THEN
    RAISE EXCEPTION 'Issue window revision names a staff member who does not exist (%).', NEW.changed_by
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_window_revision_guard ON rik.issue_window_revisions;
CREATE TRIGGER issue_window_revision_guard
  BEFORE INSERT OR UPDATE OR DELETE ON rik.issue_window_revisions
  FOR EACH ROW EXECUTE FUNCTION rik.trg_issue_window_revision_guard();

-- ---------------------------------------------------------------------------
-- 7. The change IS the record
--
-- AFTER INSERT OR UPDATE on the window. The application does not write
-- history; it changes a window, and the change records itself. `updated_by`
-- is the staff member, which the application must set and the staff-reference
-- trigger above has already validated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_record_issue_window_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  before_json jsonb;
  after_json  jsonb;
  kind        text;
  next_no     integer;
BEGIN
  after_json := rik.issue_window_state(NEW);

  IF TG_OP = 'INSERT' THEN
    before_json := NULL;
    kind := 'CREATED';
  ELSE
    before_json := rik.issue_window_state(OLD);
    -- Nothing material moved (an `updated_at` touch, say): nothing to record.
    IF before_json = after_json THEN
      RETURN NEW;
    END IF;
    kind := CASE
              WHEN NOT OLD.is_active AND NEW.is_active THEN 'ACTIVATED'
              WHEN OLD.is_active AND NOT NEW.is_active THEN 'DEACTIVATED'
              ELSE 'UPDATED'
            END;
  END IF;

  SELECT coalesce(max(revision_no), 0) + 1 INTO next_no
    FROM rik.issue_window_revisions WHERE window_id = NEW.id;

  INSERT INTO rik.issue_window_revisions
    (window_id, revision_no, change_type, period_id, ration_type, window_code,
     before_state, after_state, changed_by)
  VALUES
    (NEW.id, next_no, kind, NEW.period_id, NEW.ration_type, NEW.window_code,
     before_json, after_json, NEW.updated_by);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_issue_window_revision ON rik.issue_windows;
CREATE TRIGGER record_issue_window_revision
  AFTER INSERT OR UPDATE ON rik.issue_windows
  FOR EACH ROW EXECUTE FUNCTION rik.trg_record_issue_window_revision();

-- ---------------------------------------------------------------------------
-- 8. Grants — least privilege, stated as REVOKEs where it has to be
--
-- Migration 0018's ALTER DEFAULT PRIVILEGES grants app_rik all four verbs on
-- every new rik table, so a narrower GRANT is a no-op and narrowing is only
-- ever an explicit REVOKE. Asserted below, because this fails open silently.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON rik.issue_windows           TO app_rik;
GRANT SELECT, INSERT         ON rik.issue_window_revisions  TO app_rik;
REVOKE DELETE                ON rik.issue_windows           FROM app_rik;
REVOKE UPDATE, DELETE        ON rik.issue_window_revisions  FROM app_rik;
GRANT SELECT ON rik.issue_windows, rik.issue_window_revisions TO app_reporting_rik;

-- ---------------------------------------------------------------------------
-- 9. Verification — fail loudly rather than leave a half-applied change
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
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'issue_windows')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'issue_window_revisions') THEN
    RAISE EXCEPTION 'Migration 0047: one of the two Phase C tables was not created.';
  END IF;

  -- The overlap constraint, in the shape 0043 established.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.issue_windows'::regclass
       AND conname = 'rik_issue_windows_no_overlap' AND contype = 'x') THEN
    RAISE EXCEPTION 'Migration 0047: the overlap exclusion constraint is missing.';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'rik.issue_windows'::regclass
         AND conname = 'rik_issue_windows_no_overlap') NOT LIKE '%WHERE (is_active)%' THEN
    RAISE EXCEPTION
      'Migration 0047: the overlap constraint is not scoped to active windows — a replacement over the same dates would be refused.';
  END IF;

  -- One active window per identifier per period.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'rik' AND indexname = 'rik_issue_windows_code_uq') THEN
    RAISE EXCEPTION 'Migration 0047: the duplicate-identifier index is missing.';
  END IF;

  -- Every guard.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_windows'::regclass
                   AND tgname = 'issue_window_within_period' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_windows'::regclass
                   AND tgname = 'issue_window_sequence_order' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_windows'::regclass
                   AND tgname = 'issue_window_no_delete' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_windows'::regclass
                   AND tgname = 'record_issue_window_revision' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_windows'::regclass
                   AND tgname = 'validate_staff_ref' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.issue_window_revisions'::regclass
                   AND tgname = 'issue_window_revision_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0047: an issue-window trigger is missing.';
  END IF;

  -- The identifier rules, proved as pure arithmetic rather than assumed.
  IF rik.issue_days_well_formed(ARRAY[]::date[])
     OR NOT rik.issue_days_well_formed(ARRAY['2000-01-01', '2000-01-02']::date[])
     OR rik.issue_days_well_formed(ARRAY['2000-01-02', '2000-01-01']::date[])
     OR rik.issue_days_well_formed(ARRAY['2000-01-01', '2000-01-01']::date[]) THEN
    RAISE EXCEPTION 'Migration 0047: the operating-day shape function does not hold.';
  END IF;
  IF NOT rik.issue_days_within(ARRAY['2000-01-02']::date[], '2000-01-01', '2000-01-03')
     OR rik.issue_days_within(ARRAY['2000-01-04']::date[], '2000-01-01', '2000-01-03')
     OR rik.issue_days_within(ARRAY['1999-12-31']::date[], '2000-01-01', '2000-01-03') THEN
    RAISE EXCEPTION 'Migration 0047: the operating-day containment function does not hold.';
  END IF;

  -- Append-only and no-delete by privilege as well as by trigger.
  IF has_table_privilege('app_rik', 'rik.issue_windows', 'DELETE')
     OR has_table_privilege('app_rik', 'rik.issue_window_revisions', 'UPDATE')
     OR has_table_privilege('app_rik', 'rik.issue_window_revisions', 'DELETE') THEN
    RAISE EXCEPTION 'Migration 0047: app_rik holds a privilege the schedule history must not grant.';
  END IF;
  IF NOT has_table_privilege('app_rik', 'rik.issue_windows', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.issue_windows', 'UPDATE')
     OR NOT has_table_privilege('app_rik', 'rik.issue_window_revisions', 'INSERT')
     OR NOT has_table_privilege('app_reporting_rik', 'rik.issue_windows', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 0047: app_rik is missing a privilege the schedule path needs.';
  END IF;

  -- The legacy table is untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'issue_schedules') THEN
    RAISE EXCEPTION 'Migration 0047: rik.issue_schedules is missing; this migration must not have touched it.';
  END IF;

  -- Nothing in the entitlement configuration moved.
  SELECT count(*) INTO pools  FROM rik.entitlement_pools;
  SELECT count(*) INTO scales FROM rik.pool_scales;
  SELECT count(*) INTO convs  FROM rik.pool_conversions;
  SELECT count(*) INTO provs  FROM rik.provisions;
  IF pools <> 18 OR scales <> 50 OR convs <> 7 OR provs <> 189 THEN
    RAISE EXCEPTION
      'Migration 0047: RIK configuration changed — pools %, scales %, conversions %, provisions %; expected 18/50/7/189.',
      pools, scales, convs, provs;
  END IF;

  -- Two tables added, no view added.
  SELECT count(*) INTO tabs FROM pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO vws  FROM pg_views  WHERE schemaname IN ('shared', 'rik', 'pif');
  IF tabs <> 61 OR vws <> 5 THEN
    RAISE EXCEPTION 'Migration 0047: expected 61 tables and 5 views, found % and %.', tabs, vws;
  END IF;
END;
$$;

RESET ROLE;
