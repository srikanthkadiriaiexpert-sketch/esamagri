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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { RequireRikCustomer } from '../auth/decorators/require-rik-customer.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AccessTokenPrincipal } from '../auth/services/token.service';
import { EntitlementPeriodsRepository } from './repositories/entitlement-periods.repository';
import { EntitlementConfigRepository } from './repositories/entitlement-config.repository';
import { CustomerEligibilityFiguresRepository } from './repositories/customer-eligibility-figures.repository';
import {
  DietaryPreferenceNotSetError,
  EligibilityNotRecordedError,
  PeriodNotFoundError,
  RikEligibilityService,
  missingRationTypes,
  rationTypeLabel,
} from './services/rik-eligibility.service';
import { RikEntitlementService, type EntitlementCalculation } from './services/rik-entitlement.service';
import {
  ConfirmationRefusedError,
  RikSelectionValidationService,
  SelectionNotOpenError,
} from './services/rik-selection-validation.service';
import { PickupLocationsRepository } from './repositories/pickup-locations.repository';
import { RikIssueWindowService } from './services/rik-issue-window.service';
import { RikFulfillmentService } from './services/rik-fulfillment.service';
import { lineView, carryView } from './rik-fulfillment.controller';
import {
  IssueVoucherError,
  RikIssueVoucherService,
  type VoucherDetail,
} from './services/rik-issue-voucher.service';
import type { IssueVoucherRecord } from './repositories/issue-vouchers.repository';
import type { SelectionRecord } from './repositories/entitlement-selections.repository';
// Keys become URLs here and nowhere else: a stored `rik/provisions/...` key
// becomes the address its media route serves, and the 180 committed
// `/catalogue/rik/...` paths pass through completely unchanged.
import { rikImageUrl } from './services/rik-media.service';
import { RikNewArrivalsService } from './services/rik-new-arrivals.service';
import { RikBannersService } from './services/rik-banners.service';
import {
  ConfirmSelectionDto,
  EntitlementQueryDto,
  SetElectionsDto,
  SetProvisionQuantityDto,
} from './dto/entitlement.dto';

/**
 * Why an entitlement could not be produced, as a stable code.
 *
 * Added in STEP 11D. Three of these refusals previously shared HTTP 404
 * and differed only in their English sentence, and the customer app has
 * to tell them apart — "no period is open" is reassuring, "your
 * eligible days are not recorded" is a facility action, and "set your
 * dietary preference" is the customer's own. Matching on prose would
 * have put the distinction in a string that anyone could reword, so the
 * distinction is a code instead.
 *
 * The status codes and messages are unchanged; this is additive.
 */
export const RIK_BASIS_REASONS = {
  NO_OPEN_PERIOD: 'NO_OPEN_PERIOD',
  PERIOD_NOT_FOUND: 'PERIOD_NOT_FOUND',
  DIETARY_PREFERENCE_NOT_SET: 'DIETARY_PREFERENCE_NOT_SET',
  ELIGIBILITY_NOT_RECORDED: 'ELIGIBILITY_NOT_RECORDED',
} as const;

function noOpenPeriod(): NotFoundException {
  return new NotFoundException({
    code: ERROR_CODES.NOT_FOUND,
    message: 'No ration period is open at the moment.',
    details: { reason: RIK_BASIS_REASONS.NO_OPEN_PERIOD },
  });
}

/**
 * The customer's own RIK entitlement — "Know Your Ration" and the
 * selection it drives.
 *
 * Identity comes from the verified access token on every route. No
 * customer id is accepted from the client anywhere in this controller,
 * so there is no id to tamper with and no way to read another officer's
 * entitlement: the ownership boundary is structural, not a check that
 * could be forgotten.
 *
 * Every figure returned is computed server-side from configuration. The
 * client is told what the entitlement IS; it never tells the server.
 */
@Controller('rik')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
/**
 * EVERY route on this controller requires an approved, active RIK profile.
 *
 * Declared once, at class level, on purpose: all twelve routes below are
 * customer-facing and none of them may be reached by a PIF-only resident, so a
 * per-route decorator would be twelve chances to forget one — and a thirteenth
 * the next time a route is added. The per-route `@RequireCustomer()`
 * declarations are left exactly where they were; both checks run.
 */
