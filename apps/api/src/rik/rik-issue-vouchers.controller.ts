import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { summaryView } from './issue-voucher-summary.view';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentAuthContext } from '../auth/decorators/current-auth-context.decorator';
import type { AuthContext } from '../auth/auth-context';
import {
  IssueVoucherError,
  RikIssueVoucherService,
  type VoucherDetail,
} from './services/rik-issue-voucher.service';
import type {
  FulfillmentMode,
  RationType,
  VoucherStatus,
} from './repositories/issue-vouchers.repository';
import {
  RikVoucherExportService,
  VoucherExportError,
} from './services/rik-voucher-export.service';
import {
  CreateIssueVoucherDto,
  VoucherExportQueryDto,
  VoucherSearchQueryDto,
} from './dto/rik-issue-voucher.dto';
import type { AuditEntryRecord } from '../shared/repositories/audit-log.repository';

/**
 * Issue voucher administration (PHASE D).
 *
 * AUTHORIZATION — no new role, no new permission.
 *
 * Every route requires the existing `rik.order.manage`, which the approved
 * seed grants to RIK_ADMIN and to no other role. It is the right code: a
 * voucher is the operational request the yard works from, and
 * `rik.order.manage` is the authority over exactly that.
 *
 * DELIVERY_STAFF HOLDS NO rik.* PERMISSION AT ALL, so it cannot reach any
 * route here — which is the approved rule that delivery involvement does not
 * confer authority over RIK voucher state. RIK_PICKUP_STAFF holds
 * `rik.order.mark_ready` and `rik.order.mark_collected`, neither of which
 * appears below: those are the fulfilment TRANSITIONS, and this phase does
 * not implement them. SUPER_ADMIN holds no `rik.*` code — reported since
 * STEP 11C and deliberately unchanged.
 *
 * WHAT THIS CONTROLLER CANNOT DO, STRUCTURALLY
 *
 * There is no route that changes a voucher: no PATCH, no status action, no
 * collection or delivery, no substitution, no delete. Nor could one work if
 * it existed — migration 0048 leaves the application with SELECT and INSERT
 * on the voucher table and nothing else.
 */
