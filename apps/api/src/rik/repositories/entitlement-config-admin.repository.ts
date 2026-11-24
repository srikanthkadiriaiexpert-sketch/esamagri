import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type {
  ConversionMode,
  DietaryPreference,
  RationType,
} from './entitlement-config.repository';

/**
 * The WRITE side of the RIK entitlement configuration, plus the
 * administrative READ side.
 *
 * Why this is a second repository rather than methods bolted onto
 * EntitlementConfigRepository: the two have deliberately opposite
 * filters, and mixing them is how a calculator accidentally starts
 * using a retired rule.
 *
 *   EntitlementConfigRepository  — what the ENGINE may use.
 *                                  is_active AND inside the effective
 *                                  window as at a given date. Never
 *                                  returns a retired or future row.
 *
 *   this repository              — what an ADMINISTRATOR must see.
 *                                  EVERY row, active or not, expired or
 *                                  not, because an administrator's whole
 *                                  job is to look at the rule that is no
 *                                  longer in force and decide what
 *                                  replaces it.
 *
 * The engine is not touched by anything here. It keeps reading the same
 * four tables through its own repository, so a row written through this
 * class changes the calculation on the very next request with no
 * calculation-code change of any kind. That is the point of STEP 11C:
 * the dashboard is a new way to write the SAME rows the engine already
 * reads, not a parallel source of truth.
 *
 * DELETE is not offered anywhere in this file, and could not work if it
 * were: migration 0025 revoked DELETE on all four configuration tables
 * from app_rik, because a CONFIRMED selection's rule snapshot refers to
 * the configuration that produced it. Retiring a rule means closing it
 * (`is_active = false`, or `effective_to` set), never removing it.
 */

export type ConfigTable =
  | 'rik.entitlement_pools'
  | 'rik.pool_scales'
  | 'rik.pool_conversions'
  | 'rik.provisions';

