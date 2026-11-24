#!/usr/bin/env node
/**
 * e-Samagri — SMS OTP diagnosis. READ-ONLY.
 *
 * Run it from the staging project root:
 *
 *     node sms-otp-diagnose.cjs
 *
 * WHAT IT DOES NOT DO. It sends no SMS. It starts, stops and kills
 * nothing. It writes no file. It issues no INSERT, UPDATE or DELETE —
 * the only database statements are SELECTs. It changes no setting.
 *
 * WHAT IT NEVER PRINTS. The API key, the database password, the JWT
 * secret, any OTP code, any OTP hash, and any customer's full mobile
 * number. Where it must say something about a secret it reports its
 * SHAPE ("present, 22 characters, no stray spaces") and nothing else.
 * The one network call it makes carries the API key in the URL, so that
 * URL is never logged, not even on failure.
 *
 * It answers four questions, in the order that narrows the problem
 * fastest:
 *
 *   A. Which process owns port 3000, and did it start BEFORE the .env
 *      file was last edited? A process that started first is still
 *      running the OLD settings no matter what the file says now —
 *      which looks exactly like "SMS silently not arriving".
 *   B. Is the SMS configuration in .env well formed?
 *   C. What does the audit log say actually happened on the last few
 *      OTP requests?
 *   D. Does SMS Gateway Hub accept this API key from THIS machine, and
 *      is the account active with credit? (Balance enquiry — not a
 *      send.)
 */

const { execFileSync } = require('node:child_process');
const { createHmac, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ENV_PATH = path.join(__dirname, 'apps', 'api', '.env');
const BALANCE_URL = 'https://www.smsgatewayhub.com/api/mt/GetBalance';
const DELIVERY_URL = 'https://www.smsgatewayhub.com/api/mt/GetDelivery';
const PORT = 3000;
const AUTH_PROBE = process.argv.includes('--auth-probe');
const POST_PROBE = process.argv.includes('--post-probe');
const RIK_DEMO_CHECK = process.argv.includes('--rik-demo-check');
const DEMO_READY = process.argv.includes('--demo-ready');
const OTP_STATE = process.argv.includes('--otp-state');
const SESSION_STATUS = process.argv.includes('--session-status');
const RIK_OFFICER = process.argv.includes('--rik-officer');
/** The code the helper writes. Held only to hash it; never printed. */
const DEMO_CODE_FOR_COMPARISON = '123456';
const REQUIRED_DATABASE = 'esamagri_staging';
/** Both written forms of the one authorised demo number. Never printed. */
const DEMO_MOBILE_FORMS = ['9000000001', '+919000000001'];
const WEB_ORIGIN = 'http://localhost:5173';
const API_ORIGIN = 'http://127.0.0.1:3000';

const findings = [];
function note(level, text) {
  findings.push({ level, text });
}

function heading(title) {
  console.log(`\n${'='.repeat(68)}\n${title}\n${'='.repeat(68)}`);
}

/** Reads apps/api/.env into a map. Values are never printed by callers. */
function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    out[s.slice(0, i).trim()] = s.slice(i + 1);
  }
  return out;
}

function shapeOf(value) {
  if (value === undefined) return 'ABSENT';
  if (value === '') return 'EMPTY';
  const flags = [];
  if (value !== value.trim()) flags.push('HAS LEADING/TRAILING SPACE');
  if (/^["']|["']$/.test(value)) flags.push('WRAPPED IN QUOTES');
  if (value.includes('#')) flags.push("CONTAINS '#'");
  return `present, ${value.length} characters${flags.length ? ', ' + flags.join(', ') : ', clean'}`;
}

function powershell(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 20000,
  }).trim();
}

