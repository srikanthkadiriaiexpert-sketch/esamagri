import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

/**
 * Reads and writes for the PHASE E fulfilment records.
 *
 * APPEND-ONLY, BY PRIVILEGE. The application holds SELECT and INSERT on
 * `rik.issue_voucher_outcomes` and `rik.issue_voucher_issue_lines` and
 * nothing else (migration 0049), so there is deliberately no update or
 * delete method here — and adding one would not work if it were written.
 * The single UPDATE in this file writes a carried balance's LAPSE, which is
 * the one field migration 0049's frozen-record trigger lets move, once.
 *
 * STATUS IS NOT WRITTEN HERE. Recording an outcome moves the voucher's
 * status as a consequence, applied by a SECURITY DEFINER trigger owned by
 * the schema owner. Nothing in this repository touches
 * `rik.issue_vouchers`.
 */

export type FulfillmentOutcome =
  | 'COLLECTED'
  | 'NOT_COLLECTED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NOT_DELIVERED'
  | 'REVERSED';

export interface OutcomeRecord {
  id: string;
  voucher_id: string;
  voucher_number: string;
  sequence_no: number;
  event_type: 'OUTCOME' | 'CORRECTION';
  outcome: FulfillmentOutcome;
  reason: string | null;
  window_code: string | null;
  supersedes_id: string | null;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_role: string;
  notes: string | null;
  /** Joined for display: who recorded it. */
  recorded_by_name: string | null;
  /** True when a later correction reversed this event. */
  reversed: boolean;
}

export interface IssueLineRecord {
  id: string;
  outcome_id: string;
  voucher_id: string;
  pool_id: string;
  pool_code: string;
  pool_name: string;
  pool_unit: string;
  provision_id: string;
  provision_code: string;
  provision_name: string;
  provision_brand: string | null;
  original_provision_id: string | null;
  original_provision_code: string | null;
  original_provision_name: string | null;
  quantity: string;
  consumption_ratio: string;
  pool_equivalent_qty: string;
  carry_forward_qty: string;
  substitution_reason: string | null;
}

export interface CarryForwardRecord {
  id: string;
  customer_id: string;
  source_period_id: string;
  source_period_name: string;
  target_period_id: string;
  target_period_name: string;
  source_selection_id: string;
  source_selection_reference: string | null;
  pool_id: string;
  pool_code: string;
  pool_name: string;
  quantity: string;
  unit: string;
  remaining: string;
  established_at: string;
  established_by: string | null;
  established_by_role: string;
  lapsed_at: string | null;
  lapse_reason: string | null;
}

export interface RecordOutcomeInput {
  voucherId: string;
  voucherNumber: string;
  outcome: FulfillmentOutcome;
  eventType: 'OUTCOME' | 'CORRECTION';
  reason?: string | null;
  windowCode?: string | null;
  supersedesId?: string | null;
  staffId: string | null;
  staffRole: string;
  notes?: string | null;
}

export interface IssueLineInput {
  poolId: string;
  provisionId: string;
  originalProvisionId: string | null;
  quantity: number;
  consumptionRatio: number;
  poolEquivalentQty: number;
  carryForwardQty: number;
  substitutionReason: string | null;
}

const OUTCOME_SELECT = `
  SELECT o.id, o.voucher_id, o.voucher_number, o.sequence_no, o.event_type, o.outcome,
         o.reason, o.window_code, o.supersedes_id,
         o.recorded_at::text AS recorded_at, o.recorded_by, o.recorded_by_role, o.notes,
         u.display_name AS recorded_by_name,
         EXISTS (SELECT 1 FROM rik.issue_voucher_outcomes c WHERE c.supersedes_id = o.id) AS reversed
    FROM rik.issue_voucher_outcomes o
    LEFT JOIN shared.users u ON u.id = o.recorded_by`;

const LINE_SELECT = `
  SELECT l.id, l.outcome_id, l.voucher_id, l.pool_id,
         p.code AS pool_code, p.name AS pool_name, p.unit AS pool_unit,
         l.provision_id, pr.code AS provision_code, pr.name AS provision_name, pr.brand AS provision_brand,
         l.original_provision_id, op.code AS original_provision_code, op.name AS original_provision_name,
         l.quantity::text, l.consumption_ratio::text, l.pool_equivalent_qty::text,
         l.carry_forward_qty::text, l.substitution_reason
    FROM rik.issue_voucher_issue_lines l
    JOIN rik.entitlement_pools p ON p.id = l.pool_id
    JOIN rik.provisions pr       ON pr.id = l.provision_id
    LEFT JOIN rik.provisions op  ON op.id = l.original_provision_id`;

