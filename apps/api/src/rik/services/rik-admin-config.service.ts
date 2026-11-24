import { Injectable, Logger } from '@nestjs/common';
import { AuditLogRepository, type AuditEntryRecord } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import {
  EntitlementConfigAdminRepository,
  type AdminConversionRow,
  type AdminPoolRow,
  type AdminProvisionRow,
  type AdminScaleRow,
  type ConfigTable,
} from '../repositories/entitlement-config-admin.repository';
import type {
  ConversionMode,
  DietaryPreference,
  RationType,
} from '../repositories/entitlement-config.repository';
import {
  PickupLocationsRepository,
  type PickupLocationRecord,
} from '../repositories/pickup-locations.repository';

/**
 * RIK entitlement configuration administration (STEP 11C).
 *
 * What this service is for, in one sentence: it is the ONLY way, other
 * than SQL, to change the four tables the STEP 11B engine reads — and
 * it changes exactly those tables, so a change made here is in force on
 * the engine's very next calculation without a single line of
 * calculation code being touched.
 *
 * Three rules govern everything below.
 *
 * 1. VALIDATION IS SERVER-SIDE AND EXHAUSTIVE. Every rule in this file
 *    is enforced here, regardless of what any screen does or does not
 *    offer. The admin console has no validation of its own beyond the
 *    ordinary "this field is required" affordances — it cannot, because
 *    it is not the authority. The tests exercise these paths through
 *    HTTP, not through the UI.
 *
 * 2. CONFIGURATION IS CLOSED, NEVER DELETED. There is no delete method
 *    here and there could not be one: migration 0025 revoked DELETE on
 *    all four tables from app_rik precisely because a CONFIRMED
 *    selection's rule snapshot refers to the configuration that produced
 *    it. "Remove this rule" means `is_active = false`, or an
 *    `effective_to` that closes it off on a date.
 *
 * 3. EVERY WRITE IS AUDITED, with the before and after values, through
 *    the existing shared.audit_log path (shared.log_audit_event). No
 *    second audit system was introduced, and the table is append-only
 *    with a trigger that rejects UPDATE and DELETE outright — so the
 *    Rule history screen shows a record that cannot be edited after the
 *    fact, by anyone.
 *
 * There is no business rule in this file. It knows that a ratio must be
 * positive and that two active scales for the same pool and diet cannot
 * overlap; it does not know what any ratio IS, what any pool is called,
 * or what any diet is entitled to. Those live in rows.
 */

export type ConfigValidationCode =
  | 'INVALID_RATIO'
  | 'NEGATIVE_ENTITLEMENT'
  | 'INVALID_PACK_SIZE'
  | 'INVALID_MAX_QUANTITY'
  | 'INVALID_MAX_PACKS'
  | 'INVALID_MIN_ELIGIBLE_DAYS'
  | 'INVALID_DIETARY_PREFERENCE'
  | 'INVALID_RATION_TYPE'
  | 'INVALID_UNIT'
  | 'INVALID_CONVERSION_MODE'
  | 'INVALID_EFFECTIVE_RANGE'
  | 'INVALID_CONVERSION_QUANTITY'
  | 'CONVERSION_POOLS_IDENTICAL'
  | 'DUPLICATE_SCALE_VERSION'
  | 'OVERLAPPING_SCALE'
  | 'DUPLICATE_CODE'
  | 'POOL_NOT_FOUND'
  | 'LOOSE_ITEM_CANNOT_HAVE_PACK_SIZE'
  | 'BLANK_FIELD'
  | 'INVALID_PACK_UNIT'
  | 'INVALID_CODE_FORMAT'
  | 'NO_CHANGES_SUPPLIED';

/** A refusal with a machine-readable reason and the field that caused it. */
export class ConfigValidationError extends Error {
  readonly code: ConfigValidationCode;
  readonly field: string | null;
  readonly detail: Record<string, unknown>;

  constructor(code: ConfigValidationCode, message: string, field: string | null = null, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ConfigValidationError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

export class ConfigRecordNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = 'ConfigRecordNotFoundError';
  }
}

const DIETARY_VALUES: readonly DietaryPreference[] = ['PV', 'EV', 'NV'];
const RATION_TYPES: readonly RationType[] = ['FRESH', 'DRY'];
const UNITS: readonly string[] = ['g', 'ml', 'piece'];
const CONVERSION_MODES: readonly ConversionMode[] = ['AUTOMATIC', 'ELECTIVE'];

/**
 * What a pack may be CALLED. Deliberately a closed set: free text drifts
 * into "pkt", "Packet" and "packets" across a catalogue several people
 * maintain. This is presentation only and is NOT the entitlement unit —
 * see rik.provisions.pack_unit.
 */
