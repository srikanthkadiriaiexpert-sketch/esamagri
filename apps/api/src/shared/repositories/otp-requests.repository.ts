import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

export type OtpPurpose = 'LOGIN' | 'REGISTER';

export interface OtpRequestRecord {
  id: string;
  mobile_number: string;
  otp_hash: string;
  purpose: OtpPurpose;
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  consumed_at: Date | null;
  created_at: Date;
}

/**
 * Access to shared.otp_requests. Methods that must be race-safe against
 * a concurrent verify attempt for the SAME mobile number (find-latest +
 * increment-attempt) take an explicit `PoolClient` and are always
 * called from inside DatabaseService.withTransaction by
 * CustomerAuthService, using `SELECT ... FOR UPDATE` to serialize
 * concurrent verification attempts on one OTP row. Methods that don't
 * need that (create, the rate-limit count) go through DatabaseService
 * directly — a small race on the rate-limit count is an accepted,
 * non-security-critical approximation (worst case: very slightly over
 * the configured request rate under heavy concurrency), not a race
 * that could bypass OTP verification itself.
 */
@Injectable()
export class OtpRequestsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(params: {
    mobileNumber: string;
    otpHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
    maxAttempts: number;
  }): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO shared.otp_requests (id, mobile_number, otp_hash, purpose, expires_at, max_attempts)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, $4, $5)
       RETURNING id`,
      [params.mobileNumber, params.otpHash, params.purpose, params.expiresAt, params.maxAttempts]
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('shared.otp_requests insert did not return an id');
    }
    return id;
  }

  async countRecentForMobile(mobileNumber: string, windowSeconds: number): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM shared.otp_requests
       WHERE mobile_number = $1 AND created_at > now() - ($2 || ' seconds')::interval`,
      [mobileNumber, windowSeconds]
    );
    return Number(rows[0]?.count ?? '0');
  }

  /** Must be called inside a transaction — locks the row for the duration. */
  async findLatestActiveForUpdate(
    client: PoolClient,
    mobileNumber: string,
    purpose: OtpPurpose
  ): Promise<OtpRequestRecord | null> {
    const result = await client.query<OtpRequestRecord>(
      `SELECT id, mobile_number, otp_hash, purpose, expires_at, attempt_count, max_attempts, consumed_at, created_at
       FROM shared.otp_requests
       WHERE mobile_number = $1 AND purpose = $2 AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [mobileNumber, purpose]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Only increments while attempt_count < max_attempts — the table's
   * own CHECK constraint (attempt_count <= max_attempts) would reject
   * anything else, so this mirrors that guarantee in the WHERE clause
   * rather than relying on the constraint to reject an over-attempt.
   */
  async incrementAttempt(client: PoolClient, id: string): Promise<number> {
    const result = await client.query<{ attempt_count: number }>(
      `UPDATE shared.otp_requests
       SET attempt_count = attempt_count + 1
       WHERE id = $1 AND attempt_count < max_attempts
       RETURNING attempt_count`,
      [id]
    );
    return result.rows[0]?.attempt_count ?? -1;
  }

  async markConsumed(client: PoolClient, id: string): Promise<void> {
    await client.query('UPDATE shared.otp_requests SET consumed_at = now() WHERE id = $1', [id]);
  }

  /**
   * One CONSUMED request, by id — the database anchor behind a registration
   * ticket.
   *
   * WHY A TICKET IS NOT CHECKED BY ITS SIGNATURE ALONE. A registration ticket
   * says "this number was verified a moment ago". Its HMAC proves this server
   * said so; this read proves the event it refers to actually happened, is
   * still recent, and was a LOGIN verification of this very number. If the
   * signing key were ever to leak, a forged ticket would still have to name a
   * genuine recently-consumed row.
   *
   * `consumed_at IS NOT NULL` is part of the filter rather than a field the
   * caller re-checks, so there is one definition of "this code was actually
   * used" and no second chance to read it the wrong way round. An unconsumed
   * or expired-but-unused row is simply not returned.
   *
   * READ ONLY. It writes nothing and consumes nothing: the consuming happened
   * in the verify transaction, under `SELECT ... FOR UPDATE`, and this neither
   * repeats nor relaxes it.
   */
  async findConsumedById(
    id: string,
    purpose: OtpPurpose,
    consumedWithinSeconds: number
  ): Promise<OtpRequestRecord | null> {
    const rows = await this.db.query<OtpRequestRecord>(
      `SELECT id, mobile_number, otp_hash, purpose, expires_at, attempt_count,
              max_attempts, consumed_at, created_at
         FROM shared.otp_requests
        WHERE id = $1
          AND purpose = $2
          AND consumed_at IS NOT NULL
          AND consumed_at > now() - make_interval(secs => $3::double precision)`,
      [id, purpose, consumedWithinSeconds]
    );
    return rows[0] ?? null;
  }
}
