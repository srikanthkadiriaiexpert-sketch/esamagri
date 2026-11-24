import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

/**
 * Collection points for a RIK issue (STEP 11E).
 *
 * Business configuration, not code. The facility maintains these from
 * the RIK administration dashboard; nothing here or above it knows that
 * "Naval Park" and "Dolphin Hill" are the two that exist today, and
 * adding a third is an INSERT through a screen, not a deployment.
 *
 * Two reads, deliberately different:
 *
 *   `listActive`  what a CUSTOMER may choose — active, and inside its
 *                 effective window today.
 *   `listAll`     what an ADMINISTRATOR must see — every row including
 *                 the retired ones, because their job includes reading
 *                 the location that is no longer offered.
 *
 * The same split as the entitlement configuration repositories, for the
 * same reason: mixing them is how a retired option reappears in front
 * of a customer.
 */

export interface PickupLocationRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  updated_at: string;
}

const COLUMNS = `id, code, name, description, display_order, is_active,
        effective_from::text AS effective_from,
        effective_to::text   AS effective_to,
        updated_at::text     AS updated_at`;

const ACTIVE_TODAY = `is_active
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`;

@Injectable()
export class PickupLocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Offerable to a customer right now. */
  async listActive(client?: PoolClient): Promise<PickupLocationRecord[]> {
    return this.run<PickupLocationRecord>(
      `SELECT ${COLUMNS} FROM rik.pickup_locations
        WHERE ${ACTIVE_TODAY}
        ORDER BY display_order, name`,
      [],
      client
    );
  }

  /** Every row, for administration. */
  async listAll(client?: PoolClient): Promise<PickupLocationRecord[]> {
    return this.run<PickupLocationRecord>(
      `SELECT ${COLUMNS} FROM rik.pickup_locations ORDER BY display_order, name`,
      [],
      client
    );
  }

  /**
   * One location a customer is allowed to choose, resolved under the
   * same active-today filter as the list. Looking it up by id alone
   * would let a customer name a retired location they once saw.
   */
  async findSelectable(id: string, client?: PoolClient): Promise<PickupLocationRecord | null> {
    const rows = await this.run<PickupLocationRecord>(
      `SELECT ${COLUMNS} FROM rik.pickup_locations
        WHERE id = $1 AND ${ACTIVE_TODAY}`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  async findById(id: string, client?: PoolClient): Promise<PickupLocationRecord | null> {
    const rows = await this.run<PickupLocationRecord>(
      `SELECT ${COLUMNS} FROM rik.pickup_locations WHERE id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  async findByCode(code: string, client?: PoolClient): Promise<PickupLocationRecord | null> {
    const rows = await this.run<PickupLocationRecord>(
      `SELECT ${COLUMNS} FROM rik.pickup_locations WHERE code = $1`,
      [code],
      client
    );
    return rows[0] ?? null;
  }

  async insert(
    input: {
      code: string;
      name: string;
      description: string | null;
      displayOrder: number;
      effectiveFrom: string;
      effectiveTo: string | null;
    },
    actorId: string
  ): Promise<PickupLocationRecord> {
    const rows = await this.run<PickupLocationRecord>(
      `INSERT INTO rik.pickup_locations
         (code, name, description, display_order, effective_from, effective_to, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$7)
       RETURNING ${COLUMNS}`,
      [
        input.code,
        input.name,
        input.description,
        input.displayOrder,
        input.effectiveFrom,
        input.effectiveTo,
        actorId,
      ]
    );
    const created = rows[0];
    if (!created) throw new Error('rik.pickup_locations insert returned no row');
    return created;
  }

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      displayOrder?: number;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      isActive?: boolean;
    },
    actorId: string
  ): Promise<PickupLocationRecord | null> {
    const parts: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown, cast = '') => {
      if (value === undefined) return;
      params.push(value);
      parts.push(`${column} = $${params.length}${cast}`);
    };

    set('name', patch.name);
    set('description', patch.description);
    set('display_order', patch.displayOrder);
    set('effective_from', patch.effectiveFrom, '::date');
    set('effective_to', patch.effectiveTo, '::date');
    set('is_active', patch.isActive);

    if (parts.length === 0) {
      throw new Error('Refusing to UPDATE rik.pickup_locations with no columns to set');
    }

    params.push(actorId, id);
    const rows = await this.run<PickupLocationRecord>(
      `UPDATE rik.pickup_locations
          SET ${parts.join(', ')}, updated_at = now(), updated_by = $${params.length - 1}
        WHERE id = $${params.length}
        RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] ?? null;
  }

  private async run<T extends QueryResultRow>(
    sql: string,
    params: unknown[],
    client?: PoolClient
  ): Promise<T[]> {
    if (client) {
      const result = await client.query<T>(sql, params);
      return result.rows;
    }
    return this.db.query<T>(sql, params);
  }
}
