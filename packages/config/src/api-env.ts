import { z } from 'zod';
import { loadEnv } from './env-utils';

/**
 * Required environment configuration for apps/api (the NestJS backend).
 *
 * This schema exists ahead of the NestJS scaffolding itself (STEP 4) on
 * purpose: STEP 2's job is to fix the *contract* — every setting the
 * foundation subsystems (DB connection, auth/session, RBAC, WhatsApp
 * integration boundary, CORS/security) will need in STEP 4-8, its type,
 * and whether it is a secret — before any of that code exists. STEP 4
 * wires `loadApiEnv()` into Nest's ConfigModule; it does not redefine
 * these settings.
 *
 * SECRET vs non-secret is called out per field below. Secrets:
 *   - must never be hardcoded anywhere in source,
 *   - must never be logged (see env-utils.ts — errors report shape, not values),
 *   - must never be sent to a frontend response,
 *   - are read here from process.env only; apps/api's own README (STEP 2)
 *     documents where real values come from per environment (local .env,
 *     the deployment platform's secret store) — this package never
 *     supplies a default for a secret field.
 */

const boolFromString = (label: string) =>
  z.preprocess((val) => {
    if (typeof val !== 'string') return val;
    if (val.toLowerCase() === 'true') return true;
    if (val.toLowerCase() === 'false') return false;
    return val; // let zod's boolean check fail with a clear message
  }, z.boolean({ invalid_type_error: `${label} must be "true" or "false"` }));

/**
 * Treats an empty-string env value as `undefined`, then makes the
 * result optional. Note the ordering: the transform must run *inside*
 * an already-optional inner schema (`inner.optional()`), not the other
 * way around — `z.preprocess(fn, inner).optional()` looks equivalent
 * but is not: the outer `.optional()` only short-circuits when the RAW
 * input is `undefined`. Here the raw input is `""` (present, just
 * empty), so the preprocess still runs, correctly turning it into
 * `undefined` — but that `undefined` then hits `inner`, which (without
 * its own `.optional()`) still requires a value and fails with
 * "Required". Making `inner` itself optional is what actually lets the
 * post-transform `undefined` through.
 */
function emptyToUndefined<S extends z.ZodTypeAny>(inner: S) {
  return z.preprocess((val) => (val === '' ? undefined : val), inner.optional());
}