export interface AdminPoolRow {
  id: string;
  code: string;
  name: string;
  ration_type: RationType;
  unit: string;
  description: string | null;
  /** The category's cover picture (STEP 14B), or null. */
  image_ref: string | null;
  display_order: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminScaleRow {
  id: string;
  pool_id: string;
  pool_code: string;
  pool_name: string;
  pool_unit: string;
  dietary_preference: DietaryPreference;
  daily_qty: string;
  notes: string | null;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminConversionRow {
  id: string;
  code: string;
  from_pool_id: string;
  from_pool_code: string;
  to_pool_id: string;
  to_pool_code: string;
  from_qty: string;
  to_qty: string;
  mode: ConversionMode;
  dietary_preference: DietaryPreference | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminProvisionRow {
  id: string;
  pool_id: string;
  pool_code: string;
  pool_name: string;
  pool_ration_type: RationType;
  code: string;
  name: string;
  /** Catalogue description (STEP 12A). Never read by a calculation. */
  brand: string | null;
  image_ref: string | null;
  pack_unit: string | null;
  unit: string;
  consumption_ratio: string;
  pack_size: string | null;
  is_loose: boolean;
  is_customer_selectable: boolean;
  whole_units_only: boolean;
  max_quantity: string | null;
  max_packs: number | null;
  min_eligible_days: number | null;
  issue_period: RationType;
  dietary_preference: DietaryPreference | null;
  display_order: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoolWriteInput {
  code: string;
  name: string;
  rationType: RationType;
  unit: string;
  description: string | null;
  imageRef: string | null;
  displayOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ScaleWriteInput {
  poolId: string;
  dietaryPreference: DietaryPreference;
  dailyQty: number;
  notes: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ConversionWriteInput {
  code: string;
  fromPoolId: string;
  toPoolId: string;
  fromQty: number;
  toQty: number;
  mode: ConversionMode;
  dietaryPreference: DietaryPreference | null;
  description: string | null;
  displayOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ProvisionWriteInput {
  poolId: string;
  code: string;
  name: string;
  brand: string | null;
  imageRef: string | null;
  packUnit: string | null;
  unit: string;
  consumptionRatio: number;
  packSize: number | null;
  isLoose: boolean;
  isCustomerSelectable: boolean;
  wholeUnitsOnly: boolean;
  maxQuantity: number | null;
  maxPacks: number | null;
  minEligibleDays: number | null;
  issuePeriod: RationType;
  dietaryPreference: DietaryPreference | null;
  displayOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** Any subset of a write input — a PATCH body after validation. */
export type Patch<T> = { [K in keyof T]?: T[K] };

const POOL_COLUMNS = `id, code, name, ration_type, unit, description, image_ref, display_order,
        is_active, effective_from::text AS effective_from, effective_to::text AS effective_to,
        created_at::text AS created_at, updated_at::text AS updated_at`;

const SCALE_COLUMNS = `s.id, s.pool_id, p.code AS pool_code, p.name AS pool_name, p.unit AS pool_unit,
        s.dietary_preference, s.daily_qty::text AS daily_qty, s.notes,
        s.is_active, s.effective_from::text AS effective_from, s.effective_to::text AS effective_to,
        s.created_at::text AS created_at, s.updated_at::text AS updated_at`;

const CONVERSION_COLUMNS = `c.id, c.code, c.from_pool_id, f.code AS from_pool_code,
        c.to_pool_id, t.code AS to_pool_code,
        c.from_qty::text AS from_qty, c.to_qty::text AS to_qty,
        c.mode, c.dietary_preference, c.description, c.display_order,
        c.is_active, c.effective_from::text AS effective_from, c.effective_to::text AS effective_to,
        c.created_at::text AS created_at, c.updated_at::text AS updated_at`;

const PROVISION_COLUMNS = `v.id, v.pool_id, p.code AS pool_code, p.name AS pool_name,
        p.ration_type AS pool_ration_type,
        v.code, v.name, v.brand, v.image_ref, v.pack_unit,
        v.unit, v.consumption_ratio::text AS consumption_ratio,
        v.pack_size::text AS pack_size, v.is_loose, v.is_customer_selectable,
        v.whole_units_only,
        v.max_quantity::text AS max_quantity, v.max_packs, v.min_eligible_days,
        v.issue_period, v.dietary_preference, v.display_order,
        v.is_active, v.effective_from::text AS effective_from, v.effective_to::text AS effective_to,
        v.created_at::text AS created_at, v.updated_at::text AS updated_at`;

@Injectable()
export class EntitlementConfigAdminRepository {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------- pools

  async listPools(client?: PoolClient): Promise<AdminPoolRow[]> {
    return this.run<AdminPoolRow>(
      `SELECT ${POOL_COLUMNS}
         FROM rik.entitlement_pools
        ORDER BY ration_type, display_order, code`,
      [],
      client
    );
  }

  async findPool(id: string, client?: PoolClient): Promise<AdminPoolRow | null> {
    const rows = await this.run<AdminPoolRow>(
      `SELECT ${POOL_COLUMNS} FROM rik.entitlement_pools WHERE id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  async findPoolByCode(code: string, client?: PoolClient): Promise<AdminPoolRow | null> {
    const rows = await this.run<AdminPoolRow>(
      `SELECT ${POOL_COLUMNS} FROM rik.entitlement_pools WHERE code = $1`,
      [code],
      client
    );
    return rows[0] ?? null;
  }

  async insertPool(input: PoolWriteInput, actorId: string, client?: PoolClient): Promise<AdminPoolRow> {
    const rows = await this.run<AdminPoolRow>(
      `INSERT INTO rik.entitlement_pools
         (code, name, ration_type, unit, description, image_ref, display_order,
          effective_from, effective_to, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$10)
       RETURNING ${POOL_COLUMNS}`,
      [
        input.code,
        input.name,
        input.rationType,
        input.unit,
        input.description,
        input.imageRef,
        input.displayOrder,
        input.effectiveFrom,
        input.effectiveTo,
        actorId,
      ],
      client
    );
    return required(rows[0], 'rik.entitlement_pools insert');
  }

  async updatePool(
    id: string,
    patch: Patch<PoolWriteInput> & { isActive?: boolean },
    actorId: string,
    client?: PoolClient
  ): Promise<AdminPoolRow | null> {
    const set = new SetBuilder();
    set.add('name', patch.name);
    set.add('ration_type', patch.rationType);
    set.add('unit', patch.unit);
    set.add('description', patch.description);
    set.add('image_ref', patch.imageRef);
    set.add('display_order', patch.displayOrder);
    set.addCast('effective_from', patch.effectiveFrom, 'date');
    set.addCast('effective_to', patch.effectiveTo, 'date');
    set.add('is_active', patch.isActive);
    return this.applyUpdate<AdminPoolRow>('rik.entitlement_pools', POOL_COLUMNS, id, set, actorId, client);
  }

  // --------------------------------------------------------------- scales

  async listScales(poolId: string | null, client?: PoolClient): Promise<AdminScaleRow[]> {
    return this.run<AdminScaleRow>(
      `SELECT ${SCALE_COLUMNS}
         FROM rik.pool_scales s
         JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE ($1::uuid IS NULL OR s.pool_id = $1::uuid)
        ORDER BY p.ration_type, p.display_order, p.code,
                 s.dietary_preference, s.effective_from DESC`,
      [poolId],
      client
    );
  }

  async findScale(id: string, client?: PoolClient): Promise<AdminScaleRow | null> {
    const rows = await this.run<AdminScaleRow>(
      `SELECT ${SCALE_COLUMNS}
         FROM rik.pool_scales s
         JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE s.id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  /**
   * The row that would collide with the unique version key
   * (pool_id, dietary_preference, effective_from). Used to turn a
   * constraint violation into a clear, specific message before the
   * database has to raise one.
   */
  async findScaleVersion(
    poolId: string,
    dietaryPreference: DietaryPreference,
    effectiveFrom: string,
    client?: PoolClient
  ): Promise<AdminScaleRow | null> {
    const rows = await this.run<AdminScaleRow>(
      `SELECT ${SCALE_COLUMNS}
         FROM rik.pool_scales s
         JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE s.pool_id = $1 AND s.dietary_preference = $2 AND s.effective_from = $3::date`,
      [poolId, dietaryPreference, effectiveFrom],
      client
    );
    return rows[0] ?? null;
  }

  /**
   * Active scale rows for the same pool and diet whose effective window
   * overlaps the candidate window. Two overlapping active scales would
   * make "the scale in force on date X" ambiguous, so the service
   * refuses it — the database's unique key only catches the exact-same
   * start date, not a genuine overlap.
   */
  async findOverlappingScales(
    poolId: string,
    dietaryPreference: DietaryPreference,
    effectiveFrom: string,
    effectiveTo: string | null,
    excludeId: string | null,
    client?: PoolClient
  ): Promise<AdminScaleRow[]> {
    return this.run<AdminScaleRow>(
      `SELECT ${SCALE_COLUMNS}
         FROM rik.pool_scales s
         JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE s.pool_id = $1
          AND s.dietary_preference = $2
          AND s.is_active
          AND ($5::uuid IS NULL OR s.id <> $5::uuid)
          AND daterange(s.effective_from, s.effective_to, '[]')
              && daterange($3::date, $4::date, '[]')
        ORDER BY s.effective_from`,
      [poolId, dietaryPreference, effectiveFrom, effectiveTo, excludeId],
      client
    );
  }

  async insertScale(input: ScaleWriteInput, actorId: string, client?: PoolClient): Promise<AdminScaleRow> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO rik.pool_scales
         (pool_id, dietary_preference, daily_qty, notes, effective_from, effective_to, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$7)
       RETURNING id`,
      [
        input.poolId,
        input.dietaryPreference,
        input.dailyQty,
        input.notes,
        input.effectiveFrom,
        input.effectiveTo,
        actorId,
      ],
      client
    );
    const id = required(rows[0], 'rik.pool_scales insert').id;
    return required(await this.findScale(id, client), 'rik.pool_scales read-back');
  }

  async updateScale(
    id: string,
    patch: Patch<ScaleWriteInput> & { isActive?: boolean },
    actorId: string,
    client?: PoolClient
  ): Promise<AdminScaleRow | null> {
    const set = new SetBuilder();
    set.add('daily_qty', patch.dailyQty);
    set.add('notes', patch.notes);
    set.addCast('effective_from', patch.effectiveFrom, 'date');
    set.addCast('effective_to', patch.effectiveTo, 'date');
    set.add('is_active', patch.isActive);
    const updated = await this.applyUpdate<{ id: string }>('rik.pool_scales', 'id', id, set, actorId, client);
    return updated ? this.findScale(updated.id, client) : null;
  }

  // ---------------------------------------------------------- conversions

  async listConversions(client?: PoolClient): Promise<AdminConversionRow[]> {
    return this.run<AdminConversionRow>(
      `SELECT ${CONVERSION_COLUMNS}
         FROM rik.pool_conversions c
         JOIN rik.entitlement_pools f ON f.id = c.from_pool_id
         JOIN rik.entitlement_pools t ON t.id = c.to_pool_id
        ORDER BY c.display_order, c.code`,
      [],
      client
    );
  }

  async findConversion(id: string, client?: PoolClient): Promise<AdminConversionRow | null> {
    const rows = await this.run<AdminConversionRow>(
      `SELECT ${CONVERSION_COLUMNS}
         FROM rik.pool_conversions c
         JOIN rik.entitlement_pools f ON f.id = c.from_pool_id
         JOIN rik.entitlement_pools t ON t.id = c.to_pool_id
        WHERE c.id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  async findConversionByCode(code: string, client?: PoolClient): Promise<AdminConversionRow | null> {
    const rows = await this.run<AdminConversionRow>(
      `SELECT ${CONVERSION_COLUMNS}
         FROM rik.pool_conversions c
         JOIN rik.entitlement_pools f ON f.id = c.from_pool_id
         JOIN rik.entitlement_pools t ON t.id = c.to_pool_id
        WHERE c.code = $1`,
      [code],
      client
    );
    return rows[0] ?? null;
  }

  async insertConversion(
    input: ConversionWriteInput,
    actorId: string,
    client?: PoolClient
  ): Promise<AdminConversionRow> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO rik.pool_conversions
         (code, from_pool_id, to_pool_id, from_qty, to_qty, mode, dietary_preference,
          description, display_order, effective_from, effective_to, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$12)
       RETURNING id`,
      [
        input.code,
        input.fromPoolId,
        input.toPoolId,
        input.fromQty,
        input.toQty,
        input.mode,
        input.dietaryPreference,
        input.description,
        input.displayOrder,
        input.effectiveFrom,
        input.effectiveTo,
        actorId,
      ],
      client
    );
    const id = required(rows[0], 'rik.pool_conversions insert').id;
    return required(await this.findConversion(id, client), 'rik.pool_conversions read-back');
  }

  async updateConversion(
    id: string,
    patch: Patch<ConversionWriteInput> & { isActive?: boolean },
    actorId: string,
    client?: PoolClient
  ): Promise<AdminConversionRow | null> {
    const set = new SetBuilder();
    set.add('from_pool_id', patch.fromPoolId);
    set.add('to_pool_id', patch.toPoolId);
    set.add('from_qty', patch.fromQty);
    set.add('to_qty', patch.toQty);
    set.add('mode', patch.mode);
    set.add('dietary_preference', patch.dietaryPreference);
    set.add('description', patch.description);
    set.add('display_order', patch.displayOrder);
    set.addCast('effective_from', patch.effectiveFrom, 'date');
    set.addCast('effective_to', patch.effectiveTo, 'date');
    set.add('is_active', patch.isActive);
    const updated = await this.applyUpdate<{ id: string }>('rik.pool_conversions', 'id', id, set, actorId, client);
    return updated ? this.findConversion(updated.id, client) : null;
  }

  // ----------------------------------------------------------- provisions

  async listProvisions(poolId: string | null, client?: PoolClient): Promise<AdminProvisionRow[]> {
    return this.run<AdminProvisionRow>(
      `SELECT ${PROVISION_COLUMNS}
         FROM rik.provisions v
         JOIN rik.entitlement_pools p ON p.id = v.pool_id
        WHERE ($1::uuid IS NULL OR v.pool_id = $1::uuid)
        ORDER BY p.ration_type, p.display_order, p.code, v.display_order, v.code`,
      [poolId],
      client
    );
  }

  async findProvision(id: string, client?: PoolClient): Promise<AdminProvisionRow | null> {
    const rows = await this.run<AdminProvisionRow>(
      `SELECT ${PROVISION_COLUMNS}
         FROM rik.provisions v
         JOIN rik.entitlement_pools p ON p.id = v.pool_id
        WHERE v.id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  async findProvisionByCode(code: string, client?: PoolClient): Promise<AdminProvisionRow | null> {
    const rows = await this.run<AdminProvisionRow>(
      `SELECT ${PROVISION_COLUMNS}
         FROM rik.provisions v
         JOIN rik.entitlement_pools p ON p.id = v.pool_id
        WHERE v.code = $1`,
      [code],
      client
    );
    return rows[0] ?? null;
  }

  async insertProvision(
    input: ProvisionWriteInput,
    actorId: string,
    client?: PoolClient
  ): Promise<AdminProvisionRow> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO rik.provisions
         (pool_id, code, name, brand, image_ref, pack_unit,
          unit, consumption_ratio, pack_size, is_loose,
          is_customer_selectable, whole_units_only, max_quantity, max_packs, min_eligible_days,
          issue_period, dietary_preference, display_order,
          effective_from, effective_to, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::date,$20::date,$21,$21)
       RETURNING id`,
      [
        input.poolId,
        input.code,
        input.name,
        input.brand,
        input.imageRef,
        input.packUnit,
        input.unit,
        input.consumptionRatio,
        input.packSize,
        input.isLoose,
        input.isCustomerSelectable,
        input.wholeUnitsOnly,
        input.maxQuantity,
        input.maxPacks,
        input.minEligibleDays,
        input.issuePeriod,
        input.dietaryPreference,
        input.displayOrder,
        input.effectiveFrom,
        input.effectiveTo,
        actorId,
      ],
      client
    );
    const id = required(rows[0], 'rik.provisions insert').id;
    return required(await this.findProvision(id, client), 'rik.provisions read-back');
  }

  async updateProvision(
    id: string,
    patch: Patch<ProvisionWriteInput> & { isActive?: boolean },
    actorId: string,
    client?: PoolClient
  ): Promise<AdminProvisionRow | null> {
    const set = new SetBuilder();
    set.add('pool_id', patch.poolId);
    set.add('name', patch.name);
    set.add('brand', patch.brand);
    set.add('image_ref', patch.imageRef);
    set.add('pack_unit', patch.packUnit);
    set.add('unit', patch.unit);
    set.add('consumption_ratio', patch.consumptionRatio);
    set.add('pack_size', patch.packSize);
    set.add('is_loose', patch.isLoose);
    set.add('is_customer_selectable', patch.isCustomerSelectable);
    set.add('whole_units_only', patch.wholeUnitsOnly);
    set.add('max_quantity', patch.maxQuantity);
    set.add('max_packs', patch.maxPacks);
    set.add('min_eligible_days', patch.minEligibleDays);
    set.add('issue_period', patch.issuePeriod);
    set.add('dietary_preference', patch.dietaryPreference);
    set.add('display_order', patch.displayOrder);
    set.addCast('effective_from', patch.effectiveFrom, 'date');
    set.addCast('effective_to', patch.effectiveTo, 'date');
    set.add('is_active', patch.isActive);
    const updated = await this.applyUpdate<{ id: string }>('rik.provisions', 'id', id, set, actorId, client);
    return updated ? this.findProvision(updated.id, client) : null;
  }

  // -------------------------------------------------------------- helpers

  private async applyUpdate<T extends { id: string }>(
    table: ConfigTable,
    returning: string,
    id: string,
    set: SetBuilder,
    actorId: string,
    client?: PoolClient
  ): Promise<T | null> {
    if (set.isEmpty) {
      // An empty PATCH never reaches here: RikAdminConfigService rejects
      // a body with no recognised field, because silently reporting
      // success for a request that changed nothing is worse than saying
      // so. This guard exists so that stays true if a future caller
      // bypasses the service.
      throw new Error(`Refusing to UPDATE ${table} with no columns to set`);
    }
    const { clause, params } = set.build();
    const rows = await this.run<T>(
      `UPDATE ${table}
          SET ${clause},
              updated_at = now(),
              updated_by = $${params.length + 1}
        WHERE id = $${params.length + 2}
        RETURNING ${returning}`,
      [...params, actorId, id],
      client
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

function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`${what} returned no row`);
  }
  return value;
}

/**
 * Builds the SET clause of a PATCH from only the fields the caller
 * actually supplied. `undefined` means "not supplied, leave alone";
 * `null` means "supplied as null, write null". Conflating those is how
 * a PATCH silently wipes a column it was never asked to touch.
 */
class SetBuilder {
  private readonly parts: string[] = [];
  private readonly params: unknown[] = [];

  add(column: string, value: unknown): void {
    if (value === undefined) return;
    this.params.push(value);
    this.parts.push(`${column} = $${this.params.length}`);
  }

  addCast(column: string, value: unknown, cast: string): void {
    if (value === undefined) return;
    this.params.push(value);
    this.parts.push(`${column} = $${this.params.length}::${cast}`);
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  build(): { clause: string; params: unknown[] } {
    return { clause: this.parts.join(', '), params: [...this.params] };
  }
}