// ---------------------------------------------------------------- A
function checkPort() {
  heading(`A. WHO OWNS PORT ${PORT}, AND IS IT RUNNING THE CURRENT SETTINGS?`);

  let envMtime = null;
  try {
    envMtime = fs.statSync(ENV_PATH).mtime;
    console.log(`apps/api/.env was last edited : ${envMtime.toLocaleString()}`);
  } catch {
    console.log('apps/api/.env could not be read.');
    note('STOP', 'apps/api/.env was not found where this script expected it.');
    return;
  }

  if (process.platform !== 'win32') {
    console.log('(Port owner check is written for Windows; skipped on this platform.)');
    return;
  }

  let rows;
  try {
    rows = powershell(
      `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ` +
        `Select-Object -ExpandProperty OwningProcess -Unique`
    );
  } catch {
    rows = '';
  }

  const pids = rows.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (pids.length === 0) {
    console.log(`Nothing is listening on port ${PORT}. The API is NOT running.`);
    note('ACTION', `Nothing holds port ${PORT}. Start the API — it will pick up the current .env.`);
    return;
  }

  for (const pid of pids) {
    let name = '(unknown)';
    let started = null;
    try {
      const info = powershell(
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; ` +
          `"$($p.Name)|$($p.CreationDate)"`
      );
      const [n, created] = info.split('|');
      name = n || name;
      // CIM gives a DateTime already converted by PowerShell's formatter.
      started = created ? new Date(created) : null;
    } catch {
      /* fall through with what we have */
    }

    console.log(`\nPort ${PORT} is held by PID ${pid} (${name})`);
    if (started && !Number.isNaN(started.getTime())) {
      console.log(`That process started        : ${started.toLocaleString()}`);
      if (envMtime && started < envMtime) {
        const mins = Math.round((envMtime - started) / 60000);
        console.log(
          `\n  >>> THIS PROCESS STARTED ${mins} MINUTES BEFORE .env WAS LAST EDITED. <<<\n` +
            `      Settings are read once, at start-up. This process is still\n` +
            `      running the OLD configuration — editing the file did not\n` +
            `      reach it. If OTP delivery was switched off when it started,\n` +
            `      it is still switched off, silently.`
        );
        note(
          'STOP',
          `The API on port ${PORT} (PID ${pid}) started BEFORE .env was last edited, so it is ` +
            `running the old settings. Stop it and start it again.`
        );
      } else {
        console.log('This process started AFTER the last .env edit, so it has the current settings.');
        note('OK', `The API on port ${PORT} (PID ${pid}) started after the last .env edit.`);
      }
    } else {
      note('CHECK', `Could not read the start time of PID ${pid}; restart it to be certain.`);
    }
    console.log(`\n  To stop just this one, in PowerShell:  Stop-Process -Id ${pid}`);
  }
}

// ---------------------------------------------------------------- B
function checkConfig(env) {
  heading('B. IS THE SMS CONFIGURATION WELL FORMED?');
  if (!env) {
    console.log('apps/api/.env not found.');
    return;
  }

  const provider = env.OTP_DELIVERY_PROVIDER;
  console.log(`OTP_DELIVERY_PROVIDER      : ${provider ?? 'ABSENT'}`);
  console.log(`SMS_GATEWAY_HUB_API_KEY    : ${shapeOf(env.SMS_GATEWAY_HUB_API_KEY)}`);
  console.log(`SMS_GATEWAY_HUB_SENDER_ID  : ${shapeOf(env.SMS_GATEWAY_HUB_SENDER_ID)}`);
  console.log(`SMS_GATEWAY_HUB_ROUTE      : ${env.SMS_GATEWAY_HUB_ROUTE ?? 'default 1'}`);
  console.log(`SMS_GATEWAY_HUB_CHANNEL    : ${env.SMS_GATEWAY_HUB_CHANNEL ?? 'default 2'}`);
  console.log(`SMS_GATEWAY_HUB_DCS        : ${env.SMS_GATEWAY_HUB_DCS ?? 'default 0'}`);
  console.log(`SMS_GATEWAY_HUB_TIMEOUT_MS : ${env.SMS_GATEWAY_HUB_TIMEOUT_MS ?? 'default 10000'}`);
  console.log(
    `\nOTP rules (must be unchanged): ttl=${env.OTP_TTL_SECONDS}s ` +
      `attempts=${env.OTP_MAX_ATTEMPTS} requests=${env.OTP_REQUEST_MAX_PER_WINDOW}` +
      `/${env.OTP_REQUEST_WINDOW_SECONDS}s`
  );

  if (provider !== 'SMS_GATEWAY_HUB') {
    note('STOP', `OTP_DELIVERY_PROVIDER is "${provider}", not SMS_GATEWAY_HUB — nothing will be sent.`);
  }
  for (const key of ['SMS_GATEWAY_HUB_API_KEY', 'SMS_GATEWAY_HUB_SENDER_ID']) {
    const shape = shapeOf(env[key]);
    if (shape === 'ABSENT' || shape === 'EMPTY' || shape.includes('QUOTES') || shape.includes('SPACE')) {
      note('STOP', `${key}: ${shape}`);
    }
  }
}

// ---------------------------------------------------------------- C
async function checkAuditLog(env) {
  heading('C. WHAT DID THE LAST FEW OTP REQUESTS ACTUALLY DO?');
  const url = env && env.DATABASE_URL;
  if (!url) {
    console.log('No DATABASE_URL in .env; skipping.');
    return;
  }

  let Client;
  for (const spec of ['pg', path.join(__dirname, 'apps', 'api', 'node_modules', 'pg')]) {
    try {
      ({ Client } = require(spec));
      break;
    } catch {
      /* try the next location */
    }
  }
  if (!Client) {
    console.log("Could not load the 'pg' library; skipping this section.");
    return;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const db = await client.query('SELECT current_database() AS d, current_user AS u');
    console.log(`Connected to database "${db.rows[0].d}" as "${db.rows[0].u}" (read-only queries).`);

    const res = await client.query(
      `SELECT action, created_at::text AS at, after
         FROM shared.audit_log
        WHERE action IN ('OTP_REQUESTED','OTP_DELIVERY_FAILED')
        ORDER BY created_at DESC
        LIMIT 20`
    );

    if (res.rows.length === 0) {
      console.log('No OTP audit rows at all. No OTP has been requested against this database.');
      note('CHECK', 'The audit log holds no OTP activity — is the Customer App talking to this API?');
      return;
    }

    console.log('\nMost recent first (mobile numbers appear only as a one-way hash):\n');
    let requested = 0;
    let failed = 0;
    for (const r of res.rows) {
      const after = r.after || {};
      const reason = after.reason ? ` reason=${after.reason}` : '';
      const who = after.mobileNumberHash ? ` recipient=${String(after.mobileNumberHash).slice(0, 16)}` : '';
      console.log(`  ${r.at}  ${r.action}${reason}${who}`);
      if (r.action === 'OTP_REQUESTED') requested += 1;
      if (r.action === 'OTP_DELIVERY_FAILED') failed += 1;
    }

    console.log(`\n  ${requested} code(s) issued, ${failed} delivery failure(s) recorded.`);
    if (failed > 0) {
      const latest = res.rows.find((r) => r.action === 'OTP_DELIVERY_FAILED');
      note(
        'STOP',
        `The gateway refused delivery. Most recent reason: ${(latest.after || {}).reason}. ` +
          `See the reason table in the integration report.`
      );
    } else if (requested > 0) {
      console.log(
        '\n  No delivery failure was recorded for these. That means the API either\n' +
          '  SENT them successfully, or delivery was SWITCHED OFF at the time —\n' +
          '  those two look identical here, which is what section A tells apart.'
      );
      note('CHECK', 'Codes were issued with no recorded failure: see section A for which of the two it was.');
    }
  } catch (error) {
    console.log(`Could not read the audit log: ${error.code || error.name || 'error'}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- D
async function checkGateway(env) {
  heading('D. DOES SMS GATEWAY HUB ACCEPT THIS KEY FROM THIS MACHINE?');
  console.log('This is a BALANCE ENQUIRY. It sends no SMS and costs nothing.\n');

  const key = (env && env.SMS_GATEWAY_HUB_API_KEY ? env.SMS_GATEWAY_HUB_API_KEY : '').trim();
  if (!key) {
    console.log('No API key configured; skipping.');
    return;
  }

  // Built here and never logged — it carries the key.
  const url = `${BALANCE_URL}?APIKey=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    console.log(`HTTP status: ${res.status}`);

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      console.log('The reply was not JSON. (Body deliberately not printed.)');
      note('STOP', 'SMS Gateway Hub returned something that is not JSON — contact their support.');
      return;
    }

    // The live gateway does not always zero-pad: a real reply carried
    // "7" for the failure the vendor table calls "007". Normalise
    // before looking the meaning up, or every unpadded code reads as
    // "unknown" when it is in fact documented.
    const raw = String(payload.ErrorCode ?? '').trim();
    const code = /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '').padStart(3, '0') : raw;
    console.log(`ErrorCode  : ${code}${code === raw ? '' : ` (sent as "${raw}")`}`);
    console.log(`Message    : ${String(payload.ErrorMessage ?? '').slice(0, 120)}`);
    if (payload.Balance !== undefined) console.log(`Balance    : ${payload.Balance}`);

    if (code === '000') {
      note('OK', `The API key works from this machine. Balance: ${payload.Balance ?? 'not reported'}.`);
      if (/Trans:0(\||$)/.test(String(payload.Balance ?? ''))) {
        note('STOP', 'Transactional balance is 0 — an OTP send would be refused with ErrorCode 021.');
      }
    } else {
      const meaning =
        { '001': 'no credentials were accepted at all',
          '007': 'the API key is not valid for this account',
          '008': 'the account is not active', '009': 'the account is locked',
          '010': 'an API restriction is set on the account',
          '011': "this machine's IP address is not allowed",
          '014': 'the account is locked for spam',
          '021': 'the account has no credit' }[code] || 'see the error table in the report';
      note('STOP', `SMS Gateway Hub answered ErrorCode ${code} — ${meaning}.`);
      if (code === '007' || code === '001') {
        note(
          'ACTION',
          'This is an account-side credential problem, not a code problem. Get a fresh API key ' +
            'from the provider portal (Panel > WebAPI > API Codes) and confirm API access is ' +
            'enabled on the account. Do not paste the key into chat.'
        );
      }
    }
  } catch (error) {
    const aborted = controller.signal.aborted;
    console.log(aborted ? 'No reply within 15 seconds.' : `Could not reach the gateway: ${error.name}`);
    note(
      'STOP',
      aborted
        ? 'SMS Gateway Hub did not answer — check this machine can reach the internet.'
        : 'This machine could not connect to SMS Gateway Hub at all (firewall, proxy or no internet).'
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- E
/**
 * A DIFFERENTIAL AUTH PROBE. Four read-only calls, no SMS, run only
 * with --auth-probe.
 *
 * The question it answers: when GetBalance says "username or password
 * is invalid", is the gateway rejecting OUR KEY, or is it rejecting
 * THAT ENDPOINT for this account? Those need opposite fixes, and a
 * single GetBalance call cannot tell them apart.
 *
 * The method is to vary one thing at a time:
 *
 *   1. GetBalance, real key          — the reading we already have.
 *   2. GetBalance, obvious junk key  — if this ALSO answers 007, then
 *      007 is simply "this key was not accepted", and our request is
 *      being parsed correctly (a malformed request would fail
 *      differently, before any key was ever checked).
 *   3. GetBalance, no key at all     — expected 001/023. If this too
 *      answers 007, the endpoint answers 007 for everything and the
 *      code carries no information at all.
 *   4. GetDelivery, real key, a job  — THE DECISIVE ONE. GetDelivery
 *      id that cannot exist            authenticates with the same
 *                                      APIKey parameter. If it answers
 *                                      022 ("invalid jobid") or 023,
 *                                      the key WAS accepted and the
 *                                      problem is GetBalance alone. If
 *                                      it answers 007, the key really
 *                                      is rejected platform-wide.
 */
async function authProbe(env) {
  heading('E. DIFFERENTIAL AUTH PROBE — is it the KEY, or the ENDPOINT?');
  console.log('Four read-only calls. No SMS is sent. Nothing is changed.\n');

  const key = (env && env.SMS_GATEWAY_HUB_API_KEY ? env.SMS_GATEWAY_HUB_API_KEY : '').trim();
  if (!key) {
    console.log('No API key configured; skipping.');
    return;
  }

  // Deliberately not a real-looking key, and never near the real one.
  const JUNK = 'thisIsNotARealApiKeyXX';

  const probes = [
    ['1. GetBalance  + real key     ', `${BALANCE_URL}?APIKey=${encodeURIComponent(key)}`],
    ['2. GetBalance  + junk key     ', `${BALANCE_URL}?APIKey=${JUNK}`],
    ['3. GetBalance  + no key       ', BALANCE_URL],
    ['4. GetDelivery + real key     ', `${DELIVERY_URL}?APIKey=${encodeURIComponent(key)}&jobid=1`],
  ];

  const results = [];
  for (const [label, url] of probes) {
    // `url` may carry the key and is NEVER logged.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let line;
    let code = null;
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = await res.text();
      try {
        const payload = JSON.parse(body);
        const raw = String(payload.ErrorCode ?? '').trim();
        code = /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '').padStart(3, '0') : raw;
        line = `HTTP ${res.status}  ErrorCode ${code}  "${String(payload.ErrorMessage ?? '').slice(0, 60)}"`;
      } catch {
        line = `HTTP ${res.status}  (reply was not JSON)`;
      }
    } catch (error) {
      line = controller.signal.aborted ? 'no reply within 15s' : `could not connect (${error.name})`;
    } finally {
      clearTimeout(timer);
    }
    console.log(`  ${label} -> ${line}`);
    results.push(code);
    // Courtesy gap; these are enquiries, not sends, but no need to rush.
    await new Promise((r) => setTimeout(r, 400));
  }

  const [real, junk, nokey, delivery] = results;
  console.log('');

  if (delivery && delivery !== '007' && delivery !== '001') {
    note(
      'STOP',
      `GetDelivery ACCEPTED the same API key (it answered ${delivery}, about the job id, not the ` +
        `credentials). So the key authenticates. GetBalance alone is refusing it — ask SMS ` +
        `Gateway Hub to enable the balance API, and treat the key as working.`
    );
  } else if (real === '007' && junk === '007' && nokey !== '007') {
    note(
      'STOP',
      'A junk key and the real key get the identical answer, while a missing key does not — so ' +
        'our request is being parsed correctly and the gateway is genuinely refusing this key. ' +
        'Go back to SMS Gateway Hub with that, quoting ErrorCode 007 on GetBalance AND GetDelivery.'
    );
  } else if (real === '007' && nokey === '007' && junk === '007') {
    note(
      'CHECK',
      'This endpoint answers 007 whether a key is supplied or not, so the code carries no ' +
        'information. Ask SMS Gateway Hub what 007 means for this account specifically.'
    );
  } else if (real === '000') {
    note('OK', 'The key now works. Re-run the normal diagnosis.');
  } else {
    note('CHECK', 'Mixed result — send this whole section back.');
  }
}

// ---------------------------------------------------------------- F
/**
 * DOES A POST SURVIVE THE TRIP? Run with --post-probe.
 *
 * The login screen's OTP call fails with "Request failed", which is the
 * app's wording for a refusal that carried NO message. The API attaches
 * a message to every refusal it writes, so the refusal did not come
 * from the API. The open question is whether a POST reaches it at all —
 * a GET plainly does, since /api/health answers.
 *
 * WHY IT POSTS TO /health AND NOT TO THE OTP ROUTE. The OTP route would
 * be more realistic and is NOT safe enough. In NestJS the request
 * pipeline runs middleware -> GUARDS -> interceptors -> PIPES ->
 * handler. The rate limiter is a global guard, so it runs BEFORE the
 * validation pipe: a deliberately invalid phone number would still
 * spend one of the twenty-per-minute sign-in allowance before being
 * rejected. It would create no OTP, spend none of the five-per-hour
 * per-number allowance and never reach the SMS provider — but "spends
 * nothing at all" is the bar that was set, and it does not clear it.
 *
 * /health declares only GET. A POST to it matches no route, so NestJS
 * never resolves a handler, which means NO GUARD RUNS AT ALL: no rate
 * limit of any class is touched, no OTP is created, no provider is
 * called, nothing is written. The framework answers 404 through the
 * same error filter every other refusal uses — which is exactly the
 * thing being tested: does a POST come back as a proper JSON envelope
 * with a message, or as something blank?
 *
 * Two hops are measured separately so the proxy and the API cannot
 * hide behind each other.
 */
async function postProbe() {
  heading('F. DOES A POST SURVIVE THE TRIP? (no OTP, no SMS, no rate limit)');
  console.log('Posting to /health, which only answers GET. NestJS matches no route, so no');
  console.log('guard runs, nothing is created and nothing is spent. Expected: 404 with a');
  console.log('JSON body containing "code" and "message".\n');

  const hops = [
    ['1. straight to the API      ', `${API_ORIGIN}/health`],
    ['2. through the app server   ', `${WEB_ORIGIN}/api/health`],
  ];

  const verdicts = [];
  for (const [label, url] of hops) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let verdict = 'unreachable';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ probe: true }),
        signal: controller.signal,
      });
      const text = await res.text();
      let shape;
      try {
        const payload = JSON.parse(text);
        const hasMessage = typeof payload.message === 'string' && payload.message.length > 0;
        shape = hasMessage
          ? `JSON with code="${payload.code}" and a message`
          : `JSON but NO message field (this is what produces "Request failed")`;
        verdict = hasMessage ? 'ok' : 'nomessage';
      } catch {
        shape = `NOT JSON (${text.length} bytes) — this is what produces "Request failed"`;
        verdict = 'nonjson';
      }
      console.log(`  ${label} -> HTTP ${res.status}  ${shape}`);
    } catch (error) {
      console.log(
        `  ${label} -> ${controller.signal.aborted ? 'no reply within 15s' : `could not connect (${error.name})`}`
      );
    } finally {
      clearTimeout(timer);
    }
    verdicts.push(verdict);
  }

  const [direct, proxied] = verdicts;
  console.log('');
  if (direct === 'ok' && proxied === 'ok') {
    note(
      'OK',
      'A POST reaches the API through the app server and comes back as a proper JSON refusal. ' +
        'So the path is sound, and "Request failed" is coming from the BROWSER side — most ' +
        'likely a service worker or a cached page left over from the production preview. ' +
        'Try the app once in a private window to confirm.'
    );
  } else if (direct === 'ok' && proxied !== 'ok') {
    note(
      'STOP',
      'The API answers a POST correctly on its own, but the same POST through the app server ' +
        'does not. The forwarding step is what fails on POST, and that is the cause of ' +
        '"Request failed".'
    );
  } else if (direct === 'unreachable') {
    note('STOP', 'The API did not answer a POST at all. It is not running, or not on port 3000.');
  } else {
    note('CHECK', 'Mixed result — send this whole section back.');
  }
}

// ---------------------------------------------------------------- G
/**
 * RIK DEMO READINESS. Four SELECT statements and nothing else.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION. There is no INSERT, UPDATE,
 * DELETE, TRUNCATE or DDL anywhere in this function, and the session is
 * put into `default_transaction_read_only = on` before the first query
 * — so even a mistake in a statement below would be refused by
 * PostgreSQL itself rather than relying on this comment being true.
 *
 * IT REFUSES THE WRONG DATABASE. The staging database and the original
 * project's database sit on the same server and are reached with the
 * same login role, so configuration is the only thing keeping them
 * apart. That is not enough to rely on: this asks the server its own
 * name and stops unless it is exactly esamagri_staging.
 *
 * NOTHING PERSONAL IS PRINTED. No name, no mobile number, no RIK id, no
 * username, no address. The four answers are counts and yes/no.
 */
async function rikDemoCheck(env) {
  heading('G. RIK DEMO READINESS — four read-only questions');

  const url = env && env.DATABASE_URL;
  if (!url) {
    console.log('No DATABASE_URL in apps/api/.env; cannot check.');
    note('STOP', 'apps/api/.env has no DATABASE_URL.');
    return;
  }

  let Client;
  for (const spec of ['pg', path.join(__dirname, 'apps', 'api', 'node_modules', 'pg')]) {
    try {
      ({ Client } = require(spec));
      break;
    } catch {
      /* try the next location */
    }
  }
  if (!Client) {
    console.log("Could not load the 'pg' library.");
    note('STOP', "The 'pg' library was not found — run this from the project root.");
    return;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();

    const who = await client.query('SELECT current_database() AS db, current_user AS usr');
    const db = who.rows[0].db;
    console.log(`Connected to database "${db}" as "${who.rows[0].usr}".`);
    if (db !== REQUIRED_DATABASE) {
      console.log(`\n  >>> REFUSING TO CONTINUE. Expected "${REQUIRED_DATABASE}". <<<`);
      note('STOP', `Connected to "${db}", not ${REQUIRED_DATABASE}. Nothing was read.`);
      return;
    }

    // Belt to the braces above: the server now refuses any write on this
    // connection, whatever the statements below say.
    await client.query('SET default_transaction_read_only = on');
    console.log('Session set to READ ONLY. Four SELECT statements follow.\n');

    // --- 1. Can the existing demo customer be used as the officer? ----
    await ask(client, '1. The authorised demo customer', async () => {
      const r = await client.query(
        `SELECT (rik_id IS NOT NULL) AS has_rik_id,
                is_active,
                (deleted_at IS NOT NULL) AS removed
           FROM shared.customers
          WHERE mobile_number = ANY($1::text[])`,
        [DEMO_MOBILE_FORMS]
      );
      if (r.rows.length === 0) {
        console.log('   No such customer exists.');
        note('CHECK', 'The authorised demo customer does not exist — Demo Officer 001 needs a new number.');
        return;
      }
      const row = r.rows[0];
      console.log(`   exists: yes   already a RIK officer: ${row.has_rik_id ? 'YES' : 'no'}` +
        `   active: ${row.is_active ? 'yes' : 'NO'}   removed: ${row.removed ? 'YES' : 'no'}`);
      if (row.removed) {
        note('STOP', 'The demo customer is marked removed; its number cannot be reused.');
      } else if (row.has_rik_id && row.is_active) {
        note(
          'OK',
          'The demo customer is ALREADY an active RIK officer. Use it as Demo Officer 001 — ' +
            'no new registration, and OTP sign-in already works without SMS. This is the fast path.'
        );
      } else if (!row.has_rik_id) {
        note(
          'OK',
          'The demo customer has no RIK id, so the admin Register-officer screen will LINK it ' +
            'rather than refuse it. Register Demo Officer 001 on this number.'
        );
      } else {
        note('CHECK', 'The demo customer is a RIK officer but inactive — reactivate it in the Admin Portal.');
      }
    });

    // --- 2. Is there an account that can register an officer? ---------
    await ask(client, '2. Staff roles (counts only, no names)', async () => {
      const r = await client.query(
        `SELECT r.name AS role_name, count(*)::int AS user_count
           FROM shared.user_roles ur
           JOIN shared.roles r ON r.id = ur.role_id
          GROUP BY r.name
          ORDER BY r.name`
      );
      if (r.rows.length === 0) {
        console.log('   No staff roles are assigned to anyone.');
      }
      for (const row of r.rows) {
        console.log(`   ${row.role_name.padEnd(16)} ${row.user_count} account(s)`);
      }
      const rikAdmin = r.rows.find((row) => row.role_name === 'RIK_ADMIN');
      if (rikAdmin && rikAdmin.user_count > 0) {
        note('OK', `RIK_ADMIN exists (${rikAdmin.user_count} account). That is the sign-in that can register an officer.`);
      } else {
        note(
          'STOP',
          'NO account holds RIK_ADMIN. Only RIK_ADMIN may register an officer — SUPER_ADMIN cannot. ' +
            'Without one, the demo cannot be prepared through the Admin Portal.'
        );
      }
    });

    // --- 3. Is a period open for entitlement to be calculated in? -----
    await ask(client, '3. Entitlement periods', async () => {
      const r = await client.query(
        `SELECT status,
                count(*)::int AS total,
                count(*) FILTER (
                  WHERE current_date BETWEEN start_date AND end_date
                )::int AS covering_today
           FROM rik.entitlement_periods
          GROUP BY status
          ORDER BY status`
      );
      if (r.rows.length === 0) {
        console.log('   No entitlement periods exist at all.');
        note('STOP', 'No entitlement period exists. Create and activate one in the Admin Portal first.');
        return;
      }
      let usable = 0;
      for (const row of r.rows) {
        console.log(`   ${row.status.padEnd(10)} ${row.total} period(s), ${row.covering_today} covering today`);
        if (row.status !== 'CLOSED') usable += row.covering_today;
      }
      if (usable > 0) {
        note('OK', `A period covering today is open (status not CLOSED). Entitlement can be calculated.`);
      } else {
        note(
          'STOP',
          'No open period covers today. The Customer App will show no entitlement until one does — ' +
            'create or activate one in the Admin Portal.'
        );
      }
    });

    // --- 4. Is there anything to put in a cart? -----------------------
    await ask(client, '4. RIK provisions and pack sizes', async () => {
      const r = await client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE is_active)::int AS active,
                count(*) FILTER (
                  WHERE is_active
                    AND effective_from <= current_date
                    AND (effective_to IS NULL OR effective_to >= current_date)
                )::int AS available_today,
                count(*) FILTER (
                  WHERE is_active AND pack_size IS NOT NULL
                )::int AS with_pack_size
           FROM rik.provisions`
      );
      const row = r.rows[0];
      console.log(
        `   ${row.total} provision(s) total, ${row.active} active, ` +
          `${row.available_today} available today, ${row.with_pack_size} with a pack size`
      );
      if (row.available_today > 0) {
        note('OK', `${row.available_today} provision(s) are available today — the catalogue and cart will have content.`);
      } else {
        note('STOP', 'No provision is available today. The Customer App catalogue would be empty.');
      }
    });
  } catch (error) {
    console.log(`Could not complete the check: ${error.code || error.name || 'error'}`);
    note('STOP', `The check could not run (${error.code || error.name || 'error'}).`);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Runs one question, printing its heading, and never lets one failure stop the rest. */
async function ask(client, label, work) {
  console.log(label);
  try {
    await work();
  } catch (error) {
    console.log(`   could not be answered (${error.code || error.name || 'error'})`);
    note('CHECK', `${label} could not be answered — send this output back.`);
  }
  console.log('');
}

// ---------------------------------------------------------------- H
/**
 * DEMO READINESS. Everything that can be known without changing
 * anything, in one run.
 *
 * WHAT IT WILL NOT DO, BY INSTRUCTION AND BY CONSTRUCTION:
 *   - no OTP is requested and the OTP endpoint is never called;
 *   - the only HTTP requests are GETs to health endpoints, which read
 *     nothing but the service's own liveness;
 *   - every database statement is a SELECT, on a session PostgreSQL
 *     holds read-only, against a database it refuses unless the name is
 *     exactly esamagri_staging;
 *   - no name, mobile number, RIK id, username, price, credential or
 *     secret is printed. Counts and yes/no only.
 */
async function demoReady(env) {
  // ---- part one: can a browser reach the API? (GET only) -----------
  heading('1. SERVICES — can the browser reach the API? (GET health checks only)');
  console.log('No OTP is requested. Nothing is submitted. These are liveness reads.\n');

  const endpoints = [
    ['API, directly            ', `${API_ORIGIN}/health`, true],
    ['API readiness + schema   ', `${API_ORIGIN}/health/ready`, false],
    ['API via the Customer App ', `${WEB_ORIGIN}/api/health`, true],
    ['Customer App itself      ', `${WEB_ORIGIN}/`, false],
    ['Admin Portal             ', 'http://localhost:5174/', false],
  ];

  const reached = {};
  for (const [label, url, critical] of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      const ok = res.status >= 200 && res.status < 400;
      reached[label.trim()] = ok;
      console.log(`  ${label} -> HTTP ${res.status} ${ok ? 'OK' : 'NOT OK'}`);
      if (!ok && critical) {
        note('STOP', `${label.trim()} answered HTTP ${res.status}.`);
      }
    } catch (error) {
      reached[label.trim()] = false;
      // "TypeError" is what a refused connection surfaces as, which means
      // nothing to anyone. The cause's code (ECONNREFUSED, ENOTFOUND) is
      // the part that actually says what happened.
      const cause = (error && error.cause) || {};
      const why = controller.signal.aborted
        ? 'no reply within 10 seconds'
        : cause.code === 'ECONNREFUSED'
          ? 'NOT RUNNING (nothing is listening on that port)'
          : `could not connect (${cause.code || error.name})`;
      console.log(`  ${label} -> ${why}`);
      if (critical) note('STOP', `${label.trim()} could not be reached — ${why}.`);
    } finally {
      clearTimeout(timer);
    }
  }

  if (reached['API, directly'] && reached['API via the Customer App']) {
    note('OK', 'The Customer App can reach the API. Sign-in has a route to travel.');
    console.log(
      '\n  NOTE: this proves a GET arrives. The login screen sends a POST, which was not\n' +
        '  tested here because you restricted this run to non-mutating GET checks. If\n' +
        '  "Request failed" still appears at sign-in, that difference is where it lives.'
    );
  }

  // ---- part two: the data behind the demo --------------------------
  const url = env && env.DATABASE_URL;
  if (!url) {
    heading('2. DATA');
    note('STOP', 'apps/api/.env has no DATABASE_URL; the data checks cannot run.');
    return;
  }

  let Client;
  for (const spec of ['pg', path.join(__dirname, 'apps', 'api', 'node_modules', 'pg')]) {
    try {
      ({ Client } = require(spec));
      break;
    } catch {
      /* next */
    }
  }
  if (!Client) {
    heading('2. DATA');
    note('STOP', "The 'pg' library was not found — run this from the project root.");
    return;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const who = await client.query('SELECT current_database() AS db, current_user AS usr');
    const db = who.rows[0].db;

    heading('2. DATA — read-only, staging only');
    console.log(`Connected to "${db}" as "${who.rows[0].usr}".`);
    if (db !== REQUIRED_DATABASE) {
      console.log(`\n  >>> REFUSING TO CONTINUE. Expected "${REQUIRED_DATABASE}". <<<`);
      note('STOP', `Connected to "${db}", not ${REQUIRED_DATABASE}. Nothing was read.`);
      return;
    }
    await client.query('SET default_transaction_read_only = on');
    console.log('Session is READ ONLY. SELECT statements only.\n');

    await ask(client, 'A. The authorised demo customer', async () => {
      const r = await client.query(
        `SELECT (rik_id IS NOT NULL) AS has_rik_id, is_active, (deleted_at IS NOT NULL) AS removed
           FROM shared.customers WHERE mobile_number = ANY($1::text[])`,
        [DEMO_MOBILE_FORMS]
      );
      if (r.rows.length === 0) {
        console.log('   does not exist.');
        note('STOP', 'The authorised demo customer does not exist — there is no account to sign in as.');
        return;
      }
      const row = r.rows[0];
      console.log(
        `   exists: yes   RIK officer: ${row.has_rik_id ? 'YES' : 'no'}   ` +
          `active: ${row.is_active ? 'yes' : 'NO'}   removed: ${row.removed ? 'YES' : 'no'}`
      );
      if (row.removed || !row.is_active) {
        note('STOP', 'The demo customer is inactive or removed — it cannot sign in.');
      } else if (row.has_rik_id) {
        note('OK', 'The demo customer is an active RIK officer. RIK and PIF both reachable from one sign-in.');
      } else {
        note('STOP', 'The demo customer has no RIK id, so the RIK screens will refuse it. PIF would still work.');
      }
    });

    await ask(client, 'B. Staff roles (counts only)', async () => {
      const r = await client.query(
        `SELECT r.name AS role_name, count(*)::int AS user_count
           FROM shared.user_roles ur JOIN shared.roles r ON r.id = ur.role_id
          GROUP BY r.name ORDER BY r.name`
      );
      for (const row of r.rows) console.log(`   ${row.role_name.padEnd(16)} ${row.user_count} account(s)`);
      if (r.rows.length === 0) console.log('   none assigned.');
      const rikAdmin = r.rows.find((x) => x.role_name === 'RIK_ADMIN');
      if (rikAdmin && rikAdmin.user_count > 0) {
        note('OK', 'A RIK_ADMIN account exists, so officer and eligibility problems can be fixed in the Admin Portal.');
      } else {
        note('CHECK', 'No RIK_ADMIN account. Nothing can be corrected through the Admin Portal if the demo officer needs changes.');
      }
    });

    await ask(client, 'C. Entitlement periods', async () => {
      const r = await client.query(
        `SELECT status, count(*)::int AS total,
                count(*) FILTER (WHERE current_date BETWEEN start_date AND end_date)::int AS covering_today
           FROM rik.entitlement_periods GROUP BY status ORDER BY status`
      );
      if (r.rows.length === 0) {
        console.log('   none exist.');
        note('STOP', 'No entitlement period exists — RIK will show no entitlement.');
        return;
      }
      let usable = 0;
      for (const row of r.rows) {
        console.log(`   ${row.status.padEnd(10)} ${row.total} period(s), ${row.covering_today} covering today`);
        if (row.status !== 'CLOSED') usable += row.covering_today;
      }
      usable > 0
        ? note('OK', 'An open period covers today — entitlement can be calculated.')
        : note('STOP', 'No open period covers today — RIK entitlement will be empty.');
    });

    await ask(client, 'D. RIK provisions, pack sizes and images', async () => {
      const r = await client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE is_active AND effective_from <= current_date
                  AND (effective_to IS NULL OR effective_to >= current_date))::int AS available_today,
                count(*) FILTER (WHERE is_active AND effective_from <= current_date
                  AND (effective_to IS NULL OR effective_to >= current_date)
                  AND pack_size IS NOT NULL)::int AS with_pack_size,
                count(*) FILTER (WHERE is_active AND effective_from <= current_date
                  AND (effective_to IS NULL OR effective_to >= current_date)
                  AND image_ref IS NOT NULL)::int AS with_image
           FROM rik.provisions`
      );
      const row = r.rows[0];
      console.log(
        `   ${row.total} total, ${row.available_today} available today, ` +
          `${row.with_pack_size} with a pack size, ${row.with_image} with an image`
      );
      if (row.available_today === 0) {
        note('STOP', 'No RIK provision is available today — the ration catalogue would be empty.');
      } else {
        note('OK', `${row.available_today} RIK provision(s) available today (${row.with_image} with images).`);
        if (row.with_image < row.available_today) {
          note('CHECK', `${row.available_today - row.with_image} RIK provision(s) have no image — they will show a placeholder.`);
        }
      }
    });

    await ask(client, 'E. PIF categories, by business', async () => {
      const r = await client.query(
        `SELECT COALESCE(business_slug, '(none)') AS business,
                count(*)::int AS total,
                count(*) FILTER (WHERE active)::int AS active,
                count(*) FILTER (WHERE active AND parent_id IS NULL)::int AS top_level,
                count(*) FILTER (WHERE active AND parent_id IS NOT NULL)::int AS sub,
                count(*) FILTER (WHERE active AND image_ref IS NOT NULL)::int AS with_image
           FROM pif.categories GROUP BY business_slug ORDER BY business_slug`
      );
      if (r.rows.length === 0) {
        console.log('   none exist.');
        note('STOP', 'PIF has no categories — the shop screens would be empty.');
        return;
      }
      for (const row of r.rows) {
        console.log(
          `   ${String(row.business).padEnd(12)} ${row.active} active ` +
            `(${row.top_level} top-level, ${row.sub} sub), ${row.with_image} with images`
        );
      }
      const active = r.rows.reduce((n, x) => n + x.active, 0);
      active > 0
        ? note('OK', `${active} active PIF categor(ies) across ${r.rows.length} business group(s).`)
        : note('STOP', 'No PIF category is active — the shop screens would be empty.');
    });

    await ask(client, 'F. PIF products, prices and images', async () => {
      const r = await client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE p.deleted_at IS NULL AND p.active)::int AS sellable,
                count(*) FILTER (WHERE p.deleted_at IS NULL AND p.active
                  AND p.image_ref IS NOT NULL)::int AS with_image,
                count(*) FILTER (WHERE p.deleted_at IS NULL AND p.active
                  AND p.selling_price IS NOT NULL AND p.selling_price > 0)::int AS priced,
                count(*) FILTER (WHERE p.deleted_at IS NULL AND p.active
                  AND p.category_id IS NULL)::int AS uncategorised
           FROM pif.products p`
      );
      const row = r.rows[0];
      console.log(
        `   ${row.total} total, ${row.sellable} sellable, ${row.priced} priced, ` +
          `${row.with_image} with images, ${row.uncategorised} uncategorised`
      );
      if (row.sellable === 0) {
        note('STOP', 'No PIF product is sellable — the cart and checkout cannot be demonstrated.');
      } else {
        note('OK', `${row.sellable} PIF product(s) sellable, ${row.priced} priced.`);
        if (row.with_image < row.sellable) {
          note('CHECK', `${row.sellable - row.with_image} PIF product(s) have no image — placeholders will show.`);
        }
        if (row.priced < row.sellable) {
          note('CHECK', `${row.sellable - row.priced} PIF product(s) have no price.`);
        }
      }
    });
  } catch (error) {
    console.log(`Could not complete the data checks: ${error.code || error.name || 'error'}`);
    note('STOP', `Data checks failed (${error.code || error.name || 'error'}).`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- I
/**
 * WHY WAS THE DEMO CODE REJECTED? Read-only.
 *
 * Answers two questions that cannot be answered by looking at files.
 *
 * ONE — IS THE RUNNING API USING THE CONFIGURATION ON DISK? This matters
 * more than it looks. The helper hashes the demo code with the pepper it
 * reads from apps/api/.env; the API verifies with the pepper it read
 * when it STARTED. If .env was edited after the API started, those are
 * two different secrets and nothing will ever match, with no error to
 * show for it.
 *
 * It is proven, not assumed: the API process's start time is compared
 * against the file's last-modified time. Started after the last edit, and
 * the running pepper IS the file's pepper, because that is when it was
 * read. Neither value is printed — only which came first.
 *
 * TWO — DOES THE NEWEST REQUEST CARRY THE DEMO CODE? The stored value is
 * HMAC-SHA256(pepper, code). This computes the same hash for the demo
 * code locally and compares the two in constant time. Neither the code,
 * the pepper, nor either hash is printed: the answer is a plain yes or
 * no, which is the only part anyone needs.
 */
async function otpState(env) {
  heading('WHY WAS THE DEMO CODE REJECTED?');

  // ---- part one: is the running API using the .env on disk? --------
  console.log('1. Is the running API using the configuration currently on disk?\n');
  let envMtime = null;
  try {
    envMtime = fs.statSync(ENV_PATH).mtime;
    console.log(`   apps/api/.env last edited : ${envMtime.toLocaleString()}`);
  } catch {
    console.log('   apps/api/.env could not be read.');
  }

  let apiStartedAfterEdit = null;
  if (process.platform === 'win32' && envMtime) {
    try {
      const pids = powershell(
        `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ` +
          `Select-Object -ExpandProperty OwningProcess -Unique`
      )
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (pids.length === 0) {
        console.log(`   The API is not running (nothing holds port ${PORT}).`);
        note('CHECK', 'The API is not running, so its configuration could not be compared.');
      } else {
        const info = powershell(
          `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pids[0]}"; "$($p.CreationDate)"`
        );
        const started = info ? new Date(info) : null;
        if (started && !Number.isNaN(started.getTime())) {
          console.log(`   the running API started  : ${started.toLocaleString()}`);
          apiStartedAfterEdit = started >= envMtime;
          if (apiStartedAfterEdit) {
            console.log('\n   The API started AFTER the last edit, so it is using this .env.');
            note('OK', 'The running API is using the configuration on disk — the helper and the API share one pepper.');
          } else {
            console.log('\n   >>> The API started BEFORE .env was last edited. <<<');
            note(
              'STOP',
              'The running API is using an OLDER configuration than the file on disk. If the hashing ' +
                'secret changed, nothing the helper writes can ever match. RESTART THE API.'
            );
          }
        }
      }
    } catch {
      console.log('   (could not read the API process start time)');
    }
  }

  // ---- part two: what is actually in the newest request? -----------
  console.log('\n2. What does the newest sign-in request contain?\n');
  const url = env && env.DATABASE_URL;
  const pepper = env && env.OTP_HASH_PEPPER;
  if (!url) {
    note('STOP', 'apps/api/.env has no DATABASE_URL.');
    return;
  }

  let Client;
  for (const spec of ['pg', path.join(__dirname, 'apps', 'api', 'node_modules', 'pg')]) {
    try {
      ({ Client } = require(spec));
      break;
    } catch {
      /* next */
    }
  }
  if (!Client) {
    note('STOP', "The 'pg' library was not found — run this from the project root.");
    return;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const who = await client.query('SELECT current_database() AS db');
    if (who.rows[0].db !== REQUIRED_DATABASE) {
      console.log(`   Connected to "${who.rows[0].db}" — REFUSING. Expected "${REQUIRED_DATABASE}".`);
      note('STOP', `Connected to "${who.rows[0].db}", not ${REQUIRED_DATABASE}. Nothing was read.`);
      return;
    }
    await client.query('SET default_transaction_read_only = on');

    const r = await client.query(
      `SELECT created_at, expires_at, attempt_count, max_attempts,
              (consumed_at IS NOT NULL) AS consumed,
              (expires_at <= now())     AS expired,
              otp_hash
         FROM shared.otp_requests
        WHERE mobile_number = ANY($1::text[]) AND purpose = 'LOGIN'
        ORDER BY created_at DESC
        LIMIT 1`,
      [DEMO_MOBILE_FORMS]
    );

    if (r.rowCount === 0) {
      console.log('   There is no sign-in request for the demo account at all.');
      note('ACTION', 'Ask for the code in the Customer App first, then run the helper in stamp mode.');
      return;
    }

    const row = r.rows[0];
    const ageSeconds = Math.round((Date.now() - new Date(row.created_at).getTime()) / 1000);
    console.log(`   created          : ${new Date(row.created_at).toLocaleString()} (${ageSeconds}s ago)`);
    console.log(`   expires          : ${new Date(row.expires_at).toLocaleString()}` +
      `${row.expired ? '  — ALREADY EXPIRED' : ''}`);
    console.log(`   attempts used    : ${row.attempt_count} of ${row.max_attempts}`);
    console.log(`   already used up  : ${row.consumed ? 'YES' : 'no'}`);

    // The comparison. Nothing below is printed except the verdict.
    if (!pepper) {
      console.log('   holds demo code  : cannot tell (OTP_HASH_PEPPER is not in apps/api/.env)');
      note('CHECK', 'OTP_HASH_PEPPER is missing from apps/api/.env, so the code could not be compared.');
    } else {
      const expected = createHmac('sha256', pepper).update(DEMO_CODE_FOR_COMPARISON).digest('hex');
      const stored = String(row.otp_hash || '');
      const matches =
        stored.length === expected.length &&
        timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(expected, 'hex'));
      console.log(`   holds demo code  : ${matches ? 'YES' : 'NO'}`);

      if (matches && !row.consumed && !row.expired && row.attempt_count < row.max_attempts) {
        note('OK', 'The newest request DOES hold the demo code and is still usable. Type it in the app now.');
      } else if (matches && row.expired) {
        note('ACTION', 'The demo code was written but the request has expired. Ask for a new code, then run the helper in stamp mode.');
      } else if (matches && row.attempt_count >= row.max_attempts) {
        note('ACTION', 'The demo code was written but too many wrong attempts locked the request. Ask for a new code, then stamp again.');
      } else if (matches && row.consumed) {
        note('OK', 'The demo code was written and has already been used — that is a successful sign-in.');
      } else {
        note(
          'ACTION',
          'The newest request does NOT hold the demo code — it still has the random one the API generated. ' +
            'This is the usual cause: the helper was not run against THIS request. Run the helper in stamp mode now.'
        );
      }
    }
  } catch (error) {
    console.log(`   Could not read: ${error.code || error.name || 'error'}`);
    note('STOP', `The check failed (${error.code || error.name || 'error'}).`);
  } finally {
    await client.end().catch(() => {});
  }

  // ---- part three: the four sellable PIF products ------------------
  await pifSellable(url, Client);
}

/** Read-only: which PIF products a customer can actually buy, and where they live. */
async function pifSellable(url, Client) {
  heading('SELLABLE PIF PRODUCTS — where to navigate during the demo');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const who = await client.query('SELECT current_database() AS db');
    if (who.rows[0].db !== REQUIRED_DATABASE) {
      note('STOP', `Connected to "${who.rows[0].db}", not ${REQUIRED_DATABASE}. Nothing was read.`);
      return;
    }
    await client.query('SET default_transaction_read_only = on');

    const r = await client.query(
      `SELECT p.name AS product,
              (p.image_ref IS NOT NULL) AS has_image,
              c.name AS category,
              pc.name AS parent_category,
              COALESCE(c.business_slug, pc.business_slug, '(none)') AS business
         FROM pif.products p
         LEFT JOIN pif.categories c  ON c.id = p.category_id
         LEFT JOIN pif.categories pc ON pc.id = c.parent_id
        WHERE p.deleted_at IS NULL AND p.active
        ORDER BY business, parent_category NULLS FIRST, category, product`
    );

    if (r.rowCount === 0) {
      console.log('No sellable products. The PIF cart cannot be demonstrated.');
      note('STOP', 'No sellable PIF product — the cart and checkout cannot be shown.');
      return;
    }

    console.log(`${r.rowCount} product(s) a customer can buy:\n`);
    for (const row of r.rows) {
      const where = row.parent_category
        ? `${row.parent_category} > ${row.category}`
        : row.category || '(no category)';
      console.log(`   ${row.business.padEnd(12)} ${where}`);
      console.log(`        ${row.product}${row.has_image ? '' : '   (no image — placeholder will show)'}`);
    }
    console.log(
      '\nNavigate straight to these during the demo. Every other category is empty,\n' +
        'so browsing at random will show "no products" in front of the client.'
    );
    note('OK', `${r.rowCount} sellable PIF product(s) — the paths above are where to go.`);
  } catch (error) {
    console.log(`Could not read: ${error.code || error.name || 'error'}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- J
/**
 * HOW LONG IS THE DEMO SIGN-IN GOOD FOR? Read-only.
 *
 * There is no separate "demo access" to switch on. A customer session IS
 * the thing, and its life is already governed by REFRESH_TOKEN_TTL_DAYS,
 * which apps/api/.env sets to 30. Signing in starts that clock; this
 * reports where it has got to.
 *
 * Times come from the DATABASE's clock, converted to Asia/Kolkata, not
 * from this machine's idea of the time or its locale.
 *
 * Nothing personal is printed: no name, number, customer id, session id,
 * address, device or token. Only when a session began, when it ends, and
 * whether it is still good.
 */
async function sessionStatus(env) {
  heading('DEMO SESSION — is it active, and until when?');

  const url = env && env.DATABASE_URL;
  if (!url) {
    note('STOP', 'apps/api/.env has no DATABASE_URL.');
    return;
  }

  let Client;
  for (const spec of ['pg', path.join(__dirname, 'apps', 'api', 'node_modules', 'pg')]) {
    try {
      ({ Client } = require(spec));
      break;
    } catch {
      /* next */
    }
  }
  if (!Client) {
    note('STOP', "The 'pg' library was not found — run this from the project root.");
    return;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const who = await client.query('SELECT current_database() AS db');
    if (who.rows[0].db !== REQUIRED_DATABASE) {
      note('STOP', `Connected to "${who.rows[0].db}", not ${REQUIRED_DATABASE}. Nothing was read.`);
      return;
    }
    await client.query('SET default_transaction_read_only = on');

    const r = await client.query(
      `SELECT to_char(s.issued_at  AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') AS began_ist,
              to_char(s.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') AS ends_ist,
              (s.revoked_at IS NOT NULL) AS revoked,
              (s.expires_at > now() AND s.revoked_at IS NULL) AS usable,
              round(EXTRACT(EPOCH FROM (s.expires_at - now())) / 86400.0, 1) AS days_left
         FROM shared.auth_sessions s
         JOIN shared.customers c ON c.id = s.principal_id
        WHERE s.principal_type = 'CUSTOMER'
          AND c.mobile_number = ANY($1::text[])
        ORDER BY s.issued_at DESC
        LIMIT 5`,
      [DEMO_MOBILE_FORMS]
    );

    if (r.rowCount === 0) {
      console.log('No session has ever been created for the demo account.');
      note('ACTION', 'Sign in once in the Customer App. That single sign-in starts the 30-day clock.');
      return;
    }

    const live = r.rows.filter((x) => x.usable);
    console.log(`${r.rowCount} recent session(s), newest first:\n`);
    for (const row of r.rows) {
      const state = row.revoked ? 'revoked' : row.usable ? 'ACTIVE' : 'expired';
      console.log(
        `   began ${row.began_ist} IST   ends ${row.ends_ist} IST   ${state}` +
          (row.usable ? `   (${row.days_left} days left)` : '')
      );
    }

    if (live.length > 0) {
      const newest = live[0];
      console.log(
        `\n   The demo account is SIGNED IN until ${newest.ends_ist} IST — ` +
          `${newest.days_left} days from now.`
      );
      note(
        'OK',
        `Demo access is ACTIVE and runs to ${newest.ends_ist} IST (${newest.days_left} days). ` +
          `No further OTP is needed before then.`
      );
      console.log(
        '\n   Nothing was switched on to achieve this and nothing has to be switched off\n' +
          '   afterwards: when that moment passes the session simply ends, and the next\n' +
          '   sign-in asks for an OTP exactly as it does for every other customer.'
      );
    } else {
      note('ACTION', 'No usable session right now — sign in once in the Customer App to start the 30 days.');
    }
  } catch (error) {
    console.log(`Could not read: ${error.code || error.name || 'error'}`);
    note('STOP', `The check failed (${error.code || error.name || 'error'}).`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- K
/**
 * WHAT IS ACTUALLY RECORDED FOR THE DEMO OFFICER? Read-only.
 *
 * "Your eligible days are not recorded yet" is the officer-facing screen
 * reporting that it found NOTHING — not a zero. Two different tables feed
 * the RIK screens and they are not interchangeable:
 *
 *   rik.customer_period_eligibility            one eligible_days per
 *                                              period. THE ENTITLEMENT
 *                                              ENGINE reads this
 *                                              (RikEligibilityService
 *                                              .resolveBasis) to work out
 *                                              what may be drawn.
 *
 *   rik.customer_period_ration_eligibility     one row per ration type
 *                                              (FRESH / DRY), added by
 *                                              migration 0066. THE SCREEN
 *                                              reads this, and shows "not
 *                                              recorded yet" when a type
 *                                              has no row.
 *
 * So a missing figure can mean the screen has nothing to show while the
 * engine still has a basis, or that neither has anything. The two are
 * reported separately below, because restoring the wrong one would leave
 * the same message on screen.
 *
 * This prints the officer's NAME and RIK id on purpose — you asked to see
 * the existing record before anything is changed. The mobile number is
 * still never printed. NOTHING here writes.
 */
async function rikOfficer(env) {
  heading('THE DEMO OFFICER — what is on record (read-only)');

  const url = env && env.DATABASE_URL;
  if (!url) {
    note('STOP', 'apps/api/.env has no DATABASE_URL.');
    return;
  }

  let Client;
  for (const spec of ['pg', path.join(__dirname, 'apps', 'api', 'node_modules', 'pg')]) {
    try {
      ({ Client } = require(spec));
      break;
    } catch {
      /* next */
    }
  }
  if (!Client) {
    note('STOP', "The 'pg' library was not found — run this from the project root.");
    return;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const who = await client.query('SELECT current_database() AS db');
    if (who.rows[0].db !== REQUIRED_DATABASE) {
      note('STOP', `Connected to "${who.rows[0].db}", not ${REQUIRED_DATABASE}. Nothing was read.`);
      return;
    }
    await client.query('SET default_transaction_read_only = on');

    // --- who the demo number belongs to -------------------------------
    const cust = await client.query(
      `SELECT id, name, rik_id, dietary_preference, is_active, (deleted_at IS NOT NULL) AS removed
         FROM shared.customers
        WHERE mobile_number = ANY($1::text[])`,
      [DEMO_MOBILE_FORMS]
    );
    if (cust.rowCount === 0) {
      console.log('No customer exists for the demo number.');
      note('STOP', 'No customer for the demo number — nothing to restore against.');
      return;
    }
    const c = cust.rows[0];
    console.log('OFFICER ON RECORD');
    console.log(`   name               : ${c.name ?? '(none)'}`);
    console.log(`   RIK id             : ${c.rik_id ?? '(none — not a RIK officer)'}`);
    console.log(`   dietary preference : ${c.dietary_preference ?? '(NOT SET — the engine refuses without this)'}`);
    console.log(`   active             : ${c.is_active ? 'yes' : 'NO'}   removed: ${c.removed ? 'YES' : 'no'}`);

    if (!c.dietary_preference) {
      note('STOP', 'Dietary preference is not set. The entitlement engine refuses to calculate without it.');
    }

    // --- the periods --------------------------------------------------
    console.log('\nENTITLEMENT PERIODS');
    const periods = await client.query(
      `SELECT id, name, status,
              to_char(start_date,'DD Mon YYYY') AS starts,
              to_char(end_date,'DD Mon YYYY')   AS ends,
              (current_date BETWEEN start_date AND end_date) AS covers_today
         FROM rik.entitlement_periods
        ORDER BY start_date DESC
        LIMIT 6`
    );
    for (const p of periods.rows) {
      console.log(
        `   ${String(p.name ?? '(unnamed)').padEnd(18)} ${p.starts} – ${p.ends}  ${p.status}` +
          (p.covers_today ? '   <-- covers today' : '')
      );
    }
    const current = periods.rows.find((p) => p.covers_today && p.status !== 'CLOSED');
    if (!current) {
      note('STOP', 'No open period covers today — RIK cannot calculate an entitlement whatever the eligible days say.');
    }

    // --- what the ENGINE has ------------------------------------------
    console.log('\nELIGIBLE DAYS — what the ENTITLEMENT ENGINE reads');
    const legacy = await client.query(
      `SELECT p.name AS period, e.eligible_days,
              (p.id = $2) AS is_current
         FROM rik.customer_period_eligibility e
         JOIN rik.entitlement_periods p ON p.id = e.period_id
        WHERE e.customer_id = $1
        ORDER BY p.start_date DESC
        LIMIT 6`,
      [c.id, current ? current.id : null]
    );
    if (legacy.rowCount === 0) {
      console.log('   nothing recorded in any period.');
    } else {
      for (const r of legacy.rows) {
        console.log(
          `   ${String(r.period ?? '(unnamed)').padEnd(18)} ${r.eligible_days} day(s)` +
            (r.is_current ? '   <-- current period' : '')
        );
      }
    }

    // --- what the SCREEN has ------------------------------------------
    console.log('\nELIGIBLE DAYS — what the "Know Your Ration" SCREEN reads');
    const perType = await client.query(
      `SELECT p.name AS period, r.ration_type, r.eligible_days,
              (p.id = $2) AS is_current
         FROM rik.customer_period_ration_eligibility r
         JOIN rik.entitlement_periods p ON p.id = r.period_id
        WHERE r.customer_id = $1
        ORDER BY p.start_date DESC, r.ration_type
        LIMIT 12`,
      [c.id, current ? current.id : null]
    );
    if (perType.rowCount === 0) {
      console.log('   nothing recorded in any period — THIS is why the screen says "not recorded yet".');
    } else {
      for (const r of perType.rows) {
        console.log(
          `   ${String(r.period ?? '(unnamed)').padEnd(18)} ${String(r.ration_type).padEnd(6)} ` +
            `${r.eligible_days} day(s)` + (r.is_current ? '   <-- current period' : '')
        );
      }
    }

    // --- the verdict ---------------------------------------------------
    const engineHasCurrent = legacy.rows.some((r) => r.is_current);
    const screenHasCurrent = perType.rows.some((r) => r.is_current);
    console.log('');
    if (!current) {
      note('ACTION', 'Open an entitlement period covering today in the Admin Portal first.');
    } else if (engineHasCurrent && screenHasCurrent) {
      note('OK', 'Both figures are present for the current period. If the screen still says otherwise, say so.');
    } else if (!engineHasCurrent && !screenHasCurrent) {
      note(
        'ACTION',
        'NOTHING is recorded for the current period — neither the engine basis nor the screen figures. ' +
          'This is restored in the Admin Portal: RIK > Officers > this officer > eligibility.'
      );
    } else if (engineHasCurrent && !screenHasCurrent) {
      note(
        'ACTION',
        'The engine has a basis but the SCREEN figures are missing for the current period, which is ' +
          'exactly the "not recorded yet" message. Set them in the Admin Portal.'
      );
    } else {
      note('ACTION', 'The screen figures exist but the engine has no basis for the current period. Set it in the Admin Portal.');
    }
    console.log(
      '\nNothing was changed by this report. No eligibility figure was created, altered or guessed.'
    );
  } catch (error) {
    console.log(`Could not read: ${error.code || error.name || 'error'}`);
    note('STOP', `The check failed (${error.code || error.name || 'error'}).`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- run
(async () => {
  console.log('e-Samagri SMS OTP diagnosis — READ-ONLY. No SMS is sent. Nothing is changed.');
  const env = readEnvFile();
  if (RIK_OFFICER) {
    await rikOfficer(env);
  } else if (SESSION_STATUS) {
    await sessionStatus(env);
  } else if (OTP_STATE) {
    await otpState(env);
  } else if (DEMO_READY) {
    await demoReady(env);
  } else if (RIK_DEMO_CHECK) {
    await rikDemoCheck(env);
  } else if (POST_PROBE) {
    await postProbe();
    await checkAuditLog(env);
  } else if (AUTH_PROBE) {
    // Focused run: the credential question only. No port, database or
    // configuration noise.
    checkConfig(env);
    await authProbe(env);
  } else {
    checkPort();
    checkConfig(env);
    await checkAuditLog(env);
    await checkGateway(env);
    console.log('\n(For the credential question specifically, run: node sms-otp-diagnose.cjs --auth-probe)');
  }

  heading('VERDICT');
  if (findings.length === 0) {
    console.log('No conclusion could be drawn. Send this whole output back.');
  }
  for (const f of findings) {
    const label = { STOP: 'PROBLEM', OK: 'OK     ', ACTION: 'DO THIS', CHECK: 'CHECK  ' }[f.level];
    console.log(`  [${label}] ${f.text}`);
  }
  console.log(
    '\nNothing above was changed by this script. Copy the whole output back —\n' +
      'it contains no key, no password and no OTP.'
  );
})();