const CARRY_SELECT = `
  SELECT d.id, d.customer_id, d.source_period_id, sp.name AS source_period_name,
         d.target_period_id, tp.name AS target_period_name,
         d.source_selection_id, s.reference_number AS source_selection_reference,
         d.pool_id, p.code AS pool_code, p.name AS pool_name,
         d.quantity::text, d.unit,
         rik.dry_carry_forward_remaining(d.id)::text AS remaining,
         d.established_at::text AS established_at, d.established_by, d.established_by_role,
         d.lapsed_at::text AS lapsed_at, d.lapse_reason
    FROM rik.dry_carry_forward d
    JOIN rik.entitlement_periods sp ON sp.id = d.source_period_id
    JOIN rik.entitlement_periods tp ON tp.id = d.target_period_id
    JOIN rik.entitlement_pools p    ON p.id = d.pool_id
    JOIN rik.entitlement_selections s ON s.id = d.source_selection_id`;

@Injectable()
export class FulfillmentRepository {
  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------- outcomes

  async listOutcomes(voucherId: string, client?: PoolClient): Promise<OutcomeRecord[]> {
    const sql = `${OUTCOME_SELECT} WHERE o.voucher_id = $1 ORDER BY o.sequence_no`;
    return client
      ? (await client.query<OutcomeRecord>(sql, [voucherId])).rows
      : this.db.query<OutcomeRecord>(sql, [voucherId]);
  }

  async findOutcome(outcomeId: string, client?: PoolClient): Promise<OutcomeRecord | null> {
    const sql = `${OUTCOME_SELECT} WHERE o.id = $1`;
    const rows = client
      ? (await client.query<OutcomeRecord>(sql, [outcomeId])).rows
      : await this.db.query<OutcomeRecord>(sql, [outcomeId]);
    return rows[0] ?? null;
  }

  /**
   * The completion that still stands for a voucher, or null.
   *
   * "Still stands" means not reversed by a later correction — which is what
   * makes a reversal genuinely restore the voucher rather than merely
   * annotate it.
   */
  async currentCompletion(voucherId: string, client?: PoolClient): Promise<OutcomeRecord | null> {
    const sql = `${OUTCOME_SELECT}
       WHERE o.voucher_id = $1
         AND o.outcome IN ('COLLECTED', 'NOT_COLLECTED', 'DELIVERED', 'NOT_DELIVERED')
         AND NOT EXISTS (SELECT 1 FROM rik.issue_voucher_outcomes c WHERE c.supersedes_id = o.id)
       ORDER BY o.sequence_no DESC LIMIT 1`;
    const rows = client
      ? (await client.query<OutcomeRecord>(sql, [voucherId])).rows
      : await this.db.query<OutcomeRecord>(sql, [voucherId]);
    return rows[0] ?? null;
  }

  /**
   * Append one fulfilment event.
   *
   * The sequence number is taken inside the same statement, and
   * `UNIQUE (voucher_id, sequence_no)` is what makes two concurrent
   * completions impossible: the second gets a unique violation rather than a
   * second collection. The lifecycle itself is checked by the database
   * trigger, not here.
   */
  async insertOutcome(client: PoolClient, input: RecordOutcomeInput): Promise<string> {
    const rows = await client.query<{ id: string }>(
      `INSERT INTO rik.issue_voucher_outcomes
         (voucher_id, voucher_number, sequence_no, event_type, outcome, reason,
          window_code, supersedes_id, recorded_by, recorded_by_role, notes)
       VALUES ($1, $2,
               (SELECT COALESCE(max(sequence_no), 0) + 1
                  FROM rik.issue_voucher_outcomes WHERE voucher_id = $1),
               $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.voucherId,
        input.voucherNumber,
        input.eventType,
        input.outcome,
        input.reason ?? null,
        input.windowCode ?? null,
        input.supersedesId ?? null,
        input.staffId,
        input.staffRole,
        input.notes ?? null,
      ]
    );
    return rows.rows[0]!.id;
  }

  // ---------------------------------------------------------- issue lines

  async insertIssueLine(
    client: PoolClient,
    outcomeId: string,
    voucherId: string,
    line: IssueLineInput
  ): Promise<void> {
    await client.query(
      `INSERT INTO rik.issue_voucher_issue_lines
         (outcome_id, voucher_id, pool_id, provision_id, original_provision_id,
          quantity, consumption_ratio, pool_equivalent_qty, carry_forward_qty, substitution_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        outcomeId,
        voucherId,
        line.poolId,
        line.provisionId,
        line.originalProvisionId,
        line.quantity,
        line.consumptionRatio,
        line.poolEquivalentQty,
        line.carryForwardQty,
        line.substitutionReason,
      ]
    );
  }

  async listIssueLines(voucherId: string, client?: PoolClient): Promise<IssueLineRecord[]> {
    const sql = `${LINE_SELECT} WHERE l.voucher_id = $1 ORDER BY p.code, pr.code`;
    return client
      ? (await client.query<IssueLineRecord>(sql, [voucherId])).rows
      : this.db.query<IssueLineRecord>(sql, [voucherId]);
  }