@RequireRikCustomer()
export class RikController {
  constructor(
    private readonly periods: EntitlementPeriodsRepository,
    private readonly eligibility: RikEligibilityService,
    private readonly entitlement: RikEntitlementService,
    private readonly validation: RikSelectionValidationService,
    private readonly pickupLocations: PickupLocationsRepository,
    private readonly issueWindows: RikIssueWindowService,
    private readonly issueVouchers: RikIssueVoucherService,
    private readonly fulfillment: RikFulfillmentService,
    private readonly config: EntitlementConfigRepository,
    private readonly newArrivalsService: RikNewArrivalsService,
    private readonly bannersService: RikBannersService,
    // STEP 16: the officer's own Fresh and Dry figures, read for display
    // only. Deliberately NOT RikEligibilityService — that file resolves the
    // engine's basis and is left untouched.
    private readonly eligibilityFigures: CustomerEligibilityFiguresRepository
  ) {}

  /**
   * The RIK catalogue, as a reference list.
   *
   * WHY THIS EXISTS SEPARATELY FROM `entitlements/current`. That route
   * answers "what may THIS officer take THIS period", so it is scoped to one
   * person: filtered by dietary preference, dependent on an eligibility row
   * and an open period, and carrying the figures that decide an allowance. A
   * reference page about the food itself needs the opposite — every active
   * item, the same for everyone, and none of those figures.
   *
   * WHAT IT DELIBERATELY DOES NOT RETURN. No consumption ratio, no maximum
   * quantity, no maximum packs, no minimum eligible days, no dietary
   * applicability, no selectability flag. Those are entitlement rules, and a
   * reference page has no business carrying them: publishing a ratio here
   * would let a reader infer an allowance this route never checked. What is
   * left is what is true of the item on a shelf — what it is called, whose
   * brand it is, what it looks like, and how it is packed.
   *
   * READ-ONLY BY CONSTRUCTION. One GET, over the same
   * `loadConfiguration` the engine itself reads, with the same
   * active/effective-window filter — so a retired item disappears from here
   * exactly when it disappears from the engine, and no second definition of
   * "active" can drift from the first. It writes nothing: no inventory, no
   * balance, no selection, no voucher.
   */
  @Get('catalogue')
  @RequireCustomer()
  async catalogue() {
    const asOf = new Date().toISOString().slice(0, 10);
    const configuration = await this.config.loadConfiguration(asOf);
    const poolByItsId = new Map(configuration.pools.map((pool) => [pool.id, pool]));

    const items = configuration.provisions.map((provision) => {
      const pool = poolByItsId.get(provision.pool_id);
      return {
        // The stable business key. Anything keyed to a provision from
        // outside the database keys on this, never on the uuid, which
        // differs between environments.
        code: provision.code,
        name: provision.name,
        brand: provision.brand,
        imageRef: rikImageUrl(provision.image_ref),
        unit: provision.unit,
        packSize: provision.pack_size === null ? null : Number(provision.pack_size),
        packUnit: provision.pack_unit,
        isLoose: provision.is_loose,
        issuePeriod: provision.issue_period,
        poolCode: pool?.code ?? null,
        poolName: pool?.name ?? null,
      };
    });

    return { asOf, items };
  }

