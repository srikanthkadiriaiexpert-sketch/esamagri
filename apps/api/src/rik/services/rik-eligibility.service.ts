import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type {
  DietaryPreference,
  ProvisionRecord,
  RationType,
} from '../repositories/entitlement-config.repository';

/**
 * Who the customer is, entitlement-wise, and what they are allowed to be
 * offered.
 *
 * Two things are resolved here and nowhere else:
 *
 *  1. The authoritative basis for a calculation — dietary preference and
 *     eligible days — read from the database, never from the request.
 *     A client that posts "I am NV and I have 31 days" changes nothing.
 *
 *  2. Whether a given provision may be offered at all, which is a
 *     question answered entirely by configured columns: is it
 *     customer-selectable, does its dietary restriction match, does the
 *     customer have enough eligible days for it, and is it issued in the
 *     period being asked about.
 *
 * ---------------------------------------------------------------------------
 * ELIGIBLE DAYS ARE PER RATION TYPE (FRESH AND DRY), NOT ONE FIGURE.
 * ---------------------------------------------------------------------------
 *
 * The facility publishes TWO figures per officer per period, by Excel upload:
 * a Fresh figure (0-30) and a Dry figure (0-60). They are independent. An
 * officer may be entitled to 10 Fresh days and 30 Dry days in the same month,
 * and the two must never be added together, averaged, or exchanged for one
 * another. `rik.customer_period_ration_eligibility` holds one row per ration
 * type and is the single source of truth.
 *
 * Three states per ration type, and all three are different:
 *
 *   a number > 0   the facility published that many days.
 *   0              the facility published ZERO days. A real entitlement of
 *                  nothing. The officer is in the sheet and draws nothing.
 *   null           the facility has published NOTHING for this type. Not
 *                  zero — unknown. Nothing may be calculated from it and
 *                  no default may be substituted in its place.
 *
 * The SQL below returns SQL NULL for "no row" and 0 for "a row saying zero",
 * so the distinction survives the round trip untouched. Nothing in this file
 * coalesces one into the other.
 *
 * The legacy single figure in `rik.customer_period_eligibility` is retained
 * on the basis (`eligibleDays`) because the column is still written when a
 * draft is opened or a selection confirmed, and because selections confirmed
 * before this change replay from it. IT IS NO LONGER A CALCULATION INPUT.
 * Every quantity is scaled by the figure for the pool's own ration type.
 */

/** The ration types the facility publishes figures for, in display order. */
export const RATION_TYPES: readonly RationType[] = ['FRESH', 'DRY'] as const;

export interface EntitlementBasis {
  customerId: string;
  periodId: string;
  dietaryPreference: DietaryPreference;
  /**
   * The LEGACY single figure from `rik.customer_period_eligibility`.
   *
   * Record-keeping only. It is written to `rik.entitlement_selections`
   * when a draft is opened and when a selection is confirmed, and it is
   * what pre-change snapshots replay from. No quantity is scaled by it
   * any more — see `eligibleDaysFor`.
   *
   * 0 when no legacy row exists, which is the normal state for an officer
   * whose figures arrived through the per-ration-type Excel import (that
   * import deliberately never writes the legacy table).
   */
  eligibleDays: number;
  /** Published FRESH days (0-30), or null for "not published". */
  freshEligibleDays: number | null;
  /** Published DRY days (0-60), or null for "not published". */
  dryEligibleDays: number | null;
  asOf: string;
}

/**
 * The eligible days that apply to one ration type — the ONLY way a
 * quantity may be scaled.
 *
 * A pure function rather than a method on the basis, so that every caller
 * (the entitlement engine, selection validation, a snapshot replay, a
 * test fixture built as a plain object literal) reads the figure the same
 * way, and so that the rule itself is unit-testable without a database,
 * a Nest container or a pool.
 *
 * Returns null when the figure has not been published. A null must never
 * be turned into 0 by the caller: see the header comment.
 */
export function eligibleDaysFor(
  basis: Pick<EntitlementBasis, 'freshEligibleDays' | 'dryEligibleDays'>,
  rationType: RationType
): number | null {
  return rationType === 'FRESH' ? basis.freshEligibleDays : basis.dryEligibleDays;
}

