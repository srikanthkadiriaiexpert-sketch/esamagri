import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { FulfillmentError, RikFulfillmentService } from './services/rik-fulfillment.service';
import { IssueVouchersRepository } from './repositories/issue-vouchers.repository';
import {
  EstablishCarryForwardDto,
  LapseCarryForwardDto,
  RecordOutcomeDto,
  ReverseCompletionDto,
  SettleLapsesDto,
} from './dto/rik-fulfillment.dto';

/**
 * RIK physical fulfilment (PHASE E).
 *
 * AUTHORIZATION — no new role, no new permission, decided per lane from the
 * approved seed:
 *
 *   PICKUP outcomes        `rik.order.mark_collected`  — RIK_PICKUP_STAFF,
 *                          the counter that actually hands the ration over.
 *   DELIVERY outcomes      `rik.order.manage`          — RIK_ADMIN.
 *   Corrections, lapse and
 *   carry-forward settlement `rik.order.manage`        — RIK_ADMIN.
 *
 * DELIVERY_STAFF HOLDS NO `rik.*` PERMISSION AT ALL and therefore cannot
 * reach any route here — which is the locked rule that delivery involvement
 * confers no authority over RIK voucher state. It required no change.
 *
 * The pickup lane and the delivery lane are SEPARATE ROUTES rather than one
 * route with a mode switch, because the permission differs and a single
 * route would have to grant the weaker one. The database refuses a
 * cross-lane outcome in any case.
 */
@Controller('admin/rik/fulfillment')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikFulfillmentController {
  constructor(
    private readonly fulfillment: RikFulfillmentService,
    private readonly vouchers: IssueVouchersRepository
  ) {}

  /** What the counter needs before handing anything over. */
  @Get('vouchers/:voucherId')
  @RequirePermissions('rik.order.mark_collected')
  async counterView(@Param('voucherId', new ParseUUIDPipe()) voucherId: string) {
    return this.load(voucherId);
  }

  /** The same, for an administrator working the delivery lane. */
  @Get('vouchers/:voucherId/admin')
  @RequirePermissions('rik.order.manage')
  async adminView(@Param('voucherId', new ParseUUIDPipe()) voucherId: string) {
    return this.load(voucherId);
  }

  /** PICKUP: collected, or explicitly not collected. */
  @Post('vouchers/:voucherId/pickup')
  @RequirePermissions('rik.order.mark_collected')
  @UsePipes(pipe())
  async pickup(
    @CurrentAuthContext() context: AuthContext,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string,
    @Body() dto: RecordOutcomeDto
  ) {
    if (dto.outcome !== 'COLLECTED' && dto.outcome !== 'NOT_COLLECTED') {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The pickup lane records COLLECTED or NOT_COLLECTED.',
      });
    }
    return this.record(context, voucherId, dto);
  }

  /** DELIVERY: out for delivery, delivered, or explicitly not delivered. */
  @Post('vouchers/:voucherId/delivery')
  @RequirePermissions('rik.order.manage')
  @UsePipes(pipe())
  async delivery(
    @CurrentAuthContext() context: AuthContext,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string,
    @Body() dto: RecordOutcomeDto
  ) {
    if (!['OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED'].includes(dto.outcome)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The delivery lane records OUT_FOR_DELIVERY, DELIVERED or NOT_DELIVERED.',
      });
    }
    return this.record(context, voucherId, dto);
  }

  /**
   * Reverse a completion. NOT an edit, NOT a delete: the original event and
   * its issue lines stay, and this is appended beside them.
   */
  @Post('vouchers/:voucherId/corrections')
  @RequirePermissions('rik.order.manage')
  @UsePipes(pipe())
  async correct(
    @CurrentAuthContext() context: AuthContext,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string,
    @Body() dto: ReverseCompletionDto
  ) {
    return this.run(async () => {
      const result = await this.fulfillment.reverseCompletion(context, {
        voucherId,
        outcomeId: dto.outcomeId,
        reason: dto.reason,
        notes: dto.notes ?? null,
      });
      return {
        correctionId: result.correctionId,
        voucherNumber: result.voucher.voucher_number,
        status: result.voucher.status,
      };
    });
  }

  /** Settle the final-Fresh-window lapse for one voucher. */
  @Post('vouchers/:voucherId/lapse')
  @RequirePermissions('rik.order.manage')
  async lapse(
    @CurrentAuthContext() context: AuthContext,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string
  ) {
    return this.run(() => this.fulfillment.settleFreshLapse(context, voucherId));
  }

  /** Settle every Fresh voucher of a period whose final window has closed. */
  @Post('lapses')
  @RequirePermissions('rik.order.manage')
  @UsePipes(pipe())
  async lapses(@CurrentAuthContext() context: AuthContext, @Body() dto: SettleLapsesDto) {
    return this.run(() => this.fulfillment.settleFreshLapsesForPeriod(context, dto.periodId));
  }

  /** Establish an officer's carried Dry balance from one period into the next. */
  @Post('carry-forward')
  @RequirePermissions('rik.order.manage')
  @UsePipes(pipe())
  async carryForward(
    @CurrentAuthContext() context: AuthContext,
    @Body() dto: EstablishCarryForwardDto
  ) {
    return this.run(async () => {
      const result = await this.fulfillment.establishCarryForward(context, dto);
      return {
        established: result.established.map(carryView),
        skipped: result.skipped,
      };
    });
  }

  /** Lapse what is left of a carried balance once its Dry window has closed. */
  @Post('carry-forward/lapse')
  @RequirePermissions('rik.order.manage')
  @UsePipes(pipe())
  async carryForwardLapse(
    @CurrentAuthContext() context: AuthContext,
    @Body() dto: LapseCarryForwardDto
  ) {
    return this.run(() => this.fulfillment.lapseCarryForward(context, dto));
  }

  // ---------------------------------------------------------------- internals

  private async load(voucherId: string) {
    const voucher = await this.vouchers.findById(voucherId);
    if (voucher === null) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'That issue voucher does not exist.',
      });
    }
    const [view, substitutions] = await Promise.all([
      this.fulfillment.view(voucher),
      this.fulfillment.substitutionOptions(voucher),
    ]);
    return {
      voucherId: voucher.id,
      voucherNumber: voucher.voucher_number,
      rationType: voucher.ration_type,
      fulfillmentMode: voucher.fulfillment_mode,
      status: voucher.status,
      officer: {
        rikId: voucher.rik_id,
        name: voucher.officer_official_name ?? voucher.officer_name,
        mobileNumber: voucher.mobile_number,
        quarterBlock: voucher.quarter_block,
        quarterNumber: voucher.quarter_number,
        landmark: voucher.landmark,
      },
      destination: {
        mode: voucher.fulfillment_mode,
        pickupLocationName: voucher.pickup_location_name,
        deliveryAddress: voucher.delivery_address,
      },
      period: { id: voucher.period_id, name: voucher.period_name },
      lapsed: view.lapsed,
      lapseReason: view.lapseReason,
      finalWindowCode: view.finalWindowCode,
      finalWindowEndDate: view.finalWindowEndDate,
      reminderDue: view.reminderDue,
      daysToFinalWindowClose: view.daysToFinalWindowClose,
      completion: view.completion === null ? null : outcomeView(view.completion),
      events: view.events.map(outcomeView),
      issuedLines: view.issuedLines.map(lineView),
      carryForward: view.carryForward.map(carryView),
      substitutionOptions: substitutions,
    };
  }

  private async record(context: AuthContext, voucherId: string, dto: RecordOutcomeDto) {
    return this.run(async () => {
      const result = await this.fulfillment.recordOutcome(context, {
        voucherId,
        outcome: dto.outcome,
        reason: dto.reason ?? null,
        notes: dto.notes ?? null,
        lines: (dto.lines ?? []).map((l) => ({
          provisionId: l.provisionId,
          quantity: l.quantity,
          originalProvisionId: l.originalProvisionId ?? null,
          substitutionReason: l.substitutionReason ?? null,
        })),
      });
      return {
        outcomeId: result.outcomeId,
        voucherNumber: result.voucher.voucher_number,
        status: result.voucher.status,
      };
    });
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof FulfillmentError) {
        if (err.code === 'VOUCHER_NOT_FOUND' || err.code === 'OUTCOME_NOT_FOUND' || err.code === 'PERIOD_NOT_FOUND') {
          throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
        }
        if (err.code === 'ALREADY_COMPLETED') {
          throw new ConflictException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: err.message,
            details: { reason: err.code, ...err.detail },
          });
        }
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: err.message,
          details: { reason: err.code, ...err.detail },
        });
      }
      throw err;
    }
  }
}

function pipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

export function outcomeView(o: {
  id: string;
  sequence_no: number;
  event_type: string;
  outcome: string;
  reason: string | null;
  window_code: string | null;
  supersedes_id: string | null;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_by_role: string;
  notes: string | null;
  reversed: boolean;
}) {
  return {
    outcomeId: o.id,
    sequenceNo: o.sequence_no,
    eventType: o.event_type,
    outcome: o.outcome,
    reason: o.reason,
    windowCode: o.window_code,
    supersedesId: o.supersedes_id,
    recordedAt: o.recorded_at,
    recordedBy: { staffId: o.recorded_by, name: o.recorded_by_name, role: o.recorded_by_role },
    notes: o.notes,
    reversed: o.reversed,
  };
}

export function lineView(l: {
  id: string;
  pool_code: string;
  pool_name: string;
  pool_unit: string;
  provision_id: string;
  provision_code: string;
  provision_name: string;
  provision_brand: string | null;
  original_provision_id: string | null;
  original_provision_code: string | null;
  original_provision_name: string | null;
  quantity: string;
  consumption_ratio: string;
  pool_equivalent_qty: string;
  carry_forward_qty: string;
  substitution_reason: string | null;
}) {
  return {
    lineId: l.id,
    poolCode: l.pool_code,
    poolName: l.pool_name,
    poolUnit: l.pool_unit,
    provisionId: l.provision_id,
    code: l.provision_code,
    name: l.provision_name,
    brand: l.provision_brand,
    quantityIssued: Number(l.quantity),
    consumptionRatio: Number(l.consumption_ratio),
    poolEquivalentQty: Number(l.pool_equivalent_qty),
    carryForwardQty: Number(l.carry_forward_qty),
    substitutedFor:
      l.original_provision_id === null
        ? null
        : {
            provisionId: l.original_provision_id,
            code: l.original_provision_code,
            name: l.original_provision_name,
            reason: l.substitution_reason,
          },
  };
}

export function carryView(c: {
  id: string;
  source_period_name: string;
  target_period_name: string;
  source_selection_reference: string | null;
  pool_code: string;
  pool_name: string;
  quantity: string;
  unit: string;
  remaining: string;
  established_at: string;
  lapsed_at: string | null;
  lapse_reason: string | null;
}) {
  return {
    carryForwardId: c.id,
    sourcePeriodName: c.source_period_name,
    targetPeriodName: c.target_period_name,
    sourceSelectionReference: c.source_selection_reference,
    poolCode: c.pool_code,
    poolName: c.pool_name,
    quantity: Number(c.quantity),
    remaining: Number(c.remaining),
    unit: c.unit,
    establishedAt: c.established_at,
    lapsedAt: c.lapsed_at,
    lapseReason: c.lapse_reason,
  };
}
