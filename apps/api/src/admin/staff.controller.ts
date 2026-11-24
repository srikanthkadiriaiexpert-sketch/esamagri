import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import {
  AssignStaffRoleDto,
  CreateStaffDto,
  ResetStaffPasswordDto,
  SetStaffStatusDto,
  StaffSearchQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { AdminStaffService, StaffAdminError } from './services/admin-staff.service';

/**
 * Super Admin staff management API.
 *
 * =====================================================================
 * WHO MAY REACH THESE ROUTES, AND HOW THAT IS DECIDED
 * =====================================================================
 *
 * Every route is behind JwtAuthGuard (401 — who are you?) then
 * AuthorizationGuard (403 — may you?), in that order, and then requires
 * one of two permissions that the approved Phase 2 seed grants to
 * SUPER_ADMIN and to no other role:
 *
 *   `shared.user.manage`  — "Create/manage staff user accounts"
 *   `shared.role.grant`   — "Grant/revoke roles — the only role that
 *                            can grant other roles"
 *
 * Both have existed in shared.permissions since migration 0019 and had
 * never been required by any route. Using them rather than inventing new
 * codes is why this feature needs no migration and why no role gains any
 * permission it did not already hold.
 *
 * THE SPLIT IS MEANINGFUL, not decoration. Reading, creating, editing,
 * suspending and resetting a password require `shared.user.manage`;
 * changing which ROLES an account holds additionally requires
 * `shared.role.grant`. Both resolve to SUPER_ADMIN today, but the two
 * capabilities are separable in the schema, so the routes keep them
 * separate rather than collapsing a distinction the database draws.
 *
 * A CUSTOMER principal holds no permissions at all — customers have no
 * row in shared.user_roles — so every route here is automatically 403
 * for a customer without a customer-specific rule, and the service
 * refuses a non-STAFF principal as a second line.
 *
 * THIS IS ENFORCED HERE, NOT IN THE BROWSER. The Admin Portal hides the
 * Staff navigation entry from anyone without `shared.user.manage`, but
 * that is a usability filter: typing the URL reaches a screen whose
 * every request is authorized independently and comes back 403. The
 * role-isolation tests assert exactly that.
 *
 * =====================================================================
 * NOT TO BE CONFUSED WITH RIK OFFICERS
 * =====================================================================
 *
 * `/admin/rik/officers` manages CUSTOMERS — the officers who receive
 * rations, who live in shared.customers, carry a `rik_id`, and sign in
 * with a mobile number and an OTP. These routes manage STAFF — the
 * people who operate the portal, who live in shared.users and sign in
 * with a username and a password. Two different tables, two different
 * authentication flows, two different screens. Nothing here touches a
 * customer record.
 */
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class StaffController {
  constructor(private readonly staff: AdminStaffService) {}

  /** The staff list, filtered by name, username, role and status. */
  @Get()
  @RequirePermissions('shared.user.manage')
  @UsePipes(staffPipe())
  async list(@Query() query: StaffSearchQueryDto) {
    return this.run(() =>
      this.staff.listStaff({
        q: query.q,
        role: query.role,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      })
    );
  }

  /**
   * Every role the database holds, with the permissions each confers.
   *
   * Read from shared.roles rather than from a list in the application, so the
   * screen offers exactly the roles that exist. There is no `RIK_STAFF` in the
   * seed; the counter-facing RIK role is `RIK_PICKUP_STAFF`, and
   * `DELIVERY_STAFF` carries PIF delivery permissions only. The screen shows
   * each role's real permissions so an administrator can see that before
   * assigning it.
   */
  @Get('roles')
  @RequirePermissions('shared.user.manage')
  async roles() {
    return this.run(async () => ({ roles: await this.staff.listRoles() }));
  }

  /** One staff account, with its roles and the permissions they confer. */
  @Get(':userId')
  @RequirePermissions('shared.user.manage')
  async detail(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.run(() => this.staff.getStaff(userId));
  }

  /**
   * Creates a staff account.
   *
   * Requires BOTH permissions, because the body may carry a role and creating
   * an account with a role is a role grant. An administrator who could create
   * accounts but not grant roles would otherwise be able to grant one by
   * creating a new account with it.
   */
  @Post()
  @RequirePermissions('shared.user.manage', 'shared.role.grant')
  @UsePipes(staffPipe())
  async create(@CurrentAuthContext() context: AuthContext, @Body() body: CreateStaffDto) {
    return this.run(() =>
      this.staff.createStaff(context, {
        username: body.username,
        displayName: body.displayName,
        password: body.password,
        role: body.role,
        status: body.status,
      })
    );
  }

  /** Edits the permitted details. The display name is the only one. */
  @Patch(':userId')
  @RequirePermissions('shared.user.manage')
  @UsePipes(staffPipe())
  async update(
    @CurrentAuthContext() context: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: UpdateStaffDto
  ) {
    return this.run(() => this.staff.updateStaff(context, userId, { displayName: body.displayName }));
  }

  /** Suspends or reactivates an account, and revokes its sessions on suspend. */
  @Post(':userId/status')
  @RequirePermissions('shared.user.manage')
  @UsePipes(staffPipe())
  async setStatus(
    @CurrentAuthContext() context: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: SetStaffStatusDto
  ) {
    return this.run(() =>
      this.staff.setStatus(context, userId, { status: body.status, reason: body.reason })
    );
  }

  @Post(':userId/roles')
  @RequirePermissions('shared.user.manage', 'shared.role.grant')
  @UsePipes(staffPipe())
  async assignRole(
    @CurrentAuthContext() context: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: AssignStaffRoleDto
  ) {
    return this.run(() => this.staff.assignRole(context, userId, body.role));
  }

  /**
   * Revokes a role. The role name is a path segment rather than a body, so a
   * revoke is idempotent and cannot be confused with a grant by a client that
   * reuses the wrong verb.
   */
  @Delete(':userId/roles/:role')
  @RequirePermissions('shared.user.manage', 'shared.role.grant')
  async revokeRole(
    @CurrentAuthContext() context: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('role') role: string
  ) {
    return this.run(() => this.staff.revokeRole(context, userId, role));
  }

  /**
   * Resets a password to one the administrator supplies.
   *
   * The response carries no credential — see the service. It reports only that
   * the reset happened and how many sessions it ended.
   */
  @Post(':userId/password-reset')
  @RequirePermissions('shared.user.manage')
  @UsePipes(staffPipe())
  async resetPassword(
    @CurrentAuthContext() context: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: ResetStaffPasswordDto
  ) {
    return this.run(() =>
      this.staff.resetPassword(context, userId, {
        newPassword: body.newPassword,
        reason: body.reason,
      })
    );
  }

  /**
   * Maps a service refusal to the HTTP status that describes it, so the portal
   * can tell "you may not" from "that does not exist" from "already taken"
   * without parsing prose. Every message here is safe to show a Super Admin:
   * none of them leaks anything about an account the caller cannot already see.
   */
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof StaffAdminError) {
        const payload = {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, ...err.detail },
        };
        if (err.code === 'STAFF_NOT_FOUND') {
          throw new NotFoundException({ ...payload, code: ERROR_CODES.NOT_FOUND });
        }
        if (err.code === 'USERNAME_TAKEN') {
          throw new ConflictException(payload);
        }
        if (
          err.code === 'NOT_STAFF_PRINCIPAL' ||
          err.code === 'SELF_STATUS_CHANGE' ||
          err.code === 'SELF_ROLE_REVOKE' ||
          err.code === 'LAST_ACTIVE_SUPER_ADMIN'
        ) {
          throw new ForbiddenException({ ...payload, code: ERROR_CODES.FORBIDDEN });
        }
        throw new BadRequestException(payload);
      }
      throw err;
    }
  }
}

function staffPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}
