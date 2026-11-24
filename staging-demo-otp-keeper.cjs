/**
 * e-Samagri — CONTROLLED DEMO OTP REHEARSAL.  STAGING ONLY.
 *
 * Revision 2, 30 October 2026. Revision 1 is preserved at
 * C:\esamagri\backups\staging-demo-otp-keeper-before-rehearse-2026-10-30.bak
 *
 * WHAT CHANGED FROM REVISION 1, AND WHY. Revision 1 rewrote EVERY
 * unconsumed LOGIN request for the authorised number, however old. An
 * expired request still satisfies `consumed_at IS NULL`, so it matched —
 * and because the expiry was set with GREATEST(expires_at, now() + 15
 * min), an expired request was brought back to life. Harmless for a
 * fictional demo number, but it is not what a rehearsal should do: the
 * sign-in could then succeed against yesterday's record and prove
 * nothing about the live path. Revision 2 adds two conditions —
 * `expires_at > now()` and `created_at >= <this process's start>` — so
 * an existing record cannot be touched at all, and removes the old
 * open-ended `watch` and `once` modes so that guarantee is structural
 * rather than a matter of which argument you pass.
 *
 * WHAT IT DOES
 *   1. refuses to run unless the database SERVER reports itself as
 *      esamagri_staging;
 *   2. records its start time FROM THE DATABASE CLOCK;
 *   3. reports the authorised accounts and the pre-existing requests it
 *      will not touch;
 *   4. waits, doing nothing, until a NEW request appears;
 *   5. stamps exactly ONE record — the newest eligible one, which is the
 *      same one the API itself will read — then exits;
 *   6. if nothing appears within ten minutes, exits having changed
 *      nothing whatsoever.
 *
 * WHAT IT CANNOT DO
 *   - no SMS and no network request of any kind: the only modules it
 *     loads are fs, path, node:crypto and pg, so there is no code path
 *     to 2Factor or anywhere else, and no credit can be consumed;
 *   - it touches ONLY the numbers in AUTHORISED_DEMO_NUMBERS. Every
 *     statement is parameterised on that list;
 *   - it contains no INSERT, DELETE, TRUNCATE, DROP, ALTER or CREATE.
 *     The single write is the UPDATE below;
 *   - shared.customers is READ ONLY here. No customer can be modified;
 *   - no rik.* or pif.* table is referenced at all, so entitlements,
 *     ratios, pack sizes, dietary rules and eligibility are out of
 *     reach;
 *   - it changes no authentication rule. Expiry, the attempt ceiling,
 *     single use via consumed_at, the hourly request limit and the
 *     hash-and-compare path are exactly as the API defines them. A
 *     number outside the authorised list goes through entirely normal
 *     authentication and this process is irrelevant to it.
 *
 * WHY THE CODE IS WRITTEN AS A HASH. The API stores only
 * HMAC-SHA256(OTP_HASH_PEPPER, code). This computes the same hash with
 * the same pepper from the same configuration file, so what it writes is
 * indistinguishable from what the API would have written. The plaintext
 * code is never stored.
 *
 *   node staging-demo-otp-keeper.cjs           rehearse: wait, stamp once, exit
 *   node staging-demo-otp-keeper.cjs status    report only, change nothing
 */
const fs = require('fs');
const path = require('path');
const { createHmac, createHash } = require('node:crypto');

const ROOT = __dirname;
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

// ---------------------------------------------------------------------------
// The authorisation list. Adding a number here is a deliberate act and the
// ONLY way this tool can affect an account.
// ---------------------------------------------------------------------------
const AUTHORISED_DEMO_NUMBERS = ['+919000000001'];
const DEMO_CODE = '123456';

const REQUIRED_DATABASE = 'esamagri_staging';
const FORBIDDEN_DATABASE = 'esamagri_demo';
const WAIT_TIMEOUT_MS = 10 * 60 * 1000; // ten minutes, then exit cleanly
const POLL_MS = 1000;
const LOG_FILE = path.join('C:\\esamagri\\Claude outputs', 'demo-otp-keeper.log');

const mode = process.argv[2] || 'rehearse';