  /**
   * New Arrivals — what RIK staff are currently featuring.
   *
   * A SHOP WINDOW, NOT AN ALLOWANCE. Appearing here says one thing: a member
   * of staff chose to highlight this existing product. It says nothing about
   * whether the reader is entitled to it, how much of it they may take, or
   * whether any is in stock — this route reads one table of listings and
   * never consults a pool, a scale, a period or an eligibility row. A
   * customer who sees a product here and wants to know their allowance goes
   * to Know Your Ration, which is the only place that answers that.
   *
   * THREE CONDITIONS, ALL IN SQL. A listing reaches a customer only if staff
   * published it, today falls inside its date window, and the underlying
   * provision is itself still active and in its own effective window. They
   * live together in the repository's `listPublished` so that no caller can
   * satisfy two of them and forget the third — which is how a draft, an
   * expired promotion or a retired product reaches a screen.
   *
   * WHAT IT DELIBERATELY DOES NOT RETURN. No listing id, no provision id, no
   * publish flag, no staff identity, no entitlement figure of any kind. A
   * customer needs the product, not the record of the decision to show it.
   *
   * NO REBUILD, EVER. The customer app fetches this on each visit, so a
   * product published by staff appears the next time the page is opened, and
   * an unpublished one is gone just as quickly. Nothing about New Arrivals is
   * compiled into the front end.
   */
  @Get('new-arrivals')
  @RequireCustomer()
  async newArrivals() {
    const items = await this.newArrivalsService.listForCustomers();
    return {
      asOf: new Date().toISOString().slice(0, 10),
      items: items.map((row) => ({
        /** Stable identity for the card. A listing id, not a product id. */
        id: row.id,
        /** The catalogue code, or null for a standalone listing. */
        code: row.code,
        /** The catalogue name when linked, the staff-typed one otherwise. */
        name: row.display_name,
        brand: row.brand,
        // The listing's own picture when staff uploaded one, otherwise the
        // linked product's. Resolved in SQL, once, so no screen has to know
        // which kind of listing it is rendering.
        imageRef: rikImageUrl(row.effective_image_ref),
        headline: row.headline,
        // Catalogue facts, all null on a standalone listing. The screen shows
        // them only when present rather than inventing placeholders.
        unit: row.unit,
        packSize: row.pack_size === null ? null : Number(row.pack_size),
        packUnit: row.pack_unit,
        issuePeriod: row.issue_period,
        poolName: row.pool_name,
        /** When it started being featured — the basis for the NEW badge. */
        publishedFrom: row.published_from,
      })),
    };
  }

