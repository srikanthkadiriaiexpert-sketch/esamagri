# Phase 3A — Final Verification Report

*(Phase 2 Revision 2 addendum follows the original Phase 3A report below —
see "Phase 2 Revision 2 Addendum" section.)*

## What was verified, and how

This is a real re-run against a freshly created database
(`esamagri_verify`, PostgreSQL 16.13), not a re-assertion of results from
earlier in the build. Steps, in order:

1. Dropped and recreated `esamagri_verify` from nothing.
2. Applied all 19 migration files in numeric order with
   `psql -v ON_ERROR_STOP=1` — zero errors, every file's output consisted
   only of `CREATE`/`GRANT`/`ALTER`/`COMMENT`/`INSERT`/`DO`/`SET`/`RESET`
   confirmations.
3. Queried the live catalog (not source files) for table/view counts and
   object ownership.
4. Re-ran all 6 test files (`000`, `010`, `020`, `030`, `040`, `050`)
   against this fresh instance.
5. Confirmed the database contains only seed data after the full test run
   (tests roll back or self-clean; nothing leaked).

## Schema shape

| Check | Result |
|---|---|
| `shared` tables | 13 |
| `rik` tables | 12 |
| `pif` tables | 20 |
| **Total tables** | **45** |
| `shared` views | 1 (`v_customer_profile`) |
| `rik` views | 2 (`v_entitlement_balance`, `v_entitlement_consumption_by_product`) |
| **Total views** | **3** |

**45 tables + 3 views**, exactly matching the reconciled count from
`docs/reconciliation-report.md` item 1.

## Ownership / security fix, re-confirmed on the fresh instance

- Every table and view in `shared`/`rik`/`pif`: owned by `esamagri_owner`.
- Every `SECURITY DEFINER` function in `shared`: owned by `esamagri_owner`
  (not `postgres`).

This confirms the ownership-reassignment fix in migration `0018` is not
something that only worked once by coincidence — it reproduces correctly
on a from-scratch apply.

## Test results — all 20 named scenarios

| # | Scenario | File | Result |
|---|---|---|---|
| 1 | RIK/PIF inventory & schema separation | `030` | PASS (1a, 1b) |
| 2 | Entitlement calculation | `010` | PASS |
| 3 | Category entitlement across products | `010` | PASS |
| 4 | Entitlement concurrency (real concurrent backends) | `050` | PASS |
| 5 | Duplicate RESERVE closure prevention | `010` | PASS (5a, 5b) |
| 6 | RIK reserve/release/issue cycle | `010` | PASS |
| 7 | RIK invalid state transitions | `010` | PASS (7a, 7b, 7c) |
| 8 | PIF stock deduction | `020` | PASS |
| 9 | PIF counter-vs-online conflict (real concurrent backends) | `050` | PASS |
| 10 | Negative-stock prevention (RIK + PIF) | `010`, `020` | PASS |
| 11 | Finalized bill immutability | `020` | PASS |
| 12 | Online-order/bill uniqueness | `020` | PASS |
| 13 | COD duplicate prevention | `020` | PASS |
| 14 | Cash movement integrity | `020` | PASS (14a, 14b, 14c) |
| 15 | Invalid customer/staff reference rejection | `030` | PASS (15a, 15b, 15c) |
| 16 | Audit append-only protection | `030` | PASS (16a, 16b) |
| 17 | Idempotency duplicate-request handling | `040` | PASS (17a-d) |
| 18 | RBAC permission boundaries | `030` | PASS (18a-g) |
| 19 | Refresh-token rotation/reuse detection | `040` | PASS (19a-c) |
| 20 | PIF invalid order state transitions | `020` | PASS (20a-d) |

Plus the UUIDv7 generator's own 6-part validation (`000`,`000b`) — see
`docs/uuidv7-test-results.md` for that detail, including the explicit
statement of what is and is not claimed about RFC 9562 conformance.

**Result: 20/20 named scenarios pass, on a from-scratch database.**

## Consistency check against Phase 2 Revision 1

- Table/view count matches the reconciled 45+3 (item 1).
- Every business rule implemented traces to a specific Phase 2 section,
  cited in the migration file's own comments and cross-referenced in
  `docs/schema-inventory.md`.
- Every place implementation required a judgment call beyond Phase 2's
  literal text is recorded in `docs/reconciliation-report.md`, not
  silently decided.
