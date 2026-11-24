import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

/**
 * Reads the RIK entitlement configuration — pools, per-diet scales,
 * cross-pool conversions and provisions — as it stands on a given date.
 *
 * This repository is the ONLY thing in the engine that knows the
 * configuration exists. Nothing above it holds a scale, a ratio, a
 * product name or a dietary rule: the services consume whatever these
 * rows say. Change a row and the engine changes with it.
 *
 * Every query filters on `is_active` AND the effective-date window, so
 * a rule that has been closed off (effective_to in the past) or not yet
 * started (effective_from in the future) is simply not returned. That is
 * how configuration is versioned without a separate version table:
 * closing one row and opening another is a new generation of the rule.
 */

export type RationType = 'FRESH' | 'DRY';
export type DietaryPreference = 'PV' | 'EV' | 'NV';
export type ConversionMode = 'AUTOMATIC' | 'ELECTIVE';

export interface PoolRecord {
  id: string;
  code: string;
  name: string;
  ration_type: RationType;
  unit: string;
  description: string | null;
  /**
   * The category's cover picture (STEP 14B). Presentation only — no
   * branch of the calculation reads it, and it is NOT a provision
   * picture: this one belongs to the whole allowance, the other to a
   * single item. Null is the ordinary state for a category that has no
   * picture yet, and the screen shows its placeholder for it.
   */
  image_ref: string | null;
  display_order: number;
}

export interface PoolScaleRecord {
  id: string;
  pool_id: string;
  dietary_preference: DietaryPreference;
  daily_qty: string;
  notes: string | null;
}

export interface PoolConversionRecord {
  id: string;
  code: string;
  from_pool_id: string;
  to_pool_id: string;
  from_qty: string;
  to_qty: string;
  mode: ConversionMode;
  dietary_preference: DietaryPreference | null;
  description: string | null;
  display_order: number;
}

export interface ProvisionRecord {
  id: string;
  pool_id: string;
  code: string;
  name: string;
  /**
   * Catalogue description, added in STEP 12A. None of these three is
   * read by any calculation — they exist so a customer can tell one
   * Paneer from another. `unit` below remains the ENTITLEMENT unit.
   */
  brand: string | null;
  image_ref: string | null;
  pack_unit: string | null;
  unit: string;
  consumption_ratio: string;
  pack_size: string | null;
  is_loose: boolean;
  is_customer_selectable: boolean;
  /**
   * A whole number of this provision's own units, or nothing. A physical
   * coupon cannot be issued in halves. Separate from `pack_size`, which is a
   * quantity CEILING when paired with max_packs and never a step — the three
   * packed cereal items have a pack size and are not whole-units-only.
   */
  whole_units_only: boolean;
  max_quantity: string | null;
  max_packs: number | null;
  min_eligible_days: number | null;
  issue_period: RationType;
  dietary_preference: DietaryPreference | null;
  display_order: number;
}

/** Everything the engine needs for one calculation, read once. */
export interface EntitlementConfiguration {
  asOf: string;
  pools: PoolRecord[];
  scales: PoolScaleRecord[];
  conversions: PoolConversionRecord[];
  provisions: ProvisionRecord[];
}

const ACTIVE_WINDOW = `is_active
      AND effective_from <= $1::date
      AND (effective_to IS NULL OR effective_to >= $1::date)`;

@Injectable()
export class EntitlementConfigRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The whole active configuration as at `asOf` (default: today).
   * Read in one round trip per table rather than per pool, because the
   * engine needs the full graph to resolve cross-pool conversions.
   */
  async loadConfiguration(asOf: string, client?: PoolClient): Promise<EntitlementConfiguration> {
    const run = async <T extends QueryResultRow>(sql: string): Promise<T[]> => {
      if (client) {
        const result = await client.query<T>(sql, [asOf]);
        return result.rows;
      }
      return this.db.query<T>(sql, [asOf]);
    };

    const [pools, scales, conversions, provisions] = await Promise.all([
      run<PoolRecord>(
        `SELECT id, code, name, ration_type, unit, description, image_ref, display_order
           FROM rik.entitlement_pools
          WHERE ${ACTIVE_WINDOW}
          ORDER BY display_order, code`
      ),
      run<PoolScaleRecord>(
        `SELECT id, pool_id, dietary_preference, daily_qty::text AS daily_qty, notes
           FROM rik.pool_scales
          WHERE ${ACTIVE_WINDOW}
          ORDER BY pool_id, dietary_preference, effective_from DESC`
      ),
      run<PoolConversionRecord>(
        `SELECT id, code, from_pool_id, to_pool_id,
                from_qty::text AS from_qty, to_qty::text AS to_qty,
                mode, dietary_preference, description, display_order
           FROM rik.pool_conversions
          WHERE ${ACTIVE_WINDOW}
          ORDER BY display_order, code`
      ),
      run<ProvisionRecord>(
        `SELECT id, pool_id, code, name, brand, image_ref, pack_unit, unit,
                consumption_ratio::text AS consumption_ratio,
                pack_size::text AS pack_size,
                is_loose, is_customer_selectable, whole_units_only,
                max_quantity::text AS max_quantity,
                max_packs, min_eligible_days, issue_period,
                dietary_preference, display_order
           FROM rik.provisions
          WHERE ${ACTIVE_WINDOW}
          ORDER BY pool_id, display_order, code`
      ),
    ]);

    return { asOf, pools, scales, conversions, provisions };
  }

  /** One provision by id, subject to the same active/effective filter. */
  async findActiveProvision(
    provisionId: string,
    asOf: string,
    client?: PoolClient
  ): Promise<ProvisionRecord | null> {
    const sql = `SELECT id, pool_id, code, name, brand, image_ref, pack_unit, unit,
                        consumption_ratio::text AS consumption_ratio,
                        pack_size::text AS pack_size,
                        is_loose, is_customer_selectable, whole_units_only,
                        max_quantity::text AS max_quantity,
                        max_packs, min_eligible_days, issue_period,
                        dietary_preference, display_order
                   FROM rik.provisions
                  WHERE id = $2
                    AND ${ACTIVE_WINDOW}`;
    const rows = client
      ? (await client.query<ProvisionRecord>(sql, [asOf, provisionId])).rows
      : await this.db.query<ProvisionRecord>(sql, [asOf, provisionId]);
    return rows[0] ?? null;
  }
}
