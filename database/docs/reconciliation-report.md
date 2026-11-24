# Phase 3A / Phase 2 Revision 2 — Reconciliation Report

Every place Phase 3A's implementation required a judgment call against the
approved Phase 2 Revision 1 contract, what was decided, and why. Ordered
roughly by when each was hit during the build. Two items were surfaced to
you directly before any code was written (view count, UUID generation);
everything else below was resolved directly during implementation, using
the same reasoning standard — least invention, most consistent with
Revision 1's own stated architecture, most secure — and is documented here
rather than silently assumed.

## 1. View count: "1 view" vs. Sections 15/28/33 (asked, resolved)

Phase 2's own final inventory (Section 03) claimed exactly 1 view
(`shared.v_customer_profile`), but Sections 15/28/33 all treat
`rik.v_entitlement_balance` and `rik.v_entitlement_consumption_by_product`
as real, load-bearing reporting objects. You confirmed: build both as
read-only derived views. **Final count: 45 tables + 3 views.** Built in
migration `0008_rik_entitlements.sql`.

## 2. UUIDv7 generation mechanism (asked, resolved)

Phase 2 mandates UUIDv7 primary keys but never specifies how to generate
them, and PostgreSQL 15/16 have no native UUIDv7 support. You approved a
hand-rolled PostgreSQL-side generator (no new extension), with a defined
test bar: version/variant bits, timestamp round-trip, monotonic ordering,
1M-row bulk uniqueness, and true cross-process concurrent uniqueness (20
backends × 20,000 inserts). Built in `0002_shared_uuidv7.sql`, tests in
`tests/000_uuidv7_validation.sql` and `tests/000b_uuidv7_concurrency.sh`.
Results in `docs/uuidv7-test-results.md` — including an explicit statement
of what is *not* claimed (no formal RFC 9562 conformance suite was run).

## 3. `pif.inventory_transactions.reason` — Section 06 vs. Section 13

Section 06's data dictionary for `pif.inventory_transactions` has no
`reason` column. Section 13's check-constraint rules explicitly say the
reason-required rule applies to "`rik.inventory_transactions` **and**
`pif.inventory_transactions`" — but `rik.inventory_transactions` (Section
05) does have `reason`. This is an unambiguous dictionary omission, not a
real design conflict: Section 13 is the rule; Section 06 missed a column
`rik`'s identical table already has. Resolved by adding `reason text` +
`pif_inv_txn_reason_required_chk` to `pif.inventory_transactions`, mirroring
RIK exactly. Migration `0011_pif_catalog_inventory.sql`.

## 4. `pos_bill_items` immutability — application rule vs. DB trigger

