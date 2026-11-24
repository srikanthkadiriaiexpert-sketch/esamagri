import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request shapes for the issue voucher (PHASE D).
 *
 * A SHAPE gate, as everywhere else in this codebase. Every route runs the
 * pipe with `whitelist` and `forbidNonWhitelisted`, and that is what makes the
 * absences below enforceable.
 *
 * NOTE WHAT CANNOT BE SENT. There is no field for a voucher number, a status,
 * a quantity, a provision, a substitution, an issue window, a fulfilment mode
 * or a delivery address. Every one of those is either the server's to
 * generate or the confirmed selection's to supply:
 *
 *   * the number comes from the database sequence;
 *   * the status is the entry state of the fulfilment lane, and the
 *     application holds no privilege to change it afterwards;
 *   * the ration comes from the selection's frozen rule snapshot;
 *   * the fulfilment mode and its address or pickup location come from the
 *     confirmation, so an officer is never asked to choose again;
 *   * the issue window is resolved from the configured schedule at read time,
 *     because one Fresh voucher spans Windows 1 to 3.
 *
 * So the whole creation request is: which confirmed selection, and which
 * ration type.
 */

export class CreateIssueVoucherDto {
  @IsUUID()
  selectionId!: string;

  @IsIn(['FRESH', 'DRY'])
  rationType!: 'FRESH' | 'DRY';
}

/**
 * The Excel export's query (PHASE C).
 *
 * THE SAME FILTERS AS THE LIST, AND NO PAGING. `limit` and `offset` are
 * deliberately absent: the export covers everything the filter matches and
 * the server pages internally, so a caller cannot ask for a slice and
 * cannot be handed a file that is quietly part of the answer.
 *
 * Nothing may be sent that selects a different set or relaxes a limit — no
 * voucher id, no customer id, no sheet choice, no row cap. The 5,000 and
 * 750 ceilings are the server's and are not negotiable from a query
 * string; `forbidNonWhitelisted` on the route is what makes that
 * enforceable rather than merely intended.
 */
export class VoucherExportQueryDto {
  /** Voucher number, RIK ID, officer name, mobile or selection reference. */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  q?: string;

  @IsOptional()
  @IsIn(['FRESH', 'DRY'])
  rationType?: 'FRESH' | 'DRY';

  @IsOptional()
  @IsIn(['PICKUP', 'DELIVERY'])
  fulfillmentMode?: 'PICKUP' | 'DELIVERY';

  @IsOptional()
  @IsIn([
    'READY_FOR_PICKUP',
    'COLLECTED',
    'NOT_COLLECTED',
    'READY_FOR_DELIVERY',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'NOT_DELIVERED',
  ])
  status?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  /** Inclusive YYYY-MM-DD bounds on the voucher's ISSUE date, as in the list. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issuedFrom must be a date in YYYY-MM-DD form' })
  issuedFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issuedTo must be a date in YYYY-MM-DD form' })
  issuedTo?: string;
}

export class VoucherSearchQueryDto {
  /** Voucher number, RIK ID, officer name, mobile or selection reference. */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  q?: string;

  @IsOptional()
  @IsIn(['FRESH', 'DRY'])
  rationType?: 'FRESH' | 'DRY';

  @IsOptional()
  @IsIn(['PICKUP', 'DELIVERY'])
  fulfillmentMode?: 'PICKUP' | 'DELIVERY';

  @IsOptional()
  @IsIn([
    'READY_FOR_PICKUP',
    'COLLECTED',
    'NOT_COLLECTED',
    'READY_FOR_DELIVERY',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'NOT_DELIVERED',
  ])
  status?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  /**
   * Inclusive calendar-day bounds on the voucher's own ISSUE date
   * (rik.issue_vouchers.created_at), as YYYY-MM-DD.
   *
   * A plain date rather than a timestamp, deliberately: staff think in days,
   * and a bare date leaves no room for an off-by-one at a timezone boundary.
   * The repository casts the column to ::date so the closing day is included
   * whole, rather than ending at midnight.
   *
   * NOT a filter on when a ration was COLLECTED or DELIVERED. That date lives
   * in rik.issue_voucher_outcomes and filtering on it would need a join this
   * search does not have. The screen labels these "Issued from/to" for exactly
   * that reason, so nobody reads them as fulfilment dates.
   *
   * An inverted range is accepted and simply matches nothing; it is not an
   * error worth a 400.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issuedFrom must be a date in YYYY-MM-DD form' })
  issuedFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issuedTo must be a date in YYYY-MM-DD form' })
  issuedTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
