import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  EntitlementConfigRepository,
  type DietaryPreference,
  type EntitlementConfiguration,
  type ProvisionRecord,
  type RationType,
} from '../repositories/entitlement-config.repository';
import { RikConversionService, type ConversionEffect } from './rik-conversion.service';
import {
  RikEligibilityService,
  eligibleDaysFor,
  type EntitlementBasis,
} from './rik-eligibility.service';
import {
  displayQuantity,
  maxProvisionQuantity,
  poolEquivalent,
  round,
  scaleByDays,
  toNumber,
} from './entitlement-math';

/**
 * The entitlement calculator.
 *
 * Everything it knows, it reads. There is no product name, category
 * name, ratio, daily quantity or dietary rule written anywhere in this
 * file — change a row in `rik.pool_scales` or `rik.provisions` and the
 * numbers below change with it, with no code edit.
 *
 * How one pool's entitlement is built:
 *
 *   base            the pool's scale for this dietary preference, times
 *                   the eligible days FOR THAT POOL'S RATION TYPE. No
 *                   scale for the pair means the pool does not apply at
 *                   all — there is deliberately no fallback scale.
 *
 * EVERY QUANTITY IS SCALED BY THE POOL'S OWN RATION TYPE.
 *
 * Fresh and Dry eligible days are independent figures (0-30 and 0-60),
 * published separately by the facility. A pool is scaled by the figure for
 * `pool.ration_type` and by nothing else: the two are never added, averaged
 * or borrowed from one another, and there is no single figure left in this
 * calculation to fall back on.
 *
 * Note that the pool's `ration_type` decides this, NOT the provision's
 * `issue_period`. Bread is physically handed out on a Fresh issue day but
 * belongs to the Dry cereals pool, so a bread entitlement is Dry days'
 * worth of bread. The engine never looks at `issue_period` to scale
 * anything — that column selects which physical issue a line appears on.
 *
 * A ration type the facility has not published at all is not the same as
 * zero days. Its pools are left out of the calculation entirely rather than
 * reported as an entitlement of nothing, and the officer and RIK staff are
 * told the figure is awaited. Reporting "0 litres" for a sheet that has not
 * arrived would be a statement nobody made.
 *
 *   + automatic     every AUTOMATIC conversion targeting this pool for
 *                   this preference. This is what turns a pure-veg
 *                   officer's 250 ml/day base into 1,000 ml/day, from
 *                   configuration rather than a branch.
 *
 *   + elected       every ELECTIVE conversion targeting this pool that
 *                   the customer took.
 *
 *   - surrendered   if the customer elected to convert THIS pool away,
 *                   its own base is removed. An entitlement is never
 *                   spent twice.
 *
 *   - consumed      the pool-equivalent of everything selected from it.
 */

export interface ProvisionView {
  provisionId: string;
  code: string;
  name: string;
  /**
   * Catalogue description (STEP 12A). Presentation only — no branch of
   * the calculation reads any of these. `unit` is the entitlement unit;
   * `packUnit` is what the container is called.
   */
  brand: string | null;
  imageRef: string | null;
  packUnit: string | null;
  unit: string;
  consumptionRatio: number;
  packSize: number | null;
  isLoose: boolean;
  /**
   * Whole numbers of this provision's own unit, or nothing — a physical
   * coupon cannot be issued in halves. Reported so the screen can set the
   * input's step and refuse locally before the server has to; the server is
   * still the authority and refuses with WHOLE_UNITS_ONLY.
   */
  wholeUnitsOnly: boolean;
  maxQuantity: number | null;
  maxPacks: number | null;
  minEligibleDays: number | null;
  issuePeriod: RationType;
  /** Most that the remaining pool balance allows, before per-provision limits. */
  maxSelectableQuantity: number;
  selectedQuantity: number;
  /**
   * What `selectedQuantity` of this item costs the pool — the same
   * quantity x ratio the pool's `consumed` total is built from, reported
   * per line.
   *
   * Added in STEP 11D. Without it the customer app could only show a
   * shared pool's arithmetic by multiplying quantity by the ratio
   * itself, which is precisely the duplication the architecture
   * forbids: two implementations of one rule, one of them untested.
   * The engine already computes this figure to aggregate `consumed`;
   * it simply did not report it.
   */
  selectedPoolEquivalentQty: number;
}

