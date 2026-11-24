import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Request shapes for issue-window configuration (STEP 15C).
 *
 * A SHAPE gate, as everywhere else in this module: it stops a malformed
 * request before the service sees it and refuses an unrecognised property
 * outright, because every route runs the pipe with `whitelist` and
 * `forbidNonWhitelisted`.
 *
 * The rules that matter — the schedule is inside its period, Fresh issues run
 * in order, two live windows of one ration type cannot overlap, every
 * operating day falls inside its own window — belong to migration 0047 and to
 * RikIssueWindowService, and are exercised through HTTP. Nothing here is
 * relied on as the boundary.
 *
 * DATES ARE PLAIN STRINGS, validated as real calendar dates by the service
 * (`parseIsoDate`), not by `@IsISO8601`. That is deliberate: `@IsISO8601`
 * would accept a timestamp and a timezone, and an issue day is a DATE — the
 * facility opens on the 14th, not at 00:00 UTC on the 14th. It also lets the
 * service answer "2027-02-29 is not a real calendar date" rather than a
 * generic validation failure.
 *
 * `windowCode` is NOT a field. It is derived from the ration type and the
 * sequence number by the database's own identity CHECK, so a caller cannot
 * send a FRESH_2 that is really a Dry window.
 */

export class ConfigureIssueWindowDto {
  @IsUUID()
  periodId!: string;

  /**
   * MISS_MUSTER_FRESH and MISS_MUSTER_DRY are separate ration types rather
   * than two sequence numbers under one, because migration 0047's overlap
   * exclusion and ordering trigger are both scoped by ration type — see
   * the service header for why that matters.
   */
  @IsIn(['FRESH', 'DRY', 'MISS_MUSTER_FRESH', 'MISS_MUSTER_DRY'])
  rationType!: 'FRESH' | 'DRY' | 'MISS_MUSTER_FRESH' | 'MISS_MUSTER_DRY';

  /** 1–3 for FRESH, 1 for every other type. The service enforces the maximum. */
  @IsInt()
  @Min(1)
  @Max(3)
  sequenceNo!: number;

  @IsString()
  @Length(10, 10)
  startDate!: string;

  @IsString()
  @Length(10, 10)
  endDate!: string;

  /** The days the facility will actually issue on. 366 is a year's worth. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(366)
  @IsString({ each: true })
  @Length(10, 10, { each: true })
  operatingDays!: string[];

  @IsOptional()
  @IsString()
  @Length(1, 500)
  notes?: string;
}

/**
 * Every field optional: a PATCH changes what it names and leaves the rest.
 *
 * `periodId`, `rationType` and `sequenceNo` are absent on purpose — a window
 * is that window. Moving one into another slot would rewrite a schedule
 * officers were already shown; the way to change the shape of a period's
 * schedule is a new window and the retirement of the old one.
 */
export class UpdateIssueWindowDto {
  @IsOptional()
  @IsString()
  @Length(10, 10)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Length(10, 10)
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(366)
  @IsString({ each: true })
  @Length(10, 10, { each: true })
  operatingDays?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 500)
  notes?: string;

  /** false retires the window. There is no delete, by design. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class IssueWindowListQueryDto {
  @IsUUID()
  periodId!: string;
}