/**
 * The ration types this officer has NO published figure for.
 *
 * Drives the warnings the officer and RIK staff are shown. Empty means
 * both figures are published, including when either is a published zero.
 */
export function missingRationTypes(
  basis: Pick<EntitlementBasis, 'freshEligibleDays' | 'dryEligibleDays'>
): RationType[] {
  return RATION_TYPES.filter((t) => eligibleDaysFor(basis, t) === null);
}

/**
 * A ration type as it is written to an officer or to RIK staff.
 *
 * One place, so a message never says "FRESH" in one screen and "Fresh"
 * in another, and so no caller spells it with a conditional of its own.
 */
export function rationTypeLabel(rationType: RationType): string {
  return rationType === 'FRESH' ? 'Fresh' : 'Dry';
}

export class DietaryPreferenceNotSetError extends Error {
  constructor() {
    super('The customer has no dietary preference recorded.');
    this.name = 'DietaryPreferenceNotSetError';
  }
}

export class EligibilityNotRecordedError extends Error {
  constructor() {
    super('No eligible days are recorded for this customer and period.');
    this.name = 'EligibilityNotRecordedError';
  }
}

export class PeriodNotFoundError extends Error {
  constructor() {
    super('The requested ration period does not exist.');
    this.name = 'PeriodNotFoundError';
  }
}

export interface BasisRow {
  dietary_preference: DietaryPreference | null;
  eligible_days: number | null;
  fresh_eligible_days: number | null;
  dry_eligible_days: number | null;
  period_id: string | null;
  period_end: string | null;
}

/**
 * The basis, derived from the row the query returned.
 *
 * SEPARATED FROM THE QUERY ON PURPOSE. Every rule about what the stored
 * figures mean — which absences are fatal, when the legacy figure may
 * stand in, and that a missing per-type figure is never filled in from
 * anywhere — lives in this function, where it can be tested exhaustively
 * against every combination of three nullable columns without a database,
 * a migration or a Nest container. `resolveBasis` is then only a query.
 */
export function basisFromRow(row: BasisRow | undefined, customerId: string, periodId: string): EntitlementBasis {
  if (!row || !row.period_id) throw new PeriodNotFoundError();
  if (!row.dietary_preference) throw new DietaryPreferenceNotSetError();

  const legacy = row.eligible_days;
  const fresh = row.fresh_eligible_days;
  const dry = row.dry_eligible_days;

  /**
   * NOTHING AT ALL IS STILL AN ERROR.
   *
   * The error is raised only when the facility has published no figure of
   * any kind — no Fresh, no Dry, and no legacy figure either. That is
   * narrower than before on purpose: an officer with a Fresh figure and no
   * Dry figure used to be refused their whole ration, and now draws their
   * Fresh entitlement while the missing Dry figure is reported as missing.
   */
  if (legacy === null && fresh === null && dry === null) {
    throw new EligibilityNotRecordedError();
  }

  /**
   * THE PRE-0066 OFFICER, AND ONLY THEM.
   *
   * An officer with NEITHER per-type figure but a legacy figure predates
   * the per-ration-type sheets. For them the legacy figure IS the published
   * figure, so it stands in for both types and the calculation comes out
   * exactly as it did before this change — which is what keeps every
   * existing officer, and every existing test, unchanged.
   *
   * The fallback is deliberately all-or-nothing. The moment the facility
   * publishes EITHER per-type figure, that table is authoritative and a
   * type with no row means NOT PUBLISHED — it does not quietly inherit the
   * legacy number. Substituting a figure the facility did not publish for
   * this ration type is precisely the behaviour this change exists to
   * remove: a Fresh sheet of 10 days must never hand an officer 30 Dry days
   * because an old single figure said 30.
   */
  const legacyStandsIn = fresh === null && dry === null;

  return {
    customerId,
    periodId,
    dietaryPreference: row.dietary_preference,
    eligibleDays: legacy ?? 0,
    freshEligibleDays: legacyStandsIn ? legacy : fresh,
    dryEligibleDays: legacyStandsIn ? legacy : dry,
    asOf: row.period_end ?? new Date().toISOString().slice(0, 10),
  };
}