/**
 * A provision this customer's dietary preference allows, which a
 * SITUATIONAL condition currently blocks — today that means only the
 * minimum-eligible-days rule (the oats case).
 *
 * Added in STEP 11D. Before it, such a provision was filtered out and
 * the reason discarded, so the customer app could only either stay
 * silent or restate the rule itself — and restating a business rule in
 * React is exactly what this architecture forbids. The engine already
 * knew why (RikEligibilityService.unavailableReason); it simply had
 * nowhere to say so.
 *
 * Deliberately a SEPARATE array from `provisions`, not a flag on it, so
 * that `provisions` still means precisely "what may be selected" and no
 * existing caller, test or validation path sees any change.
 *
 * A provision excluded because it does not apply to the customer's
 * dietary preference at all is NOT listed here. That is categorical,
 * not situational: a pure vegetarian should simply never see meat, and
 * telling them "meat is unavailable to you" would be worse than not
 * mentioning it. Nor is a provision the facility marked
 * not-customer-selectable, which no officer can act on.
 */
export interface UnavailableProvisionView {
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  imageRef: string | null;
  packUnit: string | null;
  unit: string;
  packSize: number | null;
  minEligibleDays: number | null;
  issuePeriod: RationType;
  /** The engine's own words, for the client to display verbatim. */
  reason: string;
}

export interface PoolEntitlementView {
  poolId: string;
  code: string;
  name: string;
  rationType: RationType;
  unit: string;
  description: string | null;
  /** The category's cover picture, or null. Presentation only. */
  imageRef: string | null;
  dailyScale: number;
  /** Daily quantity including automatic and elected conversions. */
  effectiveDailyQty: number;
  /**
   * The eligible days this pool was scaled by — the figure published for
   * `rationType`, and the only figure that applies to it. A pool whose
   * ration type has no published figure is not in the calculation at all,
   * so this is never a stand-in for a missing one.
   */
  eligibleDays: number;
  totalEntitlement: number;
  consumed: number;
  remaining: number;
  /** Customer-facing whole-unit figures. */
  display: { totalEntitlement: number; consumed: number; remaining: number };
  automaticConversions: ConversionEffect[];
  electiveOptions: ConversionEffect[];
  electedConversions: ConversionEffect[];
  surrenderedByElection: boolean;
  provisions: ProvisionView[];
  /** Allowed by diet, blocked by a condition that could change. See above. */
  unavailableProvisions: UnavailableProvisionView[];
}

export interface EntitlementCalculation {
  customerId: string;
  periodId: string;
  dietaryPreference: DietaryPreference;
  /**
   * The legacy single figure, reported for continuity of the existing
   * response shape and of `rik.entitlement_selections.eligible_days`.
   * NOTHING IN THIS CALCULATION IS SCALED BY IT — read
   * `PoolEntitlementView.eligibleDays`, or the two figures below.
   */
  eligibleDays: number;
  /** Published FRESH days, or null for "not published". */
  freshEligibleDays: number | null;
  /** Published DRY days, or null for "not published". */
  dryEligibleDays: number | null;
  asOf: string;
  fresh: PoolEntitlementView[];
  dry: PoolEntitlementView[];
}

/**
 * A configured conversion that moves entitlement between a Fresh pool and
 * a Dry pool.
 *
 * REFUSED, NEVER GUESSED. The source and target of a conversion are scaled
 * by their own ration type's eligible days, so a conversion that crossed
 * the boundary would have to pick one of two different day counts and
 * silently discard the other — which is the one thing the Fresh/Dry rule
 * forbids outright. No such conversion is configured today (all seven are
 * Fresh to Fresh), and if one is ever added the calculation stops instead
 * of producing a figure nobody can account for.
 */