function say(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(LOG_FILE, text + '\r\n', 'utf8');
  } catch {
    /* a missing log directory must not stop the rehearsal */
  }
}
/** Short non-reversible tag, matching the API's own audit scheme. */
function tag(mobile) {
  return createHash('sha256').update(mobile).digest('hex').slice(0, 16);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- configuration ---------------------------------------------------------
let env;
try {
  const text = fs.readFileSync(path.join(ROOT, 'apps', 'api', '.env'), 'utf8');
  env = Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  );
} catch {
  say('STOP: cannot read apps/api/.env. Nothing changed.');
  process.exit(2);
}

const CONNECTION = env.DATABASE_URL;
const PEPPER = env.OTP_HASH_PEPPER;

if (!CONNECTION || !PEPPER) {
  say('STOP: DATABASE_URL or OTP_HASH_PEPPER is missing from apps/api/.env. Nothing changed.');
  process.exit(2);
}

// First, cheap check from the configuration text. The authoritative one is
// made against the server itself, below.
const configuredDb = CONNECTION.slice(CONNECTION.lastIndexOf('/') + 1);
if (configuredDb === FORBIDDEN_DATABASE) {
  say(`STOP: apps/api/.env points at ${FORBIDDEN_DATABASE}. Refusing to run. Nothing changed.`);
  process.exit(3);
}

const wantedHash = createHmac('sha256', PEPPER).update(DEMO_CODE).digest('hex');

// ---------------------------------------------------------------------------
// The ONLY write in this file.
//
// It targets exactly one row: the newest request that is for an authorised
// number, is a LOGIN request, is unconsumed, is NOT YET EXPIRED, and was
// created at or after this process started. Choosing it with ORDER BY
// created_at DESC LIMIT 1 is deliberate — it is the same row
// OtpRequestsRepository.findLatestActiveForUpdate will read, so the record
// stamped is the record the API will actually check.
//
// `created_at >= $3` is what makes "never touch an existing record" true,
// and `expires_at > now()` is what makes "never resurrect an expired one"
// true. With that second condition in place, GREATEST can only EXTEND the
// life of an already-live request, never revive a dead one.
// ---------------------------------------------------------------------------
const STAMP_SQL = `
  UPDATE shared.otp_requests AS o
     SET otp_hash      = $2,
         expires_at    = GREATEST(o.expires_at, now() + interval '15 minutes'),
         attempt_count = 0
   WHERE o.id = (
           SELECT c.id
             FROM shared.otp_requests AS c
            WHERE c.mobile_number = ANY($1::text[])
              AND c.purpose       = 'LOGIN'
              AND c.consumed_at IS NULL
              AND c.expires_at    > now()
              AND c.created_at   >= $3
            ORDER BY c.created_at DESC
            LIMIT 1
         )
     AND o.otp_hash IS DISTINCT FROM $2
  RETURNING o.id, o.created_at, o.expires_at`;

