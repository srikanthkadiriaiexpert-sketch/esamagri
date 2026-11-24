import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import {
  EntitlementConfigRepository,
  type EntitlementConfiguration,
  type ProvisionRecord,
} from '../repositories/entitlement-config.repository';
import {
  EntitlementSelectionsRepository,
  type SelectionFulfillment,
  type SelectionRecord,
} from '../repositories/entitlement-selections.repository';
import { PickupLocationsRepository } from '../repositories/pickup-locations.repository';
import { RikConversionService } from './rik-conversion.service';
import {
  RikEligibilityService,
  eligibleDaysFor,
  rationTypeLabel,
  type EntitlementBasis,
} from './rik-eligibility.service';
import { RikEntitlementService, type EntitlementCalculation } from './rik-entitlement.service';
import { exceeds, poolEquivalent, round, toNumber } from './entitlement-math';

/**
 * Server-side enforcement of the entitlement rules.
 *
 * Nothing the client sends is trusted: not the dietary preference, not
 * the eligible days, not the ratio, not the remaining balance. Every
 * decision below is recomputed from configuration and from the lines
 * already committed to the database.
 *
 * Concurrency: every mutation runs inside a transaction that first takes
 * a row lock on the selection (`SELECT ... FOR UPDATE`). Two requests
 * racing to spend the last of a pool serialise behind that lock, and the
 * second recalculates against what the first committed — so the pool
 * cannot be overspent by interleaving.
 */

export type ValidationFailureReason =
  | 'PROVISION_NOT_FOUND'
  | 'PROVISION_UNAVAILABLE'
  | 'POOL_NOT_APPLICABLE'
  | 'EXCEEDS_ENTITLEMENT'
  | 'EXCEEDS_MAX_QUANTITY'
  | 'EXCEEDS_MAX_PACKS'
  | 'WHOLE_UNITS_ONLY'
  | 'MIN_ELIGIBLE_DAYS_NOT_MET'
  /**
   * The facility has published no eligible days for this provision's
   * ration type. Distinct from POOL_NOT_APPLICABLE (the officer's diet
   * excludes it) and from EXCEEDS_ENTITLEMENT (they have a figure and
   * have used it up): here there is no figure at all, and the officer is
   * told so rather than being told something untrue about their diet or
   * their balance.
   */
  | 'ELIGIBILITY_NOT_PUBLISHED'
  | 'CONFLICTING_ELECTIONS'
  | 'SELECTION_NOT_OPEN';

/**
 * The frozen rules a confirmed selection was calculated against, as stored
 * in `rik.entitlement_selections.rule_snapshot`.
 *
 * `version` 1 stored a single `eligibleDays`. Version 2 adds the Fresh and
 * Dry figures. Both are readable; see `basisFromSnapshot`.
 */
export interface RuleSnapshot {
  /** Absent on the very first snapshots; treated as 1. */
  version?: number;
  basis: {
    dietaryPreference: EntitlementBasis['dietaryPreference'];
    eligibleDays: number;
    /** Version 2 and later only. */
    freshEligibleDays?: number | null;
    dryEligibleDays?: number | null;
    asOf: string;
  };
  pools: EntitlementConfiguration['pools'];
  scales: EntitlementConfiguration['scales'];
  conversions: EntitlementConfiguration['conversions'];
  provisions: EntitlementConfiguration['provisions'];
  elections: Array<{ conversionId: string }>;
  items: Array<{ provisionId: string; quantity: number }>;
}

/**
 * The basis a confirmed selection replays against.
 *
 * A SELECTION CONFIRMED BEFORE THIS CHANGE REPLAYS EXACTLY AS IT WAS.
 *
 * A version 1 snapshot has one figure, and that one figure is what its
 * original calculation scaled every pool by. So both ration types are read
 * from it, which reproduces the confirmed quantities to the digit — no
 * Fresh/Dry split is retrofitted onto a selection that was never calculated
 * with one. This is what makes an officer's issued voucher immune to the
 * change: the numbers on it were frozen, and they replay frozen.
 *
 * THE VERSION NUMBER DECIDES THIS, NOT THE PRESENCE OF THE FIELDS. A
 * version 2 snapshot can legitimately store `null` for a figure the facility
 * had not published, and a `??` on that null would quietly reach for the
 * legacy number — reintroducing, in the one place history is meant to be
 * frozen, exactly the substitution this change exists to remove.
 *
 * Pure, and separate from the row it is read from, so every version and
 * every null combination is testable without a database.
 */
