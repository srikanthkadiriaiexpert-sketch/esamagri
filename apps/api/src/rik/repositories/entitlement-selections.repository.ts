import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { DietaryPreference } from './entitlement-config.repository';

/**
 * The customer's selection for a period: the draft they are building,
 * the lines in it, and the elective conversions they took.
 *
 * Reads that a write depends on go through `findOpenForUpdate`, which
 * takes a row lock. Two requests racing to add the last of a pool
 * therefore serialise behind that lock, and the second one recalculates
 * against what the first actually committed. Nothing here relies on
 * read-then-write without protection.
 */

export type FulfillmentType = 'PICKUP' | 'DELIVERY';

/**
 * What a customer chose at confirmation, recorded as it was.
 *
 * `pickupLocationName` and `deliveryAddress` are SNAPSHOTS, not
 * lookups. A pickup point can be renamed and a customer can move
 * house; neither may rewrite an issue already agreed. The location id
 * is kept alongside for reporting, but the text is the record.
 */
export interface SelectionFulfillment {
  fulfillmentType: FulfillmentType;
  pickupLocationId: string | null;
  pickupLocationName: string | null;
  deliveryAddress: string | null;
}

export interface SelectionRecord {
  id: string;
  customer_id: string;
  period_id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  dietary_preference: DietaryPreference;
  eligible_days: number;
  rule_snapshot: unknown | null;
  confirmed_at: string | null;
  reference_number: string | null;
  fulfillment_type: FulfillmentType | null;
  pickup_location_id: string | null;
  pickup_location_name: string | null;
  delivery_address: string | null;
  availability_acknowledged: boolean;
  availability_acknowledged_at: string | null;
}

export interface SelectionItemRecord {
  id: string;
  selection_id: string;
  provision_id: string;
  pool_id: string;
  quantity: string;
  consumption_ratio: string;
  pool_equivalent_qty: string;
}

export interface ElectionRecord {
  id: string;
  selection_id: string;
  conversion_id: string;
  from_qty: string;
  to_qty: string;
}

