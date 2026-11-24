import { Client } from 'pg';

/**
 * Serialises the RIK specs that need to own "the current ration period".
 *
 * WHY THIS EXISTS.
 *
 * `rik.entitlement_periods` carries a GLOBAL exclusion constraint on
 * its date range (`rik_ent_periods_no_overlap`): no two periods may
 * overlap, ever, for anybody. That is correct — two ration periods
 * covering the same day would make "which period is this?" ambiguous.
 *
 * But it makes the period containing TODAY a single, exclusive
 * resource, and more than one spec needs it: every route that resolves
 * the current period (`/rik/selections/*`, `/rik/entitlements/validate`)
 * can only be exercised when a period covering today exists. Jest runs
 * spec files in parallel, so without this the second one to start would
 * fail its insert — not because anything is wrong, but because the
 * other was mid-run.
 *
 * A PostgreSQL advisory lock is the right primitive: it is held for the
 * life of a CONNECTION, costs nothing, and is released automatically if
 * the process dies, so an aborted run cannot wedge the next one.
 *
 * WHY ITS OWN CONNECTION, not DatabaseService.
 *
 * Session-level advisory locks belong to the connection that took them.
 * DatabaseService runs on a pool, so `pg_advisory_lock` and
 * `pg_advisory_unlock` issued through it could land on different
 * connections and the unlock would silently do nothing. Holding one
 * dedicated client for the spec's duration is what makes the lock mean
 * what it says.
 *
 * This is test infrastructure only. Nothing in the application takes
 * this lock, and no application behaviour depends on it.
 */

/** An arbitrary but fixed key. Only these specs use it. */
const CURRENT_PERIOD_LOCK_KEY = 1_105_011n;

export class CurrentPeriodLock {
  private constructor(private readonly client: Client) {}

  /**
   * Blocks until no other spec holds the current ration period.
   * Returns a handle whose `release()` must be called in `afterAll`.
   */
  static async acquire(): Promise<CurrentPeriodLock> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set; the RIK period lock cannot be taken.');
    }
    const client = new Client({ connectionString });
    await client.connect();
    await client.query('SELECT pg_advisory_lock($1)', [CURRENT_PERIOD_LOCK_KEY.toString()]);
    return new CurrentPeriodLock(client);
  }

  async release(): Promise<void> {
    try {
      await this.client.query('SELECT pg_advisory_unlock($1)', [CURRENT_PERIOD_LOCK_KEY.toString()]);
    } finally {
      // Ending the connection releases the lock regardless, which is
      // what makes an aborted run harmless.
      await this.client.end();
    }
  }
}