const PACK_UNITS: readonly string[] = ['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'tin', 'box'];

/** The entity types this module writes — also the Rule history filter. */
export type RikConfigEntityType = ConfigTable | 'rik.pickup_locations';

export const RIK_CONFIG_ENTITY_TYPES: readonly RikConfigEntityType[] = [
  'rik.entitlement_pools',
  'rik.pool_scales',
  'rik.pool_conversions',
  'rik.provisions',
  'rik.pickup_locations',
];

export interface PoolInput {
  code: string;
  name: string;
  rationType: string;
  unit: string;
  description?: string | null;
  /** The category's cover picture. Presentation only, and optional. */
  imageRef?: string | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface PoolPatchInput {
  name?: string;
  rationType?: string;
  unit?: string;
  description?: string | null;
  imageRef?: string | null;
  displayOrder?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface ScaleInput {
  poolId: string;
  dietaryPreference: string;
  dailyQty: number;
  notes?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface ScalePatchInput {
  dailyQty?: number;
  notes?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface ConversionInput {
  code: string;
  fromPoolId: string;
  toPoolId: string;
  fromQty: number;
  toQty: number;
  mode: string;
  dietaryPreference?: string | null;
  description?: string | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface ConversionPatchInput {
  fromPoolId?: string;
  toPoolId?: string;
  fromQty?: number;
  toQty?: number;
  mode?: string;
  dietaryPreference?: string | null;
  description?: string | null;
  displayOrder?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface ProvisionInput {
  poolId: string;
  code: string;
  name: string;
  /**
   * Catalogue description (STEP 12A). Brand is a SEPARATE field, not
   * part of the name: "Paneer" made by "Amul", so the same provision
   * can be stocked from several brands without being duplicated.
   */
  brand?: string | null;
  imageRef?: string | null;
  packUnit?: string | null;
  unit: string;
  consumptionRatio: number;
  packSize?: number | null;
  isLoose?: boolean;
  isCustomerSelectable?: boolean;
  /** Whole units only — a physical coupon cannot be issued in halves. */
  wholeUnitsOnly?: boolean;
  maxQuantity?: number | null;
  maxPacks?: number | null;
  minEligibleDays?: number | null;
  issuePeriod: string;
  dietaryPreference?: string | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface ProvisionPatchInput {
  poolId?: string;
  name?: string;
  brand?: string | null;
  imageRef?: string | null;
  packUnit?: string | null;
  unit?: string;
  consumptionRatio?: number;
  packSize?: number | null;
  isLoose?: boolean;
  isCustomerSelectable?: boolean;
  /** Whole units only — a physical coupon cannot be issued in halves. */
  wholeUnitsOnly?: boolean;
  maxQuantity?: number | null;
  maxPacks?: number | null;
  minEligibleDays?: number | null;
  issuePeriod?: string;
  dietaryPreference?: string | null;
  displayOrder?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

@Injectable()
export class RikAdminConfigService {
  private readonly logger = new Logger(RikAdminConfigService.name);

  constructor(
    private readonly repo: EntitlementConfigAdminRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly pickupLocations: PickupLocationsRepository
  ) {}

  // ====================================================== pickup locations
  //
  // Where a customer may collect a RIK issue. Added in STEP 11E so the
  // facility can add, rename or retire a collection point from this
  // dashboard — the alternative was a developer running SQL every time
  // the facility opened a new counter, which is exactly what the
  // client asked not to depend on.
  //
  // Retired, never deleted: a confirmed selection names one. The
  // selection also snapshots the NAME, so even renaming a location
  // cannot rewrite an issue already agreed.

  listPickupLocations(): Promise<PickupLocationRecord[]> {
    return this.pickupLocations.listAll();
  }

  async createPickupLocation(
    context: AuthContext,
    input: {
      code: string;
      name: string;
      description?: string | null;
      displayOrder?: number;
      effectiveFrom: string;
      effectiveTo?: string | null;
    }
  ): Promise<PickupLocationRecord> {
    const code = requireCode(input.code);
    const name = requireText(input.name, 'name');
    const effectiveFrom = requireDate(input.effectiveFrom, 'effectiveFrom');
    const effectiveTo = optionalDate(input.effectiveTo, 'effectiveTo');
    requireRange(effectiveFrom, effectiveTo);

    if (await this.pickupLocations.findByCode(code)) {
      throw new ConfigValidationError('DUPLICATE_CODE', `A collection point with code "${code}" already exists.`, 'code');
    }

    const created = await this.pickupLocations.insert(
      {
        code,
        name,
        description: input.description ?? null,
        displayOrder: input.displayOrder ?? 0,
        effectiveFrom,
        effectiveTo,
      },
      context.principalId
    );

    await this.audit(
      context,
      'RIK_CONFIG_PICKUP_LOCATION_CREATED',
      'rik.pickup_locations',
      created.id,
      null,
      pickupLocationAudit(created)
    );
    return created;
  }

  async updatePickupLocation(
    context: AuthContext,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      displayOrder?: number;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      isActive?: boolean;
    }
  ): Promise<PickupLocationRecord> {
    const before = await this.pickupLocations.findById(id);
    if (!before) throw new ConfigRecordNotFoundError('That collection point');

    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) clean.name = requireText(patch.name, 'name');
    if (patch.description !== undefined) clean.description = patch.description;
    if (patch.displayOrder !== undefined) clean.displayOrder = patch.displayOrder;
    if (patch.effectiveFrom !== undefined) clean.effectiveFrom = requireDate(patch.effectiveFrom, 'effectiveFrom');
    if (patch.effectiveTo !== undefined) clean.effectiveTo = optionalDate(patch.effectiveTo, 'effectiveTo');
    if (patch.isActive !== undefined) clean.isActive = patch.isActive;
    requireSomething(clean);

    requireRange(
      (clean.effectiveFrom as string | undefined) ?? before.effective_from,
      patch.effectiveTo !== undefined ? (clean.effectiveTo as string | null) : before.effective_to
    );

    const updated = await this.pickupLocations.update(id, clean, context.principalId);
    if (!updated) throw new ConfigRecordNotFoundError('That collection point');

    await this.audit(
      context,
      'RIK_CONFIG_PICKUP_LOCATION_UPDATED',
      'rik.pickup_locations',
      id,
      pickupLocationAudit(before),
      pickupLocationAudit(updated)
    );
    return updated;
  }

  setPickupLocationActive(context: AuthContext, id: string, isActive: boolean): Promise<PickupLocationRecord> {
    return this.updatePickupLocation(context, id, { isActive });
  }

  // ================================================================ pools

  listPools(): Promise<AdminPoolRow[]> {
    return this.repo.listPools();
  }

  async createPool(context: AuthContext, input: PoolInput): Promise<AdminPoolRow> {
    const code = requireCode(input.code);
    const rationType = requireRationType(input.rationType, 'rationType');
    const unit = requireUnit(input.unit, 'unit');
    const effectiveFrom = requireDate(input.effectiveFrom, 'effectiveFrom');
    const effectiveTo = optionalDate(input.effectiveTo, 'effectiveTo');
    requireRange(effectiveFrom, effectiveTo);

    if (await this.repo.findPoolByCode(code)) {
      throw new ConfigValidationError('DUPLICATE_CODE', `A pool with code "${code}" already exists.`, 'code');
    }

    const created = await this.repo.insertPool(
      {
        code,
        name: requireText(input.name, 'name'),
        rationType,
        unit,
        description: input.description ?? null,
        imageRef: optionalText(input.imageRef),
        displayOrder: input.displayOrder ?? 0,
        effectiveFrom,
        effectiveTo,
      },
      context.principalId
    );

    await this.audit(context, 'RIK_CONFIG_POOL_CREATED', 'rik.entitlement_pools', created.id, null, poolAudit(created));
    return created;
  }

  async updatePool(context: AuthContext, id: string, patch: PoolPatchInput): Promise<AdminPoolRow> {
    const before = await this.repo.findPool(id);
    if (!before) throw new ConfigRecordNotFoundError('That entitlement pool');

    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) clean.name = requireText(patch.name, 'name');
    if (patch.rationType !== undefined) clean.rationType = requireRationType(patch.rationType, 'rationType');
    if (patch.unit !== undefined) clean.unit = requireUnit(patch.unit, 'unit');
    if (patch.description !== undefined) clean.description = patch.description;
    if (patch.imageRef !== undefined) clean.imageRef = optionalText(patch.imageRef);
    if (patch.displayOrder !== undefined) clean.displayOrder = patch.displayOrder;
    if (patch.effectiveFrom !== undefined) clean.effectiveFrom = requireDate(patch.effectiveFrom, 'effectiveFrom');
    if (patch.effectiveTo !== undefined) clean.effectiveTo = optionalDate(patch.effectiveTo, 'effectiveTo');
    if (patch.isActive !== undefined) clean.isActive = patch.isActive;
    requireSomething(clean);

    requireRange(
      (clean.effectiveFrom as string | undefined) ?? before.effective_from,
      patch.effectiveTo !== undefined ? (clean.effectiveTo as string | null) : before.effective_to
    );

    const updated = await this.repo.updatePool(id, clean, context.principalId);
    if (!updated) throw new ConfigRecordNotFoundError('That entitlement pool');

    await this.audit(
      context,
      'RIK_CONFIG_POOL_UPDATED',
      'rik.entitlement_pools',
      id,
      poolAudit(before),
      poolAudit(updated)
    );
    return updated;
  }

  /**
   * Retire or restore a pool. There is no delete: a pool that produced
   * a confirmed selection must remain readable forever.
   */
  setPoolActive(context: AuthContext, id: string, isActive: boolean): Promise<AdminPoolRow> {
    return this.updatePool(context, id, { isActive });
  }

  // =============================================================== scales

  listScales(poolId: string | null): Promise<AdminScaleRow[]> {
    return this.repo.listScales(poolId);
  }

  async createScale(context: AuthContext, input: ScaleInput): Promise<AdminScaleRow> {
    const dietaryPreference = requireDietary(input.dietaryPreference, 'dietaryPreference');
    const dailyQty = requireNonNegative(input.dailyQty, 'dailyQty', 'NEGATIVE_ENTITLEMENT');
    const effectiveFrom = requireDate(input.effectiveFrom, 'effectiveFrom');
    const effectiveTo = optionalDate(input.effectiveTo, 'effectiveTo');
    requireRange(effectiveFrom, effectiveTo);

    const pool = await this.repo.findPool(input.poolId);
    if (!pool) {
      throw new ConfigValidationError('POOL_NOT_FOUND', 'That entitlement pool does not exist.', 'poolId');
    }

    await this.assertScaleVersionFree(input.poolId, dietaryPreference, effectiveFrom, effectiveTo, null);

    const created = await this.repo.insertScale(
      { poolId: input.poolId, dietaryPreference, dailyQty, notes: input.notes ?? null, effectiveFrom, effectiveTo },
      context.principalId
    );

    await this.audit(context, 'RIK_CONFIG_SCALE_CREATED', 'rik.pool_scales', created.id, null, scaleAudit(created));
    return created;
  }

  async updateScale(context: AuthContext, id: string, patch: ScalePatchInput): Promise<AdminScaleRow> {
    const before = await this.repo.findScale(id);
    if (!before) throw new ConfigRecordNotFoundError('That daily scale');

    const clean: Record<string, unknown> = {};
    if (patch.dailyQty !== undefined) {
      clean.dailyQty = requireNonNegative(patch.dailyQty, 'dailyQty', 'NEGATIVE_ENTITLEMENT');
    }
    if (patch.notes !== undefined) clean.notes = patch.notes;
    if (patch.effectiveFrom !== undefined) clean.effectiveFrom = requireDate(patch.effectiveFrom, 'effectiveFrom');
    if (patch.effectiveTo !== undefined) clean.effectiveTo = optionalDate(patch.effectiveTo, 'effectiveTo');
    if (patch.isActive !== undefined) clean.isActive = patch.isActive;
    requireSomething(clean);

    const nextFrom = (clean.effectiveFrom as string | undefined) ?? before.effective_from;
    const nextTo = patch.effectiveTo !== undefined ? (clean.effectiveTo as string | null) : before.effective_to;
    requireRange(nextFrom, nextTo);

    const willBeActive = patch.isActive !== undefined ? patch.isActive : before.is_active;
    if (willBeActive) {
      await this.assertScaleVersionFree(before.pool_id, before.dietary_preference, nextFrom, nextTo, id);
    }

    const updated = await this.repo.updateScale(id, clean, context.principalId);
    if (!updated) throw new ConfigRecordNotFoundError('That daily scale');

    await this.audit(context, 'RIK_CONFIG_SCALE_UPDATED', 'rik.pool_scales', id, scaleAudit(before), scaleAudit(updated));
    return updated;
  }

  setScaleActive(context: AuthContext, id: string, isActive: boolean): Promise<AdminScaleRow> {
    return this.updateScale(context, id, { isActive });
  }

  /**
   * Change a scale from a date forward WITHOUT rewriting history: the
   * current row is closed the day before the new one opens, and a new
   * row carries the new quantity.
   *
   * This is the operation the effective-dated design exists for. Editing
   * `daily_qty` in place is also offered (correcting a typo in a rule
   * that was never right), but editing in place changes what a past
   * calculation WOULD now produce — superseding does not, because the
   * old row is still there, still readable, with the window it applied
   * to. A selection already CONFIRMED is unaffected either way; its
   * JSONB rule snapshot is what reproduces it.
   */
  async supersedeScale(
    context: AuthContext,
    id: string,
    input: { dailyQty: number; effectiveFrom: string; notes?: string | null }
  ): Promise<{ closed: AdminScaleRow; created: AdminScaleRow }> {
    const current = await this.repo.findScale(id);
    if (!current) throw new ConfigRecordNotFoundError('That daily scale');

    const dailyQty = requireNonNegative(input.dailyQty, 'dailyQty', 'NEGATIVE_ENTITLEMENT');
    const newFrom = requireDate(input.effectiveFrom, 'effectiveFrom');

    if (newFrom <= current.effective_from) {
      throw new ConfigValidationError(
        'INVALID_EFFECTIVE_RANGE',
        `The new rule must start after the one it replaces (which starts ${current.effective_from}).`,
        'effectiveFrom',
        { currentEffectiveFrom: current.effective_from }
      );
    }

    const closeOn = previousDay(newFrom);
    await this.assertScaleVersionFree(current.pool_id, current.dietary_preference, newFrom, null, id);

    const closed = await this.repo.updateScale(id, { effectiveTo: closeOn }, context.principalId);
    if (!closed) throw new ConfigRecordNotFoundError('That daily scale');

    const created = await this.repo.insertScale(
      {
        poolId: current.pool_id,
        dietaryPreference: current.dietary_preference,
        dailyQty,
        notes: input.notes ?? null,
        effectiveFrom: newFrom,
        effectiveTo: null,
      },
      context.principalId
    );

    await this.audit(context, 'RIK_CONFIG_SCALE_SUPERSEDED', 'rik.pool_scales', created.id, scaleAudit(current), {
      ...scaleAudit(created),
      supersededScaleId: id,
      supersededClosedOn: closeOn,
    });

    this.logger.log(
      `RIK scale superseded (pool=${current.pool_code}, diet=${current.dietary_preference}, from=${newFrom})`
    );
    return { closed, created };
  }

  // ========================================================== conversions

  listConversions(): Promise<AdminConversionRow[]> {
    return this.repo.listConversions();
  }

  async createConversion(context: AuthContext, input: ConversionInput): Promise<AdminConversionRow> {
    const code = requireCode(input.code);
    const mode = requireMode(input.mode);
    const fromQty = requirePositive(input.fromQty, 'fromQty', 'INVALID_CONVERSION_QUANTITY');
    const toQty = requirePositive(input.toQty, 'toQty', 'INVALID_CONVERSION_QUANTITY');
    const dietaryPreference = optionalDietary(input.dietaryPreference, 'dietaryPreference');
    const effectiveFrom = requireDate(input.effectiveFrom, 'effectiveFrom');
    const effectiveTo = optionalDate(input.effectiveTo, 'effectiveTo');
    requireRange(effectiveFrom, effectiveTo);

    if (input.fromPoolId === input.toPoolId) {
      throw new ConfigValidationError(
        'CONVERSION_POOLS_IDENTICAL',
        'A conversion must move entitlement between two different pools.',
        'toPoolId'
      );
    }
    await this.assertPoolExists(input.fromPoolId, 'fromPoolId');
    await this.assertPoolExists(input.toPoolId, 'toPoolId');

    if (await this.repo.findConversionByCode(code)) {
      throw new ConfigValidationError('DUPLICATE_CODE', `A conversion with code "${code}" already exists.`, 'code');
    }

    const created = await this.repo.insertConversion(
      {
        code,
        fromPoolId: input.fromPoolId,
        toPoolId: input.toPoolId,
        fromQty,
        toQty,
        mode,
        dietaryPreference,
        description: input.description ?? null,
        displayOrder: input.displayOrder ?? 0,
        effectiveFrom,
        effectiveTo,
      },
      context.principalId
    );

    await this.audit(
      context,
      'RIK_CONFIG_CONVERSION_CREATED',
      'rik.pool_conversions',
      created.id,
      null,
      conversionAudit(created)
    );
    return created;
  }

  async updateConversion(context: AuthContext, id: string, patch: ConversionPatchInput): Promise<AdminConversionRow> {
    const before = await this.repo.findConversion(id);
    if (!before) throw new ConfigRecordNotFoundError('That conversion');

    const clean: Record<string, unknown> = {};
    if (patch.fromPoolId !== undefined) {
      await this.assertPoolExists(patch.fromPoolId, 'fromPoolId');
      clean.fromPoolId = patch.fromPoolId;
    }
    if (patch.toPoolId !== undefined) {
      await this.assertPoolExists(patch.toPoolId, 'toPoolId');
      clean.toPoolId = patch.toPoolId;
    }
    if (patch.fromQty !== undefined) {
      clean.fromQty = requirePositive(patch.fromQty, 'fromQty', 'INVALID_CONVERSION_QUANTITY');
    }
    if (patch.toQty !== undefined) {
      clean.toQty = requirePositive(patch.toQty, 'toQty', 'INVALID_CONVERSION_QUANTITY');
    }
    if (patch.mode !== undefined) clean.mode = requireMode(patch.mode);
    if (patch.dietaryPreference !== undefined) {
      clean.dietaryPreference = optionalDietary(patch.dietaryPreference, 'dietaryPreference');
    }
    if (patch.description !== undefined) clean.description = patch.description;
    if (patch.displayOrder !== undefined) clean.displayOrder = patch.displayOrder;
    if (patch.effectiveFrom !== undefined) clean.effectiveFrom = requireDate(patch.effectiveFrom, 'effectiveFrom');
    if (patch.effectiveTo !== undefined) clean.effectiveTo = optionalDate(patch.effectiveTo, 'effectiveTo');
    if (patch.isActive !== undefined) clean.isActive = patch.isActive;
    requireSomething(clean);

    const nextFromPool = (clean.fromPoolId as string | undefined) ?? before.from_pool_id;
    const nextToPool = (clean.toPoolId as string | undefined) ?? before.to_pool_id;
    if (nextFromPool === nextToPool) {
      throw new ConfigValidationError(
        'CONVERSION_POOLS_IDENTICAL',
        'A conversion must move entitlement between two different pools.',
        'toPoolId'
      );
    }
    requireRange(
      (clean.effectiveFrom as string | undefined) ?? before.effective_from,
      patch.effectiveTo !== undefined ? (clean.effectiveTo as string | null) : before.effective_to
    );

    const updated = await this.repo.updateConversion(id, clean, context.principalId);
    if (!updated) throw new ConfigRecordNotFoundError('That conversion');

    await this.audit(
      context,
      'RIK_CONFIG_CONVERSION_UPDATED',
      'rik.pool_conversions',
      id,
      conversionAudit(before),
      conversionAudit(updated)
    );
    return updated;
  }

  setConversionActive(context: AuthContext, id: string, isActive: boolean): Promise<AdminConversionRow> {
    return this.updateConversion(context, id, { isActive });
  }

  // =========================================================== provisions

  listProvisions(poolId: string | null): Promise<AdminProvisionRow[]> {
    return this.repo.listProvisions(poolId);
  }

  async createProvision(context: AuthContext, input: ProvisionInput): Promise<AdminProvisionRow> {
    const code = requireCode(input.code);
    const unit = requireUnit(input.unit, 'unit');
    const issuePeriod = requireRationType(input.issuePeriod, 'issuePeriod');
    const consumptionRatio = requirePositive(input.consumptionRatio, 'consumptionRatio', 'INVALID_RATIO');
    const packSize = optionalPositive(input.packSize, 'packSize', 'INVALID_PACK_SIZE');
    const maxQuantity = optionalPositive(input.maxQuantity, 'maxQuantity', 'INVALID_MAX_QUANTITY');
    const maxPacks = optionalPositiveInt(input.maxPacks, 'maxPacks', 'INVALID_MAX_PACKS');
    const minEligibleDays = optionalPositiveInt(input.minEligibleDays, 'minEligibleDays', 'INVALID_MIN_ELIGIBLE_DAYS');
    const dietaryPreference = optionalDietary(input.dietaryPreference, 'dietaryPreference');
    const effectiveFrom = requireDate(input.effectiveFrom, 'effectiveFrom');
    const effectiveTo = optionalDate(input.effectiveTo, 'effectiveTo');
    requireRange(effectiveFrom, effectiveTo);

    const isLoose = input.isLoose ?? false;
    requireLoosePack(isLoose, packSize);

    await this.assertPoolExists(input.poolId, 'poolId');

    if (await this.repo.findProvisionByCode(code)) {
      throw new ConfigValidationError('DUPLICATE_CODE', `A provision with code "${code}" already exists.`, 'code');
    }

    const created = await this.repo.insertProvision(
      {
        poolId: input.poolId,
        code,
        name: requireText(input.name, 'name'),
        brand: optionalText(input.brand),
        imageRef: optionalText(input.imageRef),
        packUnit: optionalPackUnit(input.packUnit),
        unit,
        consumptionRatio,
        packSize,
        isLoose,
        isCustomerSelectable: input.isCustomerSelectable ?? true,
        wholeUnitsOnly: input.wholeUnitsOnly ?? false,
        maxQuantity,
        maxPacks,
        minEligibleDays,
        issuePeriod,
        dietaryPreference,
        displayOrder: input.displayOrder ?? 0,
        effectiveFrom,
        effectiveTo,
      },
      context.principalId
    );

    await this.audit(
      context,
      'RIK_CONFIG_PROVISION_CREATED',
      'rik.provisions',
      created.id,
      null,
      provisionAudit(created)
    );
    return created;
  }

  async updateProvision(context: AuthContext, id: string, patch: ProvisionPatchInput): Promise<AdminProvisionRow> {
    const before = await this.repo.findProvision(id);
    if (!before) throw new ConfigRecordNotFoundError('That provision');

    const clean: Record<string, unknown> = {};
    if (patch.poolId !== undefined) {
      await this.assertPoolExists(patch.poolId, 'poolId');
      clean.poolId = patch.poolId;
    }
    if (patch.name !== undefined) clean.name = requireText(patch.name, 'name');
    if (patch.brand !== undefined) clean.brand = optionalText(patch.brand);
    if (patch.imageRef !== undefined) clean.imageRef = optionalText(patch.imageRef);
    if (patch.packUnit !== undefined) clean.packUnit = optionalPackUnit(patch.packUnit);
    if (patch.unit !== undefined) clean.unit = requireUnit(patch.unit, 'unit');
    if (patch.consumptionRatio !== undefined) {
      clean.consumptionRatio = requirePositive(patch.consumptionRatio, 'consumptionRatio', 'INVALID_RATIO');
    }
    if (patch.packSize !== undefined) clean.packSize = optionalPositive(patch.packSize, 'packSize', 'INVALID_PACK_SIZE');
    if (patch.isLoose !== undefined) clean.isLoose = patch.isLoose;
    if (patch.isCustomerSelectable !== undefined) clean.isCustomerSelectable = patch.isCustomerSelectable;
    if (patch.wholeUnitsOnly !== undefined) clean.wholeUnitsOnly = patch.wholeUnitsOnly;
    if (patch.maxQuantity !== undefined) {
      clean.maxQuantity = optionalPositive(patch.maxQuantity, 'maxQuantity', 'INVALID_MAX_QUANTITY');
    }
    if (patch.maxPacks !== undefined) {
      clean.maxPacks = optionalPositiveInt(patch.maxPacks, 'maxPacks', 'INVALID_MAX_PACKS');
    }
    if (patch.minEligibleDays !== undefined) {
      clean.minEligibleDays = optionalPositiveInt(patch.minEligibleDays, 'minEligibleDays', 'INVALID_MIN_ELIGIBLE_DAYS');
    }
    if (patch.issuePeriod !== undefined) clean.issuePeriod = requireRationType(patch.issuePeriod, 'issuePeriod');
    if (patch.dietaryPreference !== undefined) {
      clean.dietaryPreference = optionalDietary(patch.dietaryPreference, 'dietaryPreference');
    }
    if (patch.displayOrder !== undefined) clean.displayOrder = patch.displayOrder;
    if (patch.effectiveFrom !== undefined) clean.effectiveFrom = requireDate(patch.effectiveFrom, 'effectiveFrom');
    if (patch.effectiveTo !== undefined) clean.effectiveTo = optionalDate(patch.effectiveTo, 'effectiveTo');
    if (patch.isActive !== undefined) clean.isActive = patch.isActive;
    requireSomething(clean);

    const nextLoose = (clean.isLoose as boolean | undefined) ?? before.is_loose;
    const nextPack =
      patch.packSize !== undefined
        ? (clean.packSize as number | null)
        : before.pack_size === null
          ? null
          : Number(before.pack_size);
    requireLoosePack(nextLoose, nextPack);

    requireRange(
      (clean.effectiveFrom as string | undefined) ?? before.effective_from,
      patch.effectiveTo !== undefined ? (clean.effectiveTo as string | null) : before.effective_to
    );

    const updated = await this.repo.updateProvision(id, clean, context.principalId);
    if (!updated) throw new ConfigRecordNotFoundError('That provision');

    await this.audit(
      context,
      'RIK_CONFIG_PROVISION_UPDATED',
      'rik.provisions',
      id,
      provisionAudit(before),
      provisionAudit(updated)
    );
    return updated;
  }

  setProvisionActive(context: AuthContext, id: string, isActive: boolean): Promise<AdminProvisionRow> {
    return this.updateProvision(context, id, { isActive });
  }

  /**
   * Attach, replace or detach a provision's picture.
   *
   * Separate from updateProvision because the caller is an upload, not a
   * form: the controller has already written the file and holds a key, and
   * nothing else about the provision is being edited. Routing it through
   * `updateProvision` would work, but this way the audit trail says what
   * actually happened — a picture changed, not "the provision was updated" —
   * and the entitlement fields are visibly not in play.
   *
   * It returns the row BEFORE the change as well, because the controller
   * needs the old key to delete the file it replaced. Deleting is the
   * controller's job and happens only after this has committed, so a failed
   * write can never leave a row pointing at a file that is already gone.
   */
  async setProvisionImage(
    context: AuthContext,
    id: string,
    imageRef: string | null
  ): Promise<{ before: AdminProvisionRow; after: AdminProvisionRow }> {
    const before = await this.repo.findProvision(id);
    if (!before) throw new ConfigRecordNotFoundError('That provision');

    const after = await this.repo.updateProvision(id, { imageRef }, context.principalId);
    if (!after) throw new ConfigRecordNotFoundError('That provision');

    await this.audit(
      context,
      imageRef === null ? 'RIK_PROVISION_IMAGE_REMOVED' : 'RIK_PROVISION_IMAGE_SET',
      'rik.provisions',
      id,
      { code: before.code, imageRef: before.image_ref },
      { code: after.code, imageRef: after.image_ref }
    );
    return { before, after };
  }

  // ======================================================== rule history

  /**
   * What was actually changed, by whom, and when — read straight from
   * the append-only shared.audit_log, filtered to the four RIK
   * configuration tables.
   */
  listHistory(params: { entityType?: string | null; entityId?: string | null; limit?: number }): Promise<AuditEntryRecord[]> {
    const requested = params.entityType ?? null;
    const entityTypes =
      requested && (RIK_CONFIG_ENTITY_TYPES as readonly string[]).includes(requested)
        ? [requested]
        : RIK_CONFIG_ENTITY_TYPES;
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    return this.auditLog.listForModule({
      module: 'rik',
      entityTypes,
      entityId: params.entityId ?? null,
      limit,
    });
  }

  // ============================================================= internals

  private async assertPoolExists(poolId: string, field: string): Promise<void> {
    const pool = await this.repo.findPool(poolId);
    if (!pool) {
      throw new ConfigValidationError('POOL_NOT_FOUND', 'That entitlement pool does not exist.', field);
    }
  }

  private async assertScaleVersionFree(
    poolId: string,
    dietaryPreference: DietaryPreference,
    effectiveFrom: string,
    effectiveTo: string | null,
    excludeId: string | null
  ): Promise<void> {
    const exact = await this.repo.findScaleVersion(poolId, dietaryPreference, effectiveFrom);
    if (exact && exact.id !== excludeId) {
      throw new ConfigValidationError(
        'DUPLICATE_SCALE_VERSION',
        `A ${dietaryPreference} scale for this pool already starts on ${effectiveFrom}.`,
        'effectiveFrom',
        { existingScaleId: exact.id }
      );
    }

    const overlapping = await this.repo.findOverlappingScales(
      poolId,
      dietaryPreference,
      effectiveFrom,
      effectiveTo,
      excludeId
    );
    if (overlapping.length > 0) {
      const clash = overlapping[0];
      if (!clash) return;
      throw new ConfigValidationError(
        'OVERLAPPING_SCALE',
        `This would overlap an active ${dietaryPreference} scale for the same pool (${clash.effective_from} to ${clash.effective_to ?? 'open'}). Close that one first, or supersede it.`,
        'effectiveFrom',
        { conflictingScaleId: clash.id, conflictingFrom: clash.effective_from, conflictingTo: clash.effective_to }
      );
    }
  }

  private async audit(
    context: AuthContext,
    action: string,
    entityType: RikConfigEntityType,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'rik',
      action,
      entityType,
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}

// ------------------------------------------------------------ validators

function requireText(value: string, field: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new ConfigValidationError('BLANK_FIELD', `${field} cannot be blank.`, field);
  }
  return trimmed;
}

function requireCode(value: string): string {
  const trimmed = requireText(value, 'code').toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(trimmed)) {
    throw new ConfigValidationError(
      'INVALID_CODE_FORMAT',
      'A code may contain only letters, digits and underscores.',
      'code'
    );
  }
  return trimmed;
}

function requireDietary(value: string, field: string): DietaryPreference {
  if (!DIETARY_VALUES.includes(value as DietaryPreference)) {
    throw new ConfigValidationError(
      'INVALID_DIETARY_PREFERENCE',
      `Dietary preference must be one of ${DIETARY_VALUES.join(', ')}.`,
      field,
      { allowed: DIETARY_VALUES }
    );
  }
  return value as DietaryPreference;
}

function optionalDietary(value: string | null | undefined, field: string): DietaryPreference | null {
  if (value === null || value === undefined || value === '') return null;
  return requireDietary(value, field);
}

function requireRationType(value: string, field: string): RationType {
  if (!RATION_TYPES.includes(value as RationType)) {
    throw new ConfigValidationError(
      'INVALID_RATION_TYPE',
      `Must be one of ${RATION_TYPES.join(', ')}.`,
      field,
      { allowed: RATION_TYPES }
    );
  }
  return value as RationType;
}

function requireUnit(value: string, field: string): string {
  if (!UNITS.includes(value)) {
    throw new ConfigValidationError('INVALID_UNIT', `Unit must be one of ${UNITS.join(', ')}.`, field, {
      allowed: UNITS,
    });
  }
  return value;
}

function requireMode(value: string): ConversionMode {
  if (!CONVERSION_MODES.includes(value as ConversionMode)) {
    throw new ConfigValidationError(
      'INVALID_CONVERSION_MODE',
      `Mode must be one of ${CONVERSION_MODES.join(', ')}.`,
      'mode',
      { allowed: CONVERSION_MODES }
    );
  }
  return value as ConversionMode;
}

function requirePositive(value: number, field: string, code: ConfigValidationCode): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigValidationError(code, `${field} must be greater than zero.`, field, { supplied: value });
  }
  return value;
}

function optionalPositive(
  value: number | null | undefined,
  field: string,
  code: ConfigValidationCode
): number | null {
  if (value === null || value === undefined) return null;
  return requirePositive(value, field, code);
}

function optionalPositiveInt(
  value: number | null | undefined,
  field: string,
  code: ConfigValidationCode
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigValidationError(code, `${field} must be a whole number greater than zero.`, field, {
      supplied: value,
    });
  }
  return value;
}

function requireNonNegative(value: number, field: string, code: ConfigValidationCode): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigValidationError(code, `${field} cannot be negative.`, field, { supplied: value });
  }
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: string, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ConfigValidationError('INVALID_EFFECTIVE_RANGE', `${field} must be a date in YYYY-MM-DD form.`, field, {
      supplied: value,
    });
  }
  return value;
}

