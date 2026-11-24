import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Officer records, for RIK administration (STEP 15B Phase A).
 *
 * RECONSTRUCTED from the approved Phase A report after the working container
 * was lost; not the recovered original bytes.
 *
 * An officer IS a `shared.customers` row — the same row the customer app
 * authenticates against. This repository is the administrative view of it:
 * it reads and writes the three columns migration 0044 added (`rik_id`,
 * `official_name`, `created_by`) alongside the pre-existing identity fields,
 * and it creates the officer's residence in the same transaction.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO
 *
 *   * it never writes `rik_id`. The column's DEFAULT calls
 *     shared.format_officer_rik_id(nextval(...)), so the identifier is issued
 *     at the database boundary; the INSERT below omits the column entirely so
 *     that default fires. There is no code path in this application that can
 *     compose, supply or alter a RIK ID.
 *   * it has no delete. An officer's RIK ID appears on issue records that must
 *     stay readable, so an officer is DEACTIVATED (`is_active = false`) and
 *     never removed. `setActive` is the only state change offered.
 */

export interface OfficerRecord {
  id: string;
  /**
   * NULL for a PIF-only resident, who is a shared.customers row with no
   * officer identifier. Nullable from migration 0065 onward; every officer
   * ever registered through this repository has one.
   */
  rik_id: string | null;
  name: string;
  official_name: string | null;
  mobile_number: string;
  dietary_preference: 'PV' | 'EV' | 'NV' | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  quarter_block: string | null;
  quarter_number: string | null;
  landmark: string | null;
  /**
   * Set when the row has been soft-deleted. Selected because the linking
   * decision needs it: a mobile number belonging to a REMOVED account must be
   * refused, not quietly linked. mobile_number is UNIQUE across the whole
   * table, soft-deleted rows included, so the service cannot simply ignore
   * them.
   */
  deleted_at: string | null;
}

/**
 * Linking an existing resident, rather than creating a row.
 *
 * No `dietaryPreference`: the resident's own value is never overwritten by a
 * staff member (approved decision T2-2). No `name` either: their chosen
 * display name stays theirs, and the facility's spelling goes to
 * `official_name` (T2-3).
 */
export interface LinkOfficerInput {
  customerId: string;
  officialName: string;
  quarterBlock: string;
  quarterNumber: string;
  landmark: string | null;
  createdBy: string | null;
}

export interface CreateOfficerInput {
  name: string;
  officialName: string;
  mobileNumber: string;
  quarterBlock: string;
  quarterNumber: string;
  landmark: string | null;
  dietaryPreference: 'PV' | 'EV' | 'NV';
  createdBy: string | null;
}

/**
 * One officer with their default residence. A LEFT JOIN, because the address
 * is a separate table and an officer who somehow has none must still be
 * readable rather than vanishing from the list.
 */
const SELECT_OFFICER = `
  SELECT c.id,
         c.rik_id,
         c.name,
         c.official_name,
         c.mobile_number,
         c.dietary_preference,
         c.is_active,
         c.created_at,
         c.created_by,
         a.quarter_block,
         a.quarter_number,
         a.landmark,
         c.deleted_at
    FROM shared.customers c
    LEFT JOIN shared.customer_addresses a
           ON a.customer_id = c.id AND a.is_default`;