- No approved security, integrity, concurrency, audit, entitlement,
  inventory, cash, or idempotency mechanism was removed or weakened;
  where Phase 2's wording underspecified a mechanism, it was
  implemented at least as strictly as the literal text allows (e.g. the
  bill-items immutability trigger, the audit_log grant restriction).

## Known follow-ups for Phase 3B (not gaps in Phase 3A — explicitly out of scope here)

- Real credential provisioning for `esamagri_owner`'s login path and the
  five `app_*` roles (currently `NOLOGIN`/no-password by design).
- Real password hashing for the bootstrap `SUPER_ADMIN` (currently a
  fail-closed sentinel, by design — see reconciliation item 12).
- The two `[BUSINESS DECISION REQUIRED]` settings values seeded as
  labeled placeholders (`rik.not_collected_ttl_days`,
  `pif.online_reservation_timeout_minutes`).
- Application-layer enforcement everything the DB layer cannot itself
  guarantee (e.g. `return_items.qty` not exceeding the original line's
  remaining quantity — Phase 2 Section 06 explicitly assigns this to the
  app layer, not a `CHECK`).

## Sign-off statement

Phase 3A (Production Database Implementation) is complete: 19 migration
files, all applied and re-verified clean from scratch; 45 tables + 3
views; roles and least-privilege grants created and verified by actually
connecting as the restricted roles, not just by reading the `GRANT`
statements; 20/20 named test scenarios passing, including two genuine
cross-process concurrency tests; a real `SECURITY DEFINER`
ownership/privilege-escalation defect found during the build and fixed,
not merely documented. No application code, API, or frontend was built.
**This concludes Phase 3A. Awaiting your explicit approval before Phase
3B begins.**

---

## Phase 2 Revision 2 Addendum — Announcements + RIK Issue Schedules

*Approved with 13 corrections; implemented per that approval. Database-only,
as instructed (item 12) — no application code, API, or frontend.*

### Schema shape after Revision 2

| Check | Result |
|---|---|
| `shared` tables | 14 (13 + `announcements`) |
| `rik` tables | 13 (12 + `issue_schedules`) |
| `pif` tables | 20 (unchanged) |
| **Total tables** | **47** |
| `shared` views | 2 (`v_customer_profile`, `v_active_announcements`) |
| `rik` views | 3 (`v_entitlement_balance`, `v_entitlement_consumption_by_product`, `v_issue_schedule`) |
| `pif` views | 0 (unchanged) |
| **Total views** | **5** |

**47 tables + 5 views.** The 5-views figure matches your approval message's
authoritative inventory (item 1) exactly. The table count is corrected from
your stated "45" to **47** — see `docs/reconciliation-report.md` item 14 for
the full explanation of why 45 cannot be literally right once the two new
Revision 2 tables exist.

### New migrations (0020-0023)

All four applied cleanly, in order, to `esamagri_test`, each wrapped in
`SET ROLE esamagri_owner; ... RESET ROLE;` so every new object is owned by
`esamagri_owner` (not `postgres`) — see `docs/migration-structure.md` for
per-file contents and `docs/reconciliation-report.md` item 10 for why that
ownership discipline matters (the same `SECURITY DEFINER`
privilege-escalation class of bug Phase 3A's migration `0018` was built to
prevent).

| # | File | Result |
|---|---|---|
| 0020 | `shared_announcements.sql` | Applied; one ownership slip caught and fixed (see below) |
| 0021 | `rik_issue_schedules.sql` | Applied clean |
| 0022 | `revision2_views.sql` | Applied clean |
| 0023 | `revision2_permissions_and_grants.sql` | Applied clean |

**One issue found and fixed during implementation:** migration `0020` was
initially applied without `SET ROLE esamagri_owner`, leaving
`shared.announcements` owned by `postgres`. Caught by directly querying
`pg_class.relowner` (not assumed), fixed in both the already-applied table
(`ALTER TABLE ... OWNER TO esamagri_owner`) and the migration file itself
(so a from-scratch re-apply is correct without manual intervention — see
the fresh-database re-verification below, which confirms this).

### Grants/permissions changed

- 2 new permission codes: `shared.announcement.manage`, `rik.issue_schedule.manage`.
- `role_permissions`: `SUPER_ADMIN` + `shared.announcement.manage`;
  `RIK_ADMIN` + `shared.announcement.manage` and `rik.issue_schedule.manage`;
  `PIF_ADMIN` + `shared.announcement.manage`. No operational-staff role
  (`PIF_CASHIER`, `DELIVERY_STAFF`, `RIK_PICKUP_STAFF`) holds either.