export class CrossRationTypeConversionError extends Error {
  constructor(
    readonly conversionCode: string,
    readonly fromRationType: RationType,
    readonly toRationType: RationType
  ) {
    super(
      `Conversion ${conversionCode} crosses ration types (${fromRationType} to ${toRationType}). ` +
        'Fresh and Dry eligible days are separate figures and cannot be exchanged.'
    );
    this.name = 'CrossRationTypeConversionError';
  }
}

export interface CalculationOptions {
  /** Quantities already selected, keyed by provision id. */
  selectedQuantities?: ReadonlyMap<string, number>;
  /** Elective conversion ids the customer has taken. */
  electedConversionIds?: readonly string[];
  /** Restrict provisions to one physical issue period. */
  issuePeriod?: RationType;
  /** Pre-loaded configuration — used to calculate against a snapshot. */
  configuration?: EntitlementConfiguration;
  client?: PoolClient;
}

@Injectable()
export class RikEntitlementService {
  constructor(
    private readonly configRepo: EntitlementConfigRepository,
    private readonly conversions: RikConversionService,
    private readonly eligibility: RikEligibilityService
  ) {}

  async calculate(basis: EntitlementBasis, options: CalculationOptions = {}): Promise<EntitlementCalculation> {
    const config =
      options.configuration ?? (await this.configRepo.loadConfiguration(basis.asOf, options.client));
    return this.calculateFromConfiguration(basis, config, options);
  }