(async () => {
  const client = new Client({ connectionString: CONNECTION });
  try {
    await client.connect();
  } catch {
    say('STOP: could not connect to the staging database. Nothing changed.');
    process.exit(2);
  }

  // --- the authoritative guard: ask the SERVER which database this is -----
  const who = await client.query('SELECT current_database() AS db, now() AS server_now');
  const actualDb = who.rows[0].db;
  // The start time comes from the DATABASE clock, not this process's clock,
  // so a skew between the two cannot let an older record qualify.
  const startedAt = who.rows[0].server_now;

  say(`connected database: ${actualDb}`);
  if (actualDb !== REQUIRED_DATABASE) {
    say(`STOP: expected ${REQUIRED_DATABASE}. Refusing to run. Nothing changed.`);
    await client.end();
    process.exit(3);
  }
  say(`database clock at start: ${startedAt.toISOString()}`);

  // --- the authorised accounts (read-only) --------------------------------
  const accounts = await client.query(
    `SELECT mobile_number, is_active, (deleted_at IS NULL) AS present
       FROM shared.customers
      WHERE mobile_number = ANY($1::text[])`,
    [AUTHORISED_DEMO_NUMBERS]
  );
  for (const number of AUTHORISED_DEMO_NUMBERS) {
    const row = accounts.rows.find((r) => r.mobile_number === number);
    if (!row) {
      say(`WARNING authorised account ${tag(number)} does NOT exist in ${actualDb}; sign-in will fail for it`);
    } else if (!row.is_active || !row.present) {
      say(`WARNING authorised account ${tag(number)} exists but is inactive or deleted; sign-in will fail`);
    } else {
      say(`authorised account ${tag(number)} is present and active`);
    }
  }

  // --- what already exists, and is therefore protected --------------------
  const existing = await client.query(
    `SELECT count(*)::int                                        AS unconsumed,
            count(*) FILTER (WHERE expires_at <= now())::int     AS unconsumed_expired,
            count(*) FILTER (WHERE expires_at >  now())::int     AS unconsumed_live
       FROM shared.otp_requests
      WHERE mobile_number = ANY($1::text[])
        AND purpose = 'LOGIN'
        AND consumed_at IS NULL`,
    [AUTHORISED_DEMO_NUMBERS]
  );
  const e = existing.rows[0];
  say(
    `pre-existing unconsumed LOGIN requests: ${e.unconsumed} ` +
      `(${e.unconsumed_expired} expired, ${e.unconsumed_live} still live)`
  );
  say('NONE of those will be modified: the update requires created_at >= the start time above');

  if (mode === 'status') {
    const eligible = await client.query(
      `SELECT count(*)::int AS eligible_now
         FROM shared.otp_requests
        WHERE mobile_number = ANY($1::text[])
          AND purpose = 'LOGIN'
          AND consumed_at IS NULL
          AND expires_at  > now()
          AND created_at >= $2`,
      [AUTHORISED_DEMO_NUMBERS, startedAt]
    );
    say(`records eligible for stamping right now: ${eligible.rows[0].eligible_now} (expected 0 at startup)`);
    say('status mode: nothing was changed');
    await client.end();
    return;
  }

  if (mode !== 'rehearse') {
    say(`STOP: unknown mode "${mode}". Use no argument (rehearse) or "status". Nothing changed.`);
    await client.end();
    process.exit(2);
  }

  // --- wait for a NEW request, stamp it once, exit -------------------------
  say('');
  say('WAITING for a NEW one-time code request. Nothing has been changed yet.');
  say('  In the Customer App: enter 9000000001 and press Send OTP.');
  say(`  Giving up after ${WAIT_TIMEOUT_MS / 60000} minutes, changing nothing.`);
  say('');

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let ticks = 0;

  while (Date.now() < deadline) {
    ticks += 1;
    let result;
    try {
      result = await client.query(STAMP_SQL, [AUTHORISED_DEMO_NUMBERS, wantedHash, startedAt]);
    } catch {
      say('a query failed; retrying on the next tick (nothing was changed by the failed attempt)');
      await sleep(POLL_MS);
      continue;
    }

    if (result.rowCount > 0) {
      const row = result.rows[0];
      say('');
      say(`STAMPED one record after ${ticks} check(s).`);
      say(`  created : ${row.created_at.toISOString()}  (after the start time above)`);
      say(`  expires : ${row.expires_at.toISOString()}`);
      say(`  rows changed: ${result.rowCount} (exactly one, by construction)`);
      say('');
      say(`The Customer App will now accept ${DEMO_CODE} for the authorised demo number.`);
      say('Exiting. This process will NOT stamp anything else.');
      await client.end();
      return;
    }

    // Every 30 seconds, a quiet line so the window does not look stalled.
    if (ticks % 30 === 0) {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      say(`still waiting... ${left}s remaining, nothing changed`);
    }
    await sleep(POLL_MS);
  }

  say('');
  say(`TIMED OUT after ${WAIT_TIMEOUT_MS / 60000} minutes. No new request appeared.`);
  say('NOTHING WAS CHANGED. Run this again when you are ready to sign in.');
  await client.end();
})().catch(() => {
  say('rehearsal failed to start; nothing was changed');
  process.exit(1);
});
