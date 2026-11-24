import { IsBoolean, IsISO8601, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Request shapes for the seasonal banner admin API.
 *
 * A SHAPE GATE, NOT THE BUSINESS RULES. These stop a malformed request before
 * it reaches the service: a date that is not a date, a title that is not a
 * string, an unrecognised property. Every route runs the pipe with
 * `whitelist` and `forbidNonWhitelisted`, so an unknown field is refused
 * rather than quietly dropped.
 *
 * The rules that matter — a banner cannot be published without a picture, a
 * window cannot close before it opens, a title cannot be blank — live in
 * RikBannersService and are enforced on every path, including the ones that
 * do not go through these classes at all (the multipart image upload).
 *
 * `null` and absent mean different things. Absent leaves a column alone;
 * explicit `null` clears it. The service and repository both preserve that
 * distinction, which is why `@IsOptional()` is used rather than a default.
 *
 * There is deliberately NO `isPublished` on create. A banner is a picture,
 * and the picture arrives in a separate multipart request after the row
 * exists — so a "create published" path could only ever produce a constraint
 * violation. Publishing is its own route, once there is something to show.
 */

export class CreateBannerDto {
  /** What staff call it, and the alt text a screen reader announces. */
  @IsString()
  @Length(1, 140)
  title!: string;

  /** One optional line of copy beneath the title. A caption, not an article. */
  @IsOptional()
  @IsString()
  @Length(0, 400)
  description?: string | null;

  /** NULL means "as soon as it is published". */
  @IsOptional()
  @IsISO8601()
  startsOn?: string | null;

  /** NULL means "until staff take it down". */
  @IsOptional()
  @IsISO8601()
  endsOn?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @Length(1, 140)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 400)
  description?: string | null;

  @IsOptional()
  @IsISO8601()
  startsOn?: string | null;

  @IsOptional()
  @IsISO8601()
  endsOn?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class SetBannerPublishedDto {
  @IsBoolean()
  isPublished!: boolean;
}
