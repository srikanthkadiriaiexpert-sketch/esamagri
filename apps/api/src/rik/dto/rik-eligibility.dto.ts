import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request shapes for eligibility import and adjustment (STEP 15B Phase B).
 *
 * RECONSTRUCTED from the approved Phase B report after the working container
 * was lost; not the recovered original bytes.
 *
 * A SHAPE gate, as elsewhere. The period arrives as a FORM FIELD on the
 * upload because the spreadsheet deliberately carries no period column — the
 * administrator chooses it on the screen, so a sheet cannot target a month
 * nobody picked.
 *
 * STEP 16 / migration 0066 — THE RATION TYPE ARRIVES THE SAME WAY, AND FOR
 * THE SAME REASON. An officer now holds a Fresh figure and a Dry figure for
 * one period, and the facility's sheet still carries only
 * `Name | Mobile Number | Eligible Days`. So the administrator presses FRESH
 * or DRY on the screen and the sheet is applied to that figure alone.
 *
 * There is deliberately NO DEFAULT. A request that omits `rationType` is
 * refused, because a default would write Fresh from a Dry sheet and nothing
 * in the file would contradict it.
 *
 * Note the absence of any field that would let a caller supply an outcome, a
 * delta, a previous value or a batch reference. All four are the server's.
 */

/** The two eligibility figures an officer holds for one period. */
export const RATION_TYPES = ['FRESH', 'DRY'] as const;
export type EligibilityRationType = (typeof RATION_TYPES)[number];

/**
 * The approved maximum for each figure, in days.
 *
 * The facility's established limits, enforced in three places: here as a
 * shape, in the service with a message a human can act on, and in the
 * database as a CHECK constraint that binds every writer including psql. The
 * database is the one that counts; the other two exist so that a mistake is
 * reported rather than surfacing as a raw constraint violation.
 */
export const RATION_TYPE_MAX_DAYS: Readonly<Record<EligibilityRationType, number>> = {
  FRESH: 30,
  DRY: 60,
};

export class UploadEligibilityDto {
  @IsUUID()
  periodId!: string;

  @IsIn(RATION_TYPES)
  rationType!: EligibilityRationType;
}

export class AdjustEligibilityDto {
  @IsUUID()
  periodId!: string;

  /**
   * OPTIONAL HERE, AND ONLY HERE. The upload above requires it; a single
   * officer's correction does not.
   *
   * ABSENT MEANS THE LEGACY FIGURE — `customer_period_eligibility.eligible_days`,
   * the one the entitlement engine calculates from. That is what this screen
   * has always adjusted, and it has to stay reachable: it is the only way a
   * facility can correct what an officer actually receives.
   *
   * FRESH or DRY names one of the two figures migration 0066 added, which are
   * stored and displayed only at this stage.
   *
   * The absence travels all the way down: the service omits `ration_type` from
   * the adjustment row, and migration 0066's `ration_type IS NULL` branch of
   * the apply trigger writes the legacy column with exactly its pre-0066
   * behaviour. There is no second implementation of the legacy path anywhere.
   */
  @IsOptional()
  @IsIn(RATION_TYPES)
  rationType?: EligibilityRationType;

  /**
   * 0 is accepted here on purpose — an officer with no eligible days this
   * period is a real statement. The service re-checks the range and refuses a
   * non-integer with its own message: 0–366 for the legacy figure, exactly as
   * before, and the ration type's own maximum when one is named. The 366 below
   * is the outer shape bound, left as it was, so that a Fresh 31 is reported by
   * the service as "at most 30 days" rather than as a shapeless 400 that names
   * no limit.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(366)
  eligibleDays!: number;

  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class BatchListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
