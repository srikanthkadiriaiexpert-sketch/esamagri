# Phase E — RIK Fulfillment Integration

**Date:** 9 October 2026
**Scope:** RIK physical fulfilment (pickup and delivery lifecycle, physical issue
records, approved substitutions, Fresh lapse, previous-month Dry carry-forward,
staff UI, officer PWA, controlled correction).
**PIF:** not touched in this phase.
**Mode:** implementation (executed, not proposed).

Every figure in this report comes from a command that was actually run in this
session. Nothing is projected.

---

## 1. Recovery and state check (performed before any change)

| Check | Result |
|---|---|
| Repository | `/home/claude/restore/esamagri-app`, npm workspaces (`apps/api`, `apps/admin-web`, `apps/customer-web`, `packages/shared-types`, `packages/config`). **Not a git repository** — no commit was possible, so a checkpoint was taken as a durable archive instead (§9). |
| Migrations on disk | 49 files, `0001`–`0049`, **no gaps**. The long-standing "apply 0001–0038 then 0043–0048" skip is gone: `0039_rik_category_image_fruits.sql` was reconstructed during the image work earlier today. |
| Database | `esamagri_test` live and **not reset**. 65 tables / 5 views after this phase (62 / 5 before). |
| Phase D | Issue Voucher schema (`0048`), APIs, admin screens and the officer voucher page verified present and passing before any edit. |
| Already implemented | Voucher creation, release, numbering, window schedules, snapshot replay. |
| Not implemented (the gap this phase closes) | Any record of **physical** issue; any status movement past `READY_FOR_*`; substitutions; Fresh lapse; Dry carry-forward. |
| Image work | Not redone. Verified intact: 18 category covers, 189 provisions, 50 scale rows, 7 conversions (assertion group 10). |

---

## 2. Files changed

### New — API
| File | Lines | Purpose |
|---|---|---|
| `database/migrations/0049_rik_fulfillment.sql` | 725 | The only migration of this phase. |
| `apps/api/src/rik/repositories/fulfillment.repository.ts` | — | Outcome, issue-line and carry-forward records. |
| `apps/api/src/rik/services/rik-fulfillment.service.ts` | — | Lifecycle, substitution preparation, lapse, carry-forward, reversal. |
| `apps/api/src/rik/rik-fulfillment.controller.ts` | — | `/admin/rik/fulfillment/*`. |
| `apps/api/src/rik/dto/rik-fulfillment.dto.ts` | — | Request shapes. |
| `apps/api/src/rik/rik-fulfillment.integration.spec.ts` | — | 79 tests, real PostgreSQL + real HTTP. |

### New — UI
| File | Purpose |
|---|---|
| `apps/admin-web/src/lib/api/rik-fulfillment-api.ts` | Typed client; decides nothing. |
| `apps/admin-web/src/routes/FulfillmentPage.tsx` | The counter and delivery screen. |
| `apps/admin-web/src/routes/FulfillmentPage.test.tsx` | 11 tests. |

### Edited
| File | Change |
|---|---|
| `apps/api/src/rik/rik.controller.ts` | Officer voucher now also returns `issueStatus` (read-only). |
| `apps/api/src/rik/rik.module.ts` | Wiring. |
| `apps/api/src/database/schema-contract.ts` (+ 3 specs) | `rik` 28→31, total 62→65, with a Phase E history entry. |
| `apps/api/src/rik/rik-issue-vouchers.integration.spec.ts`, `rik-issue-windows…`, `rik-officers…`, `rik-eligibility-import…`, `rik-category-images…` | Table-count assertions 62→65. Each was made **more** specific, never weakened. |
| `apps/admin-web/src/routes/AdminLayout.tsx` | `anyPermission` on a nav item (Fulfilment is reachable by either fulfilment permission). |
| `apps/admin-web/src/app/App.tsx` | Route `/rik/fulfillment`. |
| `apps/customer-web/src/lib/api/rik-issue-voucher-api.ts` | `VoucherIssueStatus` type, `finalWindowReminder`, `formatVoucherMoment`. |
| `apps/customer-web/src/routes/rik/RikIssueVoucherPage.tsx` | Reminder banner, lapse notice, "What was actually issued", "Carried from last month" — all read-only. |
| `apps/customer-web/src/routes/rik/rik-issue-voucher.test.tsx` | +10 Phase E tests (25 total in the file). |

