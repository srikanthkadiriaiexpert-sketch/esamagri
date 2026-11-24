import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export type AuditModule = 'shared' | 'rik' | 'pif';

export interface LogAuditEventParams {
  actorId: string | null;
  actorRole: string | null;
  module: AuditModule;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  deviceInfo?: string | null;
}

/** One row of shared.audit_log, with the actor resolved to a name for display. */
export interface AuditEntryRecord {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  module: AuditModule;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
  actor_username: string | null;
  actor_display_name: string | null;
}

/**
 * Write access to shared.audit_log goes ONLY through
 * shared.log_audit_event(...) (migration 0005) — the table itself is
 * append-only and a trigger (trg_audit_log_immutable, migration 0005)
 * unconditionally rejects UPDATE/DELETE regardless of role grants. This
 * repository never issues a raw INSERT against shared.audit_log.
 *
 * `after` payloads passed here must never contain a password, OTP code,
 * OTP hash, token, or token hash — see StaffAuthService/CustomerAuthService/
 * TokenService, which construct only safe, minimal JSON (e.g.
 * {"reason":"bad_password"}) before calling logEvent.
 */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly db: DatabaseService) {}

  async logEvent(params: LogAuditEventParams): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT shared.log_audit_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id`,
      [
        params.actorId,
        params.actorRole,
        params.module,
        params.action,
        params.entityType,
        params.entityId,
        params.before !== undefined ? JSON.stringify(params.before) : null,
        params.after !== undefined ? JSON.stringify(params.after) : null,
        params.ipAddress ?? null,
        params.deviceInfo ?? null,
      ]
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('shared.log_audit_event did not return an id');
    }
    return id;
  }

  /**
   * Reads back audit entries for one module, optionally narrowed to
   * particular entity types or a single entity. Read-only: the table is
   * append-only and a trigger (migration 0005) rejects UPDATE/DELETE
   * outright, so nothing here can rewrite history.
   *
   * Added in STEP 11C for the RIK "Rule history" screen. The screen
   * shows what an administrator actually did to the entitlement
   * configuration, which is exactly what this table already records —
   * so no second history table was introduced.
   */
  async listForModule(params: {
    module: AuditModule;
    entityTypes?: readonly string[];
    entityId?: string | null;
    limit: number;
  }): Promise<AuditEntryRecord[]> {
    const types = params.entityTypes && params.entityTypes.length > 0 ? [...params.entityTypes] : null;
    return this.db.query<AuditEntryRecord>(
      `SELECT a.id,
              a.actor_id,
              a.actor_role,
              a.module,
              a.action,
              a.entity_type,
              a.entity_id,
              a.before AS before_data,
              a.after  AS after_data,
              a.created_at::text AS created_at,
              u.username    AS actor_username,
              u.display_name AS actor_display_name
         FROM shared.audit_log a
         LEFT JOIN shared.users u ON u.id = a.actor_id
        WHERE a.module = $1
          AND ($2::text[] IS NULL OR a.entity_type = ANY($2::text[]))
          AND ($3::uuid IS NULL OR a.entity_id = $3::uuid)
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $4`,
      [params.module, types, params.entityId ?? null, params.limit]
    );
  }

  /**
   * Counts recent audit_log rows for a given `action` (e.g.
   * 'STAFF_LOGIN_FAILURE') scoped to one actor, within a trailing
   * window — the brute-force-lockout signal StaffAuthService checks
   * before attempting a password verify. Only meaningful for a known
   * account (actor_id set); see StaffAuthService for why an unknown
   * username does not go through this count at all.
   */
  async countRecentActionsForActor(actorId: string, action: string, windowSeconds: number): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM shared.audit_log
       WHERE actor_id = $1 AND action = $2 AND created_at > now() - ($3 || ' seconds')::interval`,
      [actorId, action, windowSeconds]
    );
    return Number(rows[0]?.count ?? '0');
  }
}
