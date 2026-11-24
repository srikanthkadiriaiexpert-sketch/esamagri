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
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentAuthContext } from '../auth/decorators/current-auth-context.decorator';
import type { AuthContext } from '../auth/auth-context';
import { EntitlementPeriodsRepository } from './repositories/entitlement-periods.repository';
import {
  CustomerEligibilityFiguresRepository,
  verificationStatusFor,
} from './repositories/customer-eligibility-figures.repository';
import { RATION_TYPES, rationTypeLabel } from './services/rik-eligibility.service';
import {
  EligibilityAdminError,
  RikEligibilityAdminService,
  type BatchWithRows,
  type UploadedWorkbook,
} from './services/rik-eligibility-admin.service';
import { ExcelParseError, MAX_UPLOAD_BYTES } from './services/excel-eligibility-parser.service';
import { AdjustEligibilityDto, BatchListQueryDto, UploadEligibilityDto } from './dto/rik-eligibility.dto';
import type {
  AdjustmentRecord,
  ImportBatchRecord,
  ImportRowRecord,
} from './repositories/eligibility-import.repository';

/**
 * Eligibility imports and eligible-day adjustments (STEP 15B Phase B).
 *
 * AUTHORIZATION — no new role, no new permission.
 *
 * Every route requires `rik.entitlement.allocate`, held by RIK_ADMIN and by
 * no other role in the approved seed. The same code governs officer
 * registration (Phase A), which is the right grouping: both are the facility
 * deciding who an officer is and what they are entitled to draw against.
 *
 * SUPER_ADMIN holds no `rik.*` code and therefore cannot import eligibility —
 * reported since STEP 11C and unchanged. A CUSTOMER holds no permissions at
 * all, so an officer cannot read, let alone write, their own eligible days:
 * there is no customer route here, and the customer app has no write path to
 * eligibility anywhere.
 *
 * WHY UPLOAD AND CONFIRM ARE TWO REQUESTS
 *
 * Upload parses, maps and records a batch in PENDING_REVIEW. It changes no
 * officer's eligible days. Confirm is a separate call. "Never silently apply
 * a spreadsheet" is therefore a property of the API's shape rather than a
 * flag that could be defaulted wrongly.
 */