- `GRANT SELECT, INSERT, UPDATE ON shared.announcements TO app_shared` — no
  `DELETE`, ever (soft-delete-only, matching `rik.issue_schedules`).
- `GRANT SELECT ON shared.v_active_announcements TO app_shared, app_rik,
  app_pif, app_reporting_rik, app_reporting_pif`.
- `REVOKE DELETE ON rik.issue_schedules, rik.v_issue_schedule FROM app_rik`
  — narrowing migration `0018`'s schema-wide default-privileges rule for
  these two objects only (`docs/reconciliation-report.md` item 17); every
  other `rik` table's `0018` grants are untouched.
- `GRANT EXECUTE ON FUNCTION shared.assert_staff_user_exists(uuid) TO
  app_rik` — previously `app_pif`-only; required for
  `rik.trg_validate_staff_ref()` to work under the real `app_rik` role.
- `app_pif`/`app_reporting_pif` receive no grant at all on
  `rik.issue_schedules` (least privilege — PIF has no structured RIK
  schedule of its own).

All of the above were verified directly against
`information_schema.role_table_grants`/`role_routine_grants` and by
actually connecting as each restricted role and exercising both the
allowed and the disallowed operations — not just by reading the `GRANT`
statements.

### Test results — Revision 2 checklist (all items from your approval item 13)

All run in `tests/060_revision2_announcements_and_schedules.sql`, Part A
(structural/functional/data-level, one transaction, rolled back — no
residue, confirmed by re-querying for leftover `TEST%`-prefixed rows
afterward) and Part B (real `SET ROLE app_pif`/`app_rik`/`app_shared`/
`app_reporting_rik`/`app_reporting_pif`, exercising grants for real).

