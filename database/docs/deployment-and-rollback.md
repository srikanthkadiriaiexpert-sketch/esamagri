# Phase 3A — Migration/Deployment Instructions & Rollback/Recovery

## Deployment instructions

1. Provision a PostgreSQL 15+ instance (developed and tested against
   16.13). Create the target database (e.g. `esamagri_production`).
2. Apply the migrations in order, stopping immediately on any error:
   ```bash
   for f in migrations/*.sql; do
     psql -d esamagri_production -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED at $f"; break; }
   done
   ```
   Each file is idempotent-safe to *retry after fixing a failure*, but not
   safe to re-run after it already succeeded (e.g. `CREATE TABLE` without
   `IF NOT EXISTS` by design — a second run should fail loudly, not
   silently no-op, so a partially-applied environment is never mistaken
   for a fully-applied one). If a file fails partway through, its
   statements before the failure are still committed only if you wrapped
   the whole run in one transaction; the reference loop above does not, on
   purpose — investigate and fix forward (see "Recovery" below) rather
   than assuming atomicity you didn't ask for.
3. Immediately after `0019_seed_data.sql`, complete the bootstrap
   `SUPER_ADMIN` credential step out-of-band (not in any migration file):
   generate a real password hash with whatever hashing library Phase 3B
   settles on, `UPDATE shared.users SET password_hash = '<real hash>' WHERE
   username = 'bootstrap_super_admin'`, and force a change on first login
   at the application layer.
4. Set real passwords for the five `LOGIN` application roles
   (`app_shared`, `app_rik`, `app_pif`, `app_reporting_rik`,
   `app_reporting_pif`) via `ALTER ROLE ... WITH PASSWORD '...'`, generated
   and stored through your organization's real secrets process — never
   committed to a file in this repository. Until this is done, these roles
   cannot authenticate at all (fail-closed by design).
5. Point each application service's connection string at the correct role
   for its module — the `rik` service as `app_rik`, the `pif` service as
   `app_pif`, and so on — never at `esamagri_owner` or a superuser.
6. Run the test suite against a *disposable* copy of the target
   environment (never production) before declaring the deployment good —
   see `docs/final-verification-report.md` for the exact commands.

## Why there are no down-migrations

Phase 2 Section 30 calls for forward-only migrations, and that is what
this project builds: no `DROP`-based reversal script per migration file.
Two independent reasons this is the right call for this schema, not just
a shortcut:

- Several migrations (append-only tables, `SECURITY DEFINER` functions
  with ownership semantics, the ownership-reassignment step in `0018`) are
  not cleanly reversible without risking data loss or re-opening the exact
  privilege-escalation gap `0018` closes.
- A schema this interlocked (triggers referencing functions referencing
  tables across 17 migration files before roles even exist) makes a
  correct, tested down-path roughly as much work as the up-path, for a
  capability that is rarely exercised safely in practice on a live
  database anyway — most real incidents are recovered by restore, not by
  running schema changes backward against live data (see below).

## Rollback / recovery, in practice

**Before data exists (development/staging, pre-go-live):** rolling back
means recreating the database from scratch and re-running migrations up to
the desired point — trivial and safe, since there's no data to lose. This
is the expected rollback path during development.

**After real data exists (post-go-live):** the safe rollback unit is a
**point-in-time restore from backup**, not a reverse migration. Concretely:
1. Stop write traffic to the affected schema(s).
2. Restore the most recent known-good backup (or PITR to just before the
   problematic migration was applied) into a separate instance.
3. Validate against that restored instance (re-run the relevant tests from
   `tests/`) before cutting traffic back over.
4. If only a narrow, additive change needs undoing (e.g. one bad seed row,
   one wrong `settings` value), prefer a small forward-fix migration over
   any reversal — this preserves the append-only audit trail's own
   integrity, which a `DROP`/reverse-`ALTER` could otherwise undermine.

**Specific recovery notes for this schema:**
- `shared.audit_log`, `rik.entitlement_ledger`,
  `rik`/`pif.inventory_transactions`, `pif.cash_movements`,
  `rik.order_status_history` are append-only by design — "rollback" for
  these means writing a compensating row (e.g. an `ADJUST` ledger entry),
  never editing or deleting history, even during an incident.
- `rik.inventory`/`pif.inventory` balances are, per Phase 2 Sections
  16/17, always reconstructable by replaying their respective
  `inventory_transactions` from zero — if a balance is ever suspected to
  have drifted from its ledger, that replay is the recovery procedure, not
  a manual `UPDATE`.
- A migration `0018` re-run is **not** idempotent (role/ownership
  statements are guarded with existence checks for roles, but the
  ownership-reassignment loop and grants are not) — do not attempt to
  "fix forward" by re-running `0018` wholesale; apply a new, narrower
  migration file instead.
