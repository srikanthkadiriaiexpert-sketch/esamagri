# @esamagri/api

NestJS backend. Module boundaries mirror the frozen Phase 2 schemas
(`shared` / `rik` / `pif`) — see `src/app.module.ts` for the full layout
and the RIK/PIF isolation rule.

## Do not run this with an esbuild-based tool (`tsx`, `vite-node`, bare `esbuild`)

`npm run dev` uses `node --watch --require ts-node/register/transpile-only`,
not `tsx`. This is not a style preference — esbuild does not emit
TypeScript's `design:paramtypes` decorator metadata
(`emitDecoratorMetadata`), which NestJS's dependency injection relies on
for any constructor parameter that isn't given an explicit `@Inject()`
token. Under `tsx`, a plain `constructor(private readonly db: DatabaseService) {}`
silently receives `undefined` — no error at boot, just a `TypeError` the
first time the field is used. This was caught by hand during the STEP 5
database-integration checkpoint (`DatabaseHealthController` booted fine,
then 500'd on first request) and is why `tsx` was replaced.

`ts-jest` (tests) and `tsc` (the real `build`/`start` path) both go
through the actual TypeScript compiler and emit this metadata correctly
— only the previous `dev` script was affected. If a faster dev loop is
ever wanted, reach for `@swc/core` configured with
`jsc.transform.legacyDecorator` + `jsc.transform.decoratorMetadata`
(SWC supports emitting this; esbuild does not), never bare esbuild/tsx.

## Watch for ESM-only NestJS satellite packages (`@nestjs/jwt` and friends)

`apps/api` is CommonJS end-to-end (NestJS 11.x, Jest+ts-jest, `tsc`), the
same reasoning as the `tsx` pitfall above. `@nestjs/jwt@12.x` ships with
`"type": "module"` and **no CJS build at all** — importing it here doesn't
fail at `tsc`/build time (TypeScript's `esModuleInterop` happily
typechecks it), but Jest's CommonJS `require()` pipeline explodes the
moment anything imports it: `SyntaxError: Cannot use import statement
outside a module`, pointing at `@nestjs/jwt/dist/index.js`'s own
`import jsonwebtoken from 'jsonwebtoken'`. This is the exact same class of
bug as the `@nestjs/testing` version pin from the STEP 4→3B dependency
fix, just a different package: a NestJS 12.x-line satellite package
dropped CJS support while this app stays on the NestJS 11.x line.

Fixed by pinning `@nestjs/jwt` to `^11.0.2` (the last line with a real CJS
`main` — `peerDependencies` confirms it's compatible with
`@nestjs/common@^11.2.3`). Before upgrading **any** `@nestjs/*` satellite
package (`@nestjs/jwt`, `@nestjs/passport`, etc.) independently of the
core `@nestjs/common`/`@nestjs/core` version, check
`node_modules/<pkg>/package.json` for `"type": "module"` with no CJS
`exports.require` entry — that combination will typecheck and build fine
and only fail at `jest` runtime, so `npm run typecheck` / `npm run build`
passing is not proof it's safe to use here.

## Database

`src/database/` (`DatabaseModule`, `@Global()`) owns the single `pg.Pool`
connection to the approved Phase 2 database and nothing else — no
schema knowledge, no ORM, no auto-sync. `DatabaseService` exposes
`query()`, `withTransaction()`, `checkReadiness()`, and the one-time
startup schema-contract check against `database/migrations`' approved
shape (47 tables / 5 views). See `src/database/schema-contract.ts` for
why that check queries `pg_catalog` rather than `information_schema`
(the latter is privilege-filtered and would systematically undercount
`shared` — `shared.idempotency_keys` has zero direct grants by design).

`GET /health` — liveness only, no DB dependency, always responds.
`GET /health/ready` — readiness: a live `SELECT 1` + the cached
schema-contract result; 503 if either is bad.
`GET /health/views` — lists the 5 approved views the startup check found.

### Local Postgres role

The approved migrations (0018/0023) create per-module login roles
(`app_shared`, `app_rik`, `app_pif`, plus read-only `app_reporting_*`) —
there is deliberately no single role with blanket access, matching the
least-privilege design. Because this backend is one process serving all
modules, its own connection role should be a member of `app_shared`,
`app_rik`, and `app_pif` (inherits their combined grants):

```sql
CREATE ROLE esamagri_app LOGIN PASSWORD '...';
GRANT app_shared, app_rik, app_pif TO esamagri_app;
GRANT CONNECT ON DATABASE <your db> TO esamagri_app;
```

This is a role/grant operation only — it does not touch, add to, or
compete with the approved migrations or the roles they create.

## Authentication (STEP 6)

`src/auth/` — customer mobile+OTP login, staff username+password(+TOTP)
login, JWT access tokens (`JwtAuthGuard` + `@CurrentPrincipal()`), and
refresh-token sessions with rotation + reuse detection on top of
`shared.auth_sessions`. See the STEP 6 report for the full design and the
account-enumeration reasoning behind each error code. Two things worth
knowing if you're extending this:

- **OTP delivery is not wired.** `CustomerAuthService.requestOtp` stores
  a real `shared.otp_requests` row and never logs/returns the code, but
  nothing sends an SMS/WhatsApp message yet — that's `NotificationModule`
  (still an empty STEP 4 skeleton). Don't fake a "sent" response when
  wiring that up; queue/log-only until a real provider is configured
  (`OTP_DELIVERY_PROVIDER`), per the STEP 6 authorization.
- **`DatabaseService.withTransaction` rewraps non-`SafeDatabaseError`
  callback errors into a generic `SafeDatabaseError`.** That's correct
  for real driver errors, but it means a domain error thrown *from
  inside* a `withTransaction` callback (e.g. "this refresh token is
  invalid") gets swallowed into the same generic wrapper. Both
  `CustomerAuthService.verifyOtp` and `TokenService.rotateSession` work
  around this by returning a discriminated outcome from the callback and
  throwing only after the transaction has resolved — follow that pattern
  for any new transactional flow that needs to distinguish its own
  business errors from a real database failure. This was only caught by
  the real-Postgres integration test (`auth.integration.spec.ts`); the
  mocked unit test for the same code did not reproduce it.
