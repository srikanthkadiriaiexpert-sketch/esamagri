import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
  OfficerLinkConflictError,
  OfficerNotFoundError,
  OfficerValidationError,
  RikOfficerService,
} from './services/rik-officer.service';
import type { OfficerRecord } from './repositories/officers.repository';
import {
  OfficerListQueryDto,
  RegisterOfficerDto,
  SetOfficerActiveDto,
} from './dto/rik-officer.dto';

/**
 * Officer administration (STEP 15B Phase A).
 *
 * RECONSTRUCTED from the approved Phase A report after the working container
 * was lost; not the recovered original bytes.
 *
 * AUTHORIZATION — no new role, no new permission.
 *
 * Every route requires the existing `rik.entitlement.allocate`, held by
 * RIK_ADMIN and by no other role in the approved seed. Registering an officer
 * and allocating what they may draw are the same administrative authority, so
 * they share its code rather than introducing a sixteenth permission.
 *
 * SUPER_ADMIN holds no `rik.*` code and therefore cannot register an officer —
 * reported since STEP 11C and deliberately unchanged. A CUSTOMER holds no
 * permissions at all, so an officer cannot register themselves or anyone else.
 *
 * THERE IS NO DELETE ROUTE. Not an omission: an officer's RIK ID appears on
 * issue records that must stay readable, so the only state change offered is
 * active/inactive.
 */
@Controller('admin/rik/officers')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikOfficersController {
  constructor(private readonly officers: RikOfficerService) {}

  @Get()
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(officerPipe())
  async list(@Query() query: OfficerListQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const result = await this.officers.search({ q: query.q, limit, offset });
    return {
      items: result.items.map(officerView),
      total: result.total,
      limit,
      offset,
    };
  }

  @Get(':officerId')
  @RequirePermissions('rik.entitlement.allocate')
  async get(@Param('officerId', new ParseUUIDPipe()) officerId: string) {
    return this.run(() => this.officers.get(officerId), officerView);
  }

  /**
   * Register an officer, or link a resident who already has an account.
   *
   * `outcome` tells the screen which happened, so it can say "linked to an
   * existing resident, their dietary preference was kept" rather than
   * reporting a plain registration. Deliberately NOT a separate route: the
   * project owner's instruction was to reuse this workflow, not to add a
   * second approval surface.
   */
  @Post()
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(officerPipe())
  async register(@CurrentAuthContext() context: AuthContext, @Body() dto: RegisterOfficerDto) {
    return this.run(
      () =>
        this.officers.register(context, {
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          quarterBlock: dto.quarterBlock,
          quarterNumber: dto.quarterNumber,
          landmark: dto.landmark,
          dietaryPreference: dto.dietaryPreference,
        }),
      (result) => ({ ...officerView(result.officer), outcome: result.outcome })
    );
  }

  @Post(':officerId/active')
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(officerPipe())
  async setActive(
    @CurrentAuthContext() context: AuthContext,
    @Param('officerId', new ParseUUIDPipe()) officerId: string,
    @Body() dto: SetOfficerActiveDto
  ) {
    return this.run(() => this.officers.setActive(context, officerId, dto.isActive), officerView);
  }

  /**
   * Revoke every active session for this officer.
   *
   * SAME PERMISSION AS THE REST OF THIS CONTROLLER, and that is the
   * argument for it rather than a shortcut around a new one. The route
   * directly above this uses `rik.entitlement.allocate` to DEACTIVATE a
   * customer; ending that same customer's sessions is strictly the smaller
   * action, so inventing a new permission code to guard it would be asking
   * for a weaker thing to be harder to do. It also could not have been done
   * here: `PERMISSION_CODES` must stay in lockstep with
   * `shared.permissions`, so a new code needs a migration, and migrations
   * are out of scope for this change.
   *
   * A CUSTOMER CANNOT REACH THIS. The controller is mounted under
   * `admin/rik/officers` behind JwtAuthGuard and AuthorizationGuard, and a
   * CUSTOMER principal holds no permissions at all — so one customer cannot
   * revoke another's sessions, nor their own. Only staff holding
   * `rik.entitlement.allocate` (RIK_ADMIN in the approved seed) can.
   *
   * POST, not DELETE: a session is not a resource addressed by this URL, and
   * the action is a deliberate instruction rather than the removal of the
   * thing named in the path.
   *
   * NO TOKEN VALUE IS ACCEPTED OR RETURNED. The caller names an officer; the
   * response is a count. Nothing in this path reads, prints or echoes a
   * refresh token, and the audit row holds the count and the RIK ID only.
   */
  @Post(':officerId/sessions/revoke')
  @RequirePermissions('rik.entitlement.allocate')
  async revokeSessions(
    @CurrentAuthContext() context: AuthContext,
    @Param('officerId', new ParseUUIDPipe()) officerId: string
  ) {
    return this.run(
      () => this.officers.revokeSessions(context, officerId),
      (result) => ({
        ...officerView(result.officer),
        revokedSessions: result.revokedSessions,
      })
    );
  }

  // ---------------------------------------------------------------- internals

  /**
   * A refusal is 400 carrying the service's own sentence and a
   * machine-readable reason; an unknown officer is 404.
   */
  private async run<T, V>(work: () => Promise<T>, view: (value: T) => V): Promise<V> {
    try {
      return view(await work());
    } catch (err) {
      if (err instanceof OfficerNotFoundError) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
      }
      if (err instanceof OfficerLinkConflictError) {
        throw new ConflictException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: 'LINK_CONFLICT' },
        });
      }
      if (err instanceof OfficerValidationError) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, field: err.field },
        });
      }
      throw err;
    }
  }
}

function officerPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

/**
 * The officer, as an administrator reads them.
 *
 * `rikId` leads, because it is the identifier every other record uses and the
 * first thing an administrator checks. Both names travel: `name` is the
 * officer's own display name, `officialName` the facility's spelling that an
 * eligibility import verifies against.
 *
 * No eligible days appear here. An officer registered a moment ago has none
 * recorded, and reporting a zero would state something untrue.
 */
function officerView(officer: OfficerRecord) {
  return {
    rikId: officer.rik_id,
    officerId: officer.id,
    name: officer.name,
    officialName: officer.official_name,
    mobileNumber: officer.mobile_number,
    dietaryPreference: officer.dietary_preference,
    residence:
      officer.quarter_block === null && officer.quarter_number === null
        ? null
        : {
            quarterBlock: officer.quarter_block,
            quarterNumber: officer.quarter_number,
            landmark: officer.landmark,
          },
    status: officer.is_active ? 'ACTIVE' : 'INACTIVE',
    createdAt: officer.created_at,
  };
}