@Injectable()
export class EntitlementSelectionsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The open draft for this customer and period, locked for update.
   *
   * `FOR UPDATE` is the concurrency boundary: every mutation of a
   * selection runs inside a transaction that holds this lock, so a
   * customer cannot spend the same entitlement twice from two requests.
   */
  async findOpenForUpdate(
    client: PoolClient,
    customerId: string,
    periodId: string
  ): Promise<SelectionRecord | null> {
    const result = await client.query<SelectionRecord>(
      `SELECT id, customer_id, period_id, status, dietary_preference,
              eligible_days, rule_snapshot, confirmed_at::text AS confirmed_at,
              reference_number, fulfillment_type, pickup_location_id,
              pickup_location_name, delivery_address,
              availability_acknowledged,
              availability_acknowledged_at::text AS availability_acknowledged_at
         FROM rik.entitlement_selections
        WHERE customer_id = $1 AND period_id = $2 AND status = 'DRAFT'
        FOR UPDATE`,
      [customerId, periodId]
    );
    return result.rows[0] ?? null;
  }

  async createDraft(
    client: PoolClient,
    input: {
      customerId: string;
      periodId: string;
      dietaryPreference: DietaryPreference;
      eligibleDays: number;
    }
  ): Promise<SelectionRecord> {
    const result = await client.query<SelectionRecord>(
      `INSERT INTO rik.entitlement_selections
         (customer_id, period_id, status, dietary_preference, eligible_days)
       VALUES ($1, $2, 'DRAFT', $3, $4)
       RETURNING id, customer_id, period_id, status, dietary_preference,
                 eligible_days, rule_snapshot, confirmed_at::text AS confirmed_at,
                 reference_number, fulfillment_type, pickup_location_id,
                 pickup_location_name, delivery_address,
                 availability_acknowledged,
                 availability_acknowledged_at::text AS availability_acknowledged_at`,
      [input.customerId, input.periodId, input.dietaryPreference, input.eligibleDays]
    );
    return result.rows[0]!;
  }

  async listItems(client: PoolClient, selectionId: string): Promise<SelectionItemRecord[]> {
    const result = await client.query<SelectionItemRecord>(
      `SELECT id, selection_id, provision_id, pool_id,
              quantity::text AS quantity,
              consumption_ratio::text AS consumption_ratio,
              pool_equivalent_qty::text AS pool_equivalent_qty
         FROM rik.entitlement_selection_items
        WHERE selection_id = $1
        ORDER BY created_at`,
      [selectionId]
    );
    return result.rows;
  }

  /** Insert or replace one line. Quantity is absolute, never additive. */
  async upsertItem(
    client: PoolClient,
    input: {
      selectionId: string;
      provisionId: string;
      poolId: string;
      quantity: number;
      consumptionRatio: number;
      poolEquivalentQty: number;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO rik.entitlement_selection_items
         (selection_id, provision_id, pool_id, quantity, consumption_ratio, pool_equivalent_qty)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (selection_id, provision_id) DO UPDATE
         SET quantity            = EXCLUDED.quantity,
             consumption_ratio   = EXCLUDED.consumption_ratio,
             pool_equivalent_qty = EXCLUDED.pool_equivalent_qty,
             updated_at          = now()`,
      [
        input.selectionId,
        input.provisionId,
        input.poolId,
        input.quantity,
        input.consumptionRatio,
        input.poolEquivalentQty,
      ]
    );
  }

  async removeItem(client: PoolClient, selectionId: string, provisionId: string): Promise<void> {
    await client.query(
      `DELETE FROM rik.entitlement_selection_items
        WHERE selection_id = $1 AND provision_id = $2`,
      [selectionId, provisionId]
    );
  }

  async listElections(client: PoolClient, selectionId: string): Promise<ElectionRecord[]> {
    const result = await client.query<ElectionRecord>(
      `SELECT id, selection_id, conversion_id,
              from_qty::text AS from_qty, to_qty::text AS to_qty
         FROM rik.entitlement_elections
        WHERE selection_id = $1`,
      [selectionId]
    );
    return result.rows;
  }

  /**
   * Replace the elective conversions for a selection.
   *
   * Replacing rather than adding is what stops an entitlement being
   * taken twice: choosing milk in place of meat removes any earlier
   * choice of eggs in place of meat.
   */
  async replaceElections(
    client: PoolClient,
    selectionId: string,
    elections: ReadonlyArray<{ conversionId: string; fromQty: number; toQty: number }>
  ): Promise<void> {
    await client.query(`DELETE FROM rik.entitlement_elections WHERE selection_id = $1`, [selectionId]);
    for (const election of elections) {
      await client.query(
        `INSERT INTO rik.entitlement_elections (selection_id, conversion_id, from_qty, to_qty)
         VALUES ($1, $2, $3, $4)`,
        [selectionId, election.conversionId, election.fromQty, election.toQty]
      );
    }
  }

  /**
   * Confirm a draft in ONE statement: the snapshot, the basis, the
   * acknowledgement, the fulfillment and the reference number all land
   * together or not at all.
   *
   * `WHERE ... AND status = 'DRAFT'` is what makes a second confirmation
   * harmless. Two requests that both pass the earlier checks still
   * serialise on the row lock, and the loser updates zero rows and gets
   * `null` back — no second record, no exception to interpret.
   *
   * The basis is REWRITTEN from the values the calculation actually
   * used. A customer who changed their dietary preference while holding
   * an open draft would otherwise confirm a row whose stored preference
   * disagreed with its own snapshot.
   */
  async confirm(
    client: PoolClient,
    selectionId: string,
    input: {
      ruleSnapshot: unknown;
      dietaryPreference: DietaryPreference;
      eligibleDays: number;
      fulfillment: SelectionFulfillment;
    }
  ): Promise<SelectionRecord | null> {
    const result = await client.query<SelectionRecord>(
      `UPDATE rik.entitlement_selections
          SET status               = 'CONFIRMED',
              rule_snapshot        = $2::jsonb,
              snapshot_taken_at    = now(),
              confirmed_at         = now(),
              updated_at           = now(),
              dietary_preference   = $3,
              eligible_days        = $4,
              fulfillment_type     = $5,
              pickup_location_id   = $6,
              pickup_location_name = $7,
              delivery_address     = $8,
              availability_acknowledged    = true,
              availability_acknowledged_at = now(),
              reference_number     = 'RIK-' || to_char(nextval('rik.selection_reference_seq'), 'FM000000')
        WHERE id = $1 AND status = 'DRAFT'
        RETURNING id, customer_id, period_id, status, dietary_preference,
                  eligible_days, rule_snapshot, confirmed_at::text AS confirmed_at,
                  reference_number, fulfillment_type, pickup_location_id,
                  pickup_location_name, delivery_address,
                  availability_acknowledged,
                  availability_acknowledged_at::text AS availability_acknowledged_at`,
      [
        selectionId,
        JSON.stringify(input.ruleSnapshot),
        input.dietaryPreference,
        input.eligibleDays,
        input.fulfillment.fulfillmentType,
        input.fulfillment.pickupLocationId,
        input.fulfillment.pickupLocationName,
        input.fulfillment.deliveryAddress,
      ]
    );
    return result.rows[0] ?? null;
  }

  /**
   * The customer's selection for a period, whatever state it is in —
   * the open draft if there is one, otherwise the confirmed record.
   *
   * Added in STEP 11E. Before it, reads looked only for a DRAFT, so the
   * moment a customer confirmed, Know Your Ration showed their ration
   * as though they had chosen nothing. Writes still go through
   * `findOpenForUpdate`, which sees only a DRAFT, so a confirmed
   * selection remains read-only by construction rather than by a check.
   */
  async findCurrentForPeriod(customerId: string, periodId: string): Promise<SelectionRecord | null> {
    const rows = await this.db.query<SelectionRecord>(
      `SELECT id, customer_id, period_id, status, dietary_preference,
              eligible_days, rule_snapshot, confirmed_at::text AS confirmed_at,
              reference_number, fulfillment_type, pickup_location_id,
              pickup_location_name, delivery_address,
              availability_acknowledged,
              availability_acknowledged_at::text AS availability_acknowledged_at
         FROM rik.entitlement_selections
        WHERE customer_id = $1
          AND period_id = $2
          AND status IN ('DRAFT', 'CONFIRMED')
        ORDER BY CASE status WHEN 'DRAFT' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1`,
      [customerId, periodId]
    );
    return rows[0] ?? null;
  }

  /** A confirmed selection, read outside a transaction for history. */
  /**
   * One selection by id alone (PHASE D).
   *
   * `findById` above pins the customer, which is right for every
   * customer-facing path: an officer may only read their own. Issue-voucher
   * creation is a STAFF act against a selection staff have searched for, so
   * it has no customer id to pin and must look the selection up by its own
   * identifier. The authorization for that path is the RIK permission on the
   * route, not an ownership match.
   */
  async findByIdAnyCustomer(selectionId: string): Promise<SelectionRecord | null> {
    const rows = await this.db.query<SelectionRecord>(
      `SELECT id, customer_id, period_id, status, dietary_preference,
              eligible_days, rule_snapshot, confirmed_at::text AS confirmed_at,
              reference_number, fulfillment_type, pickup_location_id,
              pickup_location_name, delivery_address,
              availability_acknowledged,
              availability_acknowledged_at::text AS availability_acknowledged_at
         FROM rik.entitlement_selections
        WHERE id = $1`,
      [selectionId]
    );
    return rows[0] ?? null;
  }

  async findById(selectionId: string, customerId: string): Promise<SelectionRecord | null> {
    const rows = await this.db.query<SelectionRecord>(
      `SELECT id, customer_id, period_id, status, dietary_preference,
              eligible_days, rule_snapshot, confirmed_at::text AS confirmed_at,
              reference_number, fulfillment_type, pickup_location_id,
              pickup_location_name, delivery_address,
              availability_acknowledged,
              availability_acknowledged_at::text AS availability_acknowledged_at
         FROM rik.entitlement_selections
        WHERE id = $1 AND customer_id = $2`,
      [selectionId, customerId]
    );
    return rows[0] ?? null;
  }

  async listItemsById(selectionId: string): Promise<SelectionItemRecord[]> {
    return this.db.query<SelectionItemRecord>(
      `SELECT id, selection_id, provision_id, pool_id,
              quantity::text AS quantity,
              consumption_ratio::text AS consumption_ratio,
              pool_equivalent_qty::text AS pool_equivalent_qty
         FROM rik.entitlement_selection_items
        WHERE selection_id = $1
        ORDER BY created_at`,
      [selectionId]
    );
  }
}
