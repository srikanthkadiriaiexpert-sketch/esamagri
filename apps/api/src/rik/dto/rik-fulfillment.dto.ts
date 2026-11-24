import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Request shapes for PHASE E fulfilment.
 *
 * A SHAPE GATE, as everywhere else here: every route runs the pipe with
 * `whitelist` and `forbidNonWhitelisted`, so the absences below are
 * enforceable rather than decorative.
 *
 * NOTE WHAT CANNOT BE SENT. There is no field for a voucher status, a
 * voucher number, a pool, a consumption ratio, a pool-equivalent quantity or
 * a carry-forward amount. The status follows from the outcome; the pool and
 * the arithmetic come from the officer's own frozen snapshot and the
 * catalogue's consumption ratios; the carry-forward draw is worked out by
 * the server. A counter records WHAT was handed over and HOW MUCH, and that
 * is all it may assert.
 */

export class IssueLineDto {
  /** The provision actually handed over. */
  @IsUUID()
  provisionId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;

  /** Set ONLY when this replaces something the officer confirmed. */
  @IsOptional()
  @IsUUID()
  originalProvisionId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 300)
  substitutionReason?: string;
}

export class RecordOutcomeDto {
  @IsIn(['COLLECTED', 'NOT_COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED'])
  outcome!: 'COLLECTED' | 'NOT_COLLECTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'NOT_DELIVERED';

  /** Mandatory for a non-collection or a non-delivery; the service enforces it. */
  @IsOptional()
  @IsString()
  @Length(3, 300)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  notes?: string;

  /** Required for COLLECTED and DELIVERED; refused for the others. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IssueLineDto)
  lines?: IssueLineDto[];
}

export class ReverseCompletionDto {
  @IsUUID()
  outcomeId!: string;

  @IsString()
  @Length(5, 300)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  notes?: string;
}

export class EstablishCarryForwardDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  sourcePeriodId!: string;

  @IsUUID()
  targetPeriodId!: string;
}

export class LapseCarryForwardDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  targetPeriodId!: string;
}

export class SettleLapsesDto {
  @IsUUID()
  periodId!: string;
}