export function basisFromSnapshot(
  snapshot: RuleSnapshot,
  customerId: string,
  periodId: string
): EntitlementBasis {
  const perRationType = (snapshot.version ?? 1) >= 2;
  const legacyDays = snapshot.basis.eligibleDays;

  return {
    customerId,
    periodId,
    dietaryPreference: snapshot.basis.dietaryPreference,
    eligibleDays: legacyDays,
    freshEligibleDays: perRationType ? snapshot.basis.freshEligibleDays ?? null : legacyDays,
    dryEligibleDays: perRationType ? snapshot.basis.dryEligibleDays ?? null : legacyDays,
    asOf: snapshot.basis.asOf,
  };
}

export interface ValidationFailure {
  ok: false;
  reason: ValidationFailureReason;
  message: string;
  detail: {
    provisionId?: string;
    provisionCode?: string;
    poolId?: string;
    poolCode?: string;
    unit?: string;
    entitlement?: number;
    alreadyConsumed?: number;
    requestedEquivalent?: number;
    remaining?: number;
    maxQuantity?: number;
    maxPacks?: number;
    minEligibleDays?: number;
  };
}

export interface ValidationSuccess {
  ok: true;
  provisionId: string;
  poolId: string;
  quantity: number;
  consumptionRatio: number;
  poolEquivalentQty: number;
  remainingAfter: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/** PostgreSQL unique-violation SQLSTATE, raised by the one-open-draft index. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export class SelectionNotOpenError extends Error {
  constructor(message = 'This selection is no longer open for changes.') {
    super(message);
    this.name = 'SelectionNotOpenError';
  }
}

/** Why a confirmation was refused, as a code the client can act on. */
export type ConfirmationFailureReason =
  | 'SELECTION_NOT_OPEN'
  | 'ALREADY_CONFIRMED'
  | 'NOTHING_SELECTED'
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'INVALID_FULFILLMENT_TYPE'
  | 'PICKUP_LOCATION_REQUIRED'
  | 'PICKUP_LOCATION_INVALID'
  | 'DELIVERY_ADDRESS_REQUIRED';

export class ConfirmationRefusedError extends Error {
  readonly reason: ConfirmationFailureReason;
  readonly detail: Record<string, unknown>;