@Controller('admin/rik/issue-vouchers')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikIssueVouchersController {
  constructor(
    private readonly vouchers: RikIssueVoucherService,
    private readonly exports: RikVoucherExportService
  ) {}

  /** The operational list: search and filters over every voucher. */
  @Get()
  @RequirePermissions('rik.order.manage')
  @UsePipes(voucherPipe())
  async list(@Query() query: VoucherSearchQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const result = await this.vouchers.search({
      q: query.q,
      rationType: query.rationType as RationType | undefined,
      fulfillmentMode: query.fulfillmentMode as FulfillmentMode | undefined,
      status: query.status as VoucherStatus | undefined,
      periodId: query.periodId,
      issuedFrom: query.issuedFrom,
      issuedTo: query.issuedTo,
      limit,
      offset,
    });
    return { items: result.items.map(summaryView), total: result.total, limit, offset };
  }

  /**
   * The operational workbook: five sheets over exactly the filtered set.
   *
   * DECLARED BEFORE `@Get(':voucherId')`, AND THAT IS NOT COSMETIC. Nest
   * matches routes in declaration order, so below the parameterised route
   * the literal "export" would be captured as `:voucherId`, handed to
   * `ParseUUIDPipe` and rejected as a malformed UUID — a 400 that looks
   * like a client bug and is really a routing bug. Moving this method down
   * breaks the endpoint; a test pins the behaviour so that cannot happen
   * quietly.
   *
   * READ-ONLY. One count, a few paged reads, and one snapshot replay per
   * voucher through the existing service. No status moves, no outcome is
   * recorded, nothing is written — and nothing could be, since the
   * application holds no UPDATE on the voucher table at all.
   *
   * `@Res()` is used because the body is a binary workbook rather than
   * JSON, exactly as the PIF import-template route does. Errors are thrown
   * BEFORE anything is written to the response, so a refusal is still a
   * normal JSON error and never a half-streamed file.
   */
  @Get('export')
  @RequirePermissions('rik.order.manage')
  @UsePipes(voucherPipe())
  async export(@Query() query: VoucherExportQueryDto, @Res() res: Response): Promise<void> {
    let workbook: Buffer;
    try {
      workbook = await this.exports.build({
        q: query.q,
        rationType: query.rationType as RationType | undefined,
        fulfillmentMode: query.fulfillmentMode as FulfillmentMode | undefined,
        status: query.status as VoucherStatus | undefined,
        periodId: query.periodId,
        issuedFrom: query.issuedFrom,
        issuedTo: query.issuedTo,
      });
    } catch (err) {
      if (err instanceof VoucherExportError) {
        // A refusal the operator can act on: too many vouchers, or one
        // whose frozen snapshot could not be replayed. The reason code and
        // the offending voucher travel in `details` so the screen can show
        // the server's own sentence rather than inventing one.
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, ...err.detail },
        });
      }
      throw err;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename(new Date())}"`
    );
    res.setHeader('Content-Length', workbook.length);
    res.end(workbook);
  }

  @Get(':voucherId')
  @RequirePermissions('rik.order.manage')
  async detail(@Param('voucherId', new ParseUUIDPipe()) voucherId: string) {
    return this.run(() => this.vouchers.detail(voucherId), (d) => staffDetailView(d));
  }

  /** The voucher's own history, from shared.audit_log. */
  @Get(':voucherId/history')
  @RequirePermissions('rik.order.manage')
  async history(@Param('voucherId', new ParseUUIDPipe()) voucherId: string) {
    return this.run(
      () => this.vouchers.history(voucherId),
      (entries) => ({ items: entries.map(historyView) })
    );
  }

  /**
   * Create the voucher for a confirmed selection, or hand back the one that
   * already exists. Repeating the request is never an error and never a
   * second document.
   */
  @Post()
  @RequirePermissions('rik.order.manage')
  @UsePipes(voucherPipe())
  async create(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateIssueVoucherDto) {
    return this.run(
      () => this.vouchers.create(context, { selectionId: dto.selectionId, rationType: dto.rationType }),
      (result) => ({ created: result.created, ...summaryView(result.voucher) })
    );
  }

  // ---------------------------------------------------------------- internals

  private async run<T, V>(work: () => Promise<T>, view: (value: T) => V): Promise<V> {
    try {
      return view(await work());
    } catch (err) {
      if (err instanceof IssueVoucherError) {
        if (err.code === 'VOUCHER_NOT_FOUND' || err.code === 'SELECTION_NOT_FOUND') {
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

function voucherPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

/**
 * A sortable, filename-safe stamp: rik-issue-vouchers-2026-11-19-1654.xlsx.
 *
 * UTC, unlike the Admin Portal's CSV stamp, which is local — a file named
 * by the server cannot know the operator's clock, and guessing at it is how
 * two exports taken minutes apart end up looking hours apart.
 */
export function exportFilename(now: Date): string {
  const iso = now.toISOString();
  return `rik-issue-vouchers-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.xlsx`;
}


/**
 * The full voucher, for staff.
 *
 * Carries the operational detail an administrator needs — who issued it, the
 * officer's quarter, the pool arithmetic and the configured windows — and the
 * source components, which today are the one current period.
 */
function staffDetailView(detail: VoucherDetail) {
  const v = detail.voucher;
  return {
    ...summaryView(v),
    officer: {
      rikId: v.rik_id,
      name: v.officer_name,
      officialName: v.officer_official_name,
      mobileNumber: v.mobile_number,
      residence:
        v.quarter_block === null && v.quarter_number === null
          ? null
          : { quarterBlock: v.quarter_block, quarterNumber: v.quarter_number, landmark: v.landmark },
    },
    period: {
      id: v.period_id,
      name: v.period_name,
      startDate: v.period_start_date,
      endDate: v.period_end_date,
    },
    fulfillment: {
      mode: v.fulfillment_mode,
      pickupLocationName: v.pickup_location_name,
      deliveryAddress: v.delivery_address,
    },
    sourceComponents: detail.sourceComponents,
    windows: detail.windows,
    currentWindowCode: detail.currentWindowCode,
    pools: detail.pools,
    issuedBy: { staffId: v.created_by, name: v.created_by_name },
  };
}

function historyView(entry: AuditEntryRecord) {
  return {
    entryId: entry.id,
    action: entry.action,
    at: entry.created_at,
    actorId: entry.actor_id,
    actorName: entry.actor_display_name,
    actorRole: entry.actor_role,
    before: entry.before_data,
    after: entry.after_data,
  };
}

// Re-exported so this module's public surface is unchanged by the move.
export { summaryView };