| Checklist item | Result |
|---|---|
| Announcement publish/unpublish | PASS (#1a-c) |
| Date-based active filtering | PASS (#2) |
| Expiry | PASS (#3) |
| Open-ended announcements | PASS (#4) |
| ALL/RIK/PIF audience values (+ invalid value rejected) | PASS (#5a-b) |
| Priority ordering (URGENT→HIGH→NORMAL→LOW) | PASS (#6) |
| Soft deletion | PASS (#7) |
| RIK schedule date queries | PASS (#8a-b) |
| Category schedule | PASS (#9) |
| Product schedule | PASS (#10) |
| General schedule | PASS (#11) |
| Category/product XOR constraint | PASS (#12) |
| Duplicate schedule prevention (all 3 partial-unique indexes, + soft-delete frees the slot) | PASS (#13a-d) |
| Optional time-window validation | PASS (#14a-c) |
| FK/reference integrity (physical FK, trigger validation, ACTIVE-only, non-FK loose reference) | PASS (#15a-g) |
| Permissions (role_permissions scoping) | PASS (#16) |
| Unauthorized admin attempts (grant-level, real roles) | PASS (#17a-i) |
| View access/grants | PASS (#18a-e) |
| Audit integration smoke test (bonus, not in the checklist but relevant) | PASS (#19) |

**Result: every item on the item-13 checklist passes, with sub-assertions
totaling 30+ individual `PASS` checks and zero failures**, plus a
confirmation that no test data was left behind in any table.

### Consistency check against the Revision 2 approval

- All 13 numbered corrections implemented as specified; none silently
  reinterpreted (`docs/reconciliation-report.md` items 15-19 record the
  handful of places a documented judgment call was still needed within an
  otherwise-literal correction).
- No Phase 1 or Phase 2 Revision 1 object, grant, or behavior was altered
  — the only change to a pre-existing migration's *effect* is the narrow
  `REVOKE DELETE` in `0023`, which corrects an unintended side effect of
  `0018`'s default-privileges rule for two brand-new objects only, not a
  redesign of that rule.
- No customer React UI, NestJS business module, or PIF/RIK application
  feature was started, per item 12.
- No push notifications, chat, comments, likes, or CMS features were
  added, per item 10.

### Known follow-ups (open business/application decisions — not gaps in this database work)

- Backend enforcement of `target_audience` filtering when serving customer
  announcement lists (correction #3) — the database stores and exposes
  `target_audience`; deciding "which audience is asking" is a request-time
  concept the database layer does not have.
- Backend enforcement of the RIK_ADMIN/PIF_ADMIN role-to-audience
  restriction on write (correction #8) — the database's `role_permissions`
  data supports this, but the reject-on-mismatch logic itself is
  application code, explicitly out of scope for this phase.
- Whether/when to wire `shared.notification_outbox` to send notifications
  about new/urgent announcements — correction #10 is explicit that this is
  a future application/integration decision, not something this schema
  change should anticipate.
- The customer Android UI itself (correction #9) — specified for a future
  phase, not built here.

### Sign-off statement

Phase 2 Revision 2 (Announcements/Notices + structured RIK Issue Schedule,
database layer only) is complete: 4 new migration files (`0020`-`0023`),
all applied and re-verified from scratch; 2 new tables and 2 new views,
bringing the corrected baseline to 47 tables + 5 views; 2 new permission
codes with role assignments exactly matching correction #8; least-privilege
grants set and verified by connecting as the real restricted roles; every
item on the item-13 testing checklist passing. One ownership slip was
caught and fixed, the same way Phase 3A's `SECURITY DEFINER` ownership
defect was — found and corrected, not merely described. **This concludes
Phase 2 Revision 2. Awaiting your explicit approval before the next
application-development phase begins.**

---

## Final Phase 2 Release Audit Addendum

A full release audit was run separately from (and after) the Revision 2
work above: every migration re-inspected against the live catalog, every
function/trigger/grant re-verified from a from-scratch database, and
every numeric business scenario in the audit brief (RIK category
entitlement, RIK inventory, PIF inventory, cash/COD) reproduced exactly
as specified. Full detail is in the response that accompanies this
addendum; this section records the durable, repository-level outcome.

**One real defect found and fixed:** all six `SECURITY DEFINER` functions
in `shared` were executable by `PUBLIC` (PostgreSQL's default, never
explicitly revoked by any prior migration), letting the two strictly
read-only reporting roles (`app_reporting_rik`, `app_reporting_pif`)
write real rows into `shared.audit_log` and `shared.idempotency_keys` via
`shared.log_audit_event()` / `shared.claim_idempotency_key()` despite
holding zero direct table grant. Reproduced, then fixed with a single new
migration, `0024_revoke_public_execute_security_definer.sql` — see
`docs/reconciliation-report.md` item 20 for full detail. Re-verified
after the fix, on a database rebuilt from zero with all 24 migrations:
the exploit path is closed, and every legitimate app role's access is
unchanged.

**Baseline after the fix:** 47 tables (14 shared + 13 rik + 20 pif), 5
views, 19 functions, 16 triggers, 134 indexes — all confirmed against
`information_schema`/`pg_catalog` on a database built from zero with all
24 migrations, zero manual intervention, zero unexpected output.

**Table count reconciled exactly, not just noted:** the audit's own
brief cited "45 tables" as the approved baseline; the database genuinely
contains 47. The two tables beyond 45 are `shared.announcements`
(migration `0020`) and `rik.issue_schedules` (migration `0021`) — the
exact two tables the Phase 2 Revision 2 approval message itself
mandated (corrections #2, #6, #8). 45 is the correct count only for the
database state *before* Revision 2 existed; once Revision 2's own
approved tables are included, 47 is the only figure `information_schema`
can report. This is not an unresolved discrepancy — it is direct,
traceable arithmetic from the approval that ordered these two tables
built.

**New tests added:** `tests/070_audit_concurrency.sh` — three real
cross-process concurrency scenarios not previously covered: RIK
inventory reservation locking, duplicate COD-collection prevention, and
duplicate idempotent-request prevention, all under genuine concurrent
backend connections. All pass. The test-file count is now **9**, not 8 —
stated plainly rather than silently kept at the pre-audit number.

**No defect beyond `0024` was found or silently fixed.** Every other
audit section — migration inventory/ordering, cross-schema isolation,
RIK entitlement (including the exact 25kg category scenario), RIK
inventory (including the exact 100/10/10 scenario and all 9 transaction
types), PIF inventory/POS (including the exact 20/5/10 scenario), the
single-direction bill/order relationship, cash/COD (all 5 movement
types, the documented expected-cash formula), idempotency, audit
logging, announcements, RIK issue schedules, hardcoded-secret scanning,
and fake-transactional-data scanning — passed with no schema changes
required.

**No Phase 3 application code was created or modified** during this
audit: no React, no NestJS, no API, no UI. The only repository changes
were migration `0024`, the new test file `tests/070_audit_concurrency.sh`,
and documentation updates recording both.
