import {
  BadRequestException,
  Body,
  Controller,
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
  humanWindow,
  IssueWindowError,
  RikIssueWindowService,
} from './services/rik-issue-window.service';
import type {
  IssueWindowRecord,
  IssueWindowRevisionRecord,
} from './repositories/issue-windows.repository';
import {
  ConfigureIssueWindowDto,
  IssueWindowListQueryDto,
  UpdateIssueWindowDto,
} from './dto/rik-issue-window.dto';

/**
 * RIK issue-window administration (STEP 15C).
 *
 * AUTHORIZATION — no new role, no new permission.
 *
 * Every route requires the existing `rik.issue_schedule.manage`, held by
 * RIK_ADMIN and by no other role in the approved seed. That code already
 * governs the facility's issue scheduling, which is exactly what an issue
 * window is, so a sixteenth permission would have been a new name for an
 * existing authority.
 *
 * SUPER_ADMIN holds no `rik.*` code and therefore cannot configure a window —
 * reported since STEP 11C and deliberately unchanged. A CUSTOMER holds no
 * permissions at all; their read-only view is a separate route on the
 * customer controller and there is no customer route here.
 *
 * THERE IS NO DELETE ROUTE, and not by omission: migration 0047 refuses
 * DELETE and the application role holds no DELETE privilege. A window an
 * officer was already shown stays on record, retired.
 */
@Controller('admin/rik/issue-windows')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikIssueWindowsController {
  constructor(private readonly windows: RikIssueWindowService) {}

  /** Every window of one period, retired ones included, in schedule order. */
  @Get()
  @RequirePermissions('rik.issue_schedule.manage')
  @UsePipes(windowPipe())
  async list(@Query() query: IssueWindowListQueryDto) {
    return this.run(
      () => this.windows.listForPeriod(query.periodId),
      (items) => ({ items: items.map(windowView) })
    );
  }

  @Get(':windowId')
  @RequirePermissions('rik.issue_schedule.manage')
  async get(@Param('windowId', new ParseUUIDPipe()) windowId: string) {
    return this.run(() => this.windows.get(windowId), windowView);
  }

  /** Who changed this window, when, and what it said before. */
  @Get(':windowId/revisions')
  @RequirePermissions('rik.issue_schedule.manage')
  async revisions(@Param('windowId', new ParseUUIDPipe()) windowId: string) {
    return this.run(
      () => this.windows.revisions(windowId),
      (items) => ({ items: items.map(revisionView) })
    );
  }

  @Post()
  @RequirePermissions('rik.issue_schedule.manage')
  @UsePipes(windowPipe())
  async configure(
    @CurrentAuthContext() context: AuthContext,
    @Body() dto: ConfigureIssueWindowDto
  ) {
    return this.run(
      () =>
        this.windows.configure(context, {
          periodId: dto.periodId,
          rationType: dto.rationType,
          sequenceNo: dto.sequenceNo,
          startDate: dto.startDate,
          endDate: dto.endDate,
          operatingDays: dto.operatingDays,
          notes: dto.notes ?? null,
        }),
      windowView
    );
  }

  /**
   * Reconfigure a window: its dates, its operating days, its note, or whether
   * it is live. The database records the revision itself.
   */
  @Patch(':windowId')
  @RequirePermissions('rik.issue_schedule.manage')
  @UsePipes(windowPipe())
  async update(
    @CurrentAuthContext() context: AuthContext,
    @Param('windowId', new ParseUUIDPipe()) windowId: string,
    @Body() dto: UpdateIssueWindowDto
  ) {
    return this.run(
      () =>
        this.windows.update(context, windowId, {
          startDate: dto.startDate,
          endDate: dto.endDate,
          operatingDays: dto.operatingDays,
          notes: dto.notes,
          isActive: dto.isActive,
        }),
      windowView
    );
  }

  // ---------------------------------------------------------------- internals

  /**
   * A refusal is 400 carrying the service's own sentence and a
   * machine-readable reason; an unknown window or period is 404.
   */
  private async run<T, V>(work: () => Promise<T>, view: (value: T) => V): Promise<V> {
    try {
      return view(await work());
    } catch (err) {
      if (err instanceof IssueWindowError) {
        if (err.code === 'WINDOW_NOT_FOUND' || err.code === 'PERIOD_NOT_FOUND') {
          throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
        }
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, field: err.field, ...err.detail },
        });
      }
      throw err;
    }
  }
}

function windowPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

/**
 * One window, as an administrator reads it.
 *
 * The window's own name leads, because "Fresh Issue 2" is what the facility
 * calls it and `sequence_no` is how the database orders it. Both who created
 * it and who last changed it travel, so the list answers "who moved this?"
 * without opening the revision history.
 */
function windowView(w: IssueWindowRecord) {
  return {
    windowId: w.id,
    windowCode: w.window_code,
    label: humanWindow(w.window_code),
    rationType: w.ration_type,
    sequenceNo: w.sequence_no,
    period: {
      periodId: w.period_id,
      name: w.period_name,
      startDate: w.period_start_date,
      endDate: w.period_end_date,
    },
    startDate: w.start_date,
    endDate: w.end_date,
    operatingDays: w.operating_days,
    isActive: w.is_active,
    status: w.is_active ? 'ACTIVE' : 'RETIRED',
    notes: w.notes,
    createdAt: w.created_at,
    createdBy: { staffId: w.created_by, name: w.created_by_name },
    updatedAt: w.updated_at,
    updatedBy: { staffId: w.updated_by, name: w.updated_by_name },
  };
}

/**
 * One revision, with both states.
 *
 * `before` is null on the first revision, which is what CREATED means. The
 * states are the database's own jsonb snapshots (rik.issue_window_state), not
 * a reconstruction, so the history cannot drift from what actually happened.
 */
function revisionView(r: IssueWindowRevisionRecord) {
  return {
    revisionId: r.id,
    windowId: r.window_id,
    revisionNo: r.revision_no,
    changeType: r.change_type,
    windowCode: r.window_code,
    label: humanWindow(r.window_code),
    rationType: r.ration_type,
    before: r.before_state,
    after: r.after_state,
    changedBy: { staffId: r.changed_by, name: r.changed_by_name },
    changedAt: r.changed_at,
  };
}