  /**
   * The seasonal banners live on the home screen today.
   *
   * WHAT THIS IS NOT. It is not the home screen's hero. The hero is a
   * committed brand asset rendered by the customer app's own HeroBanner
   * component, owned by no table and reachable from no endpoint. This route
   * returns the OPTIONAL seasonal pictures that render beneath it, and an
   * empty list — which is the normal state — leaves the home screen exactly
   * as it is.
   *
   * Published, pictured, and inside its date window as at today. Staff put a
   * Diwali banner up in advance with a start date and it appears on the day,
   * then disappears on its end date without anybody having to remember. No
   * rebuild is involved: the customer app fetches this on each visit.
   */
  @Get('banners')
  @RequireCustomer()
  async banners() {
    const items = await this.bannersService.listForCustomers();
    return {
      asOf: new Date().toISOString().slice(0, 10),
      items: items.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        // Already filtered to the pictured rows by the query, but the URL
        // helper is the only thing that turns a stored key into an address.
        imageUrl: rikImageUrl(row.image_ref),
        startsOn: row.starts_on,
        endsOn: row.ends_on,
      })),
    };
  }

  /**
   * Know Your Ration — the customer's applicable entitlement for a
   * period, split into FRESH and DRY, with the provisions and conversion
   * options that apply to them.
   */
  @Get('entitlements/current')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async currentEntitlement(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Query() query: EntitlementQueryDto
  ) {
    // Two different absences, told apart: a period the customer named
    // that does not exist, and no period being open at all. The first
    // is a bad link; the second is a normal, reassuring state.
    if (query.periodId) {
      const named = await this.periods.findById(query.periodId);
      if (!named) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'That ration period does not exist.',
          details: { reason: RIK_BASIS_REASONS.PERIOD_NOT_FOUND },
        });
      }
      return this.buildFor(principal.principalId, named, query.issuePeriod);
    }

    const period = await this.periods.findCurrent();
    if (!period) {
      throw noOpenPeriod();
    }
    return this.buildFor(principal.principalId, period, query.issuePeriod);
  }

  /** Resolve the basis, apply the customer's draft, and present the result. */
  private async buildFor(
    customerId: string,
    period: { id: string; name: string; start_date: string; end_date: string },
    issuePeriod?: 'FRESH' | 'DRY'
  ) {
    const basis = await this.resolveBasis(customerId, period.id);
    const state = await this.loadSelectionState(basis.customerId, period.id);

    const calculation = await this.entitlement.calculate(basis, {
      selectedQuantities: state.quantities,
      electedConversionIds: state.electedConversionIds,
      issuePeriod,
    });

    return this.present(calculation, period, state.selection);
  }

  /** Pre-flight one quantity without writing anything. */
  @Post('entitlements/validate')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async validate(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Body() dto: SetProvisionQuantityDto
  ) {
    const period = await this.requireCurrentPeriod();
    const basis = await this.resolveBasis(principal.principalId, period.id);
    const state = await this.loadSelectionState(basis.customerId, period.id);

    const result = await this.validation.validateQuantity(basis, dto.provisionId, dto.quantity, {
      existingQuantities: state.quantities,
      electedConversionIds: state.electedConversionIds,
    });
    return { result };
  }

  /** Set the absolute quantity of one provision. Zero removes it. */
  @Post('selections/quantity')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async setQuantity(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Body() dto: SetProvisionQuantityDto
  ) {
    const period = await this.requireCurrentPeriod();
    const basis = await this.resolveBasis(principal.principalId, period.id);

    const { result, calculation } = await this.validation.setQuantity(basis, dto.provisionId, dto.quantity);
    return { result, entitlement: this.present(calculation, period) };
  }

  /** Choose which elective conversions to take. Replaces any earlier choice. */
  @Post('selections/elections')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async setElections(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Body() dto: SetElectionsDto
  ) {
    const period = await this.requireCurrentPeriod();
    const basis = await this.resolveBasis(principal.principalId, period.id);

    const { result, calculation } = await this.validation.setElections(basis, dto.conversionIds ?? []);
    return { result, entitlement: this.present(calculation, period) };
  }

  /**
   * The collection points a customer may choose right now.
   *
   * Read from configuration the facility maintains, so adding or
   * retiring one is a change on a screen, not a deployment. The client
   * renders whatever comes back and hard-codes nothing.
   */
  @Get('fulfillment/pickup-locations')
  @RequireCustomer()
  async listPickupLocations() {
    const items = await this.pickupLocations.listActive();
    return {
      items: items.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        description: l.description,
      })),
    };
  }

  /**
   * The configured physical issue schedule, READ ONLY (STEP 15C).
   *
   * Fresh Issue 1, 2 and 3 and the Dry Issue for the period containing
   * today, with their date ranges and the days the facility will actually
   * issue on. Live windows only.
   *
   * WHAT IS DELIBERATELY NOT HERE. No revision history, no `createdBy` or
   * `updatedBy`, no retired window, no note and no window id: an audit trail
   * is an administrative record and has no business on a customer's screen,
   * and a retired window would read as a date an officer could travel on.
   *
   * There is no customer WRITE path to the schedule anywhere in this
   * application — not a disabled one, not a guarded one. This is the only
   * customer-facing issue-window route that exists.
   *
   * 404 when the facility has no open period, with the same
   * NO_OPEN_PERIOD reason the entitlement routes use, so the app can say
   * "no period is open" rather than showing an empty schedule as if the
   * facility had published one.
   */
  @Get('issue-schedule')
  @RequireCustomer()
  async issueSchedule() {
    const schedule = await this.issueWindows.currentSchedule();
    if (schedule === null) throw noOpenPeriod();
    return schedule;
  }

  /**
   * The officer's own Fresh and Dry eligible days (STEP 16 / migration 0066).
   *
   * READ ONLY, and separate from `entitlements/current` on purpose.
   *
   * These are the two figures RIK staff publish from the facility's sheets,
   * and SINCE THE FRESH/DRY CALCULATION CHANGE THEY ARE WHAT THE ENTITLEMENT
   * ENGINE CALCULATES FROM. A Fresh pool is scaled by the Fresh figure and a
   * Dry pool by the Dry figure; the legacy single `eligible_days` column no
   * longer scales anything. (This comment previously said the opposite,
   * because when migration 0066 landed these figures were stored and
   * displayed only. That condition was lifted when the change was approved.)
   *
   * The route stays separate from `entitlements/current` because it answers
   * a question of its own — what has the facility published for me — and
   * answers it even for an officer who has no entitlement to show. It reads;
   * it does not calculate.
   *
   * NULL MEANS NOT PUBLISHED, AND SAYS SO. A figure the facility has not
   * uploaded yet is returned as `null`, never as 0. The two are different
   * statements and an officer must never be shown "0 days" for a sheet that
   * simply has not arrived.
   *
   * Identity comes from the verified token like every other route in this
   * controller. No customer id is accepted from the client, so there is no id
   * to tamper with and no way to read another officer's figures. There is no
   * write path: officers cannot change these values, here or anywhere.
   */
  @Get('eligibility-days')
  @RequireCustomer()
  async myEligibilityDays(@CurrentPrincipal() principal: AccessTokenPrincipal) {
    const period = await this.periods.findCurrent();
    if (!period) throw noOpenPeriod();

    const figures = await this.eligibilityFigures.forCustomerPeriod(
      principal.principalId,
      period.id
    );

    const published = {
      freshEligibleDays: figures?.fresh_eligible_days ?? null,
      dryEligibleDays: figures?.dry_eligible_days ?? null,
    };

    return {
      period: {
        id: period.id,
        name: period.name,
        startDate: period.start_date,
        endDate: period.end_date,
      },
      ...published,
      /**
       * The same two figures stated as present-or-absent, one entry per
       * ration type, always both — so a client renders "Dry: awaited"
       * rather than inferring it from a field it did not find. `published`
       * is false ONLY when no figure exists; a published zero has
       * `published: true` and `days: 0`, because somebody published it.
       */
      byRationType: (['FRESH', 'DRY'] as const).map((rationType) => {
        const days =
          rationType === 'FRESH' ? published.freshEligibleDays : published.dryEligibleDays;
        return {
          rationType,
          label: rationTypeLabel(rationType),
          days,
          published: days !== null,
        };
      }),
      /** The ration types with no published figure. Empty when both exist. */
      missingRationTypes: missingRationTypes(published),
    };
  }

  /**
   * The officer's own issue vouchers (PHASE D).
   *
   * READ ONLY, and ownership is enforced on the SERVER: the list is filtered
   * by the authenticated principal, never by anything the client sends.
   */
  @Get('issue-vouchers')
  @RequireCustomer()
  async myIssueVouchers(@CurrentPrincipal() principal: AccessTokenPrincipal) {
    const items = await this.issueVouchers.listForCustomer(principal.principalId);
    return { items: items.map(customerVoucherSummary) };
  }

  /**
   * One of the officer's own vouchers, as the document they are shown.
   *
   * NO IDOR. A voucher belonging to someone else answers exactly as a
   * voucher that does not exist — the service compares the voucher's officer
   * to the authenticated one and raises the same not-found either way — so
   * knowing an id reveals nothing, not even that the id is real.
   *
   * The response carries no administrative detail: no issuing staff member,
   * no audit history, no internal note, no selection id.
   */
  @Get('issue-vouchers/:voucherId')
  @RequireCustomer()
  async myIssueVoucher(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Param('voucherId', new ParseUUIDPipe()) voucherId: string
  ) {
    try {
      const detail = await this.issueVouchers.detailForCustomer(principal.principalId, voucherId);
      // PHASE E: the officer sees WHAT ACTUALLY HAPPENED beside what was
      // confirmed — read only, and only ever their own voucher.
      const fulfillment = await this.fulfillment.view(detail.voucher);
      // `issueStatus`, NOT `fulfillment`: the voucher document has carried a
      // `fulfillment` block since PHASE D and that block is the DESTINATION
      // (pickup or delivery, and where). Reusing the name here would have
      // silently replaced it and left the officer's own screen without a
      // collection point or a delivery address.
      return { ...customerVoucherView(detail), issueStatus: customerFulfillmentView(fulfillment) };
    } catch (err) {
      if (err instanceof IssueVoucherError) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'That issue voucher does not exist.',
        });
      }
      throw err;
    }
  }

  /**
   * Confirm the selection: the rule snapshot, the availability
   * acknowledgement and the chosen fulfillment, together.
   *
   * This is the SAME endpoint STEP 11B introduced, extended rather than
   * replaced — there is exactly one way to confirm a RIK selection, and
   * this is it.
   */
  @Post('selections/confirm')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async confirm(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Body() dto: ConfirmSelectionDto
  ) {
    const period = await this.requireCurrentPeriod();
    const basis = await this.resolveBasis(principal.principalId, period.id);

    try {
      const { selectionId, selection, calculation } = await this.validation.confirm(basis, {
        availabilityAcknowledged: dto.availabilityAcknowledged,
        fulfillmentType: dto.fulfillmentType,
        pickupLocationId: dto.pickupLocationId ?? null,
        deliveryAddress: dto.deliveryAddress ?? null,
      });

      return {
        selectionId,
        status: 'CONFIRMED',
        confirmation: confirmationView(selection),
        entitlement: this.present(calculation, period),
      };
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  /**
   * A refused confirmation is 400 with a machine-readable reason and
   * the values the screen needs to explain itself. An attempt to
   * confirm something already confirmed carries the existing
   * reference, so a refresh or a double tap can show the customer
   * their confirmation rather than an error they cannot act on.
   */
  private toHttp(err: unknown): unknown {
    if (err instanceof ConfirmationRefusedError) {
      return new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: err.reason, ...err.detail },
      });
    }
    if (err instanceof SelectionNotOpenError) {
      return new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: 'SELECTION_NOT_OPEN' },
      });
    }
    return err;
  }

  // ---------------------------------------------------------------- internals

  private async requireCurrentPeriod() {
    const period = await this.periods.findCurrent();
    if (!period) {
      throw noOpenPeriod();
    }
    return period;
  }

  /**
   * Resolve the basis, translating the engine's honest "we do not have
   * what we need" states into messages a customer can act on — never
   * into a fabricated default.
   */
  private async resolveBasis(customerId: string, periodId: string) {
    try {
      return await this.eligibility.resolveBasis(customerId, periodId);
    } catch (err) {
      if (err instanceof DietaryPreferenceNotSetError) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Please set your dietary preference before viewing your ration.',
          details: { reason: RIK_BASIS_REASONS.DIETARY_PREFERENCE_NOT_SET },
        });
      }
      if (err instanceof EligibilityNotRecordedError) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Your eligible days for this period have not been recorded yet.',
          details: { reason: RIK_BASIS_REASONS.ELIGIBILITY_NOT_RECORDED },
        });
      }
      if (err instanceof PeriodNotFoundError) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'That ration period does not exist.',
          details: { reason: RIK_BASIS_REASONS.PERIOD_NOT_FOUND },
        });
      }
      throw err;
    }
  }

  private async loadSelectionState(customerId: string, periodId: string) {
    const calculation = await this.validation.loadDraftState(customerId, periodId);
    return calculation;
  }

  /**
   * Shape the calculation for the client.
   *
   * Internal ids are kept because the client needs them to make a
   * selection, but nothing about the storage shape leaks: no table
   * names, no effective-date columns, no configuration rows the customer
   * has no business seeing.
   */
  private present(
    calculation: EntitlementCalculation,
    period: { id: string; name: string; start_date: string; end_date: string },
    selection: SelectionRecord | null = null
  ) {
    const pool = (p: EntitlementCalculation['fresh'][number]) => ({
      poolId: p.poolId,
      code: p.code,
      name: p.name,
      unit: p.unit,
      description: p.description,
      // The category's cover picture, or null where none is recorded —
      // the screen falls back to its placeholder on null.
      imageRef: rikImageUrl(p.imageRef),
      dailyScale: p.dailyScale,
      effectiveDailyQty: p.effectiveDailyQty,
      eligibleDays: p.eligibleDays,
      totalEntitlement: p.display.totalEntitlement,
      consumed: p.display.consumed,
      remaining: p.display.remaining,
      precise: { totalEntitlement: p.totalEntitlement, consumed: p.consumed, remaining: p.remaining },
      automaticConversions: p.automaticConversions.map((c) => ({
        code: c.code,
        fromDailyQty: c.fromDailyQty,
        toDailyQty: c.toDailyQty,
        description: c.description,
      })),
      conversionOptions: p.electiveOptions.map((c) => ({
        conversionId: c.conversionId,
        code: c.code,
        fromPoolId: c.fromPoolId,
        toPoolId: c.toPoolId,
        fromDailyQty: c.fromDailyQty,
        toDailyQty: c.toDailyQty,
        description: c.description,
        selected: p.electedConversions.some((e) => e.conversionId === c.conversionId),
      })),
      surrendered: p.surrenderedByElection,
      provisions: p.provisions.map((pr) => ({
        provisionId: pr.provisionId,
        code: pr.code,
        name: pr.name,
        brand: pr.brand,
        imageRef: rikImageUrl(pr.imageRef),
        packUnit: pr.packUnit,
        unit: pr.unit,
        consumptionRatio: pr.consumptionRatio,
        packSize: pr.packSize,
        isLoose: pr.isLoose,
        wholeUnitsOnly: pr.wholeUnitsOnly,
        maxQuantity: pr.maxQuantity,
        maxPacks: pr.maxPacks,
        minEligibleDays: pr.minEligibleDays,
        issuePeriod: pr.issuePeriod,
        maxSelectableQuantity: pr.maxSelectableQuantity,
        selectedQuantity: pr.selectedQuantity,
        selectedPoolEquivalentQty: pr.selectedPoolEquivalentQty,
      })),
      /**
       * Items this officer's diet allows but a condition currently
       * blocks, with the engine's own explanation. Sent so the client
       * can say WHY something is missing without knowing the rule —
       * see UnavailableProvisionView. Carries no entitlement figures.
       */
      unavailableProvisions: p.unavailableProvisions.map((pr) => ({
        provisionId: pr.provisionId,
        code: pr.code,
        name: pr.name,
        brand: pr.brand,
        imageRef: rikImageUrl(pr.imageRef),
        packUnit: pr.packUnit,
        unit: pr.unit,
        packSize: pr.packSize,
        minEligibleDays: pr.minEligibleDays,
        issuePeriod: pr.issuePeriod,
        reason: pr.reason,
      })),
    });

    return {
      period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date },
      dietaryPreference: calculation.dietaryPreference,
      /**
       * The legacy single figure. Retained so the existing response shape
       * is unchanged for any client still reading it. NO QUANTITY ABOVE IS
       * SCALED BY IT — each pool carries the days it was actually scaled
       * by, and the two authoritative figures follow.
       */
      eligibleDays: calculation.eligibleDays,
      /** Published FRESH days (0-30), or null for "not published". */
      freshEligibleDays: calculation.freshEligibleDays,
      /** Published DRY days (0-60), or null for "not published". */
      dryEligibleDays: calculation.dryEligibleDays,
      /**
       * A RATION TYPE WHOSE FIGURE IS AWAITED IS SAID OUT LOUD.
       *
       * The engine leaves such a type's pools out of the calculation —
       * there is no figure to scale them by, and reporting an entitlement
       * of zero would state something the facility never published. So the
       * absence is reported here instead of being left for the officer to
       * notice as a missing section, with the engine's own wording for the
       * client to display verbatim.
       *
       * Empty when both figures are published, INCLUDING when either is a
       * published zero. A zero is a figure; this list is about figures
       * that do not exist.
       */
      eligibilityWarnings: missingRationTypes(calculation).map((rationType) => ({
        rationType,
        message:
          `Your ${rationTypeLabel(rationType)} eligible days for this period have not been ` +
          `published yet, so your ${rationTypeLabel(rationType)} entitlement cannot be shown. ` +
          'Please contact the RIK office.',
      })),
      fresh: calculation.fresh.map(pool),
      dry: calculation.dry.map(pool),
      /**
       * The state of this customer's selection, so the client knows
       * whether it may still be changed. Null means nothing has been
       * started yet. A CONFIRMED selection carries its reference and
       * fulfillment, which is what makes a refresh of the confirmation
       * page work without re-confirming anything.
       */
      selection: selection === null ? null : confirmationView(selection),
    };
  }
}

