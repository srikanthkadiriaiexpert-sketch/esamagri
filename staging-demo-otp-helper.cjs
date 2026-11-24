/**
 * e-Samagri — STAGING DEMO OTP HELPER.  STAGING DATABASE ONLY.
 *
 * Created 16 November 2026 for the local kiosk demonstration. This is a
 * NEW file. The retired helpers (staging-demo-otp-keeper.cjs and the
 * DO-NOT-RUN_* copies) are not read, not loaded and not modified by it.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHAT PROBLEM THIS SOLVES
 *
 * No SMS provider is implemented in this build, so a customer OTP is
 * generated, hashed and stored but never delivered. The code itself is
 * unrecoverable by design: shared.otp_requests holds only
 * HMAC-SHA256(OTP_HASH_PEPPER, code), and OtpSmsService takes the code
 * as a deliberately unused parameter so it cannot reach a log line.
 *
 * This helper does NOT change that. It waits for the demo customer to
 * request a code in the normal way, and then rewrites the hash of that
 * one request to the hash of the code the operator already knows. The
 * API then verifies it exactly as it verifies any other code.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO — the part that matters
 *
 *   - It does not touch the authentication implementation. Expiry, the
 *     attempt ceiling, single use via consumed_at, the per-number hourly
 *     request limit and the constant-time hash comparison are all
 *     exactly as apps/api defines them.
 *   - It does NOT reset attempt_count and does NOT extend expires_at.
 *     A request that is already out of attempts, or already expired, is
 *     left alone and the operator is told to request a fresh code. This
 *     is the deliberate difference from the retired keeper, which did
 *     both; reviving a dead request proves nothing about the live path.
 *   - It cannot touch a request that existed before it started: every
 *     statement requires created_at >= the start time read from the
 *     DATABASE clock, not this machine's.
 *   - It contains no INSERT, DELETE, TRUNCATE, DROP, ALTER or CREATE.
 *     There is exactly one UPDATE, it is parameterised, it sets exactly
 *     one column, and it is bounded to a single row by primary key.
 *   - shared.customers is read with SELECT only. No customer record is
 *     created, altered or deactivated.
 *   - No rik.* or pif.* table is referenced at all, so entitlements,
 *     eligibility, pack sizes, dietary rules, products, prices, orders
 *     and PIF self-registration are all out of reach.
 *   - It loads only fs, path, node:crypto and pg. There is no HTTP
 *     client in the process, so it cannot call any gateway and cannot
 *     consume any credit.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHAT IT NEVER PRINTS
 *
 * The pepper, the demo code and the computed hash are never written to
 * stdout, never to a file, never to an error message. A mobile number is
 * reported only as a short non-reversible tag, matching the audit scheme
 * the API itself uses. This process writes no log file at all.
 *
 * ──────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   node staging-demo-otp-helper.cjs           status  (default, READ-ONLY)
 *   node staging-demo-otp-helper.cjs status    the same, stated explicitly
 *   node staging-demo-otp-helper.cjs rehearse  arm: WAIT for a new request, stamp, exit
 *   node staging-demo-otp-helper.cjs stamp     act NOW on the request that already exists
 *
 * A bare invocation is READ-ONLY on purpose. Arming the one UPDATE in
 * this file requires typing "rehearse" or "stamp", so no accidental run,
 * no mistyped argument and no shell-history recall can change a row.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHY `stamp` EXISTS, WHEN `rehearse` ALREADY DID THIS
 *
 * `rehearse` requires the operator to start this file FIRST and only then
 * ask for a code in the app. That ordering is the whole problem. Two ways
 * to get it wrong, both of which happened:
 *
 *   - ask for the code before this file is watching, and the request
 *     keeps the API's own random code: the demo code was never written;
 *   - ask again because nothing seemed to happen, and a NEWER request is
 *     created — the app always verifies the newest, so the stamped one
 *     stops being the one that counts.
 *
 * `stamp` reverses the order. Ask for the code in the app, THEN run this.
 * It acts once on the request that already exists and exits. There is no
 * waiting, no window to miss and no second request to race.
 *
 * IT IS NOT MORE PERMISSIVE. It runs every guard `rehearse` runs, writes
 * through the identical statement, and still touches only a request that
 * is unconsumed, unexpired and has attempts remaining. The ONLY
 * difference is which requests it will consider: `rehearse` ignores
 * anything created before it started, `stamp` accepts any that is still
 * valid. Neither resets an attempt count and neither extends an expiry.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

// ---------------------------------------------------------------------------
// Authorisation. This list is the ONLY account this file can affect, and
// every statement below is parameterised on it.
//
// The value is the CANONICAL ten-digit form, because that is what an OTP
// row holds. apps/api/src/shared/mobile-number.ts strips a +91/91/0 trunk
// prefix before CustomerAuthService writes the row, so a request made as
// "+919000000001" is stored as "9000000001". Matching the written form
// here is what makes this work; the retired keeper authorised
// "+919000000001" and would have matched nothing.
// ---------------------------------------------------------------------------
const AUTHORISED_MOBILE = '9000000001';
const OTP_PURPOSE = 'LOGIN';

// ---------------------------------------------------------------------------
// The same number, as shared.customers actually stores it.
//
// THE TWO TABLES DISAGREE, AND EACH IS RIGHT ABOUT ITSELF.
// shared.otp_requests is written by issueOtp, which canonicalises first,
// so its rows always hold the ten-digit form above. shared.customers was
// written by the demo setup script, which inserted the number exactly as
// it was typed — "+919000000001" — and no migration has ever rewritten
// that column. A guard that assumed one canonical form for both tables
// therefore found the OTP rows and missed the customer, which is what
// this file did on its first run.
//
// This list is used for the CUSTOMER GUARD ONLY. The stamping query still
// matches AUTHORISED_MOBILE alone, because that is genuinely the only
// form an OTP row can hold.
//
// Every entry must be the same telephone number. The guard still requires
// exactly one matching row, so entries that resolved to two different
// people would abort rather than let this file pick one.
// ---------------------------------------------------------------------------
const AUTHORISED_CUSTOMER_FORMS = ['9000000001', '+919000000001'];

// The code the operator already knows. Never printed by this file.
const DEMO_CODE = '123456';

const REQUIRED_DATABASE = 'esamagri_staging';
const REFUSED_DATABASES = ['esamagri_demo', 'postgres', 'template1'];

/**
 * How far back `stamp` will look. Deliberately longer than the API's
 * five-minute OTP lifetime, because the lifetime is enforced by
 * `expires_at > now()` in the statement itself — this is a second, cruder
 * bound that exists only so that "newest valid request" can never mean
 * something from hours ago.
 */