export const apiEnvSchema = z.object({
  // --- Runtime -------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- Database (connects to the frozen Phase 2 schema; this package
  //     only carries connection settings, never schema) ---------------
  // SECRET: DATABASE_URL embeds the DB password.
  DATABASE_URL: z.string().min(1, 'Required — postgres connection string'),
  DATABASE_SSL: boolFromString('DATABASE_SSL').default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(0),
  // How long an idle client sits in the pool before being closed.
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // How long to wait for a connection from the pool before failing —
  // deliberately short so a DB outage fails fast instead of piling up
  // hung requests.
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  // Server-side guard against a runaway query holding a connection (and
  // a row lock) forever; applied per-session via `SET statement_timeout`.
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // --- JWT access token (short-lived, never persisted server-side) ---
  // SECRET
  JWT_ACCESS_SECRET: z.string().min(32, 'Required, >=32 chars — signs short-lived access tokens'),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),

  // --- Refresh session cookie (backs shared.auth_sessions rotation) --
  REFRESH_COOKIE_NAME: z.string().min(1).default('esamagri_rt'),
  // Empty means HOST-ONLY: the Domain attribute is left off the cookie
  // entirely, so the browser binds it to exactly the host that was
  // asked. That is the only form that serves localhost and a LAN
  // address from one configuration — `Domain=localhost` is refused by
  // any other host, and an IP address is not a legal Domain value at
  // all (RFC 6265 domain-matching is defined for names, not addresses),
  // so there is no single non-empty value that works for both. Set a
  // real parent domain here only to share one cookie across subdomains
  // in a deployed environment. See auth.controller.ts, which omits the
  // attribute rather than sending an empty one.
  REFRESH_COOKIE_DOMAIN: z.string().trim().default(''),
  /**
   * HOW LONG A SIGNED-IN CUSTOMER STAYS SIGNED IN — 365 days, ROLLING.
   *
   * Approved session policy. Every successful refresh issues a new token and
   * sets its expiry to this many days from THAT refresh (see
   * `TokenService.refreshExpiryFromNow`), so a resident who opens the app
   * even once a year never has to verify an OTP again. There is deliberately
   * NO absolute cap: a fixed maximum would force a re-verification, and an
   * OTP the facility pays for, on someone who has done nothing wrong.
   *
   * WHAT CARRIES THE RISK INSTEAD OF A SHORT LIFETIME. The token is opaque
   * and 256-bit, only its SHA-256 hash is stored, it rotates on every use,
   * reuse of a rotated token revokes the whole family, and staff can revoke a
   * customer's sessions outright. Those are the controls that make a long
   * lifetime safe; shortening the lifetime instead would buy less and cost an
   * SMS every time.
   *
   * This was 30 days. Nothing else about the mechanism changed with it.
   */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(365),

  // --- Password hashing (staff accounts, shared.users) ----------------
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // --- Staff TOTP (where specified by Phase 3A for elevated roles) ---
  STAFF_TOTP_ISSUER: z.string().min(1).default('e Samagri'),

  // --- Staff login brute-force protection ------------------------------
  // No dedicated "login_attempts" table exists in the frozen schema, and
  // adding one would be a schema change — so this is enforced by
  // counting recent STAFF_LOGIN_FAILURE rows in the existing, already-
  // mandatory shared.audit_log (see StaffAuthService), not a new store.
  STAFF_LOGIN_MAX_FAILURES_PER_WINDOW: z.coerce.number().int().positive().default(5),
  STAFF_LOGIN_LOCKOUT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),

  // --- Customer OTP auth ----------------------------------------------
  // SECRET: pepper mixed into the OTP hash before it is stored — the DB
  // never holds a plaintext or unsalted OTP (shared.otp_requests).
  OTP_HASH_PEPPER: z.string().min(16, 'Required, >=16 chars'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  OTP_REQUEST_MAX_PER_WINDOW: z.coerce.number().int().positive().default(5),

  // --- OTP delivery channel (config-dependent integration boundary) --
  //
  // 'SMS_GATEWAY_HUB' IS IMPLEMENTED. It was added together with
  // apps/api/src/notification/smsgatewayhub.provider.ts and the
  // SMS_GATEWAY_HUB_* settings below, in one change, which is the rule
  // this block has always stated: a value becomes spellable in the same
  // commit as the code behind it, never before.
  //
  // THIS ENUM IS THE FIRST OF TWO GUARDS, AND THE OMISSIONS ARE STILL
  // THE POINT. 'SMS_2FACTOR' is gone because its code is gone, and
  // 'SMS_GATEWAY' is gone because it never had any code at all: it was
  // an accepted value with no implementation behind it, so selecting it
  // produced a process that booted cleanly, answered every sign-in
  // normally, and delivered nothing — a silent failure with no error,
  // no audit row and no log line to find it by. Both remain refused BY
  // NAME in loadApiEnv below, and note that 'SMS_GATEWAY_HUB' is a
  // different string from the retired 'SMS_GATEWAY': the refusal is an
  // exact-key lookup, so the new value does not collide with it.
  //
  // The second guard is OtpSmsService.send: any selected value with no
  // transport behind it still yields FAILED/NO_PROVIDER, which
  // CustomerAuthService audits as OTP_DELIVERY_FAILED. 'WHATSAPP'
  // remains spellable because the WhatsApp block below governs
  // order/status notifications too, and those are a separate
  // integration — but it still buys no OTP delivery, and the service
  // refuses it loudly rather than quietly.
  //
  // When credentials are unavailable the boundary must isolate itself
  // (log only) rather than fabricate a successful send.
  OTP_DELIVERY_PROVIDER: z.enum(['NONE', 'WHATSAPP', 'SMS_GATEWAY_HUB']).default('NONE'),

  // --- WhatsApp Business Platform (official API only — never browser/
  //     QR-session automation, per explicit instruction) ---------------
  // SECRET: WHATSAPP_API_TOKEN
  //
  // emptyToUndefined: a .env file conventionally spells "not set" as
  // `KEY=` (empty string), not by omitting the line — dotenv parses
  // that as `""`, which z.string().optional() alone would NOT treat as
  // absent (optional only skips validation for `undefined`, not `""`),
  // so an empty placeholder in .env.example would otherwise fail
  // .url()/.min(1) validation instead of being treated as "unset".
  WHATSAPP_API_BASE_URL: emptyToUndefined(z.string().url()),
  WHATSAPP_API_TOKEN: emptyToUndefined(z.string().min(1)),
  WHATSAPP_BUSINESS_PHONE_NUMBER_ID: emptyToUndefined(z.string().min(1)),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: emptyToUndefined(z.string().min(1)),

  // --- SMS OTP delivery: SMS Gateway Hub --------------------------------
  //
  // These replace the five SMS_2FACTOR_* settings that stood in this
  // place (base URL, API key, template name, timeout, dry-run) and were
  // removed with the 2Factor provider. They were added in the same
  // change as apps/api/src/notification/smsgatewayhub.provider.ts, which
  // is the only code that reads them: a credential that exists before
  // its code does is a credential nothing validates.
  //
  // THERE IS NO BASE URL SETTING, DELIBERATELY. The endpoint is a fixed
  // constant in the provider, because the request body carries the API
  // key and a URL read from .env is a URL a mistake can point somewhere
  // else.
  //
  // EVERY ONE OF THESE IS OPTIONAL IN THE SCHEMA and enforced by the
  // cross-field rule in loadApiEnv instead: the API key and sender ID
  // become REQUIRED the moment OTP_DELIVERY_PROVIDER=SMS_GATEWAY_HUB is
  // selected, and are simply absent otherwise, so no existing .env has
  // to change for the API to keep starting.
  //
  // SECRET: SMS_GATEWAY_HUB_API_KEY. It is never defaulted here, never
  // placed in .env.example, and never logged — the provider checks that
  // it is present without reading its value out.
  SMS_GATEWAY_HUB_API_KEY: emptyToUndefined(z.string().min(1)),

  // The DLT-approved sender header (page 10 of the vendor document: a
  // six-character approved sender ID). The bound is deliberately looser
  // than six so that a header approved at a different length is not
  // rejected here by a rule the registry does not actually impose.
  SMS_GATEWAY_HUB_SENDER_ID: emptyToUndefined(z.string().trim().min(3).max(11)),

  // --- DLT identifiers -----------------------------------------------
  //
  // THE TWO VALUES THE EARLIER XML IMPLEMENTATION DID NOT SEND AT ALL.
  //
  // The vendor's 11-page HTTP API document contains no Entity ID or
  // Content Template ID field anywhere, so the first implementation sent
  // neither, and the integration report recorded that as an open
  // question. SMS Gateway Hub support has since supplied the GET SendSMS
  // form, which carries both, and a live send using it was accepted and
  // delivered to a handset. These are therefore now REQUIRED whenever
  // SMS_GATEWAY_HUB is the selected channel — see the cross-field rule
  // in loadApiEnv.
  //
  // NEITHER IS A SECRET. A Principal Entity ID and a Content Template ID
  // are DLT registration identifiers, visible to the operator in the
  // provider's own panel and returned in plain text by its `gettemplates`
  // and `getsenderid` APIs. They are not credentials and nothing is
  // gained by hiding them — but they are not defaulted either, because a
  // guessed registration ID would be matched against the registry and
  // rejected, and a wrong one is worse than an absent one.
  //
  // VALIDATED BY SHAPE, DELIBERATELY LOOSELY. Both are 19-digit numeric
  // strings on the Indian DLT registries today, and an 18-digit value
  // caused exactly the failure this check would have caught — one dropped
  // keystroke, silently accepted, matching no template. Digits-only is
  // enforced because a non-numeric registration ID is always a mistake;
  // the LENGTH is not pinned to 19, because that is a registry
  // convention rather than a documented guarantee, and a build that
  // refused a validly-issued 20-digit ID would be a worse failure than
  // the one being prevented.
  SMS_GATEWAY_HUB_ENTITY_ID: emptyToUndefined(
    z
      .string()
      .trim()
      .regex(/^\d+$/, 'Must be the all-digit Principal Entity ID from the DLT registry')
      .min(10)
      .max(24)
  ),
  SMS_GATEWAY_HUB_DLT_TEMPLATE_ID: emptyToUndefined(
    z
      .string()
      .trim()
      .regex(/^\d+$/, 'Must be the all-digit Content Template ID from the DLT registry')
      .min(10)
      .max(24)
  ),

  // Route, Channel and DCS are STRINGS, not numbers, and go into the
  // XML exactly as written. Page 10 documents Route=1 (default),
  // Channel=2 (transactional) and DCS=0 (English) — those are the
  // defaults — but page 3 of the same document hints at a non-numeric
  // channel for OTP traffic ("for OTP = OTP"), which page 10
  // contradicts. Keeping them as free strings means that if SMS Gateway
  // Hub confirms a different value, it is a .env edit and not a code
  // change. DCS is the exception: the document gives exactly two legal
  // values, so it is constrained to them.
  SMS_GATEWAY_HUB_ROUTE: z.string().trim().min(1).default('1'),
  SMS_GATEWAY_HUB_CHANNEL: z.string().trim().min(1).default('2'),
  SMS_GATEWAY_HUB_DCS: z.enum(['0', '8']).default('0'),

  // How long to wait for the gateway before giving up. A sign-in is
  // held open for this long, so it is bounded and short; exceeding it
  // produces FAILED/TIMEOUT, which the caller audits and does not
  // throw.
  SMS_GATEWAY_HUB_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // FlashSms is NOT a setting. It is fixed at 0 (a normal, stored SMS)
  // in the provider, because a flash message appears on screen without
  // being saved and a code nobody can go back and read is useless.
  //
  // What did NOT move, and must not: e-Samagri still generates every
  // code itself (OtpService.generateCode, a CSPRNG), still stores only
  // HMAC-SHA256(OTP_HASH_PEPPER, code) in shared.otp_requests.otp_hash,
  // and still verifies it locally in constant time. Whatever provider
  // arrives next is TRANSPORT ONLY: its own autogen/verify flow is not
  // to be adopted, because otp_hash is NOT NULL (migration 0004) and
  // holds the HMAC of OUR code, and because the expiry, attempt
  // counter, single-use flag and per-number request limit all hang off
  // the local verification path.

  // --- CORS / security --------------------------------------------------
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1, 'Required — comma-separated list, e.g. https://app.esamagri.example,https://admin.esamagri.example'),

  // --- Correlation / audit ---------------------------------------------
  CORRELATION_ID_HEADER: z.string().min(1).default('x-correlation-id'),

  // --- Rate limiting (LAUNCH HARDENING) --------------------------------
  //
  // Three classes, counted per caller per window — see
  // apps/api/src/common/rate-limit.guard.ts for why one number cannot serve
  // all three. Defaults are deliberately generous enough that a real
  // facility never meets them and tight enough that a password-guessing
  // loop does: 20 auth attempts a minute is ~1 every 3 seconds, which no
  // human sign-in approaches.
  //
  // RATE_LIMIT_ENABLED defaults to FALSE under NODE_ENV=test, because the
  // integration suites deliberately make hundreds of requests a second from
  // one address; everywhere else it defaults to true.
  RATE_LIMIT_ENABLED: boolFromString('RATE_LIMIT_ENABLED').optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_AUTH_PER_WINDOW: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WRITE_PER_WINDOW: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_READ_PER_WINDOW: z.coerce.number().int().positive().default(900),

  // --- Request body limits (LAUNCH HARDENING) --------------------------
  // A JSON body this API accepts is a form or a cart, never a file: files
  // go through the multipart upload path, which has its own limit
  // (PIF_MEDIA_MAX_BYTES). Keeping this small means an oversized body is
  // refused at the parser instead of being buffered.
  REQUEST_BODY_LIMIT: z.string().min(2).default('256kb'),
  // How many reverse proxies sit in front of this API. 0 means none; 1 is
  // the usual nginx-in-front deployment. It decides which address `req.ip`
  // resolves to, which is what rate limiting counts.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  // --- Bulk catalogue import (LAUNCH HARDENING) ------------------------
  PIF_IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),
  PIF_IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(5_000),

  // --- PIF product images (PHASE F) ------------------------------------
  // Where an administrator's uploaded product image is written, and the
  // limits the server enforces on it. A default is supplied deliberately:
  // an existing deployment's .env must keep starting unchanged, and an
  // image upload must never be able to choose its own destination — the
  // path comes from here, the filename is generated, and nothing a client
  // sends takes part in either.
  PIF_MEDIA_ROOT: z.string().min(1).default('var/pif-media'),
  PIF_MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(2_000_000),

  // --- RIK provision images --------------------------------------------
  // The same arrangement for RIK, in a directory of its own so that a RIK
  // picture and a PIF picture can never be confused for one another and
  // either store can be moved or restored without touching the other. A
  // default is supplied for the same reason as above: no existing .env file
  // has to change for provision images to start working, and the size limit
  // is deliberately the PIF one — PIF_MEDIA_MAX_BYTES governs both, so an
  // operator has one number to reason about rather than two that can drift.
  RIK_MEDIA_ROOT: z.string().min(1).default('var/rik-media'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema> & { RATE_LIMIT_ENABLED: boolean };

/**
 * Validates `source` (pass `process.env` in real use; a fixture object in
 * tests) and returns fully-typed config, or throws with every problem
 * listed at once. Call this exactly once, at process startup.
 */
export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  // BEFORE the schema runs, not after. A retired provider value is a
  // valid-looking string that this build does not implement, and zod
  // would reject it with a generic "invalid enum value" listing the
  // permitted values — which tells an operator what is allowed but not
  // what became of the channel they asked for. An operator who writes
  // OTP_DELIVERY_PROVIDER=SMS_2FACTOR into a .env — copied from an older
  // file, a runbook or a note — is told by name what happened and what
  // the state of SMS delivery now is.
  //
  // Refusing to start is the correct outcome. The alternative is a
  // process that serves every sign-in normally while no code is ever
  // delivered, which is the exact failure this cleanup set out to make
  // impossible.
  assertProviderIsNotRetired(source.OTP_DELIVERY_PROVIDER);

  const parsed = loadEnv(apiEnvSchema, source, 'api');

  // Cross-field rule the schema alone can't express: if a WhatsApp
  // delivery channel is selected, its credentials become required.
  if (parsed.OTP_DELIVERY_PROVIDER === 'WHATSAPP' || requiresWhatsappCredentials(source)) {
    const missing = (
      ['WHATSAPP_API_BASE_URL', 'WHATSAPP_API_TOKEN', 'WHATSAPP_BUSINESS_PHONE_NUMBER_ID'] as const
    ).filter((key) => !parsed[key]);
    if (missing.length > 0) {
      throw new Error(
        `[api] OTP_DELIVERY_PROVIDER=WHATSAPP (or WhatsApp notifications are enabled) but missing: ${missing.join(', ')}. Refusing to start.`
      );
    }
  }

  // The same rule for SMS Gateway Hub, and the reason it exists: the
  // schema can mark the API key optional but cannot say "optional
  // UNLESS this other field selects it". Without this, selecting
  // SMS_GATEWAY_HUB with no key in .env would start cleanly and then
  // fail on the first sign-in — which is exactly the silent
  // non-delivery this whole block was written to make impossible.
  //
  // The message names the missing SETTINGS, never their values, and the
  // key is not read here at all.
  //
  // FOUR SETTINGS, NOT TWO, SINCE THE MOVE TO THE GET SendSMS API. The
  // Entity ID and the Content Template ID are sent on every request; a
  // request missing either is refused by DLT scrubbing rather than by the
  // gateway, so the message is accepted (ErrorCode 000) and then never
  // delivered. That is the worst failure mode this file exists to
  // prevent — a sign-in that looks fine and silently delivers nothing —
  // so both are required up front and the process refuses to start
  // without them.
  if (parsed.OTP_DELIVERY_PROVIDER === 'SMS_GATEWAY_HUB') {
    const missing = (
      [
        'SMS_GATEWAY_HUB_API_KEY',
        'SMS_GATEWAY_HUB_SENDER_ID',
        'SMS_GATEWAY_HUB_ENTITY_ID',
        'SMS_GATEWAY_HUB_DLT_TEMPLATE_ID',
      ] as const
    ).filter((key) => !parsed[key]);
    if (missing.length > 0) {
      throw new Error(
        `[api] OTP_DELIVERY_PROVIDER=SMS_GATEWAY_HUB but missing: ${missing.join(', ')}. ` +
          `Add them to apps/api/.env (the API key comes from the provider's API Codes page; ` +
          `the sender ID is your DLT-approved header; the Entity ID and Content Template ID ` +
          `are the DLT registration identifiers its getsenderid / gettemplates APIs return). ` +
          `Refusing to start.`
      );
    }
  }

  // Rate limiting defaults to OFF under NODE_ENV=test and ON everywhere
  // else. Expressed here rather than in the schema because it depends on
  // another field: the integration suites make hundreds of requests a
  // second from one address and would otherwise throttle themselves, while
  // a development or production process must be protected by default — an
  // operator should have to switch protection OFF deliberately, never ON.
  const rateLimitEnabled =
    parsed.RATE_LIMIT_ENABLED ?? parsed.NODE_ENV !== 'test';

  return { ...parsed, RATE_LIMIT_ENABLED: rateLimitEnabled };
}

