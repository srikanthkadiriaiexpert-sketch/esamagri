import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Request shapes for the RIK entitlement configuration API (STEP 11C).
 *
 * These are a SHAPE gate, not the business rules. They stop a
 * malformed request (a string where a number belongs, an unknown
 * field, a date that isn't a date) before it reaches the service, and
 * every controller here runs the pipe with `whitelist` and
 * `forbidNonWhitelisted` so an unrecognised property is refused rather
 * than quietly dropped.
 *
 * The rules that matter — a ratio must be positive, an entitlement
 * cannot be negative, two active scales for the same pool and diet
 * cannot overlap, a pool must exist — all live in
 * RikAdminConfigService, are enforced there on every path, and are
 * tested through HTTP. Nothing in this file is relied on as the
 * boundary.
 *
 * That is also why no `@Min` guards a quantity, ratio or scale here.
 * If one did, the pipe would refuse a negative entitlement with a
 * generic "validation failed" and the service's own, specific rule
 * would never run — and would never be exercised by a test. The
 * quantity rules belong to the service, and this file lets them reach
 * it. `@Min(0)` appears only on `displayOrder`, which is presentation,
 * not entitlement.
 *
 * Note on nullable fields: `null` and "absent" mean different things in
 * a PATCH — `null` means "clear this value", absent means "leave it
 * alone". The DTOs therefore allow null explicitly where the column is
 * nullable, and the service distinguishes the two.
 */

const RATION_TYPES = ['FRESH', 'DRY'];
const UNITS = ['g', 'ml', 'piece'];
const DIETS = ['PV', 'EV', 'NV'];
const MODES = ['AUTOMATIC', 'ELECTIVE'];
// What a pack is CALLED. Presentation only — never the entitlement unit.
const PACK_UNITS = ['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'tin', 'box'];

// numeric(14,4) / numeric(14,6) — well inside this bound, which exists
// only to refuse an absurd value early.
const MAX_NUMERIC = 1_000_000_000;

export class CreatePoolDto {
  @IsString()
  @Length(1, 60)
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsIn(RATION_TYPES)
  rationType!: string;

  @IsIn(UNITS)
  unit!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  /** Path to the category's cover picture. Optional; null clears it. */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  imageRef?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsISO8601({ strict: true }, { message: 'effectiveFrom must be a date (YYYY-MM-DD)' })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'effectiveTo must be a date (YYYY-MM-DD)' })
  effectiveTo?: string | null;
}

export class UpdatePoolDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsIn(RATION_TYPES)
  rationType?: string;

  @IsOptional()
  @IsIn(UNITS)
  unit?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  /** Path to the category's cover picture. Optional; null clears it. */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  imageRef?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateScaleDto {
  @IsUUID()
  poolId!: string;

  @IsIn(DIETS)
  dietaryPreference!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  dailyQty!: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string | null;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;
}

export class UpdateScaleDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  dailyQty?: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SupersedeScaleDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  dailyQty!: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string | null;
}

export class CreateConversionDto {
  @IsString()
  @Length(1, 60)
  code!: string;

  @IsUUID()
  fromPoolId!: string;

  @IsUUID()
  toPoolId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  fromQty!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  toQty!: number;

  @IsIn(MODES)
  mode!: string;

  @IsOptional()
  @IsIn(DIETS)
  dietaryPreference?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;
}

export class UpdateConversionDto {
  @IsOptional()
  @IsUUID()
  fromPoolId?: string;

  @IsOptional()
  @IsUUID()
  toPoolId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  fromQty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  toQty?: number;

  @IsOptional()
  @IsIn(MODES)
  mode?: string;

  @IsOptional()
  @IsIn(DIETS)
  dietaryPreference?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateProvisionDto {
  @IsUUID()
  poolId!: string;

  @IsString()
  @Length(1, 60)
  code!: string;

  @IsString()
  @Length(1, 160)
  name!: string;

  /**
   * Brand is its OWN field, never part of the name. "Paneer" made by
   * "Amul" — so the same provision can be stocked from several brands
   * without duplicating the item.
   */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  brand?: string | null;

  /** A catalogue image reference. Presentation only; affects nothing. */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  imageRef?: string | null;

  /** What the pack is called. NOT the entitlement unit below. */
  @IsOptional()
  @IsIn(PACK_UNITS)
  packUnit?: string | null;

  @IsIn(UNITS)
  unit!: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Max(MAX_NUMERIC)
  consumptionRatio!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  packSize?: number | null;

  @IsOptional()
  @IsBoolean()
  isLoose?: boolean;

  @IsOptional()
  @IsBoolean()
  isCustomerSelectable?: boolean;

  /** Whole units only — a physical coupon cannot be issued in halves. */
  @IsOptional()
  @IsBoolean()
  wholeUnitsOnly?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  maxQuantity?: number | null;

  @IsOptional()
  @IsInt()
  @Max(1_000_000)
  maxPacks?: number | null;

  @IsOptional()
  @IsInt()
  @Max(3_660)
  minEligibleDays?: number | null;

  @IsIn(RATION_TYPES)
  issuePeriod!: string;

  @IsOptional()
  @IsIn(DIETS)
  dietaryPreference?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;
}

/**
 * The PATCH body every provision-editing screen uses — the SKU master,
 * the pack sizes & limits screen and the issue period & availability
 * screen all send a subset of these fields to the same endpoint. Those
 * three screens are different views of one table, so they deliberately
 * share one contract rather than growing three near-identical ones that
 * could drift apart.
 */
export class UpdateProvisionDto {
  @IsOptional()
  @IsUUID()
  poolId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  imageRef?: string | null;

  @IsOptional()
  @IsIn(PACK_UNITS)
  packUnit?: string | null;

  @IsOptional()
  @IsIn(UNITS)
  unit?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Max(MAX_NUMERIC)
  consumptionRatio?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  packSize?: number | null;

  @IsOptional()
  @IsBoolean()
  isLoose?: boolean;

  @IsOptional()
  @IsBoolean()
  isCustomerSelectable?: boolean;

  /** Whole units only — a physical coupon cannot be issued in halves. */
  @IsOptional()
  @IsBoolean()
  wholeUnitsOnly?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Max(MAX_NUMERIC)
  maxQuantity?: number | null;

  @IsOptional()
  @IsInt()
  @Max(1_000_000)
  maxPacks?: number | null;

  @IsOptional()
  @IsInt()
  @Max(3_660)
  minEligibleDays?: number | null;

  @IsOptional()
  @IsIn(RATION_TYPES)
  issuePeriod?: string;

  @IsOptional()
  @IsIn(DIETS)
  dietaryPreference?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Retire or restore a configuration row. There is no delete. */
export class SetActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

/**
 * A collection point (STEP 11E). Business configuration the facility
 * maintains: "Naval Park" and "Dolphin Hill" are rows, not code, and a
 * third counter is a form submission rather than a deployment.
 */
export class CreatePickupLocationDto {
  @IsString()
  @Length(1, 60)
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;
}

export class UpdatePickupLocationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
