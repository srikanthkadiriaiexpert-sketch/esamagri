import { IsBoolean, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

/**
 * Request shapes for the RIK New Arrivals admin API.
 *
 * A SHAPE GATE, NOT THE BUSINESS RULES. These stop a malformed request before
 * it reaches the service: a string where a uuid belongs, a date that is not a
 * date, an unrecognised property. Every route runs the pipe with `whitelist`
 * and `forbidNonWhitelisted`, so an unknown field is refused rather than
 * quietly dropped.
 *
 * The rules that matter — the id must name a RIK provision, the provision
 * must be active, it must not already be listed, the date window must close
 * after it opens — all live in RikNewArrivalsService, are enforced there on
 * every path, and are tested through HTTP. Nothing in this file is relied on
 * as the boundary, and in particular `@IsUUID` is a format check and NOT the
 * RIK-only rule: a well-formed PIF product id passes here and is refused by
 * the service and by the foreign key.
 *
 * `null` and absent mean different things. Absent leaves a column alone;
 * explicit `null` clears it. The service and repository both preserve that
 * distinction, so `@IsOptional()` is used rather than a default.
 */

export class CreateNewArrivalDto {
  /**
   * The staff-typed product name. Required for the ordinary standalone
   * listing; omitted when `provisionId` is given, because a linked listing
   * takes its name from the catalogue. Which of the two is required is the
   * service's decision — this is only the shape gate.
   */
  @IsOptional()
  @IsString()
  @Length(1, 140)
  productName?: string;

  /**
   * OPTIONAL since migration 0056. A rik.provisions id, for when staff
   * choose to link the listing to a catalogue product. Omit it entirely for
   * a standalone listing, which is the ordinary case.
   */
  @IsOptional()
  @IsUUID()
  provisionId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 140)
  headline?: string | null;

  @IsOptional()
  @IsISO8601()
  publishedFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  publishedUntil?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  /** Staff may create a draft and publish later, so this defaults to false. */
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateNewArrivalDto {
  /** Renaming applies to a standalone listing only; the service refuses it on a linked one. */
  @IsOptional()
  @IsString()
  @Length(1, 140)
  productName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 140)
  headline?: string | null;

  @IsOptional()
  @IsISO8601()
  publishedFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  publishedUntil?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class SetPublishedDto {
  @IsBoolean()
  isPublished!: boolean;
}