/**
 * A selection as the customer sees it after confirming — or while still
 * drafting, in which case most of it is null.
 *
 * No price, no total, no payment reference, no tax: a RIK issue is an
 * entitlement being drawn, not a purchase.
 */
function confirmationView(selection: SelectionRecord) {
  return {
    selectionId: selection.id,
    status: selection.status,
    referenceNumber: selection.reference_number,
    confirmedAt: selection.confirmed_at,
    availabilityAcknowledged: selection.availability_acknowledged,
    acknowledgedAt: selection.availability_acknowledged_at,
    fulfillment:
      selection.fulfillment_type === null
        ? null
        : {
            type: selection.fulfillment_type,
            // The snapshot, not a live lookup — see the migration.
            pickupLocationName: selection.pickup_location_name,
            deliveryAddress: selection.delivery_address,
          },
  };
}

/** A voucher in the officer's own list. */
function customerVoucherSummary(v: IssueVoucherRecord) {
  return {
    voucherId: v.id,
    voucherNumber: v.voucher_number,
    rationType: v.ration_type,
    fulfillmentMode: v.fulfillment_mode,
    status: v.status,
    periodName: v.period_name,
    issueDate: v.released_at,
  };
}

/**
 * The voucher as the officer reads it.
 *
 * What is deliberately NOT here: the selection id, the issuing staff member,
 * the audit history, any internal note, and any field the officer could send
 * back. There is no customer write route to a voucher anywhere in this
 * application, and the application cannot change a voucher's status at all.
 */
