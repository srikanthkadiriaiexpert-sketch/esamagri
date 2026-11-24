import type { DatabaseService } from '../../database/database.service';

/**
 * TEST SEEDING for `rik.customer_period_ration_eligibility` (migration 0066).
 *
 * WHY A HELPER AND NOT AN INSERT IN EACH SPEC.
 *
 * That table is write-protected. `rik_cpre_protect_value` fires BEFORE INSERT
 * OR UPDATE OF eligible_days and refuses the write — for every role including
 * the owner — unless the transaction-local setting
 * `rik.in_eligibility_adjustment` is 'on'. In production the only thing that
 * turns it on is `rik.trg_apply_eligibility_adjustment`, which the facility
 * reaches by inserting an audited `rik.eligibility_adjustments` row carrying
 * the previous value, the delta, a reason and the staff member who made it.
 *
 * A test seed must not go that way. Writing an adjustment row would mean
 * inventing a staff member and a reason, and planting a row in the audit
 * history that says a correction was made which nobody made. False audit
 * records are worse in a test database than an obvious seed, because they are
 * indistinguishable from real ones when someone later reads the history.
 *
 * So this seed declares itself: it sets the same transaction-local flag the
 * apply trigger sets, inside one transaction, writes the figure, and clears
 * the flag. `set_config(..., true)` scopes it to the transaction, so it cannot
 * leak onto a later request on the same pooled connection. Nothing here is
 * exported to or reachable from application code — this module lives under
 * `test-support` and is imported only by `*.integration.spec.ts`.
 *
 * THE FACILITY'S MAXIMUMS BIND THIS SEED TOO. `rik_cpre_caps_chk` allows
 * FRESH 0-30 and DRY 0-60. A suite that deliberately works with more than 30
 * eligible days has no legal Fresh row to write, so `seedBothRationTypes`
 * writes NEITHER row for such a figure and leaves that officer-period on the
 * pre-0066 fallback, where the legacy figure stands in for both types. That is
 * a real supported state, not a gap in the seed — see `basisFromRow`.
 */

export const FRESH_MAX_DAYS = 30;
export const DRY_MAX_DAYS = 60;

/**
 * Write one ration type's figure, through the guard.
 *
 * `ON CONFLICT DO NOTHING` so a suite that seeds the same officer-period twice
 * is idempotent, and so an already-published figure is never overwritten by a
 * seed — if a figure is there, the test that put it there owns it.
 */
export async function seedRationEligibility(
  db: DatabaseService,
  customerId: string,
  periodId: string,
  rationType: 'FRESH' | 'DRY',
  eligibleDays: number
): Promise<void> {
  const max = rationType === 'FRESH' ? FRESH_MAX_DAYS : DRY_MAX_DAYS;
  if (!Number.isInteger(eligibleDays) || eligibleDays < 0 || eligibleDays > max) {
    throw new Error(
      `seedRationEligibility: ${rationType} eligible days must be an integer between 0 and ${max}; got ${eligibleDays}. ` +
        'rik_cpre_caps_chk would refuse this row.'
    );
  }

  await db.withTransaction(async (client) => {
    await client.query(`SELECT set_config('rik.in_eligibility_adjustment', 'on', true)`);
    await client.query(
      `INSERT INTO rik.customer_period_ration_eligibility
         (customer_id, period_id, ration_type, eligible_days, notes)
       VALUES ($1, $2, $3, $4, 'Seeded by the integration suite.')
       ON CONFLICT (customer_id, period_id, ration_type) DO NOTHING`,
      [customerId, periodId, rationType, eligibleDays]
    );
    await client.query(`SELECT set_config('rik.in_eligibility_adjustment', 'off', true)`);
  });
}

/**
 * Seed BOTH figures to the same number — the shape almost every suite wants.
 *
 * Seeding both to the figure the suite's legacy row already carries is what
 * keeps every existing quantity assertion true: the Fresh and Dry totals come
 * out exactly as they did when one figure drove both. What changes is the path
 * — the engine is exercised reading the per-ration-type table, which is what
 * production does, instead of the pre-0066 fallback.
 *
 * Returns false, having written nothing, when the figure exceeds the Fresh
 * maximum. See the module comment.
 */
export async function seedBothRationTypes(
  db: DatabaseService,
  customerId: string,
  periodId: string,
  eligibleDays: number
): Promise<boolean> {
  if (eligibleDays > FRESH_MAX_DAYS) return false;
  await seedRationEligibility(db, customerId, periodId, 'FRESH', eligibleDays);
  await seedRationEligibility(db, customerId, periodId, 'DRY', eligibleDays);
  return true;
}

/**
 * Remove every seeded figure for these periods.
 *
 * NOT OPTIONAL IN TEARDOWN. `rik_cpre_period_fk` references
 * `rik.entitlement_periods(id)`, so a suite that deletes its periods while a
 * figure still points at one fails on the foreign key — and reports it as a
 * teardown error that looks nothing like its cause. Every suite that seeds
 * must call this before it deletes its periods.
 *
 * DELETE is not guarded: `rik_cpre_protect_value` fires on INSERT and UPDATE
 * only, because removing a figure returns it to "not published", which is the
 * absence of a value rather than a change to one.
 */
export async function clearRationEligibilityForPeriods(
  db: DatabaseService,
  periodIds: readonly string[]
): Promise<void> {
  if (periodIds.length === 0) return;
  await db.query(
    `DELETE FROM rik.customer_period_ration_eligibility WHERE period_id = ANY($1::uuid[])`,
    [periodIds]
  );
}

/** The same, keyed by officer — for a suite that tears down by customer. */
export async function clearRationEligibilityForCustomers(
  db: DatabaseService,
  customerIds: readonly string[]
): Promise<void> {
  if (customerIds.length === 0) return;
  await db.query(
    `DELETE FROM rik.customer_period_ration_eligibility WHERE customer_id = ANY($1::uuid[])`,
    [customerIds]
  );
}