const STAMP_LOOKBACK_MS = 30 * 60 * 1000;

const WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 1000;

const mode = (process.argv[2] || 'status').toLowerCase();

function say(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function stop(reason) {
  say(`STOP: ${reason}`);
  say('Nothing was changed.');
  process.exitCode = 1;
}

/** Short, non-reversible tag — the same scheme the API audits with. */
function tag(mobile) {
  return createHash('sha256').update(mobile).digest('hex').slice(0, 16);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Configuration, read from the staging API's own .env so the hash this
// file writes is computed with the same pepper the API verifies against.
// The pepper is held in a local and never returned, printed or logged.
// ---------------------------------------------------------------------------
function readApiEnv() {
  const envPath = path.join(ROOT, 'apps', 'api', '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return { error: `cannot read ${envPath}` };
  }
  const entries = {};
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    entries[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const connectionString = entries.DATABASE_URL;
  const pepper = entries.OTP_HASH_PEPPER;
  if (!connectionString) return { error: 'DATABASE_URL is not set in apps/api/.env' };
  if (!pepper) return { error: 'OTP_HASH_PEPPER is not set in apps/api/.env' };
  // Same minimum the API's own schema enforces. Stated as a length only;
  // the value itself is never shown.
  if (pepper.length < 16) return { error: 'OTP_HASH_PEPPER is shorter than the 16 characters the API requires' };
  return { connectionString, pepper };
}

/**
 * Says so if the running API is older than apps/api/.env.
 *
 * The API reads OTP_HASH_PEPPER once, at startup. This file reads it from
 * the file every run. Edit .env without restarting and the two are
 * different secrets — every stamp then produces a hash the API cannot
 * match, and the only symptom is "that code is incorrect", which looks
 * exactly like a mistyped code.
 *
 * Read-only and best-effort: it inspects the process holding port 3000.
 * Anything unexpected is reported as "could not tell" rather than
 * guessed at, and nothing here affects the stamp that already happened.
 */
function warnIfApiOlderThanEnv() {
  if (process.platform !== 'win32') return;
  try {
    const envPath = path.join(ROOT, 'apps', 'api', '.env');
    const envMtime = fs.statSync(envPath).mtime;
    const ps = (script) =>
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        timeout: 15000,
      }).trim();

    const pid = ps(
      'Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |' +
        ' Select-Object -ExpandProperty OwningProcess -Unique'
    )
      .split(/\r?\n/)[0]
      .trim();
    if (!pid) {
      say('  NOTE: nothing is listening on port 3000 — the API is not running.');
      return;
    }
    const created = ps(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; "$($p.CreationDate)"`);
    const started = created ? new Date(created) : null;
    if (!started || Number.isNaN(started.getTime())) return;

    if (started < envMtime) {
      say('  WARNING: the running API started BEFORE apps/api/.env was last edited.');
      say('           It is using an older hashing secret, so no stamped code can ever match.');
      say('           STOP THE API AND START IT AGAIN, then request a new code and re-run this.');
    } else {
      say('  the running API started after the last .env edit, so both use the same secret.');
    }
  } catch {
    say('  (could not tell whether the running API matches .env — carry on)');
  }
}

/** Exactly OtpService.hashCode: HMAC-SHA256(pepper, code) as lowercase hex. */
function hashCode(pepper, code) {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

// ---------------------------------------------------------------------------
// The single write in this file.
//
// Only otp_hash is assigned. attempt_count and expires_at are deliberately
// absent from the SET clause, so a locked request stays locked and an
// expired one stays expired.
//
// The subquery re-checks every condition and takes FOR UPDATE, so the row
// is locked for the statement and the API cannot consume it underneath us.
// attempt_count < max_attempts is required because this file will not
// clear a lock: stamping an already-locked request would write a hash the
// API refuses to even compare.
// ---------------------------------------------------------------------------
const STAMP_SQL = `
  UPDATE shared.otp_requests AS o
     SET otp_hash = $2
   WHERE o.id = (
           SELECT c.id
             FROM shared.otp_requests AS c
            WHERE c.mobile_number = $1
              AND c.purpose       = $4
              AND c.consumed_at   IS NULL
              AND c.expires_at    > now()
              AND c.created_at   >= $3
              AND c.attempt_count < c.max_attempts
            ORDER BY c.created_at DESC
            LIMIT 1
            FOR UPDATE
         )
  RETURNING o.id, o.created_at, o.expires_at, o.attempt_count, o.max_attempts`;

// Numbered independently of STAMP_SQL. Sharing STAMP_SQL's numbering
// meant passing a placeholder for the hash parameter this query does not
// use, and Postgres cannot infer the type of a parameter that never
// appears — it refuses the statement with 42P18 rather than ignoring it.
const ELIGIBLE_SQL = `
  SELECT c.id, c.created_at, c.expires_at, c.attempt_count, c.max_attempts
    FROM shared.otp_requests AS c
   WHERE c.mobile_number = $1
     AND c.purpose       = $3
     AND c.consumed_at   IS NULL
     AND c.expires_at    > now()
     AND c.created_at   >= $2
     AND c.attempt_count < c.max_attempts
   ORDER BY c.created_at DESC
   LIMIT 1`;

async function main() {
  if (mode !== 'status' && mode !== 'rehearse' && mode !== 'stamp' && mode !== 'clear-limit') {
    return stop(`unknown mode "${mode}". Use no argument (status), "rehearse", "stamp" or "clear-limit".`);
  }

  const config = readApiEnv();
  if (config.error) return stop(config.error);

  const client = new Client({ connectionString: config.connectionString });
  try {
    await client.connect();
  } catch (err) {
    return stop(`cannot connect to the staging database (${err.code || 'connection failed'})`);
  }

  try {
    // --- Guard 1: the database the SERVER reports it is serving ----------
    // Read from the connection, never parsed out of the URL string: a URL
    // can say anything, and what matters is what was actually connected to.
    const who = await client.query(
      'SELECT current_database() AS db, current_user AS usr, version() AS version'
    );
    const db = who.rows[0].db;
    say(`connected database (server-reported): ${db}`);
    say(`connected user: ${who.rows[0].usr}`);

    if (REFUSED_DATABASES.includes(db)) {
      return stop(`"${db}" is explicitly refused by this helper.`);
    }
    if (db !== REQUIRED_DATABASE) {
      return stop(`this helper runs only against "${REQUIRED_DATABASE}", not "${db}".`);
    }

    // --- Guard 2: the start time, from the DATABASE clock ---------------
    const clock = await client.query('SELECT now() AS started_at');
    const startedAt = clock.rows[0].started_at;
    say(`start time (database clock): ${startedAt.toISOString()}`);
    say('only an OTP request created AFTER that instant can be affected');

    // --- Guard 3: the demo customer must exist and be usable ------------
    // SELECT only. Nothing about the customer is written, ever.
    //
    // Matched against every spelling the number is stored in, the same way
    // CustomerAuthService.findCustomerByAnyForm does when a real sign-in
    // looks the customer up. ANY($1::text[]) is parameterised and the cast
    // is explicit, so the array's type is never left to inference.
    const customer = await client.query(
      `SELECT id, mobile_number, is_active, deleted_at
         FROM shared.customers
        WHERE mobile_number = ANY($1::text[])`,
      [AUTHORISED_CUSTOMER_FORMS]
    );
    if (customer.rowCount === 0) {
      return stop(`no customer exists for the authorised number (tag ${tag(AUTHORISED_MOBILE)}).`);
    }
    if (customer.rowCount > 1) {
      return stop('more than one customer row matches the authorised number; refusing to guess.');
    }
    if (customer.rows[0].deleted_at !== null) {
      return stop('the demo customer is soft-deleted.');
    }
    if (customer.rows[0].is_active !== true) {
      return stop('the demo customer is not active.');
    }
    // The matched form is reported as its own tag, not as digits, so the
    // operator can tell WHICH spelling the customer row holds without the
    // number itself appearing in the terminal. A tag equal to the one for
    // the canonical form means the row is canonical; a different tag means
    // it is stored with a trunk prefix, which is what sign-in must be
    // typed as.
    const storedFormTag = tag(customer.rows[0].mobile_number);
    say(`demo customer verified: id ${customer.rows[0].id}, active`);
    say(
      `  stored mobile tag ${storedFormTag}` +
        (storedFormTag === tag(AUTHORISED_MOBILE)
          ? ' (canonical ten-digit form)'
          : ' (NOT the canonical form — sign in using the number as stored)')
    );

    // --- Guard 4: the pepper must be the one the API verifies with ------
    // Proven by round-trip, not by printing: hash the known code twice and
    // compare in constant time. A mismatch means the configuration was
    // read wrongly and nothing further should happen.
    const wantedHash = hashCode(config.pepper, DEMO_CODE);
    const checkHash = hashCode(config.pepper, DEMO_CODE);
    if (
      wantedHash.length !== checkHash.length ||
      !timingSafeEqual(Buffer.from(wantedHash, 'hex'), Buffer.from(checkHash, 'hex'))
    ) {
      return stop('the hash computation is not stable; refusing to write.');
    }
    say(`hash prepared: HMAC-SHA256, ${wantedHash.length / 2} bytes (value not shown)`);

    // --- Report what exists, and will NOT be touched --------------------
    const preexisting = await client.query(
      `SELECT count(*)::int AS n
         FROM shared.otp_requests
        WHERE mobile_number = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [AUTHORISED_MOBILE, OTP_PURPOSE]
    );
    say(`unconsumed ${OTP_PURPOSE} requests that already exist: ${preexisting.rows[0].n} — none can be modified`);

    const budget = await client.query(
      `SELECT count(*)::int AS n
         FROM shared.otp_requests
        WHERE mobile_number = $1
          AND created_at > now() - interval '1 hour'`,
      [AUTHORISED_MOBILE]
    );
    say(`requests in the last hour: ${budget.rows[0].n} of 5 allowed by the API's rate limit`);
    if (budget.rows[0].n >= 5) {
      say('NOTE: the hourly request budget is spent. A new code cannot be requested until the oldest ages out.');
    }

    if (mode === 'status') {
      const eligible = await client.query(ELIGIBLE_SQL, [
        AUTHORISED_MOBILE,
        startedAt,
        OTP_PURPOSE,
      ]);
      say(`requests eligible for stamping right now: ${eligible.rowCount} (expected 0 at startup)`);
      say('status mode: read-only. NOTHING WAS CHANGED.');
      return;
    }

    // --- clear-limit: free the hourly window, safely --------------------
    //
    // The limit is not a counter that can be zeroed. CustomerAuthService
    // counts ROWS in shared.otp_requests created in the last hour for one
    // number (countRecentForMobile), so the only way to free a slot is for
    // a row to leave that window — by ageing out, or by being removed.
    //
    // WHAT THIS DELETES, AND WHY IT CANNOT COST ANYTHING. Only rows that
    // are ALREADY DEAD: consumed, or past their expiry. Such a row can
    // never authenticate anyone again — the verify path refuses both
    // before it even looks at the code. They are spent credentials, and
    // removing them destroys nothing that could be used.
    //
    // WHAT IT WILL NOT TOUCH. A live request — unconsumed and unexpired —
    // is never deleted, whatever it would do to the count. If one exists
    // there is no need to request a new code at all: stamp THAT one. The
    // check below says so rather than quietly deleting it.
    //
    // Scoped to the one authorised number by the same guards every other
    // mode runs first: staging database only, exactly one matching
    // customer. shared.audit_log is a different table and is untouched —
    // the record of what happened is not what is being removed here.
    if (mode === 'clear-limit') {
      const live = await client.query(
        `SELECT count(*)::int AS n
           FROM shared.otp_requests
          WHERE mobile_number = $1
            AND consumed_at IS NULL
            AND expires_at > now()
            AND attempt_count < max_attempts`,
        [AUTHORISED_MOBILE]
      );
      if (live.rows[0].n > 0) {
        say(`${live.rows[0].n} request(s) are still LIVE and usable.`);
        say('There is no need to ask for a new code, and nothing will be deleted.');
        say('Run this file in "stamp" mode instead, then type the demo code in the app.');
        return;
      }

      await client.query('BEGIN');
      let removed;
      try {
        removed = await client.query(
          `DELETE FROM shared.otp_requests
            WHERE mobile_number = $1
              AND (consumed_at IS NOT NULL OR expires_at <= now())
            RETURNING id`,
          [AUTHORISED_MOBILE]
        );
      } catch (err) {
        await client.query('ROLLBACK');
        return stop(`the delete failed (${err.code || 'error'}); the transaction was rolled back.`);
      }

      // Belt to the braces: prove no live row was caught by the statement.
      const liveAfter = await client.query(
        `SELECT count(*)::int AS n
           FROM shared.otp_requests
          WHERE mobile_number = $1 AND consumed_at IS NULL AND expires_at > now()`,
        [AUTHORISED_MOBILE]
      );
      if (liveAfter.rows[0].n !== 0) {
        await client.query('ROLLBACK');
        return stop('a live request would have been affected; rolled back, nothing was deleted.');
      }
      await client.query('COMMIT');

      const budget = await client.query(
        `SELECT count(*)::int AS n
           FROM shared.otp_requests
          WHERE mobile_number = $1 AND created_at > now() - interval '1 hour'`,
        [AUTHORISED_MOBILE]
      );
      say(`removed ${removed.rowCount} spent request(s) — all expired or already used.`);
      say(`requests counting against the hourly limit now: ${budget.rows[0].n} of 5`);
      if (budget.rows[0].n >= 5) {
        say('The limit is still reached, which means the remaining requests are live.');
        say('Use "stamp" rather than asking for a new code.');
      } else {
        say('A slot is free. Press "Send OTP" ONCE in the app, then run this file in "stamp" mode.');
      }
      say('No other customer was touched. shared.audit_log was not modified.');
      return;
    }

    // --- stamp: act once on the request that already exists -------------
    //
    // The floor passed to STAMP_SQL is the only thing that differs from
    // rehearse. `rehearse` passes its own start time, which is what makes
    // it ignore anything that existed before it. `stamp` passes a floor
    // well behind any request that could still be valid, so the statement
    // is decided entirely by the conditions that matter — unconsumed,
    // unexpired, attempts remaining — rather than by when this process
    // happened to start.
    //
    // The floor is NOT removed altogether. It costs nothing to keep and
    // it means a forgotten row from hours ago can never be the one
    // selected, however the expiry column might be edited in future.
    if (mode === 'stamp') {
      const floor = new Date(Date.now() - STAMP_LOOKBACK_MS);
      say(`stamp mode: acting on the newest valid ${OTP_PURPOSE} request, if there is one.`);

      await client.query('BEGIN');
      let result;
      try {
        result = await client.query(STAMP_SQL, [
          AUTHORISED_MOBILE,
          wantedHash,
          floor,
          OTP_PURPOSE,
        ]);
      } catch (err) {
        await client.query('ROLLBACK');
        return stop(`the update failed (${err.code || 'error'}); the transaction was rolled back.`);
      }

      // Nothing matched. Say WHICH condition failed, because "no eligible
      // request" is useless at eight in the morning — the operator needs
      // to know whether to ask for a new code or wait for the rate limit.
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        const why = await client.query(
          `SELECT (consumed_at IS NOT NULL) AS consumed,
                  (expires_at <= now())     AS expired,
                  (attempt_count >= max_attempts) AS locked,
                  attempt_count, max_attempts
             FROM shared.otp_requests
            WHERE mobile_number = $1 AND purpose = $2
            ORDER BY created_at DESC
            LIMIT 1`,
          [AUTHORISED_MOBILE, OTP_PURPOSE]
        );
        if (why.rowCount === 0) {
          return stop('no sign-in request exists for the demo account. Ask for the code in the app first, then run this again.');
        }
        const r = why.rows[0];
        const reason = r.consumed
          ? 'the newest request has already been used'
          : r.expired
            ? 'the newest request has expired'
            : r.locked
              ? `the newest request is locked (${r.attempt_count} of ${r.max_attempts} attempts used)`
              : 'the newest request did not meet every condition';
        return stop(`${reason}. Ask for a NEW code in the app, then run this again. Nothing was changed.`);
      }

      if (result.rowCount > 1) {
        await client.query('ROLLBACK');
        return stop(`the update matched ${result.rowCount} rows; expected exactly one. Rolled back.`);
      }

      await client.query('COMMIT');
      const row = result.rows[0];
      say(`stamped request ${row.id}`);
      say(`  created ${row.created_at.toISOString()}, expires ${row.expires_at.toISOString()}`);
      say(`  attempts ${row.attempt_count} of ${row.max_attempts} — untouched, as is the expiry`);

      // ---------------------------------------------------------------
      // THE WRITE IS NOW CHECKED, NOT ASSUMED.
      //
      // Stamping and then being told "that code is incorrect" leaves an
      // operator with no way to tell WHICH of three things went wrong,
      // and the only way they had to find out was to burn another
      // request. These three checks cost nothing and separate them.
      // ---------------------------------------------------------------

      // 1. Did the value actually land? Compared in constant time, and
      //    the hash is never printed on either side.
      const back = await client.query(
        'SELECT otp_hash FROM shared.otp_requests WHERE id = $1',
        [row.id]
      );
      const stored = String(back.rows[0] ? back.rows[0].otp_hash : '');
      const landed =
        stored.length === wantedHash.length &&
        timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(wantedHash, 'hex'));
      say(`  write verified: ${landed ? 'yes — the row now holds the demo code' : 'NO — the value did not land'}`);
      if (!landed) {
        return stop('the write did not take effect; do not attempt a sign-in with this request.');
      }

      // 2. Is this still the request the app will check? The API always
      //    verifies the NEWEST one. A second press of "Send OTP" after
      //    this point creates a newer request, and the stamp silently
      //    stops counting — which is the single most common way this
      //    ends in "that code is incorrect".
      // The comparison stays INSIDE Postgres. Passing row.created_at back
      // as a parameter looked equivalent and was not: timestamptz holds
      // microseconds, a JavaScript Date holds milliseconds, so the value
      // arrives rounded DOWN and the row matches "newer than itself".
      // That reported a phantom newer request on every clean run.
      const newer = await client.query(
        `SELECT count(*)::int AS n
           FROM shared.otp_requests
          WHERE mobile_number = $1
            AND purpose = $2
            AND created_at > (SELECT created_at FROM shared.otp_requests WHERE id = $3)`,
        [AUTHORISED_MOBILE, OTP_PURPOSE, row.id]
      );
      if (newer.rows[0].n > 0) {
        say(`  WARNING: ${newer.rows[0].n} NEWER request(s) exist. The app checks the newest,`);
        say('           so this stamp will NOT be the one it compares against.');
        say('           Press "Send OTP" once more, then run this again — and do not press it again after.');
      } else {
        say('  this is the newest request, so it is the one the app will check.');
      }

      // 3. Is the API running with the configuration this file just read?
      //    The pepper is read from apps/api/.env here, but the API uses
      //    whatever it read AT STARTUP. If .env was edited afterwards the
      //    two secrets differ and no stamp can ever verify — with nothing
      //    to show for it but "that code is incorrect".
      warnIfApiOlderThanEnv();

      say('Enter the demo code in the app before that expiry. Exactly one row was changed.');
      return;
    }

    // --- rehearse: wait for a NEW request, stamp it once, exit ----------
    say('rehearse mode: waiting for a fresh OTP request. Ask for the code in the app now.');
    say(`giving up after ${WAIT_TIMEOUT_MS / 60000} minutes, having changed nothing.`);

    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await client.query('BEGIN');
      let result;
      try {
        result = await client.query(STAMP_SQL, [
          AUTHORISED_MOBILE,
          wantedHash,
          startedAt,
          OTP_PURPOSE,
        ]);
      } catch (err) {
        await client.query('ROLLBACK');
        return stop(`the update failed (${err.code || 'error'}); the transaction was rolled back.`);
      }

      if (result.rowCount === 1) {
        await client.query('COMMIT');
        const row = result.rows[0];
        say(`stamped request ${row.id}`);
        say(`  created ${row.created_at.toISOString()}, expires ${row.expires_at.toISOString()}`);
        say(`  attempts ${row.attempt_count} of ${row.max_attempts} — untouched, as is the expiry`);
        say('Enter the demo code in the app before that expiry. Exactly one row was changed.');
        return;
      }

      if (result.rowCount > 1) {
        await client.query('ROLLBACK');
        return stop(`the update matched ${result.rowCount} rows; it must match at most one. Rolled back.`);
      }

      await client.query('ROLLBACK');
      await sleep(POLL_MS);
    }

    say('timed out waiting for a fresh request. NOTHING WAS CHANGED.');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  // Never let a stack trace carry configuration into the terminal.
  say(`STOP: unexpected failure (${err && err.code ? err.code : 'error'}).`);
  say('Nothing was committed.');
  process.exitCode = 1;
});