function optionalDate(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requireDate(value, field);
}

function requireRange(from: string, to: string | null): void {
  if (to !== null && to < from) {
    throw new ConfigValidationError(
      'INVALID_EFFECTIVE_RANGE',
      'The end date cannot be before the start date.',
      'effectiveTo',
      { effectiveFrom: from, effectiveTo: to }
    );
  }
}

/**
 * A trimmed string, or NULL. An empty box means "not recorded", which
 * is an honest state — a brand or an image the facility has not
 * supplied must not become an empty string pretending to be a value.
 */
function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function optionalPackUnit(value: string | null | undefined): string | null {
  const trimmed = optionalText(value);
  if (trimmed === null) return null;
  if (!PACK_UNITS.includes(trimmed)) {
    throw new ConfigValidationError(
      'INVALID_PACK_UNIT',
      `A pack unit must be one of ${PACK_UNITS.join(', ')}.`,
      'packUnit',
      { allowed: PACK_UNITS }
    );
  }
  return trimmed;
}

function requireLoosePack(isLoose: boolean, packSize: number | null): void {
  if (isLoose && packSize !== null) {
    throw new ConfigValidationError(
      'LOOSE_ITEM_CANNOT_HAVE_PACK_SIZE',
      'An item issued loose cannot also have a pack size.',
      'packSize'
    );
  }
}