/**
 * What actually happened, as the officer reads it (PHASE E).
 *
 * READ ONLY and deliberately narrow: the status, the date, what was handed
 * over, what was substituted and why, any carried balance, and whether the
 * voucher has lapsed. NOT here: the staff member who recorded it, the
 * internal notes, the event sequence or any correction detail — those are
 * the facility's operational records, and the server does not send them to
 * an officer.
 */
function customerFulfillmentView(view: {
  status: string;
  completion: { outcome: string; recorded_at: string; reason: string | null } | null;
  issuedLines: Parameters<typeof lineView>[0][];
  carryForward: Parameters<typeof carryView>[0][];
  lapsed: boolean;
  lapseReason: string | null;
  finalWindowCode: string | null;
  finalWindowEndDate: string | null;
  reminderDue: boolean;
  daysToFinalWindowClose: number | null;
}) {
  return {
    status: view.status,
    completedAt: view.completion?.recorded_at ?? null,
    completedOutcome: view.completion?.outcome ?? null,
    outcomeReason: view.completion?.reason ?? null,
    issued: view.issuedLines.map((l) => {
      const line = lineView(l);
      return {
        poolName: line.poolName,
        poolUnit: line.poolUnit,
        name: line.name,
        brand: line.brand,
        quantityIssued: line.quantityIssued,
        substitutedFor:
          line.substitutedFor === null
            ? null
            : { name: line.substitutedFor.name, reason: line.substitutedFor.reason },
      };
    }),
    carryForward: view.carryForward.map((c) => {
      const row = carryView(c);
      return {
        sourcePeriodName: row.sourcePeriodName,
        poolName: row.poolName,
        quantity: row.quantity,
        remaining: row.remaining,
        unit: row.unit,
        lapsedAt: row.lapsedAt,
      };
    }),
    lapsed: view.lapsed,
    lapseReason: view.lapseReason,
    finalWindowCode: view.finalWindowCode,
    finalWindowEndDate: view.finalWindowEndDate,
    /** Shown as a reminder while the final Fresh window is close. */
    reminderDue: view.reminderDue,
    daysToFinalWindowClose: view.daysToFinalWindowClose,
  };
}

function customerVoucherView(detail: VoucherDetail) {
  const v = detail.voucher;
  return {
    voucherNumber: v.voucher_number,
    selectionReference: v.selection_reference,
    rationType: v.ration_type,
    status: v.status,
    issueDate: v.released_at,
    period: { name: v.period_name, startDate: v.period_start_date, endDate: v.period_end_date },
    officer: {
      rikId: v.rik_id,
      name: v.officer_official_name ?? v.officer_name,
      mobileNumber: v.mobile_number,
      residence:
        v.quarter_block === null && v.quarter_number === null
          ? null
          : { quarterBlock: v.quarter_block, quarterNumber: v.quarter_number, landmark: v.landmark },
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
  };
}
