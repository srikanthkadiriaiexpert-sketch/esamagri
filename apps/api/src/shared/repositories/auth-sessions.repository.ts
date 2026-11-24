import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

export type PrincipalType = 'STAFF' | 'CUSTOMER';

export interface AuthSessionRecord {
  id: string;
  principal_type: PrincipalType;
  principal_id: string;
  family_id: string;
  refresh_token_hash: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  ip_address: string | null;
  device_info: string | null;
}

/**
 * Access to shared.auth_sessions — server-side refresh-token tracking,
 * rotated on every use (Phase 2 Section 22 / migration 0004's own
 * comment). `refresh_token_hash` is always a SHA-256 hash of the opaque
 * token value handed to the client (TokenService); this repository
 * never sees or stores a plaintext refresh token.
 *
 * Rotation (look up the presented token, revoke it, link it to a new
 * session via replaced_by_id, insert the new session in the same
 * family) must run inside DatabaseService.withTransaction, with the
 * lookup done via findByTokenHashForUpdate's `FOR UPDATE`, so two
 * concurrent uses of the same refresh token are serialized rather than
 * both succeeding — the second one then observes revoked_at already
 * set and can trigger reuse-detection (family-wide revoke) in
 * TokenService, instead of racing to hand out two valid sessions from
 * one token.
 */
@Injectable()
export class AuthSessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(params: {
    principalType: PrincipalType;
    principalId: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<AuthSessionRecord> {
    const rows = await this.db.query<AuthSessionRecord>(
      `INSERT INTO shared.auth_sessions
         (id, principal_type, principal_id, family_id, refresh_token_hash, expires_at, ip_address, device_info)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7)
       RETURNING id, principal_type, principal_id, family_id, refresh_token_hash,
                 issued_at, expires_at, revoked_at, replaced_by_id, ip_address, device_info`,
      [
        params.principalType,
        params.principalId,
        params.familyId,
        params.refreshTokenHash,
        params.expiresAt,
        params.ipAddress,
        params.deviceInfo,
      ]
    );
    const row = rows[0];
    if (!row) {
      throw new Error('shared.auth_sessions insert did not return a row');
    }
    return row;
  }

  /** Must be called inside a transaction — locks the row for the duration. */
  async findByTokenHashForUpdate(client: PoolClient, refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    const result = await client.query<AuthSessionRecord>(
      `SELECT id, principal_type, principal_id, family_id, refresh_token_hash,
              issued_at, expires_at, revoked_at, replaced_by_id, ip_address, device_info
       FROM shared.auth_sessions
       WHERE refresh_token_hash = $1
       FOR UPDATE`,
      [refreshTokenHash]
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<AuthSessionRecord | null> {
    const rows = await this.db.query<AuthSessionRecord>(
      `SELECT id, principal_type, principal_id, family_id, refresh_token_hash,
              issued_at, expires_at, revoked_at, replaced_by_id, ip_address, device_info
       FROM shared.auth_sessions
       WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  /**
   * Marks one session revoked and, on rotation, links it to its
   * replacement. Idempotent against an already-revoked row (the WHERE
   * clause means a second call is a no-op, not an error).
   */
  async revoke(client: PoolClient, id: string, replacedById: string | null = null): Promise<void> {
    await client.query(
      `UPDATE shared.auth_sessions
       SET revoked_at = now(), replaced_by_id = COALESCE($2, replaced_by_id)
       WHERE id = $1 AND revoked_at IS NULL`,
      [id, replacedById]
    );
  }

  /**
   * Theft response: revoke every still-active session in a rotation
   * family in one statement. Used when a refresh token that was already
   * rotated away (revoked_at set, replaced_by_id populated) is
   * presented again — a strong signal the token was stolen and used
   * outside the legitimate rotation chain.
   */
  async revokeFamily(client: PoolClient, familyId: string): Promise<number> {
    const result = await client.query(
      `UPDATE shared.auth_sessions
       SET revoked_at = now()
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Revoke every still-active session belonging to one principal, across all
   * devices and all rotation families.
   *
   * ADDED FOR STAFF ADMINISTRATION, and needed because suspending an account
   * would otherwise be a half-measure. `status` is checked when a staff member
   * SIGNS IN (StaffAuthService), so a suspension stops the next login — but a
   * session already in flight keeps refreshing until it expires on its own.
   * Suspending an account and resetting its password both call this, so the
   * suspension takes effect now rather than whenever the current token happens
   * to run out.
   *
   * Takes no PoolClient: it is one statement and is not part of the rotation
   * dance those methods guard with FOR UPDATE. Idempotent — the WHERE clause
   * makes a second call a no-op.
   */
  async revokeAllForPrincipal(principalType: PrincipalType, principalId: string): Promise<number> {
    const rows = await this.db.query<{ revoked: string }>(
      `WITH revoked AS (
         UPDATE shared.auth_sessions
            SET revoked_at = now()
          WHERE principal_type = $1
            AND principal_id = $2
            AND revoked_at IS NULL
        RETURNING id
       )
       SELECT count(*)::text AS revoked FROM revoked`,
      [principalType, principalId]
    );
    return Number(rows[0]?.revoked ?? '0');
  }
}
