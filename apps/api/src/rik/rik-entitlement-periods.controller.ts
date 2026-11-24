import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { PeriodAdminError, RikEntitlementPeriodService } from './services/rik-entitlement-period.service';
import type { PeriodView } from './services/rik-entitlement-period.service';
import {
  CreatePeriodDto,
  SetPeriodStatusDto,
  UpdatePeriodDto,
} from './dto/rik-entitlement-period.dto';

/**
 * Entitlement period administration.
 *
 * AUTHORIZATION — no new role, no new permission, no seed change.
 *
 * Every route requires the existing `rik.entitlement.allocate`, which both
 * RIK_ADMIN and SUPER_ADMIN already hold in this deployment. Opening a period
 * and allocating what may be drawn in it are the same administrative
 * authority, so they share its code rather than introducing another.
 *
 * THERE IS NO DELETE ROUTE. Not an omission: a period is referenced by
 * eligibility, entitlements, selections, issue windows, vouchers and
 * carry-forward rows. `PATCH :periodId/status` to CLOSED retires it without
 * touching one of them.
 *
 * NOTHING HERE COMPUTES AN ENTITLEMENT. A period is a name and two dates.
 */
@Controller('admin/rik/entitlement-periods')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikEntitlementPeriodsController {
  constructor(private readonly periods: RikEntitlementPeriodService) {}

  /**
   * Every period, with its derived state and `currentPeriodId`.
   *
   * `currentPeriodId` is null when no period is operational today — which is a
   * real and important answer, not an error. The screen says so in words and
   * asks an administrator to configure one, rather than selecting something
   * arbitrary.
   */
  @Get()
  @RequirePermissions('rik.entitlement.allocate')
  async list() {
    const result = await this.periods.list();
    return {
      items: result.periods.map(periodView),
      currentPeriodId: result.currentPeriodId,
      total: result.periods.length,
    };
  }

  @Post()
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(periodPipe())
  async create(@CurrentAuthContext() context: AuthContext, @Body() dto: CreatePeriodDto) {
    return this.run(
      () =>
        this.periods.create(context, {
          name: dto.name,
          startDate: dto.startDate,
          endDate: dto.endDate,
          status: dto.status,
        }),
      periodView
    );
  }

  @Patch(':periodId')
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(periodPipe())
  async update(
    @CurrentAuthContext() context: AuthContext,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() dto: UpdatePeriodDto
  ) {
    return this.run(
      () =>
        this.periods.update(context, periodId, {
          name: dto.name,
          startDate: dto.startDate,
          endDate: dto.endDate,
        }),
      periodView
    );
  }

  @Patch(':periodId/status')
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(periodPipe())
  async setStatus(
    @CurrentAuthContext() context: AuthContext,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() dto: SetPeriodStatusDto
  ) {
    return this.run(() => this.periods.setStatus(context, periodId, dto.status), periodView);
  }

  // ---------------------------------------------------------------- internals

  /**
   * A refusal carries the service's own sentence and a machine-readable reason.
   *
   * 404 for an unknown period. 409 for the two refusals that are about the
   * state of other records rather than this request's shape — a name or date
   * range that collides, and a period whose dates are pinned by dependents —
   * because retrying the same request unchanged will not help. Everything else
   * is 400.
   */
  private async run<T, V>(work: () => Promise<T>, view: (value: T) => V): Promise<V> {
    try {
      return view(await work());
    } catch (err) {
      if (err instanceof PeriodAdminError) {
        const payload = {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, field: err.field, ...err.detail },
        };
        if (err.code === 'PERIOD_NOT_FOUND') {
          throw new NotFoundException({ ...payload, code: ERROR_CODES.NOT_FOUND });
        }
        if (
          err.code === 'DUPLICATE_NAME' ||
          err.code === 'OVERLAPPING_PERIOD' ||
          err.code === 'PERIOD_IN_USE'
        ) {
          throw new ConflictException(payload);
        }
        throw new BadRequestException(payload);
      }
      throw err;
    }
  }
}

function periodPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

/**
 * The period, as an administrator reads it.
 *
 * `state` and `status` both travel, and that is deliberate: `status` is the
 * label the facility set, `state` is what the period actually is today. A
 * screen that showed only one of them would eventually mislead someone —
 * "ACTIVE" on a period that ended last week, or "PAST" on one somebody still
 * needs to close.
 *
 * `dependents` travels so the screen can explain WHY dates are locked instead
 * of merely disabling a field.
 */
function periodView(period: PeriodView) {
  return {
    periodId: period.id,
    name: period.name,
    startDate: period.start_date,
    endDate: period.end_date,
    status: period.status,
    state: period.state,
    isCurrent: period.isCurrent,
    datesEditable: period.datesEditable,
    dependents: period.dependents,
  };
}