  /**
   * The calculation proper, against a configuration that has already been
   * loaded. Kept separate so a confirmed selection can be recalculated
   * against its stored snapshot rather than against today's rules.
   */
  calculateFromConfiguration(
    basis: EntitlementBasis,
    config: EntitlementConfiguration,
    options: CalculationOptions = {}
  ): EntitlementCalculation {
    const { dietaryPreference } = basis;
    const selected = options.selectedQuantities ?? new Map<string, number>();

    const rationTypeOf = new Map<string, RationType>(config.pools.map((p) => [p.id, p.ration_type]));

    /**
     * Conversion effects, each scaled by ITS OWN pools' ration type.
     *
     * Built here rather than through `RikConversionService.automaticEffects`
     * because that method scales every conversion by one day count, and
     * there is no longer one day count to give it. Its two public building
     * blocks — `applicableConversions` (which conversions apply to this
     * dietary preference) and `toEffect` (one row times N days) — are used
     * unchanged, so the rule about WHICH conversions apply still lives in
     * exactly one place.
     *
     * A conversion whose pools are not in `config.pools` can only happen on
     * a snapshot replay, where the stored pool set is pruned to the pools
     * the officer actually used. The target pool's type is tried next, and
     * then the legacy figure — which is what a pre-change snapshot stored
     * and the figure its original calculation used, so such a replay comes
     * out exactly as it did when it was confirmed.
     */
    const effectsOfMode = (mode: 'AUTOMATIC' | 'ELECTIVE'): ConversionEffect[] => {
      const effects: ConversionEffect[] = [];
      for (const conversion of this.conversions.applicableConversions(config, dietaryPreference, mode)) {
        const fromType = rationTypeOf.get(conversion.from_pool_id);
        const toType = rationTypeOf.get(conversion.to_pool_id);

        if (fromType !== undefined && toType !== undefined && fromType !== toType) {
          throw new CrossRationTypeConversionError(conversion.code, fromType, toType);
        }

        const governingType = fromType ?? toType;
        const days =
          governingType === undefined ? basis.eligibleDays : eligibleDaysFor(basis, governingType);

        // The surrendered entitlement's own figure is not published, so
        // there is no entitlement to convert and nothing to report.
        if (days === null) continue;

        effects.push(this.conversions.toEffect(conversion, days));
      }
      return effects;
    };

    const automatic = effectsOfMode('AUTOMATIC');
    const electiveOptions = effectsOfMode('ELECTIVE');
    const elected = this.conversions.selectedEffects(electiveOptions, options.electedConversionIds ?? []);

    const scaleFor = (poolId: string): number | null => {
      const scale = config.scales.find(
        (s) => s.pool_id === poolId && s.dietary_preference === dietaryPreference
      );
      return scale ? toNumber(scale.daily_qty) : null;
    };

    // Pool-equivalent consumption, aggregated per pool across every
    // selected provision — this is what makes a pool "shared".
    const consumedByPool = new Map<string, number>();
    for (const provision of config.provisions) {
      const qty = selected.get(provision.id);
      if (!qty || qty <= 0) continue;
      const equivalent = poolEquivalent(qty, toNumber(provision.consumption_ratio));
      consumedByPool.set(provision.pool_id, round((consumedByPool.get(provision.pool_id) ?? 0) + equivalent));
    }

    const views: PoolEntitlementView[] = [];

    for (const pool of config.pools) {
      /**
       * THE POOL'S OWN RATION TYPE DECIDES ITS DAYS, AND A MISSING FIGURE
       * IS NOT A ZERO.
       *
       * `null` means the facility has published nothing for this ration
       * type. The pool is left out rather than reported with an
       * entitlement of 0, because a zero is a figure somebody published
       * and this is the absence of one. The officer is told the figure is
       * awaited through `eligibilityWarnings`, and any attempt to select
       * from such a pool is refused with that same explanation rather
       * than with "you have run out".
       */
      const poolDays = eligibleDaysFor(basis, pool.ration_type);
      if (poolDays === null) continue;

      const dailyScale = scaleFor(pool.id);
      const automaticIn = automatic.filter((c) => c.toPoolId === pool.id);
      const electedIn = elected.filter((c) => c.toPoolId === pool.id);
      const surrendered = elected.some((c) => c.fromPoolId === pool.id);

      const baseDaily = surrendered ? 0 : dailyScale ?? 0;
      const addedDaily = round(
        [...automaticIn, ...electedIn].reduce((sum, c) => sum + c.toDailyQty, 0)
      );
      const effectiveDailyQty = round(baseDaily + addedDaily);

      // A pool is present for this customer when it has a scale of its
      // own, or when configuration routes entitlement into it.
      const applies = dailyScale !== null || automaticIn.length > 0 || electedIn.length > 0;
      if (!applies) continue;
      if (effectiveDailyQty <= 0 && !surrendered) continue;

      const totalEntitlement = scaleByDays(effectiveDailyQty, poolDays);
      const consumed = consumedByPool.get(pool.id) ?? 0;
      const remaining = round(totalEntitlement - consumed);

      const poolApplies = effectiveDailyQty > 0;
      const provisions = config.provisions
        .filter((p) => p.pool_id === pool.id)
        .filter((p) => this.eligibility.isProvisionAvailable(p, basis, poolApplies, poolDays))
        .filter((p) => (options.issuePeriod ? p.issue_period === options.issuePeriod : true))
        .map((p) => this.toProvisionView(p, remaining, selected));

      // The same set, minus the availability filter, kept only where the
      // ONLY thing standing in the way is the eligible-days minimum.
      // "Would it be available if the customer had exactly the minimum?"
      // answers that without this method knowing which rules exist — if
      // a second situational rule is ever configured, the same test
      // keeps working.
      const unavailableProvisions = config.provisions
        .filter((p) => p.pool_id === pool.id)
        .filter((p) => (options.issuePeriod ? p.issue_period === options.issuePeriod : true))
        .filter(
          (p) =>
            p.min_eligible_days !== null &&
            poolDays < p.min_eligible_days &&
            this.eligibility.isProvisionAvailable(p, basis, poolApplies, p.min_eligible_days)
        )
        .map((p) => this.toUnavailableProvisionView(p, basis, poolApplies, poolDays));

      views.push({
        poolId: pool.id,
        code: pool.code,
        name: pool.name,
        rationType: pool.ration_type,
        unit: pool.unit,
        description: pool.description,
        imageRef: pool.image_ref,
        dailyScale: dailyScale ?? 0,
        effectiveDailyQty,
        eligibleDays: poolDays,
        totalEntitlement,
        consumed,
        remaining,
        display: {
          totalEntitlement: displayQuantity(totalEntitlement),
          consumed: displayQuantity(consumed),
          remaining: displayQuantity(remaining),
        },
        automaticConversions: automaticIn,
        electiveOptions: electiveOptions.filter(
          (c) => c.fromPoolId === pool.id || c.toPoolId === pool.id
        ),
        electedConversions: electedIn,
        surrenderedByElection: surrendered,
        provisions,
        unavailableProvisions,
      });
    }

    const order = (a: PoolEntitlementView, b: PoolEntitlementView) => a.code.localeCompare(b.code);
    return {
      customerId: basis.customerId,
      periodId: basis.periodId,
      dietaryPreference,
      eligibleDays: basis.eligibleDays,
      freshEligibleDays: basis.freshEligibleDays,
      dryEligibleDays: basis.dryEligibleDays,
      asOf: basis.asOf,
      fresh: views.filter((v) => v.rationType === 'FRESH').sort(order),
      dry: views.filter((v) => v.rationType === 'DRY').sort(order),
    };
  }