@Injectable()
export class OfficersRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * `c.rik_id IS NOT NULL` here and in `search`/`count` is not decoration.
   * Once a PIF-only resident can exist, shared.customers holds rows that are
   * NOT officers, and these queries previously selected every customer with
   * `deleted_at IS NULL`. Without this predicate the RIK officers list would
   * silently fill with PIF residents, and `get`/`setActive` would operate on
   * one by id. An officer is a customer WITH an identifier; nothing else is.
   */
  async findById(officerId: string): Promise<OfficerRecord | null> {
    const rows = await this.db.query<OfficerRecord>(
      `${SELECT_OFFICER} WHERE c.id = $1 AND c.rik_id IS NOT NULL AND c.deleted_at IS NULL`,
      [officerId]
    );
    return rows[0] ?? null;
  }

  /**
   * The row behind a mobile number, officer or not, for the linking decision.
   *
   * Distinct from `findAnyByMobile` only in intent: this is the call that asks
   * "is this resident already in the system, and are they already an officer?"
   * It includes soft-deleted rows for the same reason findAnyByMobile does —
   * mobile_number is UNIQUE across the whole table.
   */
  async findCustomerByMobile(mobileNumber: string): Promise<OfficerRecord | null> {
    return this.findAnyByMobile(mobileNumber);
  }

  async findByRikId(rikId: string): Promise<OfficerRecord | null> {
    const rows = await this.db.query<OfficerRecord>(
      `${SELECT_OFFICER} WHERE c.rik_id = $1 AND c.deleted_at IS NULL`,
      [rikId]
    );
    return rows[0] ?? null;
  }

  /**
   * Mobile lookup that INCLUDES soft-deleted officers.
   *
   * Deliberate. `shared.customers.mobile_number` is UNIQUE across the whole
   * table, soft-deleted rows included, so a registration reusing a
   * soft-deleted officer's number would fail on the constraint with a
   * database error. This lets the service refuse it by name instead.
   */
  async findAnyByMobile(mobileNumber: string): Promise<OfficerRecord | null> {
    const rows = await this.db.query<OfficerRecord>(
      `${SELECT_OFFICER} WHERE c.mobile_number = $1`,
      [mobileNumber]
    );
    return rows[0] ?? null;
  }

  /**
   * The officers list, searchable by the four things an administrator has in
   * front of them: the RIK ID, the name (either spelling), the mobile number
   * or the quarter.
   *
   * The search is a plain case-insensitive substring match. It is a lookup
   * aid, not a matching rule — nothing in this application resolves an
   * officer's identity by name similarity.
   */
  async search(params: { q?: string; limit: number; offset: number }): Promise<OfficerRecord[]> {
    const { q, limit, offset } = params;
    if (q === undefined || q.trim() === '') {
      return this.db.query<OfficerRecord>(
        `${SELECT_OFFICER}
          WHERE c.rik_id IS NOT NULL AND c.deleted_at IS NULL
          ORDER BY c.rik_id
          LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }
    const needle = `%${q.trim()}%`;
    return this.db.query<OfficerRecord>(
      `${SELECT_OFFICER}
        WHERE c.rik_id IS NOT NULL AND c.deleted_at IS NULL
          AND (c.rik_id ILIKE $1
            OR c.name ILIKE $1
            OR c.official_name ILIKE $1
            OR c.mobile_number ILIKE $1
            OR a.quarter_block ILIKE $1
            OR a.quarter_number ILIKE $1)
        ORDER BY c.rik_id
        LIMIT $2 OFFSET $3`,
      [needle, limit, offset]
    );
  }

  async count(q?: string): Promise<number> {
    if (q === undefined || q.trim() === '') {
      const rows = await this.db.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM shared.customers
          WHERE rik_id IS NOT NULL AND deleted_at IS NULL`
      );
      return Number(rows[0]!.total);
    }
    const needle = `%${q.trim()}%`;
    const rows = await this.db.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM shared.customers c
         LEFT JOIN shared.customer_addresses a ON a.customer_id = c.id AND a.is_default
        WHERE c.rik_id IS NOT NULL AND c.deleted_at IS NULL
          AND (c.rik_id ILIKE $1
            OR c.name ILIKE $1
            OR c.official_name ILIKE $1
            OR c.mobile_number ILIKE $1
            OR a.quarter_block ILIKE $1
            OR a.quarter_number ILIKE $1)`,
      [needle]
    );
    return Number(rows[0]!.total);
  }

  /**
   * Register an officer and their residence in ONE transaction.
   *
   * Either both rows exist or neither does: an officer with no quarter cannot
   * be delivered to, and a half-registered officer would still have consumed
   * a RIK ID — which is never reused — so the identifier would be burnt on a
   * record nobody can use.
   *
   * `rik_id` is absent from the column list on purpose. See the class comment.
   */
  async create(input: CreateOfficerInput): Promise<OfficerRecord> {
    const id = await this.db.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO shared.customers
           (mobile_number, name, official_name, dietary_preference, is_active, created_by)
         VALUES ($1, $2, $3, $4, true, $5)
         RETURNING id`,
        [
          input.mobileNumber,
          input.name,
          input.officialName,
          input.dietaryPreference,
          input.createdBy,
        ]
      );
      const officerId = inserted.rows[0]!.id;

      await client.query(
        `INSERT INTO shared.customer_addresses
           (customer_id, label, quarter_block, quarter_number, landmark, is_default)
         VALUES ($1, 'Quarter', $2, $3, $4, true)`,
        [officerId, input.quarterBlock, input.quarterNumber, input.landmark]
      );

      return officerId;
    });

    const officer = await this.findById(id);
    // The row was just committed in this process; a null here would mean the
    // transaction lied about its own result.
    if (officer === null) {
      throw new Error(`Officer ${id} was created but cannot be read back.`);
    }
    return officer;
  }

  /**
   * Link an EXISTING resident to a newly issued RIK ID, in ONE transaction.
   *
   * This is the Scenario 3 path: a resident who already uses PIF is registered
   * as an officer by RIK staff. It is an UPDATE, never an INSERT, so:
   *
   *   * the customer's `id` does not change, and every row that references it
   *     — their PIF cart, orders, order items, order events, addresses — stays
   *     valid with no cascade and nothing rewritten;
   *   * `name` is untouched, so the display name they chose remains theirs;
   *   * `dietary_preference` is untouched, so their own value (or NULL) stands;
   *   * no second customer row is created, so there is no duplicate to
   *     reconcile later.
   *
   * `rik_id` IS in the SET list, and the value sent is a PLACEHOLDER that is
   * never stored. Migration 0065's BEFORE UPDATE trigger discards it and
   * substitutes shared.format_officer_rik_id(nextval(...)), which is why this
   * repository still cannot compose, supply or choose a RIK ID — the class
   * comment above holds unchanged. `AND rik_id IS NULL` makes a concurrent
   * second attempt update zero rows instead of issuing a second identifier.
   *
   * UNTIL MIGRATION 0065 IS APPLIED THIS WILL FAIL at the database, because
   * rik_id is still NOT NULL and the 0044 trigger refuses every change to it.
   * That is expected and deliberate: the application code is complete and the
   * schema change is a separate, reviewed deliverable.
   */
  async linkExistingCustomer(input: LinkOfficerInput): Promise<OfficerRecord | null> {
    const linked = await this.db.withTransaction(async (client) => {
      const updated = await client.query<{ id: string }>(
        `UPDATE shared.customers
            SET rik_id        = 'PENDING',
                official_name = $2,
                created_by    = COALESCE(created_by, $3),
                updated_at    = now()
          WHERE id = $1
            AND rik_id IS NULL
            AND deleted_at IS NULL
        RETURNING id`,
        [input.customerId, input.officialName, input.createdBy]
      );
      if (updated.rows.length === 0) return null;

      // A resident who registered through PIF already gave their quarter, so
      // the usual case is that this inserts nothing. An officer with no
      // address cannot be delivered to, so one is created when absent rather
      // than leaving the record half usable.
      await client.query(
        `INSERT INTO shared.customer_addresses
           (customer_id, label, quarter_block, quarter_number, landmark, is_default)
         SELECT $1, 'Quarter', $2, $3, $4, true
          WHERE NOT EXISTS (
            SELECT 1 FROM shared.customer_addresses
             WHERE customer_id = $1 AND is_default
          )`,
        [input.customerId, input.quarterBlock, input.quarterNumber, input.landmark]
      );

      return input.customerId;
    });

    return linked === null ? null : this.findById(linked);
  }

  /**
   * Activate or deactivate. The WHERE pins `is_active` to the opposite value
   * so a no-op update is distinguishable from a missing officer: a null
   * result means either, and the service has already read the officer.
   */
  async setActive(officerId: string, isActive: boolean): Promise<OfficerRecord | null> {
    await this.db.query(
      `UPDATE shared.customers
          SET is_active = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [officerId, isActive]
    );
    return this.findById(officerId);
  }
}