@Injectable()
export class RikEligibilityService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Resolve the calculation basis for a customer and period.
   *
   * `asOf` is taken from the period's own end date when one exists, so a
   * calculation for a past period resolves the configuration that was in
   * force then rather than whatever is active today.
   *
   * ONE ROUND TRIP, THREE SOURCES. The dietary preference, the legacy
   * figure and the two per-ration-type figures are read together. The
   * per-type figures come from a LATERAL subquery whose aggregate always
   * produces exactly one row, so joining it `ON true` can never drop the
   * period row and can never turn a missing figure into anything but
   * NULL.
   */
  async resolveBasis(customerId: string, periodId: string, client?: PoolClient): Promise<EntitlementBasis> {
    const sql = `
      SELECT c.dietary_preference,
             e.eligible_days,
             r.fresh_eligible_days,
             r.dry_eligible_days,
             p.id::text     AS period_id,
             p.end_date::text AS period_end
        FROM rik.entitlement_periods p
        LEFT JOIN shared.customers c ON c.id = $1
        LEFT JOIN rik.customer_period_eligibility e
               ON e.customer_id = $1 AND e.period_id = p.id
        LEFT JOIN LATERAL (
          SELECT max(eligible_days) FILTER (WHERE ration_type = 'FRESH') AS fresh_eligible_days,
                 max(eligible_days) FILTER (WHERE ration_type = 'DRY')   AS dry_eligible_days
            FROM rik.customer_period_ration_eligibility
           WHERE customer_id = $1 AND period_id = p.id
        ) r ON true
       WHERE p.id = $2`;

    const rows = client
      ? (await client.query<BasisRow>(sql, [customerId, periodId])).rows
      : await this.db.query<BasisRow>(sql, [customerId, periodId]);

    return basisFromRow(rows[0], customerId, periodId);
  }

  /**
   * May this provision be offered to this customer?
   *
   * Pure configuration: nothing here knows what the provision is called.
   * `poolApplies` is passed in because applicability of the pool itself
   * is decided by the presence of a scale, which the entitlement service
   * resolves.
   *
   * `eligibleDays` IS PASSED IN, NOT READ FROM THE BASIS. It is the figure
   * for the ration type of the pool this provision belongs to, which the
   * caller already has in hand. Taking it as an argument is what stops
   * this method from silently using one officer's Fresh days to judge a
   * Dry provision — the compiler now requires the caller to say which
   * figure applies. null means the figure is not published, and nothing
   * may be offered against a figure that does not exist.
   */
  isProvisionAvailable(
    provision: ProvisionRecord,
    basis: EntitlementBasis,
    poolApplies: boolean,
    eligibleDays: number | null,
    options: { requireCustomerSelectable?: boolean } = {}
  ): boolean {
    const { requireCustomerSelectable = true } = options;

    if (!poolApplies) return false;
    if (eligibleDays === null) return false;
    if (requireCustomerSelectable && !provision.is_customer_selectable) return false;
    if (provision.dietary_preference !== null && provision.dietary_preference !== basis.dietaryPreference) {
      return false;
    }
    if (provision.min_eligible_days !== null && eligibleDays < provision.min_eligible_days) {
      return false;
    }
    return true;
  }

  /** Why a provision was refused — for validation messages that explain themselves. */
  unavailableReason(
    provision: ProvisionRecord,
    basis: EntitlementBasis,
    poolApplies: boolean,
    eligibleDays: number | null
  ): string | null {
    if (!poolApplies) {
      return 'This entitlement does not apply to your dietary preference.';
    }
    /**
     * NOT PUBLISHED IS SAID AS NOT PUBLISHED. An officer whose sheet has
     * not arrived is told their figure is awaited — never that they have
     * run out of days, and never shown a figure nobody published.
     */
    if (eligibleDays === null) {
      return 'Your eligible days for this ration category have not been published yet. Please contact the RIK office.';
    }
    if (!provision.is_customer_selectable) {
      return 'This provision is issued at the counter and cannot be selected here.';
    }
    if (provision.dietary_preference !== null && provision.dietary_preference !== basis.dietaryPreference) {
      return 'This provision does not apply to your dietary preference.';
    }
    if (provision.min_eligible_days !== null && eligibleDays < provision.min_eligible_days) {
      return `This provision requires at least ${provision.min_eligible_days} eligible days; you have ${eligibleDays}.`;
    }
    return null;
  }
}
