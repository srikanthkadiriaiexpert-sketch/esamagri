import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Read/write access to the frozen `shared.announcements` table
 * (STEP 10). Columns are exactly the approved migration's; nothing here
 * adds or assumes one.
 *
 * The enumerations below are the table's own CHECK constraints, mirrored
 * in TypeScript so an invalid value is rejected before it reaches
 * Postgres and returns a constraint-violation error. They are NOT
 * invented product rules — `announcements_audience_chk`,
 * `announcements_priority_chk` and `announcements_type_chk` are the
 * source of truth and this file must stay in lockstep with them.
 *
 * This repository performs NO authorization. Audience scoping (a
 * RIK_ADMIN may not touch PIF announcements) is enforced one layer up,
 * in AnnouncementsService, so the rule lives in one auditable place
 * rather than being spread across queries.
 */
export const ANNOUNCEMENT_AUDIENCES = ['ALL', 'RIK', 'PIF'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const ANNOUNCEMENT_TYPES = [
  'GENERAL',
  'HOLIDAY_CLOSURE',
  'RIK_ISSUE_DAYS',
  'RIK_CATEGORY_SCHEDULE',
  'PIF_TIMING',
  'DELIVERY_PICKUP_CHANGE',
  'OPERATIONAL',
  'TEMPORARY_STOCK_NOTICE',
] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
  announcement_type: AnnouncementType;
  target_audience: AnnouncementAudience;
  priority: AnnouncementPriority;
  start_date: string;
  end_date: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A row of `shared.v_active_announcements`. It is NOT an
 * AnnouncementRecord: the view omits `is_published` (everything in it is
 * published) and adds `published_at`, which the customer screens show as
 * the notice's date.
 */
export interface ActiveAnnouncementRecord {
  id: string;
  title: string;
  body: string;
  announcement_type: AnnouncementType;
  target_audience: AnnouncementAudience;
  priority: AnnouncementPriority;
  start_date: string;
  end_date: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  announcementType: AnnouncementType;
  targetAudience: AnnouncementAudience;
  priority: AnnouncementPriority;
  startDate?: string;
  endDate?: string | null;
  isPublished: boolean;
  createdBy: string;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  priority?: AnnouncementPriority;
  isPublished?: boolean;
  endDate?: string | null;
  updatedBy: string;
}

const COLUMNS = `id, title, body, announcement_type, target_audience, priority,
                 start_date::text AS start_date, end_date::text AS end_date,
                 is_published, created_at, updated_at`;

@Injectable()
export class AnnouncementsRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Soft-deleted rows are never returned; the app holds no DELETE grant by design. */
  async listForAudiences(audiences: readonly AnnouncementAudience[]): Promise<AnnouncementRecord[]> {
    return this.db.query<AnnouncementRecord>(
      `SELECT ${COLUMNS}
         FROM shared.announcements
        WHERE deleted_at IS NULL AND target_audience = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT 200`,
      [[...audiences]]
    );
  }

  /**
   * THE CUSTOMER-FACING READ, and the only query in this file that does
   * not touch the base table.
   *
   * It selects from `shared.v_active_announcements`, the read model
   * migration 0022 created for exactly this purpose. "Active" is the
   * view's definition, not this file's: published, not soft-deleted, and
   * today inside [start_date, end_date-or-open-ended], recomputed on
   * every read so an expired notice stops appearing without anything
   * having to run. Re-stating those conditions here would be a second
   * copy of a rule that is already written down once, and the two would
   * eventually disagree.
   *
   * WHAT THE VIEW DELIBERATELY DOES NOT DO is filter by audience — its
   * own comment says so, because "which audience is asking" is a
   * request-time fact the database does not have. That filter is the
   * caller's, and it is applied here through the parameter rather than
   * being interpolated, so an audience value can never reach SQL as
   * text.
   *
   * The view carries no `is_published` column (everything in it is
   * published by construction), so the projection below is the view's
   * own, not COLUMNS.
   */
  async listActiveForAudiences(
    audiences: readonly AnnouncementAudience[]
  ): Promise<ActiveAnnouncementRecord[]> {
    return this.db.query<ActiveAnnouncementRecord>(
      `SELECT id, title, body, announcement_type, target_audience, priority,
              start_date::text AS start_date, end_date::text AS end_date,
              published_at, created_at, updated_at
         FROM shared.v_active_announcements
        WHERE target_audience = ANY($1::text[])
        LIMIT 200`,
      [[...audiences]]
    );
  }

  async findById(id: string): Promise<AnnouncementRecord | null> {
    const rows = await this.db.query<AnnouncementRecord>(
      `SELECT ${COLUMNS} FROM shared.announcements WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ?? null;
  }

  async countForAudiences(audiences: readonly AnnouncementAudience[]): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM shared.announcements
        WHERE deleted_at IS NULL AND target_audience = ANY($1::text[])`,
      [[...audiences]]
    );
    return Number(rows[0]?.count ?? '0');
  }

  async create(input: CreateAnnouncementInput): Promise<AnnouncementRecord> {
    const rows = await this.db.query<AnnouncementRecord>(
      `INSERT INTO shared.announcements
              (title, body, announcement_type, target_audience, priority,
               start_date, end_date, is_published, published_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE($6::date, CURRENT_DATE), $7::date, $8,
               CASE WHEN $8 THEN now() ELSE NULL END, $9, $9)
    RETURNING ${COLUMNS}`,
      [
        input.title,
        input.body,
        input.announcementType,
        input.targetAudience,
        input.priority,
        input.startDate ?? null,
        input.endDate ?? null,
        input.isPublished,
        input.createdBy,
      ]
    );
    return rows[0] as AnnouncementRecord;
  }

  /**
   * Updates only the fields a staff member may edit. `target_audience`
   * is deliberately NOT updatable: moving an announcement between
   * audiences would let a module admin hand their row to the other
   * module (or to ALL) after creation, side-stepping the audience check
   * that governed its creation.
   */
  async update(id: string, input: UpdateAnnouncementInput): Promise<AnnouncementRecord | null> {
    const rows = await this.db.query<AnnouncementRecord>(
      `UPDATE shared.announcements
          SET title        = COALESCE($2, title),
              body         = COALESCE($3, body),
              priority     = COALESCE($4, priority),
              is_published = COALESCE($5, is_published),
              end_date     = COALESCE($6::date, end_date),
              published_at = CASE
                               WHEN $5 IS TRUE AND published_at IS NULL THEN now()
                               ELSE published_at
                             END,
              unpublished_at = CASE
                                 WHEN $5 IS FALSE AND is_published THEN now()
                                 ELSE unpublished_at
                               END,
              updated_by   = $7,
              updated_at   = now()
        WHERE id = $1 AND deleted_at IS NULL
    RETURNING ${COLUMNS}`,
      [
        id,
        input.title ?? null,
        input.body ?? null,
        input.priority ?? null,
        input.isPublished ?? null,
        input.endDate ?? null,
        input.updatedBy,
      ]
    );
    return rows[0] ?? null;
  }
}