Section 18 states the "no UPDATE to `pos_bill_items` once the parent bill
is FINALIZED" rule is enforced in the application's bill-write service,
"since cross-row temporal rules aren't expressible as a plain `CHECK`."
That reasoning rules out a `CHECK` constraint, not a trigger — Phase 2
itself uses exactly this trigger-backstop pattern for `shared.audit_log`
(Section 24). Implemented as a DB-level trigger backstop
(`pif.trg_bill_items_immutable_after_finalize`, migration
`0016_pif_functions_triggers.sql`) for the same documented rule. This is a
stronger mechanism for an existing rule, not a new one, and is what the
Phase 3A brief's "finalized bill immutability" test scenario requires at
the database level. Verified in `tests/020_pif_billing_and_inventory.sql`
(#11).

## 5. `pif.orders` cancellation window — literal Section 19 reading

Section 19 says cancellation/failure "is valid from PLACED through
DELIVERED — any status before SALE_FINALIZED." Taken fully literally these
two phrases disagree once `COD_COLLECTED` is in play (it *is* "before
SALE_FINALIZED" but is not "PLACED through DELIVERED"). Resolved in favor
of the narrower, explicitly-named window: `CANCELLED`/`NOT_DELIVERED` are
reachable only from `PLACED` through `DELIVERED`, not from
`COD_COLLECTED`. This is the more conservative reading (fewer states treated
as cancellable) and matches ordinary retail practice — once goods are
physically delivered, "cancel" no longer applies; a return process would.
Implemented in `pif.trg_validate_order_status_transition`, migration
`0016`. Verified in `tests/020_pif_billing_and_inventory.sql` (#20b).

## 6. `pos_bills` status transitions — literal arrow-notation reading

Section 18 writes the bill lifecycle as `OPEN → FINALIZED → (CANCELLED |
RETURNED)`. Read literally, `CANCELLED`/`RETURNED` are reachable only from
`FINALIZED`, not directly from `OPEN` — i.e. there is no DB-level path to
void an unfinalized bill. Implemented literally
(`pif.trg_validate_bill_status_transition`, migration `0016`). If the real
workflow needs to void an `OPEN` bill before it's finalized, that is a
Phase 2 addendum, not something Phase 3A should add on its own judgment.

## 7. `shared.audit_log` grants — Section 02 vs. Section 24 conflict

Section 02 says `app_rik`/`app_pif` have "**zero grants in shared** —
audits via `shared.log_audit_event()`." Section 24 separately says
`app_shared`, `app_rik`, `app_pif` "are granted `INSERT, SELECT`" directly
on `shared.audit_log`. These directly disagree. Resolved in favor of
Section 02's stricter reading: **no application role holds a direct grant
on `shared.audit_log`**; all writes go exclusively through the
`SECURITY DEFINER` function. `app_shared` additionally gets a direct
`SELECT` (read only, not the `INSERT`/`UPDATE`/`DELETE` Section 24
describes) to support the `shared.audit_log.view` permission (Section 23).
Rationale: Section 02's language is the Revision 1 architectural direction
(cross-schema/sensitive writes go through `SECURITY DEFINER` functions,
not raw grants — see item 8 below too), it is strictly more secure, and it
is what the Phase 3A brief's "least privilege" instruction points toward.
Section 24's sentence appears to be a pre-Revision-1 leftover that was
never updated. Migration `0018_roles_and_grants.sql`; verified directly
(not just by inspection) in `tests/030_isolation_security_rbac.sql`
(#18d/e) by actually connecting as `app_pif` and confirming the direct
grant is refused.

## 8. `shared.idempotency_keys` write path — new wrapper functions

Section 02's "zero grants in shared" for `app_rik`/`app_pif` and Section
27's literal "`INSERT ... ON CONFLICT DO NOTHING RETURNING id`" raw-SQL
description of the idempotency mechanism are, taken together, impossible: a
role with zero write grants in `shared` cannot run a raw `INSERT` against
`shared.idempotency_keys`. Resolved the same way every other "rik/pif needs
a controlled write into shared" case in Phase 2 is resolved — a
`SECURITY DEFINER` wrapper, exactly like `shared.log_audit_event()`. Added
three small functions not individually named in Phase 2 but whose combined
behavior is exactly what Section 27 mandates:
`shared.claim_idempotency_key()`, `shared.store_idempotent_response()`,
`shared.get_idempotent_response()`. Migration
`0017_shared_idempotency_functions.sql`. This keeps app_rik/app_pif's
"zero grants in shared" literally true while implementing Section 27's
mandatory race-safe semantics exactly as specified — a wrapping decision,
not a behavior change.

## 9. `shared.settings` key name for the PIF reservation-timeout value

Section 34 names `rik.not_collected_ttl_days` explicitly but only
*describes* (does not name) "PIF online-reservation timeout." Seeded as
`pif.online_reservation_timeout_minutes`, following the same
`{module}.{setting_name}` convention as the given key. This is a Phase 3A
naming choice, not a Phase 2 requirement — if the real key name differs
once the business decision is made, only the seed row and the reading code
need to change, not the schema. Migration `0019_seed_data.sql`.

## 10. SECURITY DEFINER ownership — a real vulnerability, fixed, not just described

Migrations `0001`–`0017` were necessarily applied as the `postgres`
superuser in this environment (there was no other role to apply them as
yet). That left every `SECURITY DEFINER` function
(`shared.log_audit_event`, `shared.assert_customer_exists`,
`shared.assert_staff_user_exists`, the three idempotency functions) owned
by `postgres` — meaning each would have executed with full superuser
privileges whenever `app_rik`/`app_pif` called it. That is the literal
"SECURITY DEFINER privilege escalation" failure mode the Phase 3A security
checklist asks about, not a hypothetical. Migration
`0018_roles_and_grants.sql` creates a dedicated, non-superuser
`esamagri_owner` role and reassigns ownership of every object in
`shared`/`rik`/`pif` — tables, views, and all functions, including every
`SECURITY DEFINER` function — to it before any grant is issued, and every
migration from `0018` onward applies as `esamagri_owner` (`SET ROLE`), not
`postgres`. Verified directly: `pg_proc`/`pg_class` ownership checked
post-migration (see `docs/final-verification-report.md`), and
`SECURITY DEFINER` functions were exercised as `app_rik`/`app_pif` in
`tests/030` to confirm they still succeed under the new owner.

## 11. Reporting-role grant scope (`app_reporting_rik` / `app_reporting_pif`)

Section 02 describes both roles in one row: "Read-only, module-specific
reporting views." But only RIK has reporting views (2); PIF has none — its
reports (Section 28: cashier variance, purchase cost trend, etc.) read
base tables directly (`pif.cash_movements`, `pif.goods_receipt_items`,
`pif.cashier_shifts`, ...). Granting `app_reporting_pif` `SELECT` only on
two nonexistent PIF views isn't possible; granting it broad `SELECT` on all
of `pif` (still read-only, still schema-scoped) is the resolution that
actually lets Section 28's named PIF reports run. `app_reporting_rik` gets
the same broad `SELECT` on `rik` (not narrowed to the 2 views) for the same
reason — Section 28's RIK reports also reference base-table columns
directly. Migration `0018`.

## 12. Bootstrap `SUPER_ADMIN` password

`shared.users.password_hash` is `NOT NULL`, but Phase 3A is DB-only — no
application code, so no password-hashing library/algorithm is in scope to
choose. The seeded bootstrap row uses a deliberately unusable sentinel
string, not a real hash of any password. It fails closed (cannot
authenticate as-is) until a real out-of-band provisioning step (outside
any migration file) sets a genuine hash and forces an immediate change —
exactly Section 31's instruction, and avoiding inventing an application-
layer hashing decision that belongs to Phase 3B. Migration `0019`.

## 13. Test-scenario count reconciliation

The Phase 3A brief asked for "20 named database-level test scenarios" and
enumerated a list. Counting that list yields 19 distinct named scenarios.
Rather than silently padding the count or silently dropping the stated
"20," a 20th scenario was added that is clearly in scope and not covered by
the other 19: **PIF order invalid state transitions**
(`pif.trg_validate_order_status_transition`), the direct PIF counterpart to
the RIK invalid-transitions scenario the list does name. This is flagged
here rather than asserted as an exact match to an original count this
report cannot independently re-derive. All 20 scenarios are implemented
and pass — see `docs/final-verification-report.md` for the full list and
results.

---

# Phase 2 Revision 2 additions (items 14+)

The items below were reconciled during the Revision 2 implementation
(announcements + RIK issue schedules), against your explicit approval
message and its 13 numbered corrections. Where a correction left no
ambiguity, it was implemented literally with no judgment call required;
this section documents the handful of places a decision or a plain
transparency flag was still needed.

## 14. View count baseline: 45+3 → 47+5 (and a table-count correction)

Your approval item 1 states the authoritative view inventory (5 views,
listed exactly as built) and instructs "the final Phase 2 / Phase 3A
baseline must state: 45 TABLES + 5 VIEWS." The 5-views figure is exactly
correct and matches the implementation precisely — `shared` now has 2
views (`v_customer_profile`, `v_active_announcements`), `rik` has 3
(`v_entitlement_balance`, `v_entitlement_consumption_by_product`,
`v_issue_schedule`), `pif` has none, built in migration `0022`.

However, "45 tables" is the pre-Revision-2 figure and cannot be literally
correct once `shared.announcements` and `rik.issue_schedules` are added:
the true total is **47 tables** (45 + 2 new — confirmed against the live
catalog, not retyped: `SELECT count(*) FROM information_schema.tables
WHERE table_schema IN ('shared','rik','pif') AND table_type='BASE
TABLE'` returns 47 on `esamagri_test` after migration `0023`). This is
handled the same way the Phase 3A "1 view" (item 1 above) and "20 named
scenarios" (item 13 above) discrepancies were handled: stated plainly
rather than silently repeating an inconsistent number. **Corrected final
baseline: 47 tables + 5 views.** `docs/schema-inventory.md` and
`docs/final-verification-report.md` have been updated to this figure.

## 15. `shared.announcements` creator references — physical FK (correction #2, same-schema case)

Your correction #2 asked for `shared.announcements.created_by`/`updated_by`
to be normal physical foreign keys to `shared.users.id`, since both tables
live in `shared` and same-schema referential integrity should not be
deliberately weakened. Implemented literally:
`announcements_created_by_fk`/`announcements_updated_by_fk`, migration
`0020`. This is a genuinely different situation from Phase 2's
`created_by` "accepted trade-off" (Section 34, cited in
`docs/schema-inventory.md`) — that trade-off exists specifically because
most `created_by` columns elsewhere in this schema would otherwise need a
*cross-schema* mechanism; here the reference never leaves `shared`, so
there is no reason to relax it.

## 16. `rik.issue_schedules` creator references — trigger-validated, not a physical FK (correction #2, cross-schema case)

The same correction #2 asked for the opposite treatment on
`rik.issue_schedules.created_by`/`updated_by`: retain the approved
cross-schema DB-enforced validation mechanism from Phase 2 Revision 1
(the `SECURITY DEFINER` trigger pattern), rather than leaving these as
plain unvalidated attribution columns. This is a genuine *elevation*
above the general Phase 2 `created_by` convention for this one table,
deliberately requested by you rather than decided unilaterally. Built as
`rik.trg_validate_staff_ref()` (migration `0021`), the first use of the
staff-ref-validation pattern in the `rik` schema — `pif` has had the
equivalent per-column triggers since Phase 3A
(`pif.trg_validate_cashier_ref`/`trg_validate_handled_by_ref`), and
migration `0018`'s own comment had already anticipated a future `rik`
table needing this. `app_rik` was granted `EXECUTE` on
`shared.assert_staff_user_exists()` in migration `0023` to make this
possible — previously granted to `app_pif` only, since no `rik` table
needed it until now. Verified under the real `app_rik` role (not just the
owning role, which would bypass the grant either way) in
`tests/060_revision2_announcements_and_schedules.sql` (#15g/#18c).

## 17. `rik.issue_schedules` — narrowing the schema-wide DELETE default for one table

Migration `0018`'s `ALTER DEFAULT PRIVILEGES FOR ROLE esamagri_owner IN
SCHEMA rik GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rik` is a
schema-wide rule that automatically grants `app_rik` full CRUD, including
`DELETE`, on any new table created in `rik` — correct for most existing
`rik` tables, but inconsistent with the soft-delete-only design this
Revision 2 proposal specified for `rik.issue_schedules` (matching
`shared.announcements`, which also gets no `DELETE` grant for any role).
The moment `rik.issue_schedules`/`rik.v_issue_schedule` were created, this
rule silently gave `app_rik` `DELETE` on both. Resolved with a narrow,
explicit `REVOKE DELETE ON rik.issue_schedules/rik.v_issue_schedule FROM
app_rik` in migration `0023` — a targeted correction for these two new
objects only, not a change to the `0018` default-privileges rule itself,
per your explicit "do not redesign Phase 1 or Phase 2 Revision 1"
instruction (item 12). Every other `rik` table keeps the original
`0018` behavior unchanged. Verified in
`tests/060_revision2_announcements_and_schedules.sql` (#17c, #17d):
`app_rik` retains INSERT/SELECT/UPDATE but a real `DELETE` attempt as
that role is rejected.

## 18. `related_reference_type`/`related_reference_id` — retained, documented as loose/non-FK

Your correction #7 offered a choice: keep this field if it earns its
complexity, documented strictly as described, or stop and propose
removing it. It was retained — it is the only way an announcement can
point at a specific RIK issue schedule (e.g. "see the updated category
schedule" linking a narrative notice to its structured calendar entry)
without merging the two concepts, which correction #5 explicitly
forbids. All five of your listed conditions are met: it is documented as
a loose, application-level reference only
(`docs/schema-inventory.md`, "Revision 2:
`related_reference_type`/`related_reference_id`" section); it carries no
physical FK (`shared.announcements`, migration `0020`); allowed reference
types are an application-layer concern, not DB-enforced; soft-deleting or
removing the referenced row cannot break the referencing announcement;
and an announcement remains fully valid even once its related schedule no
longer exists — all verified directly, not just asserted, in
`tests/060_revision2_announcements_and_schedules.sql` (#15e): a
`rik.issue_schedules` row is soft-deleted after an announcement is
created pointing at it, and the announcement is confirmed to remain in
`shared.v_active_announcements` afterward.

## 19. Audience-security and role-to-audience enforcement are backend responsibilities, not DB gaps

Corrections #3 and #8 both draw a hard line: `target_audience`
(ALL/RIK/PIF) filtering, and which admin role may set which
`target_audience`, must be enforced by the backend/service layer — the
database's job is to store the value and expose it correctly, not to
decide who may read or write which audience. This Revision 2 database
implementation therefore does *not* attempt row-level or value-level
audience enforcement (the schema has no such mechanism anywhere else
either — see `docs/schema-inventory.md`'s RBAC notes). What the database
does provide, and what was verified: `shared.v_active_announcements`
exposes `target_audience` on every row so a backend can filter by it
(`0022`); the two new permission codes and their `role_permissions`
assignments give the backend the RBAC data it needs to reject
RIK_ADMIN-sets-PIF / PIF_ADMIN-sets-RIK at the application layer
(`0023`, verified in `tests/060...` #16). The actual reject-on-mismatch
logic is explicitly out of scope for this database-only phase (item 12:
"do not start NestJS business modules") and is called out again here as
an open business/application decision — see
`docs/final-verification-report.md`'s Revision 2 addendum, item G.

---

# Final Phase 2 release audit — item 20

## 20. `PUBLIC EXECUTE` on `SECURITY DEFINER` functions — found, confirmed, fixed

During the final release audit (least-privilege review of every
`SECURITY DEFINER` function), a real defect was found: PostgreSQL grants
`EXECUTE` on a newly created function to `PUBLIC` automatically unless
explicitly revoked. Every migration that added a `SECURITY DEFINER`
function in `shared` (`0005`, `0017`) followed it with an explicit
`GRANT EXECUTE` to the intended app roles (`0018`, `0023`) but never
revoked the underlying `PUBLIC` grant — so those explicit grants were
redundant, and every role, including the two strictly-read-only
reporting roles, already had access.

Reproduced directly, not just inferred: connected as `app_reporting_rik`
— which holds zero direct grant on `shared.audit_log` or
`shared.idempotency_keys`, confirmed structurally and by
`tests/030_isolation_security_rbac.sql` #18f — and successfully called
`shared.log_audit_event()`, inserting a real row into `shared.audit_log`.
The same path exposed `shared.claim_idempotency_key()` /
`shared.store_idempotent_response()` (both of which mutate
`shared.idempotency_keys`) to both reporting roles.

Fixed with the minimum necessary change: migration `0024` revokes
`EXECUTE ... FROM PUBLIC` on all six `SECURITY DEFINER` functions in
`shared` (`log_audit_event`, `assert_customer_exists`,
`assert_staff_user_exists`, `claim_idempotency_key`,
`store_idempotent_response`, `get_idempotent_response`). This changes
nothing for `app_shared`/`app_rik`/`app_pif` — they keep exactly the
access they had via the explicit grants already issued in `0005`,
`0017`, `0018`, `0023` — and closes the gap only for `app_reporting_rik`,
`app_reporting_pif`, and any future role that was never explicitly
granted. Verified by re-running the exact reproduction after the fix
(rejected with `insufficient_privilege`) and by re-confirming every
legitimate app role's access still works unchanged, on a database
rebuilt from zero with all 24 migrations. Not in scope: `shared.uuid_generate_v7()`
/ `uuid_v7_extract_timestamp()` (not `SECURITY DEFINER`, no side effects,
intentionally universal) and `shared.trg_audit_log_immutable()` (a
trigger function, not independently callable in a way this concern
applies to).

This audit also added `tests/070_audit_concurrency.sh`, three real
cross-process concurrency scenarios not covered by
`tests/050_concurrency.sh`: RIK inventory reservation locking, duplicate
COD-collection prevention under true concurrency, and duplicate
idempotent-request prevention under true concurrency. All three pass —
see `docs/final-verification-report.md`'s Final Release Audit addendum.