  /** Flatten both ration types — used by validation, which does not care. */
  allPools(calculation: EntitlementCalculation): PoolEntitlementView[] {
    return [...calculation.fresh, ...calculation.dry];
  }

  findPool(calculation: EntitlementCalculation, poolId: string): PoolEntitlementView | undefined {
    return this.allPools(calculation).find((p) => p.poolId === poolId);
  }

  private toProvisionView(
    provision: ProvisionRecord,
    remainingPoolQty: number,
    selected: ReadonlyMap<string, number>
  ): ProvisionView {
    const ratio = toNumber(provision.consumption_ratio);
    const packSize = provision.pack_size === null ? null : toNumber(provision.pack_size);
    const maxQuantity = provision.max_quantity === null ? null : toNumber(provision.max_quantity);
    const selectedQuantity = selected.get(provision.id) ?? 0;

    // What the pool balance allows, then narrowed by the provision's own
    // configured ceilings. The already-selected quantity is added back so
    // the figure reads as "you may take up to this in total".
    const byPool = maxProvisionQuantity(round(remainingPoolQty + poolEquivalent(selectedQuantity, ratio)), ratio);
    const ceilings = [byPool];
    if (maxQuantity !== null) ceilings.push(maxQuantity);
    if (provision.max_packs !== null && packSize !== null) {
      ceilings.push(round(provision.max_packs * packSize));
    }

    return {
      provisionId: provision.id,
      code: provision.code,
      name: provision.name,
      brand: provision.brand,
      imageRef: provision.image_ref,
      packUnit: provision.pack_unit,
      unit: provision.unit,
      consumptionRatio: ratio,
      packSize,
      isLoose: provision.is_loose,
      wholeUnitsOnly: provision.whole_units_only,
      maxQuantity,
      maxPacks: provision.max_packs,
      minEligibleDays: provision.min_eligible_days,
      issuePeriod: provision.issue_period,
      maxSelectableQuantity: Math.max(0, Math.min(...ceilings)),
      selectedQuantity,
      selectedPoolEquivalentQty: poolEquivalent(selectedQuantity, ratio),
    };
  }

  /**
   * No entitlement figures here, deliberately. An item the customer
   * cannot take has no balance to report, and quoting one would invite
   * them to plan around a number that does not apply to them.
   */
  private toUnavailableProvisionView(
    provision: ProvisionRecord,
    basis: EntitlementBasis,
    poolApplies: boolean,
    eligibleDays: number | null
  ): UnavailableProvisionView {
    return {
      provisionId: provision.id,
      code: provision.code,
      name: provision.name,
      brand: provision.brand,
      imageRef: provision.image_ref,
      packUnit: provision.pack_unit,
      unit: provision.unit,
      packSize: provision.pack_size === null ? null : toNumber(provision.pack_size),
      minEligibleDays: provision.min_eligible_days,
      issuePeriod: provision.issue_period,
      reason:
        this.eligibility.unavailableReason(provision, basis, poolApplies, eligibleDays) ??
        'This provision is not available to you at the moment.',
    };
  }
}