**Migration numbers added: `0049` only.** No previously applied migration was
edited. (`0039`, reconstructed earlier today during the image work, is noted
here only because it closes the former numbering gap.)

---

## 3. Database changes and how existing data is preserved

### Three tables (migration 0049)

**`rik.issue_voucher_outcomes`** — every fulfilment event, append-only.
`event_type` ('OUTCOME' | 'CORRECTION'), `outcome`
(COLLECTED / NOT_COLLECTED / OUT_FOR_DELIVERY / DELIVERED / NOT_DELIVERED /
REVERSED), `reason`, `window_code`, `supersedes_id`, `recorded_at`,
`recorded_by`, `recorded_by_role`, `notes`.
`UNIQUE (voucher_id, sequence_no)` is the concurrency guard.

**`rik.issue_voucher_issue_lines`** — what was *physically* handed over:
`pool_id`, `provision_id`, `original_provision_id`, `quantity`,
`consumption_ratio`, `pool_equivalent_qty`, `carry_forward_qty`,
`substitution_reason`.

**`rik.dry_carry_forward`** — one previous month's unissued Dry balance:
`customer_id`, `source_period_id`, `target_period_id`, `source_selection_id`,
`pool_id`, `quantity`, `unit`, `basis` (frozen jsonb), `established_*`,
`lapsed_at`, `lapse_reason`.

### The invariants are in the database, not only in the service

| Guard | Mechanism |
|---|---|
| The application can never write a voucher status | `app_rik` holds **SELECT, INSERT** on `rik.issue_vouchers` and nothing else (verified on a fresh rebuild). Status is projected by a `SECURITY DEFINER` AFTER-INSERT trigger on the outcomes table, so status and history cannot disagree. |
| One standing completion per voucher | `issue_voucher_outcome_valid` BEFORE-INSERT trigger + `UNIQUE (voucher_id, sequence_no)`. |
| Lane separation | A pickup outcome on a delivery voucher (and the reverse) is refused by trigger. |
| History is immutable | `*_append_only` triggers; UPDATE and DELETE revoked from `app_rik` on both history tables. |
| Substitution stays in its pool | `issue_line_valid` trigger. |
| Carry-forward cannot stack | `carry_forward_no_stacking`: a period that *received* a carry-forward can never be a *source*, and the source must be the immediately preceding period. |
| Carry-forward is frozen | `carry_forward_frozen`: only a lapse may change the row, and only once. |
| Nothing is deleted | DELETE revoked on all three tables. |

12 triggers on the three new tables; one function,
`rik.dry_carry_forward_remaining(uuid)` = quantity − Σ un-reversed
`carry_forward_qty`.