function requireSomething(clean: Record<string, unknown>): void {
  if (Object.keys(clean).length === 0) {
    throw new ConfigValidationError('NO_CHANGES_SUPPLIED', 'No recognised field was supplied to change.', null);
  }
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------- audit payload shapes
// Deliberately explicit rather than spreading the row: an audit entry
// should record the configuration values, not whatever columns a future
// migration happens to add.

function poolAudit(r: AdminPoolRow): Record<string, unknown> {
  return {
    code: r.code,
    name: r.name,
    rationType: r.ration_type,
    unit: r.unit,
    imageRef: r.image_ref,
    displayOrder: r.display_order,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}

function scaleAudit(r: AdminScaleRow): Record<string, unknown> {
  return {
    poolCode: r.pool_code,
    dietaryPreference: r.dietary_preference,
    dailyQty: r.daily_qty,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}

function conversionAudit(r: AdminConversionRow): Record<string, unknown> {
  return {
    code: r.code,
    fromPoolCode: r.from_pool_code,
    toPoolCode: r.to_pool_code,
    fromQty: r.from_qty,
    toQty: r.to_qty,
    mode: r.mode,
    dietaryPreference: r.dietary_preference,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}

function provisionAudit(r: AdminProvisionRow): Record<string, unknown> {
  return {
    code: r.code,
    name: r.name,
    brand: r.brand,
    packUnit: r.pack_unit,
    imageRef: r.image_ref,
    poolCode: r.pool_code,
    unit: r.unit,
    consumptionRatio: r.consumption_ratio,
    packSize: r.pack_size,
    isLoose: r.is_loose,
    isCustomerSelectable: r.is_customer_selectable,
    wholeUnitsOnly: r.whole_units_only,
    maxQuantity: r.max_quantity,
    maxPacks: r.max_packs,
    minEligibleDays: r.min_eligible_days,
    issuePeriod: r.issue_period,
    dietaryPreference: r.dietary_preference,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}

function pickupLocationAudit(r: PickupLocationRecord): Record<string, unknown> {
  return {
    code: r.code,
    name: r.name,
    displayOrder: r.display_order,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}
