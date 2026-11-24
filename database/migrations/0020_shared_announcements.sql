-- =============================================================================
-- Migration 0020: shared.announcements
-- Phase 2 Revision 2 (customer-facing announcements/notices), approved with
-- corrections. See docs/reconciliation-report.md items 14+.
--
-- created_by/updated_by are PHYSICAL FOREIGN KEYS to shared.users.id, per
-- your Revision 2 correction #2: announcements lives in shared and
-- shared.users is also in shared, so same-schema referential integrity
-- must not be deliberately weakened the way cross-schema attribution
-- columns are (Section 34's accepted trade-off applies only to columns
-- that would otherwise need a cross-schema mechanism — this one doesn't).
-- =============================================================================

SET ROLE esamagri_owner;

CREATE TABLE shared.announcements (
  id                        uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  title                     text        NOT NULL,
  body                      text        NOT NULL,
  announcement_type         text        NOT NULL,
  target_audience           text        NOT NULL DEFAULT 'ALL',
  priority                  text        NOT NULL DEFAULT 'NORMAL',
  start_date                date        NOT NULL DEFAULT CURRENT_DATE,
  end_date                  date,
  is_published              boolean     NOT NULL DEFAULT false,
  published_at              timestamptz,
  unpublished_at            timestamptz,
  related_reference_type    text,
  related_reference_id      uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_by                uuid,
  deleted_at                timestamptz,
  CONSTRAINT announcements_pk PRIMARY KEY (id),
  CONSTRAINT announcements_created_by_fk FOREIGN KEY (created_by) REFERENCES shared.users (id),
  CONSTRAINT announcements_updated_by_fk FOREIGN KEY (updated_by) REFERENCES shared.users (id),
  CONSTRAINT announcements_type_chk CHECK (announcement_type IN (
    'GENERAL','HOLIDAY_CLOSURE','RIK_ISSUE_DAYS','RIK_CATEGORY_SCHEDULE',
    'PIF_TIMING','DELIVERY_PICKUP_CHANGE','OPERATIONAL','TEMPORARY_STOCK_NOTICE'
  )),
  CONSTRAINT announcements_audience_chk CHECK (target_audience IN ('ALL','RIK','PIF')),
  CONSTRAINT announcements_priority_chk CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  CONSTRAINT announcements_date_range_chk CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT announcements_related_ref_pair_chk CHECK ((related_reference_type IS NULL) = (related_reference_id IS NULL))
);

CREATE INDEX announcements_active_idx ON shared.announcements (is_published, target_audience, priority, start_date) WHERE deleted_at IS NULL;
CREATE INDEX announcements_type_idx ON shared.announcements (announcement_type);

COMMENT ON TABLE shared.announcements IS 'Phase 2 Revision 2 — admin-authored customer-facing broadcast content: general announcements, holiday/closure notices, RIK issue-day/category-schedule narrative notices, PIF timing notices, delivery/pickup changes, operational notices, temporary stock notices. URGENT is a priority value, not a separate type (Revision 2 correction #4).';
COMMENT ON COLUMN shared.announcements.related_reference_type IS 'Loose, optional, APPLICATION-VALIDATED reference (e.g. to a rik.issue_schedules row) — never a physical FK. See docs/reconciliation-report.md item 16 for why: every existing cross-schema-flavored reference in this schema runs rik/pif -> shared, never the reverse, and a physical FK here would run backward from that. An announcement remains fully valid even if the row it loosely references is later soft-deleted or removed.';
COMMENT ON COLUMN shared.announcements.deleted_at IS 'Soft delete — same convention as shared.customers/rik.products/pif.products. No application role is ever granted DELETE on this table; history stays queryable via the base table even once a row is filtered out of shared.v_active_announcements.';

RESET ROLE;