  /** The lines of the completion that still stands — what was actually issued. */
  async listCurrentIssueLines(voucherId: string): Promise<IssueLineRecord[]> {
    return this.db.query<IssueLineRecord>(
      `${LINE_SELECT}
        WHERE l.voucher_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM rik.issue_voucher_outcomes c WHERE c.supersedes_id = l.outcome_id
          )
        ORDER BY p.code, pr.code`,
      [voucherId]
    );
  }

  /**
   * Pool-equivalent actually issued for one selection, by pool, counting only
   * completions that still stand. This is the single source of "what was
   * physically issued" that both the lapse and the carry-forward read.
   */
  async issuedByPool(
    selectionId: string,
    client?: PoolClient
  ): Promise<Array<{ pool_id: string; issued: string }>> {
    const sql = `
      SELECT l.pool_id, sum(l.pool_equivalent_qty)::text AS issued
        FROM rik.issue_voucher_issue_lines l
        JOIN rik.issue_vouchers v ON v.id = l.voucher_id
       WHERE v.selection_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM rik.issue_voucher_outcomes c WHERE c.supersedes_id = l.outcome_id
         )
       GROUP BY l.pool_id`;
    return client
      ? (await client.query<{ pool_id: string; issued: string }>(sql, [selectionId])).rows
      : this.db.query<{ pool_id: string; issued: string }>(sql, [selectionId]);
  }

  // -------------------------------------------------------- carry forward

  async listCarryForwardForTarget(
    customerId: string,
    targetPeriodId: string,
    client?: PoolClient
  ): Promise<CarryForwardRecord[]> {
    const sql = `${CARRY_SELECT} WHERE d.customer_id = $1 AND d.target_period_id = $2 ORDER BY p.code`;
    return client
      ? (await client.query<CarryForwardRecord>(sql, [customerId, targetPeriodId])).rows
      : this.db.query<CarryForwardRecord>(sql, [customerId, targetPeriodId]);
  }

  async findCarryForwardBySource(
    customerId: string,
    sourcePeriodId: string,
    client?: PoolClient
  ): Promise<CarryForwardRecord[]> {
    const sql = `${CARRY_SELECT} WHERE d.customer_id = $1 AND d.source_period_id = $2 ORDER BY p.code`;
    return client
      ? (await client.query<CarryForwardRecord>(sql, [customerId, sourcePeriodId])).rows
      : this.db.query<CarryForwardRecord>(sql, [customerId, sourcePeriodId]);
  }

  /**
   * Establish a carried balance, or leave the existing one alone.
   *
   * `ON CONFLICT DO NOTHING` against `UNIQUE (customer_id, source_period_id,
   * pool_id)` is what makes establishment idempotent and duplicate-proof: a
   * second attempt, concurrent or not, writes nothing.
   */
  async establishCarryForward(
    client: PoolClient,
    input: {
      customerId: string;
      sourcePeriodId: string;
      targetPeriodId: string;
      sourceSelectionId: string;
      poolId: string;
      quantity: number;
      unit: string;
      basis: Record<string, unknown>;
      staffId: string | null;
      staffRole: string;
    }
  ): Promise<boolean> {
    const rows = await client.query<{ id: string }>(
      `INSERT INTO rik.dry_carry_forward
         (customer_id, source_period_id, target_period_id, source_selection_id, pool_id,
          quantity, unit, basis, established_by, established_by_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       ON CONFLICT (customer_id, source_period_id, pool_id) DO NOTHING
       RETURNING id`,
      [
        input.customerId,
        input.sourcePeriodId,
        input.targetPeriodId,
        input.sourceSelectionId,
        input.poolId,
        input.quantity,
        input.unit,
        JSON.stringify(input.basis),
        input.staffId,
        input.staffRole,
      ]
    );
    return rows.rows.length > 0;
  }

  /** Record the lapse of a carried balance. Set-once, enforced by trigger. */
  async lapseCarryForward(client: PoolClient, carryId: string, reason: string): Promise<boolean> {
    const rows = await client.query<{ id: string }>(
      `UPDATE rik.dry_carry_forward
          SET lapsed_at = now(), lapse_reason = $2, updated_at = now()
        WHERE id = $1 AND lapsed_at IS NULL
        RETURNING id`,
      [carryId, reason]
    );
    return rows.rows.length > 0;
  }

  async remaining(carryId: string, client?: PoolClient): Promise<number> {
    const sql = `SELECT rik.dry_carry_forward_remaining($1)::text AS remaining`;
    const rows = client
      ? (await client.query<{ remaining: string }>(sql, [carryId])).rows
      : await this.db.query<{ remaining: string }>(sql, [carryId]);
    return Number(rows[0]?.remaining ?? 0);
  }
}