### Preservation
No table was altered destructively; no historical row was rewritten. Confirmed
selections, rule snapshots, officer records, eligibility imports, issue windows
and audit history are untouched — asserted directly (group 4: "the officer's
confirmed selection is byte-for-byte unchanged"; group 8: "the source selection
and snapshot were never touched by any of it"). No RIK stock-quantity
inventory was introduced; the two legacy Phase 2 `rik.inventory*` tables remain
empty and unused (asserted).

---

## 4. API and UI delivered

### API — `/admin/rik/fulfillment`
| Route | Permission |
|---|---|
| `GET vouchers/:id` | `rik.order.mark_collected` |
| `GET vouchers/:id/admin` | `rik.order.manage` |
| `POST vouchers/:id/pickup` | `rik.order.mark_collected` |
| `POST vouchers/:id/delivery` | `rik.order.manage` |
| `POST vouchers/:id/corrections` | `rik.order.manage` |
| `POST vouchers/:id/lapse`, `POST lapses` | `rik.order.manage` |
| `POST carry-forward`, `POST carry-forward/lapse` | `rik.order.manage` |

**No new role and no new permission** — still exactly 6 roles and 20
permissions (asserted). No PURCHASING role. `DELIVERY_STAFF` holds no `rik.*`
permission at all and is refused on every route (asserted twice).

Customer: `GET /rik/issue-vouchers/:id` now also returns `issueStatus` —
status, completion, what was actually issued (with substitutions named),
carried balance, lapse, and the final-window reminder. It carries **no** staff
identity, no notes, no event sequence and no correction detail (asserted by
string search on the response).

### Admin UI
Voucher search → counter panel showing officer, fulfilment mode and
location/address; per-line "actually issued" quantity; a substitute selector
populated **only** from server-offered alternatives; mandatory substitution
reason; lane-correct action buttons; the carried balance as its own block;
reminder and lapse banners; a correction block disabled until a reason of at
least 5 characters; full event history with reversed events struck through.
There is no edit, delete or undo control on a completed voucher.

### Customer PWA
Voucher stays structurally read-only (no form, no input, no select, no
textarea — asserted). Added: the final-Fresh-window reminder (server decides
whether it is due; the screen only renders the sentence), the lapse notice
(stating explicitly that the voucher number and eligible days are unchanged and
Dry is unaffected), "What was actually issued" (and a plain "nothing has been
recorded as issued yet" when nothing has), and "Carried from last month" shown
separately from the month's own entitlement. No calendar date or operating day
is hardcoded anywhere in this UI.

---

## 5. The two gaps, resolved

**A. Fresh lapse.** At the close of the final configured Fresh window, the
remaining unissued Fresh entitlement lapses by appending a `NOT_COLLECTED` /
`NOT_DELIVERED` outcome with reason `WINDOW_CLOSED` and a `SYSTEM`-level
record. The **same voucher keeps its number**; no replacement voucher is
created; eligible days do not move; no adjustment row is written; the Dry
voucher of the same selection is untouched; and nothing is marked collected or
delivered. Lapsing twice changes nothing. All six of those are separate
assertions.

**B. Dry carry-forward.** Established only after the source Dry window has
closed, only from a `CONFIRMED` selection, as
`confirmed pool equivalent − physically issued pool equivalent`, with the
basis frozen as jsonb. It is held separately from current-month entitlement,
is consumed only within the target month's Dry window, lapses when that window
closes, cannot stack, and cannot be established twice (idempotent in the
service *and* refused by a unique index when the application is bypassed).

**Implementation decision, recorded not invented:** when a line is issued, the
**carried balance is drawn first**, because it is the portion with a deadline.
This is an allocation order, not a new business rule, and it is asserted
("is SPENT FIRST when the officer collects this month").

---

## 6. Test results — all executed in this session

| Suite | Result |
|---|---|
| **Phase E focused** `rik-fulfillment.integration.spec.ts` | **79 / 79 passed** (11 groups) |
| **Full API regression** | **1061 / 1061 passed, 29 / 29 suites** |
| **admin-web** (incl. 11 new fulfilment tests) | **177 / 177 passed, 13 files** |
| **customer-web** (incl. 10 new Phase E voucher tests) | **163 / 163 passed, 8 files** |
| **packages/config** | **12 / 12 passed** |
| Typecheck | api, admin-web, customer-web, shared-types, config — **all clean** |
| Lint (whole monorepo) | **clean** |
| Production builds | api, admin-web, customer-web — **all built** |
| Fresh rebuild | all 49 migrations applied in order on a new database → **65 tables / 5 views**; `0049` re-applied → idempotent, still 65; `app_rik` = `INSERT, SELECT` on `rik.issue_vouchers` and on `rik.issue_voucher_outcomes` |

### The 13 acceptance areas
| # | Area | Where | Count |
|---|---|---|---|
| 1 | Pickup collection and explicit non-collection | group 1 | 10 passed |
| 2 | Delivery lifecycle and explicit non-delivery | group 2 | 5 passed |
| 3 | Unauthorized status changes | group 3 | 6 passed |
| 4 | Physical issue recording and entitlement consumption | groups 1, 4, 8 | included above |
| 5 | Full and partial approved substitutions | group 4 | 5 passed |
| 6 | Unapproved substitutions and invalid quantities | group 5 | 7 passed |
| 7 | Confirmed-selection immutability | groups 4, 7, 8 | included above |
| 8 | Fresh continuation and final-window lapse | group 7 | 11 passed |
| 9 | Dry carry-forward, consumption and expiry | group 8 | 12 passed |
| 10 | Duplicate requests, concurrent actions, audit | group 11 | 3 passed |
| 11 | Schedule changes and customer read-only status | group 7 (schedule move), group 9, customer-web | 5 + 25 passed |
| 12 | Completed-voucher correction / reversal | group 6 | 10 passed |
| 13 | Regression of entitlement, catalogue, import, voucher tests | full API run | 1061 passed |

Group 10 ("the approved baseline is untouched", 5 passed) additionally pins the
schema shape, PIF at 20 tables, the absence of a RIK stock table, the catalogue
figures and the 18 covers.

### Two defects found and fixed during this phase
1. **Response clobber (found by writing the customer UI).** The Phase E block
   was first returned to the officer under the key `fulfillment`, which the
   voucher document has used since Phase D for the **destination**. The object
   spread silently replaced it, so the officer's own screen would have lost its
   collection point / delivery address. Renamed to `issueStatus`, and a named
   regression test now asserts both blocks are present at once.
2. **A genuine race answered 500.** Two simultaneous "Collected" requests both
   pass the pre-check; the loser hit the database guard, and
   `withTransaction`'s `SafeDatabaseError` surfaced as a bare 500. The loser's
   error is now re-examined: if a standing completion exists, the refusal
   becomes the same `ALREADY_COMPLETED` **409** the sequential case gives;
   otherwise the original error is rethrown untouched. Data integrity was never
   at risk — exactly one outcome, one set of issue lines and one audit entry
   were recorded either way, which is now asserted.

---

## 7. Remaining blockers and historical data

**No blocker to RIK fulfilment.**

On historical Dry carry-forward, the honest position: a carry-forward can only
be computed from **physical issue records**, and those begin with migration
`0049`. For any period that closed before this phase there is nothing to
compute from, and the implementation refuses to invent a balance.

I enumerated the affected cases in the working database rather than assuming:
13 closed periods, 193 closed-period Dry vouchers, of which 94 have no outcome
record. **Every one of them belongs to a Jest fixture period**
(`Jest 15E target` 42, `Jest 15D ration …` 52) — there is no real operational
history in this database, because the application has never run in production.

So the resolution path is a policy statement, not a data migration:
carry-forward is available from the first month in which fulfilment is recorded
onward. If the facility later wants a balance for a month that predates
go-live, it must be entered as an explicit, audited establishment with a stated
basis — the `basis` jsonb column and `established_by` exist for exactly that —
and never inferred.

---

## 8. Readiness decision

**RIK fulfilment is ready for submission.** The lifecycle, physical issue
records, approved substitutions, Fresh lapse, one-month Dry carry-forward,
controlled correction, staff screen and officer view are implemented, enforced
in the database, and covered by 79 focused tests inside a 1061-test API
regression with clean typechecks, clean lint and three production builds.

Two operational notes for the facility, not blockers:
- the 500→409 fix and the `issueStatus` rename are both server-side; no client
  outside this repository consumes either shape yet;
- carry-forward starts from the first recorded month (§7).

---

## 9. Checkpoint

The repository is not under version control, so the checkpoint is an archive:

- `esamagri-PHASE-E-code-2026-10-09.tar.gz` — the full source tree
  (no `node_modules`, no `dist`).
- `esamagri-PHASE-E-full-2026-10-09.tar.gz` — the same tree plus a
  `pg_dump -Fc` of `esamagri_test` taken after this phase.

---

## 10. Next steps for PIF

PIF was not touched: 20 tables, unchanged and asserted. In order:

1. **State check first.** PIF has schema and seed data from Phase 2 and a
   scope-correction analysis in `docs/reports/pif-scope-correction-analysis.md`.
   Read that before writing anything; it is the document that defines what PIF
   is now meant to be.
2. **Catalogue and pricing** — PIF sells rather than issues, so the first
   working slice is the priced catalogue and the cart, reusing the existing
   `pif.*` tables rather than new ones.
3. **Order lifecycle**, following the pattern this phase established: the
   application holds SELECT+INSERT, an append-only event table carries history,
   and a trigger projects status. This is the part most worth copying — it is
   the reason RIK status and history cannot disagree.
4. **Billing and payment records** against the existing PIF billing tables.
5. **Fulfilment** — PIF can reuse the lane model (pickup / delivery, explicit
   non-collection) but needs its **own** tables; the RIK ones are
   entitlement-shaped and must not be shared.
6. **Permissions** — PIF roles exist in the current 6-role / 20-permission set.
   Do not add a role; in particular, no PURCHASING role.
7. **Tests** — mirror this phase's structure: prove each database guard by
   bypassing the application, and claim nothing that was not executed.
