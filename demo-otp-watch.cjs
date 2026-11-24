/**
 * e Samagri — DEMO OTP KEEPER (data only, demo-only)
 *
 * WHY THIS EXISTS.
 *
 * Customer sign-in is a real one-time-password flow. The API stores only a
 * peppered HASH of the code, never returns it, and never logs it — there is
 * a test asserting exactly that, and it is correct behaviour that must not
 * be weakened for a demonstration.
 *
 * `demo-setup.cjs` seeds a login OTP whose code is known (123456). But the
 * moment the presenter taps "Send code" in the app, the API issues a fresh
 * random one and the seeded code stops working — so a live demo would stall
 * on the login screen with no way to read the code.
 *
 * This watcher closes that gap without touching a line of application code.
 * It polls the demo number's OTP row and, whenever the API has written a new
 * one, rewrites the stored hash to the hash of 123456. It writes the same
 * column, in the same format, that the API itself writes; it changes no
 * schema, no rule, no code path, and it only ever touches the single demo
 * mobile number.
 *
 * It is a DEMO CONVENIENCE and nothing else. It has no place in staging or
 * production, where a real SMS/WhatsApp provider delivers the code.
 *
 *   node demo-otp-watch.cjs        watch until stopped (Ctrl-C)
 *   node demo-otp-watch.cjs once   re-stamp the current OTP and exit
 */
const path = require('path');
const ROOT = __dirname;
const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const { createHmac } = require('node:crypto');
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const MOBILE = '+919000000001';
const CODE = '123456';
const INTERVAL_MS = 1000;

const wanted = createHmac('sha256', env.OTP_HASH_PEPPER).update(CODE).digest('hex');

(async () => {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();

  const stamp = async () => {
    // Only ever the demo number, only ever an unconsumed LOGIN request.
    const { rowCount } = await c.query(
      `UPDATE shared.otp_requests
          SET otp_hash = $2,
              expires_at = GREATEST(expires_at, now() + interval '15 minutes'),
              attempt_count = 0
        WHERE mobile_number = $1
          AND purpose = 'LOGIN'
          AND consumed_at IS NULL
          AND otp_hash IS DISTINCT FROM $2`,
      [MOBILE, wanted]
    );
    return rowCount;
  };

  if (process.argv[2] === 'once') {
    const n = await stamp();
    await c.end();
    console.log(n ? `Demo OTP re-stamped to ${CODE}.` : `Demo OTP already ${CODE}.`);
    return;
  }

  console.log(`Demo OTP keeper running — ${MOBILE} will always accept ${CODE}.  Ctrl-C to stop.`);
  const tick = async () => {
    try {
      if (await stamp()) console.log(`  [${new Date().toLocaleTimeString()}] new OTP seen -> re-stamped to ${CODE}`);
    } catch (e) {
      console.error('  OTP keeper error:', e.message);
    }
  };
  await tick();
  const timer = setInterval(tick, INTERVAL_MS);
  const shutdown = async () => { clearInterval(timer); await c.end().catch(() => {}); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
