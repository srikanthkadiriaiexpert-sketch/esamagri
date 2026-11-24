# Phase 3A — Pre-Completion Security Review Checklist

Every item the Phase 3A brief named, with what was actually checked and
where the evidence is — not just an assertion.

## SQL injection

All schema/function DDL was hand-written, not generated from
user-controllable input at build time. All `SECURITY DEFINER` functions
take typed parameters (`uuid`, `text`, `jsonb`) bound as PL/pgSQL
parameters, not concatenated into dynamic SQL — the one place this project
uses dynamic SQL (`EXECUTE format(...)` in migration `0018`'s ownership-
reassignment loop) sources every identifier from `pg_catalog` system views
(`pg_tables`, `pg_views`, `pg_proc`), never from external input, and uses
`format(%I, ...)`/`%s` with `regprocedure` casts, which are
identifier-safe. **Status: no injectable surface in this layer.** Real SQL
injection risk in this system will live in Phase 3B's query-construction
code, not here.

## Privilege escalation

Checked directly, not assumed:
- Every `SECURITY DEFINER` function is owned by `esamagri_owner`, a
  non-superuser role with no `CREATEROLE`/`CREATEDB`, **not** `postgres`
  (this was found to be wrong during the build and fixed — see
  `docs/reconciliation-report.md` item 10).
- `app_rik`/`app_pif` were confirmed, by actually connecting as those
  roles, to have **zero** direct grants on `shared.customers`,
  `shared.users`, `shared.audit_log`, or `shared.idempotency_keys**
  (`tests/030_isolation_security_rbac.sql` #18d/e).
- No role holds `UPDATE`/`DELETE` on `shared.audit_log` (checked via
  `information_schema.role_table_grants` implicitly — no such `GRANT`
  statement exists anywhere in the migration set, and the trigger backstop
  independently blocks it regardless).

## SECURITY DEFINER vulnerabilities

Every `SECURITY DEFINER` function (`shared.log_audit_event`,
`assert_customer_exists`, `assert_staff_user_exists`,
`claim_idempotency_key`, `store_idempotent_response`,
`get_idempotent_response`) has an explicit `SET search_path = shared,
pg_catalog` — verified by inspection of every `CREATE FUNCTION` statement
and re-confirmed post-ownership-reassignment via
`pg_proc.proconfig`/`pg_get_functiondef`. None of them execute
caller-supplied SQL. None of them grant broader access than their single
documented purpose (each does exactly one narrow, named thing).

## Unsafe `search_path`

Same evidence as above — every `SECURITY DEFINER` function pins
`search_path` explicitly. Non-`SECURITY DEFINER` functions (the trigger
wrapper functions in `rik`/`pif`) do not need this protection since they
run as the invoker, not a fixed definer, so a hijacked `search_path`
there only affects the invoking role's own privileges, not an elevation.

## Unauthorized cross-schema access

Verified structurally (`tests/030` #1a): zero physical foreign keys cross
`rik`↔`pif`, or either into `shared`. Verified at the grant level: no
`app_rik`/`app_pif` role can `SELECT` from `shared.customers`/`users`
directly (#18d) — the only read path is `shared.v_customer_profile`, whose
column list is itself restricted to approved fields (Phase 2 Section 04).

## Append-only ledger bypass

Four append-only tables, two different enforcement layers, both tested:
- `shared.audit_log`: trigger backstop (`trg_audit_log_immutable`) rejects
  `UPDATE`/`DELETE` unconditionally, confirmed even for the owning role
  (`tests/030` #16a/b) — deliberately not grant-dependent, since it must
  hold even if a grant is ever misconfigured.
- `rik.entitlement_ledger`, `rik.inventory_transactions`,
  `pif.inventory_transactions`, `pif.cash_movements`: role-grant-based
  (`app_rik`/`app_pif` hold `INSERT`+`SELECT` only, migration `0018`).
  `rik.order_status_history` is grant-restricted the same way.

## Entitlement / stock / COD / idempotency bypass

- Entitlement over-allocation: prevented by the `SELECT ... FOR UPDATE`
  row-lock pattern on `rik.entitlements`, proven under real concurrent
  backends, not just asserted (`tests/050_concurrency.sh` #4).
- Stock overselling (PIF counter vs. online): same proof, real concurrent
  backends racing on `pif.inventory` (`tests/050_concurrency.sh` #9).
- Negative stock: `CHECK` constraints on both `rik.inventory` and
  `pif.inventory` (`tests/010` #10, `tests/020` #10).
- Duplicate COD collection: partial unique index
  `pif_cash_movements_cod_order_uq` (`tests/020` #13).
- Idempotency bypass: `shared.claim_idempotency_key()` uses
  `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — race-safe by
  construction, never a check-then-act `SELECT` (`tests/040` #17).

## Finalized-bill mutation

`pif.trg_bill_items_immutable_after_finalize` blocks any `UPDATE` to a
`pos_bill_items` row once its parent bill is `FINALIZED` — tested directly
by attempting exactly that update (`tests/020` #11).

## Invalid transitions

Both order-lifecycle state machines (`rik.orders`, 9 states;
`pif.orders`, 10 states) and the `pif.pos_bills` lifecycle are enforced by
`BEFORE UPDATE OF status` triggers that reject any transition not in the
explicit allow-list — each tested with both a valid full path and at
least one illegal skip-ahead/wrong-path attempt
(`tests/010` #7, `tests/020` #20).

## What this checklist does not cover

Application-layer concerns (session/token handling in request code, input
validation before it reaches the DB, rate limiting, TLS/network posture,
secrets management for the real `app_*` role passwords) are Phase 3B and
deployment-operations concerns, not database-schema concerns, and are out
of scope for this document by design.
