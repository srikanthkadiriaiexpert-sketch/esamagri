import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Read access to the frozen `rik.issue_schedules` table (STEP 10
 * Section 8) — the administrative foundation for consuming a structure
 * the approved Phase 2 schema already provides, gated by the existing
 * `rik.issue_schedule.manage` permission.
 *
 * Read-only on purpose. Creating a schedule means deciding real issue
 * dates, category windows and collection timings, which are unresolved
 * business decisions (BD-4, and BD-1/BD-3 for anything category-scoped).
 * This file therefore exposes no insert or update path at all — the
 * absence is the safeguard, not a comment asking a future author to be
 * careful.
 *
 * The table is currently empty, so the administrative screen shows an
 * honest empty state rather than any fabricated schedule.
 */
export interface IssueScheduleRecord {
  id: string;
  schedule_date: string;
  category_id: string | null;
  product_id: string | null;
  status: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  is_published: boolean;
}

@Injectable()
export class IssueSchedulesRepository {
  constructor(private readonly db: DatabaseService) {}

  async listUpcoming(limit = 100): Promise<IssueScheduleRecord[]> {
    return this.db.query<IssueScheduleRecord>(
      `SELECT id,
              schedule_date::text AS schedule_date,
              category_id,
              product_id,
              status,
              start_time::text   AS start_time,
              end_time::text     AS end_time,
              notes,
              is_published
         FROM rik.issue_schedules
        WHERE deleted_at IS NULL
        ORDER BY schedule_date DESC
        LIMIT $1`,
      [limit]
    );
  }

  async count(): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rik.issue_schedules WHERE deleted_at IS NULL`
    );
    return Number(rows[0]?.count ?? '0');
  }
}
