/**
 * Thrown by DatabaseService instead of ever letting a raw `pg` error
 * (or anything derived from it) propagate up to a controller. A raw pg
 * error can carry the failing SQL text, a `detail`/`hint` that quotes
 * column values, or (on a connection failure) the target host/port —
 * none of that belongs in an HTTP response or a customer-facing
 * message (STEP 5 requirement 8 / STEP 8's error-envelope rule).
 *
 * The full original error (message, stack, and any pg-specific fields)
 * is always logged server-side via Nest's Logger before this is
 * thrown — see DatabaseService's private `logAndWrap`. Nothing about
 * the connection string (host, port, database name, credentials) is
 * ever included in `safeMessage` or in what gets logged; only a fixed,
 * generic diagnostic label is used.
 */
export class SafeDatabaseError extends Error {
  constructor(public readonly safeMessage: string) {
    super(safeMessage);
    this.name = 'SafeDatabaseError';
  }
}