/**
 * Provider values that used to be accepted here and no longer are, each
 * with the reason an operator needs in order to act on the refusal.
 *
 * Keeping the names listed — rather than simply deleting them from the
 * enum and letting the generic validation error speak — is what turns a
 * stale .env into a five-second fix instead of an investigation.
 *
 * THIS MAP WAS LEFT EXACTLY AS IT WAS when SMS Gateway Hub was
 * implemented. 'SMS_GATEWAY_HUB' and the retired 'SMS_GATEWAY' are
 * different strings and the lookup below is an exact key match, so the
 * new provider does not weaken either refusal — a .env still carrying
 * SMS_GATEWAY is still refused by name, and the refusal's advice is
 * updated to name the value that now works.
 */
const RETIRED_OTP_DELIVERY_PROVIDERS: Readonly<Record<string, string>> = {
  SMS_2FACTOR: 'the 2Factor integration was removed from this project',
  SMS_GATEWAY: 'that value never had an implementation behind it',
};

function assertProviderIsNotRetired(requested: string | undefined): void {
  if (requested === undefined) return;
  const reason = RETIRED_OTP_DELIVERY_PROVIDERS[requested];
  if (reason === undefined) return;
  // The advice changed when SMS Gateway Hub landed, and this is the
  // whole reason the refusal spells out a next step rather than just
  // saying no: an operator reaching this line has a stale .env, and the
  // useful thing to tell them is the value that now works. It is NOT a
  // suggestion to switch delivery on — SMS_GATEWAY_HUB needs its own
  // credentials, and selecting it without them is refused separately.
  throw new Error(
    `[api] OTP_DELIVERY_PROVIDER=${requested} is no longer supported — ${reason}. ` +
      `SMS delivery is now provided by OTP_DELIVERY_PROVIDER=SMS_GATEWAY_HUB, which requires ` +
      `SMS_GATEWAY_HUB_API_KEY and SMS_GATEWAY_HUB_SENDER_ID; set OTP_DELIVERY_PROVIDER=NONE if ` +
      `you do not have them. Refusing to start.`
  );
}

function requiresWhatsappCredentials(source: Record<string, string | undefined>): boolean {
  // WhatsApp is also used for order/status notifications independent of
  // OTP delivery; treat "any WhatsApp var set" as "WhatsApp integration
  // in use" so a half-configured integration fails fast too.
  return Boolean(
    source.WHATSAPP_API_BASE_URL || source.WHATSAPP_API_TOKEN || source.WHATSAPP_BUSINESS_PHONE_NUMBER_ID
  );
}
