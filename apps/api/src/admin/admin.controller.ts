import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentAuthContext } from '../auth/decorators/current-auth-context.decorator';
import type { AuthContext } from '../auth/auth-context';
import { UsersRepository } from '../shared/repositories/users.repository';
import { IssueSchedulesRepository } from '../rik/repositories/issue-schedules.repository';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';
import { SetPifSelfRegistrationDto } from './dto/settings.dto';
import {
  AdminAnnouncementsService,
  AnnouncementAudienceForbiddenError,
  AnnouncementNotFoundError,
} from './services/admin-announcements.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminSettingsService } from './services/admin-settings.service';

/**
 * Admin/staff API foundation (STEP 10).
 *
 * Every route is behind JwtAuthGuard (401 — who are you?) then
 * AuthorizationGuard (403 — may you?), in that order. A CUSTOMER
 * principal holds no permissions at all — customers have no row in
 * shared.user_roles — so every permission-gated route here is
 * automatically 403 for a customer without needing a customer-specific
 * rule. That is the existing STEP 7 model doing its job; nothing about
 * it is modified or weakened here.
 *
 * `GET /admin/session` is the one route without a permission
 * requirement: it only reports who the caller already is. It still
 * refuses a CUSTOMER explicitly, because the staff application should
 * fail closed rather than render a shell for a non-staff identity.
 *
 * Note on scope: SUPER_ADMIN in the approved seed holds
 * user/role/settings/audit/announcement permissions — it is NOT granted
 * rik.* or pif.* codes. This controller reflects the seed exactly
 * rather than widening any role, so a SUPER_ADMIN sees the shared
 * administration surface and not RIK/PIF module data. Broadening that
 * would be a database change, and is reported rather than assumed.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class AdminController {
  constructor(
    private readonly announcements: AdminAnnouncementsService,
    private readonly dashboard: AdminDashboardService,
    private readonly issueSchedules: IssueSchedulesRepository,
    private readonly users: UsersRepository,
    private readonly settings: AdminSettingsService
  ) {}

  /** Who the signed-in staff member is, with their live roles and permissions. */
  @Get('session')
  async session(@CurrentAuthContext() context: AuthContext) {
    this.requireStaff(context);
    const user = await this.users.findById(context.principalId);
    return {
      userId: context.principalId,
      username: user?.username ?? null,
      displayName: user?.display_name ?? null,
      roles: [...context.roles].sort(),
      permissions: [...context.permissions].sort(),
    };
  }

  /** Role-appropriate dashboard tiles — real figures or an honest 'unavailable'. */
  @Get('dashboard')
  async dashboardSummary(@CurrentAuthContext() context: AuthContext) {
    this.requireStaff(context);
    return this.dashboard.build(context);
  }

  @Get('announcements')
  @RequirePermissions('shared.announcement.manage')
  async listAnnouncements(@CurrentAuthContext() context: AuthContext) {
    return this.announcements.list(context);
  }

  @Post('announcements')
  @RequirePermissions('shared.announcement.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async createAnnouncement(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateAnnouncementDto) {
    try {
      return await this.announcements.create(context, {
        title: dto.title,
        body: dto.body,
        announcementType: dto.announcementType,
        targetAudience: dto.targetAudience,
        priority: dto.priority,
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        isPublished: dto.isPublished,
      });
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  @Patch('announcements/:id')
  @RequirePermissions('shared.announcement.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async updateAnnouncement(
    @CurrentAuthContext() context: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto
  ) {
    try {
      return await this.announcements.update(context, id, {
        title: dto.title,
        body: dto.body,
        priority: dto.priority,
        isPublished: dto.isPublished,
        endDate: dto.endDate ?? null,
      });
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  // ------------------------------------------------------------------
  // PIF SELF-REGISTRATION SWITCH
  //
  // Both routes require `shared.settings.write`, which the approved seed
  // (migration 0019) grants to SUPER_ADMIN and to no other role. The
  // permission is OLD, not new; nothing about the RBAC model changed to
  // add this screen.
  //
  // SERVER-SIDE ENFORCEMENT IS THE ONLY ENFORCEMENT THAT COUNTS. The
  // Admin Portal also hides the page from a staff member without the
  // permission, but that is usability: AuthorizationGuard refuses the
  // request regardless of what the navigation chose to draw, and a
  // CUSTOMER principal holds no permissions at all, so it is 403 here
  // without needing a customer-specific rule.
  //
  // The READ is gated by the same permission as the WRITE, rather than
  // being left open to any staff member. Whether a public registration
  // endpoint is currently open is operational security information, and
  // the only people who need it are the people who can change it.
  // ------------------------------------------------------------------

  @Get('settings/pif-self-registration')
  @RequirePermissions('shared.settings.write')
  async readPifSelfRegistration() {
    return this.settings.readPifSelfRegistration();
  }

  /**
   * Turns PIF self-registration on or off, and records who did it.
   *
   * PUT rather than POST: this sets one named switch to a stated value, so
   * sending it twice leaves the same state. The response is the setting as
   * re-read AFTER the write, not the value the caller sent — the screen
   * should show what the server now holds, not what the browser hoped for.
   */
  @Put('settings/pif-self-registration')
  @RequirePermissions('shared.settings.write')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async setPifSelfRegistration(
    @CurrentAuthContext() context: AuthContext,
    @Body() dto: SetPifSelfRegistrationDto
  ) {
    return this.settings.setPifSelfRegistration(context, dto.enabled);
  }

  /**
   * RIK issue schedules — read-only foundation over the existing
   * rik.issue_schedules table (STEP 10 Section 8). No creation path
   * exists: real issue dates, windows and category scoping are
   * unresolved business decisions.
   */
  @Get('rik/issue-schedules')
  @RequirePermissions('rik.issue_schedule.manage')
  async listIssueSchedules() {
    const items = await this.issueSchedules.listUpcoming();
    return {
      items: items.map((s) => ({
        id: s.id,
        scheduleDate: s.schedule_date,
        categoryId: s.category_id,
        productId: s.product_id,
        status: s.status,
        startTime: s.start_time,
        endTime: s.end_time,
        notes: s.notes,
        isPublished: s.is_published,
      })),
      // Creation is deliberately not offered by this phase.
      canCreate: false,
    };
  }

  /**
   * Staff-only gate for the routes that carry no permission requirement.
   * A CUSTOMER reaching a staff route is 403, not 401: they are
   * authenticated, just not staff.
   */
  private requireStaff(context: AuthContext): void {
    if (context.principalType !== 'STAFF') {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Staff access is required.' });
    }
  }

  private toHttp(err: unknown): unknown {
    if (err instanceof AnnouncementAudienceForbiddenError) {
      // Same generic shape the guards use — it never reveals which
      // audiences exist or which the caller lacks.
      return new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'You do not have access to this resource.' });
    }
    if (err instanceof AnnouncementNotFoundError) {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Announcement not found.' });
    }
    return err;
  }
}