@Controller('admin/rik')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikEligibilityController {
  constructor(
    private readonly eligibility: RikEligibilityAdminService,
    private readonly periods: EntitlementPeriodsRepository,
    private readonly figures: CustomerEligibilityFiguresRepository
  ) {}

  /**
   * The periods an import may target.
   *
   * Needed because the Excel carries no period column, so the screen has to
   * offer a choice. Read-only: creating a period is still outside the
   * application.
   */
  @Get('periods')
  @RequirePermissions('rik.entitlement.allocate')
  async listPeriods() {
    const items = await this.periods.listAll();
    return {
      items: items.map((p) => ({
        periodId: p.id,
        name: p.name,
        startDate: p.start_date,
        endDate: p.end_date,
        status: p.status,
      })),
    };
  }

  // ------------------------------------------------------------- imports

  @Post('eligibility-imports')
  @RequirePermissions('rik.entitlement.allocate')
  @UseInterceptors(
    FileInterceptor('file', {
      // In memory, never on disk: the workbook is parsed and discarded, and
      // nothing writes an officer's data to the filesystem.
      storage: undefined,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    })
  )
  async upload(
    @CurrentAuthContext() context: AuthContext,
    @UploadedFile() file: UploadedWorkbook | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    dto: UploadEligibilityDto
  ) {
    if (!file) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Attach the eligibility workbook as the "file" field.',
        details: { reason: 'FILE_REQUIRED', field: 'file' },
      });
    }
    return this.run(
      () =>
        this.eligibility.upload(context, {
          periodId: dto.periodId,
          rationType: dto.rationType,
          file,
        }),
      batchView
    );
  }

  /**
   * Whether this period's Fresh and Dry sheets have been published.
   *
   * Two entries, always, so that "Dry not uploaded" is stated rather than
   * inferred from an empty panel. Read-only.
   */
  @Get('periods/:periodId/eligibility-status')
  @RequirePermissions('rik.entitlement.allocate')
  async uploadStatus(@Param('periodId', new ParseUUIDPipe()) periodId: string) {
    return this.run(
      () => this.eligibility.uploadStatus(periodId),
      (items) => ({
        items: items.map((s) => ({
          rationType: s.ration_type,
          uploaded: s.batch_id !== null,
          batchId: s.batch_id,
          batchRef: s.batch_ref,
          status: s.status,
          totals:
            s.batch_id === null
              ? null
              : {
                  rows: s.total_rows ?? 0,
                  changed: s.matched_changed ?? 0,
                  noChange: s.matched_no_change ?? 0,
                  exceptions: s.exception_rows ?? 0,
                  applied: s.applied_rows ?? 0,
                },
          uploadedAt: s.uploaded_at,
          decidedAt: s.decided_at,
          officersWithValue: s.officers_with_value,
        })),
      })
    );
  }

  /**
   * WHICH OFFICERS ARE MISSING A FIGURE, BY NAME.
   *
   * The panel above this route reports whether each sheet was uploaded. That
   * is not enough once eligible days actually drive the calculation: an
   * applied Fresh sheet with nine officers missing from it leaves nine
   * officers unable to draw their Fresh ration, and "Fresh: Uploaded" says
   * nothing about them. This route names them.
   *
   * Read-only, same permission as the rest of this controller, same period
   * parameter. One row per officer who needs attention — a missing figure or
   * a published zero — with both figures and a derived status per type.
   *
   * DERIVED, NOT STORED. No column records "verified"; the status is read off
   * the figure that exists plus the import history, so no migration was
   * needed and nothing new has to be kept in step.
   *
   * WHAT THE STATUS IS NOT ALLOWED TO CLAIM. An officer is reported as absent
   * from the latest upload only when an APPLIED batch for that ration type
   * exists and contains no row matching them — the one case where absence is
   * a fact on record. With no applied batch, the status is the generic
   * "eligibility verification required" instead, because there is no sheet
   * for them to have been left out of.
   *
   * THE LIST IS NEVER QUIETLY CUT SHORT. `truncated` is true when more
   * officers need attention than are listed, and the totals are counted
   * across the whole roll rather than over the page.
   */
  @Get('periods/:periodId/eligibility-gaps')
  @RequirePermissions('rik.entitlement.allocate')
  async eligibilityGaps(@Param('periodId', new ParseUUIDPipe()) periodId: string) {
    const period = await this.periods.findById(periodId);
    if (!period) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'That ration period does not exist.',
      });
    }

    const gaps = await this.figures.officerGapsForPeriod(periodId);

    return {
      period: {
        id: period.id,
        name: period.name,
        startDate: period.start_date,
        endDate: period.end_date,
      },
      totals: gaps.totals,
      truncated: gaps.truncated,
      items: gaps.rows.map((row) => ({
        customerId: row.customer_id,
        rikId: row.rik_id,
        name: row.name,
        officialName: row.official_name,
        byRationType: RATION_TYPES.map((rationType) => ({
          rationType,
          label: rationTypeLabel(rationType),
          days: rationType === 'FRESH' ? row.fresh_eligible_days : row.dry_eligible_days,
          status: verificationStatusFor(row, rationType),
        })),
      })),
    };
  }

  @Get('eligibility-imports')
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(eligibilityPipe())
  async listBatches(@Query() query: BatchListQueryDto) {
    const items = await this.eligibility.listBatches(query.limit);
    return { items: items.map(batchSummary) };
  }

  @Get('eligibility-imports/:batchId')
  @RequirePermissions('rik.entitlement.allocate')
  async batch(@Param('batchId', new ParseUUIDPipe()) batchId: string) {
    return this.run(() => this.eligibility.getBatch(batchId), batchView);
  }

  /** Apply a reviewed batch. Idempotent: a second call returns the applied batch. */
  @Post('eligibility-imports/:batchId/confirm')
  @RequirePermissions('rik.entitlement.allocate')
  async confirm(
    @CurrentAuthContext() context: AuthContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string
  ) {
    return this.run(() => this.eligibility.confirm(context, batchId), batchView);
  }

  @Post('eligibility-imports/:batchId/discard')
  @RequirePermissions('rik.entitlement.allocate')
  async discard(
    @CurrentAuthContext() context: AuthContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string
  ) {
    return this.run(() => this.eligibility.discard(context, batchId), batchView);
  }

  // --------------------------------------------------- officer eligibility

  @Get('officers/:officerId/eligibility')
  @RequirePermissions('rik.entitlement.allocate')
  async officerEligibility(@Param('officerId', new ParseUUIDPipe()) officerId: string) {
    return this.run(
      () => this.eligibility.officerEligibility(officerId),
      (result) => ({
        periods: result.periods.map((p) => ({
          periodId: p.period_id,
          periodName: p.period_name,
          // The legacy figure, which still drives the entitlement engine,
          // followed by the two new ones. NULL travels as null and is never
          // coerced to 0: "not published" and "zero days" are different
          // statements and staff have to be able to tell them apart.
          eligibleDays: p.eligible_days,
          freshEligibleDays: p.fresh_eligible_days,
          dryEligibleDays: p.dry_eligible_days,
          updatedAt: p.updated_at,
        })),
        history: result.history.map(adjustmentView),
      })
    );
  }

  /** The exception path: one officer, one period, one reason. */
  @Post('officers/:officerId/eligibility')
  @RequirePermissions('rik.entitlement.allocate')
  @UsePipes(eligibilityPipe())
  async adjust(
    @CurrentAuthContext() context: AuthContext,
    @Param('officerId', new ParseUUIDPipe()) officerId: string,
    @Body() dto: AdjustEligibilityDto
  ) {
    return this.run(
      () =>
        this.eligibility.adjust(context, {
          officerId,
          periodId: dto.periodId,
          rationType: dto.rationType,
          eligibleDays: dto.eligibleDays,
          reason: dto.reason,
        }),
      (result) => ({
        previousEligibleDays: result.previous,
        delta: result.delta,
        newEligibleDays: result.next,
        adjustmentId: result.adjustmentId,
      })
    );
  }

  // ---------------------------------------------------------------- internals

  /**
   * A refusal is 400 with a machine-readable reason; a missing batch or
   * officer is 404. A parse failure is also a 400 and carries its own code,
   * because "the workbook has no Eligible Days column" is something the
   * administrator can fix, not an internal error.
   */
  private async run<T, V>(work: () => Promise<T>, view: (value: T) => V): Promise<V> {
    try {
      return view(await work());
    } catch (err) {
      if (err instanceof ExcelParseError) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, field: 'file', ...err.detail },
        });
      }
      if (err instanceof EligibilityAdminError) {
        if (err.code === 'BATCH_NOT_FOUND' || err.code === 'OFFICER_NOT_FOUND') {
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

function eligibilityPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

function batchSummary(b: ImportBatchRecord) {
  return {
    batchId: b.id,
    batchRef: b.batch_ref,
    periodId: b.period_id,
    periodName: b.period_name,
    /** FRESH, DRY, or null on a batch uploaded before migration 0066. */
    rationType: b.ration_type,
    fileName: b.file_name,
    fileHash: b.file_hash,
    status: b.status,
    totals: {
      rows: b.total_rows,
      changed: b.matched_changed,
      noChange: b.matched_no_change,
      exceptions: b.exception_rows,
      applied: b.applied_rows,
    },
    uploadedAt: b.uploaded_at,
    decidedAt: b.decided_at,
  };
}

/**
 * The preview, as a reviewer reads it.
 *
 * Both names are sent — what the sheet said and what e-Samagri holds —
 * because a NAME_MISMATCH is only reviewable if the reviewer can see the two
 * values side by side. The raw eligible-days text travels too, so "the sheet
 * says 7.5" can be shown instead of "invalid number".
 */
function batchView(result: BatchWithRows) {
  return {
    ...batchSummary(result.batch),
    rows: result.rows.map((r: ImportRowRecord) => ({
      rowId: r.id,
      sheetRow: r.sheet_row,
      excelName: r.raw_name,
      excelMobile: r.raw_mobile,
      excelEligibleDays: r.raw_eligible_days,
      normalisedMobile: r.normalised_mobile,
      officerId: r.matched_customer_id,
      rikId: r.matched_rik_id,
      systemName: r.system_name,
      systemOfficialName: r.system_official_name,
      previousEligibleDays: r.previous_eligible_days,
      importedEligibleDays: r.imported_eligible_days,
      delta: r.delta,
      outcome: r.outcome,
      exceptionReason: r.exception_reason,
    })),
  };
}

function adjustmentView(a: AdjustmentRecord) {
  return {
    adjustmentId: a.id,
    periodId: a.period_id,
    periodName: a.period_name,
    /** Which figure this entry moved; null means the legacy column. */
    rationType: a.ration_type,
    previousEligibleDays: a.previous_eligible_days,
    delta: a.delta,
    newEligibleDays: a.new_eligible_days,
    reason: a.reason,
    source: a.source,
    batchRef: a.batch_ref,
    staffId: a.staff_id,
    staffName: a.staff_name,
    createdAt: a.created_at,
  };
}
