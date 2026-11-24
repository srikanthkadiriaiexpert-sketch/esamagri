import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_TYPES,
  type AnnouncementAudience,
  type AnnouncementPriority,
  type AnnouncementType,
} from '../../shared/repositories/announcements.repository';

/**
 * Announcement payloads. Every enumerated field is validated against the
 * frozen table's own CHECK constraint values — no value outside
 * `announcements_audience_chk`, `announcements_priority_chk` or
 * `announcements_type_chk` can reach the database.
 *
 * Passing the validation here does NOT mean the caller may use the
 * audience: AdminAnnouncementsService re-checks it against the staff
 * member's module scope. Validation and authorization are separate
 * concerns and both run.
 */
export class CreateAnnouncementDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 4000)
  body!: string;

  @IsIn(ANNOUNCEMENT_TYPES as readonly string[])
  announcementType!: AnnouncementType;

  @IsIn(ANNOUNCEMENT_AUDIENCES as readonly string[])
  targetAudience!: AnnouncementAudience;

  @IsIn(ANNOUNCEMENT_PRIORITIES as readonly string[])
  priority!: AnnouncementPriority;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'startDate must be an ISO date (YYYY-MM-DD)' })
  startDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'endDate must be an ISO date (YYYY-MM-DD)' })
  endDate?: string;

  @IsBoolean()
  isPublished!: boolean;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  body?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES as readonly string[])
  priority?: AnnouncementPriority;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'endDate must be an ISO date (YYYY-MM-DD)' })
  endDate?: string;

  /**
   * `targetAudience` is intentionally not accepted on update — see
   * AnnouncementsRepository.update. A client sending it is rejected by
   * forbidNonWhitelisted rather than silently ignored.
   */
}
