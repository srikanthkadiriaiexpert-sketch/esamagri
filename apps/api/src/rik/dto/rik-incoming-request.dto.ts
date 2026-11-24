import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request shape for the incoming-requests queue (PHASE B).
 *
 * A SHAPE GATE, like every other query DTO here. The route runs the pipe
 * with `whitelist` and `forbidNonWhitelisted`, which is what makes the
 * absences below enforceable rather than decorative.
 *
 * NOTE WHAT CANNOT BE SENT. There is no field for a status, a customer id,
 * a selection id or a voucher. The queue's membership rule — confirmed, and
 * no voucher of that ration type yet — is the server's and is not
 * negotiable from a query string; and a caller cannot ask for one named
 * officer's confirmed selections by id, only search for them, so this
 * endpoint cannot be turned into a lookup of a particular customer's
 * records.
 */
export class IncomingRequestQueryDto {
  /** RIK ID, officer name, official name, mobile, or selection reference. */
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
  @IsUUID()
  periodId?: string;

  /**
   * Inclusive calendar-day bounds on the CONFIRMATION date, as YYYY-MM-DD.
   *
   * The confirmation date, not the issue date: nothing in this queue has
   * been issued. The screen labels them "Confirmed from/to" so they cannot
   * be read as the voucher dates that the Issue vouchers screen filters on.
   *
   * An inverted range matches nothing and is not an error worth a 400.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'confirmedFrom must be a date in YYYY-MM-DD form' })
  confirmedFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'confirmedTo must be a date in YYYY-MM-DD form' })
  confirmedTo?: string;

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
