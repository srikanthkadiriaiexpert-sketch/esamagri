import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Request shapes for entitlement period administration.
 *
 * A SHAPE gate, not the business rules — the same division of labour as
 * rik-officer.dto.ts. Every route runs the pipe with `whitelist` and
 * `forbidNonWhitelisted`, which is what makes the absent fields enforceable: a
 * body carrying `id`, `periodId` or anything else is refused outright, because
 * no DTO here declares them.
 *
 * The rules that matter — date validity, end after start, no overlap, no
 * duplicate name, and whether a period's dates may still move — live in
 * RikEntitlementPeriodService, because every one of them needs to look at the
 * other periods or at what already depends on this one. The shape gate cannot
 * see either.
 */

/** yyyy-mm-dd. The service rejects impossible dates such as 2026-02-30. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePeriodDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Matches(ISO_DATE, { message: 'startDate must be formatted yyyy-mm-dd.' })
  startDate!: string;

  @IsString()
  @Matches(ISO_DATE, { message: 'endDate must be formatted yyyy-mm-dd.' })
  endDate!: string;

  /**
   * OPTIONAL, AND DEFAULTED TO UPCOMING BY THE SERVICE.
   *
   * Status is a label the facility chooses; it is the DATES that decide which
   * period is operational. The one exception is CLOSED, which the service
   * treats as an explicit retirement, so a period is never created CLOSED by
   * accident — staff close it deliberately afterwards.
   */
  @IsOptional()
  @IsIn(['UPCOMING', 'ACTIVE', 'CLOSED'])
  status?: 'UPCOMING' | 'ACTIVE' | 'CLOSED';
}

export class UpdatePeriodDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Matches(ISO_DATE, { message: 'startDate must be formatted yyyy-mm-dd.' })
  startDate!: string;

  @IsString()
  @Matches(ISO_DATE, { message: 'endDate must be formatted yyyy-mm-dd.' })
  endDate!: string;
}

export class SetPeriodStatusDto {
  @IsIn(['UPCOMING', 'ACTIVE', 'CLOSED'])
  status!: 'UPCOMING' | 'ACTIVE' | 'CLOSED';
}
