# Phase 3A — Implementation Plan

## Scope

Convert the approved Phase 2 Revision 1 architecture into a running,
tested PostgreSQL 15+ implementation (tested against PostgreSQL 16.13).
Database only. No application code, no API layer, no frontend — that is
explicitly Phase 3B and out of scope here.

## Approach

1. **Reconcile first.** Read Phase 2 Rev1 in full, cross-checked every
   table dictionary, constraint, function, trigger, index, role, and
   business rule against every other section that touches it. Two real
   contradictions were found and put to you directly before any SQL was
   written (view count, UUIDv7 mechanism). Smaller gaps and narrower
   ambiguities found during the build itself are resolved directly, each
   with its reasoning recorded in `docs/reconciliation-report.md` — never
   silently.
2. **Migrate forward-only, numbered, one concern per file.** No down-
   migrations, no migration framework/ORM — plain `.sql` files applied in
   order with `psql -f`, matching Phase 2 Section 30's schema-independent
   apply-order requirement. See `docs/migration-structure.md` for the file
   list and dependency order.
3. **Apply and verify every file immediately**, against a live, disposable
   `esamagri_test` database — never trust authored-on-faith SQL. Every
   migration in this project was applied and confirmed clean before the
   next was written.
4. **Write real tests, run them for real.** Every one of the 20 named
   database-level test scenarios is an actual `.sql`/`.sh` file that
   connects to the live test database and asserts real behavior —
   including two scenarios that require genuine cross-process concurrency
   (separate OS-level `psql` backends, not just separate statements in one
   session).
5. **Fix, don't just note, a real security defect found along the way.**
   Every `SECURITY DEFINER` function was initially owned by the `postgres`
   superuser (unavoidable — migrations had to be applied as some role
   before `esamagri_owner` existed). That is a genuine privilege-escalation
   risk, not a style issue, so migration `0018` reassigns ownership of
   every object in all three schemas to a dedicated non-superuser role
   before any grant is issued, and this was re-verified afterward, not just
   asserted.
6. **Consistency re-check before delivery.** The entire migration set is
   re-applied end-to-end against a fresh database and the full test suite
   re-run, immediately before packaging — see
   `docs/final-verification-report.md`.

## Layering (why the migrations are ordered this way)

- `0001` — extensions (`pg_trgm`, `btree_gist`) + the three schemas.
- `0002` — `shared.uuid_generate_v7()`, needed as the `DEFAULT` for every
  table's primary key from this point on.
- `0003`–`0006` — `shared` schema: core identity, auth/audit/idempotency
  tables, the three `SECURITY DEFINER` validation/audit functions +
  `shared.audit_log`'s trigger backstop, and `shared.v_customer_profile`.
  `shared` is built first because every cross-schema reference in `rik`/
  `pif` validates against it.
- `0007`–`0010` — `rik` schema: catalog/inventory, entitlements (+ the 2
  approved reporting views), cart/order tables, then RIK's trigger
  functions last (they reference tables created earlier in this block).
- `0011`–`0016` — `pif` schema, deliberately reordered from the original
  task-list grouping for one FK-dependency reason:
  `pif.pos_bills.online_order_id` references `pif.orders.id`, and
  `pif.cash_movements` references both `pos_bills` and `pif.orders`, so
  `pif.orders`/`order_items` (`0013`) had to exist before
  `pos_bills`/`pos_bill_items`/`cash_movements` (`0014`). Catalog/inventory
  (`0011`) and purchasing (`0012`) have no such ordering constraint and
  come first as in the original plan. Returns (`0015`) and trigger wiring
  (`0016`) come last, once everything they reference exists.
- `0017` — the `shared.idempotency_keys` `SECURITY DEFINER` wrapper
  functions (see reconciliation item 8) — placed after both `rik` and
  `pif` exist since it's infrastructure both will call, but logically
  belongs with the other `shared` functions.
- `0018` — roles and grants, deliberately last among the schema-defining
  migrations: it needs every object in every schema to already exist so it
  can both reassign ownership and grant precisely (never over-broadly) per
  table/function.
- `0019` — seed data, deliberately last of all: pure DML, needs every
  table and role already in place.

## What was deliberately not built

Per the brief's explicit fence: no React/NestJS/API code, no PWA/POS/
admin UI, no WhatsApp integration, no payment gateway, no deployment
tooling (Docker/Vercel). Also not built because Phase 2 does not require
it at the DB layer: application-side password hashing (Section 31's
bootstrap user uses an intentionally unusable placeholder, not a real
hash — see reconciliation item 12), and any facility-scoping schema change
(Section 34 marks that "not a V1 decision").