  constructor(reason: ConfirmationFailureReason, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ConfirmationRefusedError';
    this.reason = reason;
    this.detail = detail;
  }
}

/** What the customer asked for at confirmation, before it is validated. */
export interface ConfirmationRequest {
  availabilityAcknowledged: boolean;
  fulfillmentType: string;
  pickupLocationId?: string | null;
  deliveryAddress?: string | null;
}

@Injectable()
export class RikSelectionValidationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configRepo: EntitlementConfigRepository,
    private readonly selections: EntitlementSelectionsRepository,
    private readonly entitlement: RikEntitlementService,
    private readonly eligibility: RikEligibilityService,
    private readonly conversions: RikConversionService,
    private readonly pickupLocations: PickupLocationsRepository
  ) {}

  /**
   * Check one quantity against the live rules without writing anything.
   * Used by the validate endpoint so a client can pre-flight a change.
   */
  async validateQuantity(
    basis: EntitlementBasis,
    provisionId: string,
    quantity: number,
    options: {
      configuration?: EntitlementConfiguration;
      existingQuantities?: ReadonlyMap<string, number>;
      electedConversionIds?: readonly string[];
      client?: PoolClient;
    } = {}
  ): Promise<ValidationResult> {
    const config =
      options.configuration ?? (await this.configRepo.loadConfiguration(basis.asOf, options.client));

    const provision = config.provisions.find((p) => p.id === provisionId);
    if (!provision) {
      return {
        ok: false,
        reason: 'PROVISION_NOT_FOUND',
        message: 'That provision is not available.',
        detail: { provisionId },
      };
    }

    // Recalculate with this provision's quantity excluded, so the check
    // is "does the new absolute quantity fit", not "does it fit on top
    // of itself".
    const others = new Map(options.existingQuantities ?? []);
    others.delete(provisionId);

    const calculation = await this.entitlement.calculate(basis, {
      configuration: config,
      selectedQuantities: others,
      electedConversionIds: options.electedConversionIds,
      client: options.client,
    });

    return this.checkAgainstCalculation(provision, quantity, calculation, basis, config);
  }

  /**
   * Validate and persist one line, under a row lock.
   *
   * Returns the validation result and the recalculated entitlement, so a
   * caller never has to re-derive what the balance became.
   */
  async setQuantity(
    basis: EntitlementBasis,
    provisionId: string,
    quantity: number
  ): Promise<{ result: ValidationResult; calculation: EntitlementCalculation; selectionId: string }> {
    return this.db.withTransaction(async (client) => {
      const selection = await this.openDraft(client, basis);
      const config = await this.configRepo.loadConfiguration(basis.asOf, client);

      const items = await this.selections.listItems(client, selection.id);
      const existing = new Map<string, number>(items.map((i) => [i.provision_id, toNumber(i.quantity)]));
      const elections = await this.selections.listElections(client, selection.id);
      const electedIds = elections.map((e) => e.conversion_id);

      const result = await this.validateQuantity(basis, provisionId, quantity, {
        configuration: config,
        existingQuantities: existing,
        electedConversionIds: electedIds,
        client,
      });

      if (result.ok) {
        if (quantity <= 0) {
          await this.selections.removeItem(client, selection.id, provisionId);
          existing.delete(provisionId);
        } else {
          await this.selections.upsertItem(client, {
            selectionId: selection.id,
            provisionId,
            poolId: result.poolId,
            quantity: result.quantity,
            consumptionRatio: result.consumptionRatio,
            poolEquivalentQty: result.poolEquivalentQty,
          });
          existing.set(provisionId, result.quantity);
        }
      }

      const calculation = await this.entitlement.calculate(basis, {
        configuration: config,
        selectedQuantities: existing,
        electedConversionIds: electedIds,
        client,
      });

      return { result, calculation, selectionId: selection.id };
    });
  }

  /**
   * Replace the customer's elective conversions.
   *
   * Two elections surrendering the same source pool are refused — the
   * meat entitlement cannot be taken as eggs and as milk at once.
   * Changing an election re-checks every existing line, because reducing
   * a pool can invalidate a quantity that was legal a moment ago.
   */
  async setElections(
    basis: EntitlementBasis,
    conversionIds: readonly string[]
  ): Promise<{ result: ValidationResult | { ok: true }; calculation: EntitlementCalculation }> {
    return this.db.withTransaction(async (client) => {
      const selection = await this.openDraft(client, basis);
      const config = await this.configRepo.loadConfiguration(basis.asOf, client);

      /**
       * WHICH options exist, not what they are worth.
       *
       * This path validates the ids the customer sent, refuses two
       * elections that surrender the same pool, and stores the DAILY
       * quantities. No period total is read from these effects, so there
       * is no day count to supply here and none is invented — passing one
       * figure would mean choosing between Fresh and Dry days for a list
       * that can contain both. Totals are produced by the entitlement
       * engine, which scales each conversion by its own pools' ration
       * type.
       */
      const periodTotalsNotReadHere = 0;
      const options = this.conversions.electiveOptions(
        config,
        basis.dietaryPreference,
        periodTotalsNotReadHere
      );
      const chosen = this.conversions.selectedEffects(options, conversionIds);
      const conflicts = this.conversions.findConflictingElections(chosen);

      if (conflicts.length > 0) {
        const group = conflicts[0]!;
        const calculation = await this.recalculate(client, basis, config, selection.id);
        return {
          result: {
            ok: false,
            reason: 'CONFLICTING_ELECTIONS',
            message: 'Only one alternative may be taken for the same entitlement.',
            detail: { poolId: group[0]!.fromPoolId },
          },
          calculation,
        };
      }

      await this.selections.replaceElections(
        client,
        selection.id,
        chosen.map((c) => ({ conversionId: c.conversionId, fromQty: c.fromDailyQty, toQty: c.toDailyQty }))
      );

      // An election can shrink a pool; drop any line that no longer fits
      // rather than leaving the customer over their entitlement.
      const items = await this.selections.listItems(client, selection.id);
      const quantities = new Map<string, number>(items.map((i) => [i.provision_id, toNumber(i.quantity)]));
      const electedIds = chosen.map((c) => c.conversionId);

      for (const item of items) {
        const check = await this.validateQuantity(basis, item.provision_id, toNumber(item.quantity), {
          configuration: config,
          existingQuantities: quantities,
          electedConversionIds: electedIds,
          client,
        });
        if (!check.ok) {
          await this.selections.removeItem(client, selection.id, item.provision_id);
          quantities.delete(item.provision_id);
        }
      }

      const calculation = await this.entitlement.calculate(basis, {
        configuration: config,
        selectedQuantities: quantities,
        electedConversionIds: electedIds,
        client,
      });
      return { result: { ok: true }, calculation };
    });
  }

  /**
   * Confirm the draft: the rule snapshot, the basis, the availability
   * acknowledgement and the chosen fulfillment, all in one transaction.
   *
   * The snapshot carries the pools, scales, conversions and the
   * provisions actually used, plus the basis. That is enough to
   * reproduce the calculation exactly, so a later administrative change
   * to the master configuration cannot restate a confirmed selection.
   *
   * WHAT MAKES THIS ATOMIC. Everything below happens inside one
   * transaction that opens by taking a row lock on the selection. The
   * snapshot, the basis, the acknowledgement, the fulfillment and the
   * reference number are written by a SINGLE update statement — there
   * is no window in which a selection is confirmed but its fulfillment
   * is missing, and no ordering of failures that could leave one
   * without the other. If anything raises, the whole transaction rolls
   * back and the draft is untouched.
   *
   * WHAT MAKES A SECOND ATTEMPT HARMLESS. That update carries
   * `WHERE status = 'DRAFT'`. Two requests that both pass validation
   * still serialise on the lock; the second finds no draft and updates
   * nothing. It is refused with ALREADY_CONFIRMED and the record it
   * would have duplicated is returned instead, so a double-tap, a
   * refresh or a retry after a slow network all land on the same
   * confirmation rather than a second one.
   *
   * The pickup location is resolved SERVER-SIDE from its id, and the
   * NAME is snapshotted onto the row. A client cannot name its own
   * location text, and renaming the location afterwards cannot rewrite
   * what was agreed.
   */
  async confirm(
    basis: EntitlementBasis,
    request: ConfirmationRequest
  ): Promise<{ selectionId: string; selection: SelectionRecord; calculation: EntitlementCalculation }> {
    // Shape checks first, before any lock is taken: a malformed request
    // should not make another customer wait.
    if (request.availabilityAcknowledged !== true) {
      throw new ConfirmationRefusedError(
        'ACKNOWLEDGEMENT_REQUIRED',
        'Please confirm that you understand provisions are subject to availability.'
      );
    }

    const fulfillment = await this.resolveFulfillment(request);

    /**
     * "There is nothing open to confirm" is CARRIED OUT of the
     * transaction as a value rather than thrown from inside it.
     *
     * `DatabaseService.withTransaction` deliberately replaces any error
     * escaping the callback with a generic `SafeDatabaseError`, so that
     * driver detail and SQL can never reach a caller. That is right for
     * database failures, but it also swallowed this deliberate domain
     * signal: confirming an already-confirmed selection produced HTTP
     * 500 "a database error occurred" instead of a plain "this is no
     * longer open". Found in STEP 11D by confirming twice over HTTP.
     *
     * The check still happens under the same `SELECT … FOR UPDATE` row
     * lock — only the verdict travels out, and the transaction commits
     * having written nothing.
     */
    const outcome = await this.db.withTransaction(async (client) => {
      const selection = await this.selections.findOpenForUpdate(client, basis.customerId, basis.periodId);
      if (!selection) return { open: false as const };

      const config = await this.configRepo.loadConfiguration(basis.asOf, client);
      const items = await this.selections.listItems(client, selection.id);
      const quantities = new Map<string, number>(items.map((i) => [i.provision_id, toNumber(i.quantity)]));
      const elections = await this.selections.listElections(client, selection.id);
      const electedIds = elections.map((e) => e.conversion_id);

      const calculation = await this.entitlement.calculate(basis, {
        configuration: config,
        selectedQuantities: quantities,
        electedConversionIds: electedIds,
        client,
      });

      const usedPoolIds = new Set(items.map((i) => i.pool_id));
      /**
       * SNAPSHOT VERSION 2 — THE FROZEN BASIS NOW CARRIES BOTH FIGURES.
       *
       * Version 1 stored one `eligibleDays`, because one figure was all
       * the calculation used. Version 2 stores the Fresh and Dry figures
       * as well, including a null where one was not published, so a
       * replay scales each pool by the figure that actually applied to it
       * on the day the officer confirmed.
       *
       * The legacy `eligibleDays` is still written. It is what version 1
       * snapshots replay from, and keeping it means this snapshot can be
       * read by the previous code as well as by this code — the version
       * number is additive, not a break.
       */
      const snapshot = {
        version: 2,
        takenAt: new Date().toISOString(),
        basis: {
          dietaryPreference: basis.dietaryPreference,
          eligibleDays: basis.eligibleDays,
          freshEligibleDays: basis.freshEligibleDays,
          dryEligibleDays: basis.dryEligibleDays,
          asOf: basis.asOf,
        },
        pools: config.pools.filter((p) => usedPoolIds.has(p.id)),
        scales: config.scales.filter(
          (s) => usedPoolIds.has(s.pool_id) && s.dietary_preference === basis.dietaryPreference
        ),
        conversions: config.conversions.filter(
          (c) => c.dietary_preference === null || c.dietary_preference === basis.dietaryPreference
        ),
        elections: elections.map((e) => ({
          conversionId: e.conversion_id,
          fromQty: toNumber(e.from_qty),
          toQty: toNumber(e.to_qty),
        })),
        provisions: config.provisions.filter((p) => quantities.has(p.id)),
        items: items.map((i) => ({
          provisionId: i.provision_id,
          poolId: i.pool_id,
          quantity: toNumber(i.quantity),
          consumptionRatio: toNumber(i.consumption_ratio),
          poolEquivalentQty: toNumber(i.pool_equivalent_qty),
        })),
      };

      if (items.length === 0) {
        return { open: false as const, reason: 'NOTHING_SELECTED' as const };
      }

      const confirmed = await this.selections.confirm(client, selection.id, {
        ruleSnapshot: snapshot,
        // The basis the calculation actually used, not whatever the row
        // happened to store when the draft was opened.
        dietaryPreference: basis.dietaryPreference,
        eligibleDays: basis.eligibleDays,
        fulfillment,
      });

      // Lost the race: another request confirmed this draft between the
      // lock being released and this statement. Nothing was written.
      if (!confirmed) {
        return { open: false as const, reason: 'ALREADY_CONFIRMED' as const };
      }

      return { open: true as const, selection: confirmed, calculation };
    });

    if (!outcome.open) {
      if (outcome.reason === 'NOTHING_SELECTED') {
        throw new ConfirmationRefusedError(
          'NOTHING_SELECTED',
          'Choose at least one provision before confirming your ration.'
        );
      }
      // No open draft. Either it was already confirmed — in which case
      // the customer should see that confirmation rather than an error
      // they cannot act on — or there is genuinely nothing to confirm.
      const existing = await this.selections.findCurrentForPeriod(basis.customerId, basis.periodId);
      if (existing?.status === 'CONFIRMED') {
        throw new ConfirmationRefusedError(
          'ALREADY_CONFIRMED',
          'This ration selection has already been confirmed.',
          { selectionId: existing.id, referenceNumber: existing.reference_number }
        );
      }
      throw new SelectionNotOpenError();
    }

    return {
      selectionId: outcome.selection.id,
      selection: outcome.selection,
      calculation: outcome.calculation,
    };
  }

  /**
   * Turn what the customer asked for into what will be stored, refusing
   * anything incomplete.
   *
   * Every rule here is enforced server-side regardless of what the
   * screen offered, and each refusal names itself so the screen can
   * point at the field rather than showing a wall of text.
   */
  private async resolveFulfillment(request: ConfirmationRequest): Promise<SelectionFulfillment> {
    if (request.fulfillmentType !== 'PICKUP' && request.fulfillmentType !== 'DELIVERY') {
      throw new ConfirmationRefusedError(
        'INVALID_FULFILLMENT_TYPE',
        'Choose whether you will collect your ration or have it delivered.',
        { supplied: request.fulfillmentType }
      );
    }

    if (request.fulfillmentType === 'PICKUP') {
      const locationId = request.pickupLocationId ?? null;
      if (!locationId) {
        throw new ConfirmationRefusedError(
          'PICKUP_LOCATION_REQUIRED',
          'Choose where you will collect your ration.'
        );
      }

      // Resolved against what is offerable TODAY, so a location the
      // customer saw last month but which has since been retired cannot
      // be chosen by sending its id.
      const location = await this.pickupLocations.findSelectable(locationId);
      if (!location) {
        throw new ConfirmationRefusedError(
          'PICKUP_LOCATION_INVALID',
          'That collection point is not available. Please choose another.',
          { pickupLocationId: locationId }
        );
      }

      return {
        fulfillmentType: 'PICKUP',
        pickupLocationId: location.id,
        // The NAME as it is now — the historical record.
        pickupLocationName: location.name,
        deliveryAddress: null,
      };
    }

    const address = (request.deliveryAddress ?? '').trim();
    if (address === '') {
      throw new ConfirmationRefusedError(
        'DELIVERY_ADDRESS_REQUIRED',
        'Enter the address your ration should be delivered to.'
      );
    }

    return {
      fulfillmentType: 'DELIVERY',
      pickupLocationId: null,
      pickupLocationName: null,
      // Stored verbatim. Never a reference to the profile address,
      // which the customer may change afterwards.
      deliveryAddress: address,
    };
  }

  /**
   * Recompute a confirmed selection from its own snapshot.
   *
   * This is the proof that history is preserved: the configuration used
   * is the one stored on the row, so changing `rik.pool_scales` today
   * cannot move a figure that was confirmed last month.
   */
  async recalculateFromSnapshot(
    selectionId: string,
    customerId: string
  ): Promise<EntitlementCalculation | null> {
    const selection = await this.selections.findById(selectionId, customerId);
    if (!selection || !selection.rule_snapshot) return null;

    const snapshot = selection.rule_snapshot as RuleSnapshot;
    const basis = basisFromSnapshot(snapshot, customerId, selection.period_id);

    const quantities = new Map(snapshot.items.map((i) => [i.provisionId, i.quantity]));
    return this.entitlement.calculateFromConfiguration(
      basis,
      {
        asOf: snapshot.basis.asOf,
        pools: snapshot.pools,
        scales: snapshot.scales,
        conversions: snapshot.conversions,
        provisions: snapshot.provisions,
      },
      {
        selectedQuantities: quantities,
        electedConversionIds: snapshot.elections.map((e) => e.conversionId),
      }
    );
  }

  /**
   * The customer's selection for a period, read-only — the open draft
   * if there is one, otherwise the confirmed record.
   *
   * Returns empty state rather than creating a draft, so simply looking
   * at Know Your Ration never writes anything.
   *
   * It falls back to the CONFIRMED selection because of a gap STEP 11E
   * found: this used to look for a DRAFT alone, so the instant a
   * customer confirmed, Know Your Ration showed their ration as though
   * they had chosen nothing. Writes are unaffected — they go through
   * `findOpenForUpdate`, which still sees only a DRAFT, so a confirmed
   * selection stays read-only by construction rather than by a check
   * somebody has to remember.
   */
  async loadDraftState(
    customerId: string,
    periodId: string
  ): Promise<{
    quantities: Map<string, number>;
    electedConversionIds: string[];
    selectionId: string | null;
    selection: SelectionRecord | null;
  }> {
    const selection = await this.selections.findCurrentForPeriod(customerId, periodId);
    const selectionId = selection?.id ?? null;
    if (!selection || !selectionId) {
      return { quantities: new Map(), electedConversionIds: [], selectionId: null, selection: null };
    }

    const [items, elections] = await Promise.all([
      this.selections.listItemsById(selectionId),
      this.db.query<{ conversion_id: string }>(
        `SELECT conversion_id FROM rik.entitlement_elections WHERE selection_id = $1`,
        [selectionId]
      ),
    ]);

    return {
      quantities: new Map(items.map((i) => [i.provision_id, toNumber(i.quantity)])),
      electedConversionIds: elections.map((e) => e.conversion_id),
      selectionId,
      selection,
    };
  }

  // ---------------------------------------------------------------- internals

  /**
   * The customer's open draft, creating one if there is none.
   *
   * The create is racy by nature: two parallel first-requests both find
   * no draft and both insert, and the partial unique index on
   * (customer, period) WHERE status = 'DRAFT' rejects the loser. That
   * rejection is the index doing its job, not an error the customer
   * should ever see — so the loser re-reads the row the winner
   * committed and takes the lock on it, and both requests proceed
   * against the same draft, serialised.
   */
  private async openDraft(client: PoolClient, basis: EntitlementBasis) {
    const existing = await this.selections.findOpenForUpdate(client, basis.customerId, basis.periodId);
    if (existing) return existing;

    // The insert goes inside a SAVEPOINT. In PostgreSQL a failed
    // statement aborts the whole transaction, so without one the losing
    // request could not continue far enough to re-read the winner's row —
    // it would only be able to roll back.
    await client.query('SAVEPOINT open_draft');
    try {
      const created = await this.selections.createDraft(client, {
        customerId: basis.customerId,
        periodId: basis.periodId,
        dietaryPreference: basis.dietaryPreference,
        eligibleDays: basis.eligibleDays,
      });
      await client.query('RELEASE SAVEPOINT open_draft');
      return created;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT open_draft');
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.selections.findOpenForUpdate(client, basis.customerId, basis.periodId);
      if (raced) return raced;
      throw err;
    }
  }

  private async recalculate(
    client: PoolClient,
    basis: EntitlementBasis,
    config: EntitlementConfiguration,
    selectionId: string
  ): Promise<EntitlementCalculation> {
    const items = await this.selections.listItems(client, selectionId);
    const elections = await this.selections.listElections(client, selectionId);
    return this.entitlement.calculate(basis, {
      configuration: config,
      selectedQuantities: new Map(items.map((i) => [i.provision_id, toNumber(i.quantity)])),
      electedConversionIds: elections.map((e) => e.conversion_id),
      client,
    });
  }

  /** Every rule check for one quantity, in one place. */
  private checkAgainstCalculation(
    provision: ProvisionRecord,
    quantity: number,
    calculation: EntitlementCalculation,
    basis: EntitlementBasis,
    config: EntitlementConfiguration
  ): ValidationResult {
    const pool = this.entitlement.findPool(calculation, provision.pool_id);
    const poolMeta = config.pools.find((p) => p.id === provision.pool_id);

    /**
     * TWO REASONS A POOL CAN BE ABSENT, AND THEY ARE NOT THE SAME THING.
     *
     * The calculation leaves out a pool whose ration type has no published
     * eligible days, as well as a pool the officer's diet excludes. Saying
     * "this does not apply to your dietary preference" to an officer whose
     * Dry sheet simply has not arrived would be a false statement about
     * them, and one they could do nothing about. The missing figure is
     * checked first and named for what it is.
     */
    const poolRationDays =
      poolMeta === undefined ? undefined : eligibleDaysFor(basis, poolMeta.ration_type);

    if (!pool && poolMeta !== undefined && poolRationDays === null) {
      return {
        ok: false,
        reason: 'ELIGIBILITY_NOT_PUBLISHED',
        message:
          `Your ${rationTypeLabel(poolMeta.ration_type)} eligible days for this period have not ` +
          'been published yet. Please contact the RIK office.',
        detail: {
          provisionId: provision.id,
          provisionCode: provision.code,
          poolId: poolMeta.id,
          poolCode: poolMeta.code,
        },
      };
    }

    if (!pool) {
      return {
        ok: false,
        reason: 'POOL_NOT_APPLICABLE',
        message: 'This entitlement does not apply to your dietary preference.',
        detail: { provisionId: provision.id, provisionCode: provision.code, poolCode: poolMeta?.code },
      };
    }

    /**
     * The days that govern this line are the days the calculation ACTUALLY
     * SCALED THIS POOL BY, read back off the pool it produced rather than
     * resolved a second time here. One figure, computed once: a second
     * derivation could disagree with the arithmetic it is meant to be
     * judging, and the officer would be refused against a number that is
     * not the one their balance was built from.
     *
     * For Bread that figure is the Dry figure, because the cereals pool is
     * Dry — whichever issue day the loaf is handed over on.
     */
    const governingDays = pool.eligibleDays;

    const unavailable = this.eligibility.unavailableReason(
      provision,
      basis,
      pool.effectiveDailyQty > 0,
      governingDays
    );
    if (unavailable) {
      const reason: ValidationFailureReason =
        provision.min_eligible_days !== null && governingDays < provision.min_eligible_days
          ? 'MIN_ELIGIBLE_DAYS_NOT_MET'
          : 'PROVISION_UNAVAILABLE';
      return {
        ok: false,
        reason,
        message: unavailable,
        detail: {
          provisionId: provision.id,
          provisionCode: provision.code,
          poolId: pool.poolId,
          poolCode: pool.code,
          minEligibleDays: provision.min_eligible_days ?? undefined,
        },
      };
    }

    // Removing a line is always allowed.
    if (quantity <= 0) {
      return {
        ok: true,
        provisionId: provision.id,
        poolId: provision.pool_id,
        quantity: 0,
        consumptionRatio: toNumber(provision.consumption_ratio),
        poolEquivalentQty: 0,
        remainingAfter: pool.remaining,
      };
    }

    /**
     * A WHOLE NUMBER, OR NOTHING.
     *
     * Checked before any ceiling, because "two and a half coupons" is not a
     * quantity that is too large — it is not a quantity at all. A physical
     * coupon is handed over or it is not.
     *
     * The guard lives here rather than in the DTO because the DTO is shared
     * by every provision and most of them are genuinely divisible: Milk TD is
     * weighed in grams, vegetables in grams. Which provisions are countable
     * is configuration (`whole_units_only`), so the engine applies it without
     * knowing what any provision is called — today exactly one row sets it.
     *
     * Note this is NOT pack_size. The three packed cereal items have a pack
     * size and a 2-pack limit and remain selectable at any quantity up to
     * that ceiling, exactly as before.
     */
    if (provision.whole_units_only && !Number.isInteger(quantity)) {
      const unitWord = provision.pack_unit === 'coupon' ? 'coupons' : provision.unit;
      return {
        ok: false,
        reason: 'WHOLE_UNITS_ONLY',
        message: `${provision.name} is taken in whole ${unitWord}. Please choose a whole number.`,
        detail: {
          provisionId: provision.id,
          provisionCode: provision.code,
          poolId: pool.poolId,
          poolCode: pool.code,
          unit: provision.unit,
        },
      };
    }

    const maxQuantity = provision.max_quantity === null ? null : toNumber(provision.max_quantity);
    if (maxQuantity !== null && quantity > maxQuantity) {
      return {
        ok: false,
        reason: 'EXCEEDS_MAX_QUANTITY',
        message: `The maximum for this provision is ${maxQuantity} ${provision.unit}.`,
        detail: {
          provisionId: provision.id,
          provisionCode: provision.code,
          poolId: pool.poolId,
          poolCode: pool.code,
          unit: provision.unit,
          maxQuantity,
        },
      };
    }

    const packSize = provision.pack_size === null ? null : toNumber(provision.pack_size);
    if (provision.max_packs !== null && packSize !== null) {
      const packs = quantity / packSize;
      if (packs > provision.max_packs + 1e-9) {
        return {
          ok: false,
          reason: 'EXCEEDS_MAX_PACKS',
          message: `The maximum for this provision is ${provision.max_packs} pack(s) of ${packSize} ${provision.unit}.`,
          detail: {
            provisionId: provision.id,
            provisionCode: provision.code,
            poolId: pool.poolId,
            poolCode: pool.code,
            unit: provision.unit,
            maxPacks: provision.max_packs,
            maxQuantity: round(provision.max_packs * packSize),
          },
        };
      }
    }

    const ratio = toNumber(provision.consumption_ratio);
    const requestedEquivalent = poolEquivalent(quantity, ratio);
    const consumedByOthers = pool.consumed;
    const totalAfter = round(consumedByOthers + requestedEquivalent);

    if (exceeds(totalAfter, pool.totalEntitlement)) {
      return {
        ok: false,
        reason: 'EXCEEDS_ENTITLEMENT',
        message: `This selection would exceed your ${pool.name} entitlement.`,
        detail: {
          provisionId: provision.id,
          provisionCode: provision.code,
          poolId: pool.poolId,
          poolCode: pool.code,
          unit: pool.unit,
          entitlement: pool.totalEntitlement,
          alreadyConsumed: consumedByOthers,
          requestedEquivalent,
          remaining: pool.remaining,
        },
      };
    }

    return {
      ok: true,
      provisionId: provision.id,
      poolId: provision.pool_id,
      quantity: round(quantity),
      consumptionRatio: ratio,
      poolEquivalentQty: requestedEquivalent,
      remainingAfter: round(pool.totalEntitlement - totalAfter),
    };
  }
}
