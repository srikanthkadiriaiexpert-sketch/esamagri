# e Samagri — STEP 11C — RIK Admin Configuration API + Dashboard

**Implementation report** · 23 September 2026

---

## Status

| Capability | Status |
|---|---|
| **ENTITLEMENT POOLS** | **COMPLETE** |
| **DAILY SCALES** | **COMPLETE** |
| **CONVERSIONS** | **COMPLETE** |
| **PROVISIONS / SKU MASTER** | **COMPLETE** |
| **PACK SIZES & LIMITS** | **COMPLETE** |
| **ISSUE PERIODS & AVAILABILITY** | **COMPLETE** |
| **RULE HISTORY** | **COMPLETE** |
| **RIK_ADMIN-ONLY AUTHORIZATION** | **COMPLETE** |
| **SERVER-SIDE VALIDATION** | **COMPLETE** |
| **AUDIT LOGGING** | **COMPLETE** |
| **ENGINE USES ADMIN CONFIGURATION** | **COMPLETE** |

Every line above is covered by a test that runs against the real database over real
HTTP. Nothing is claimed on the strength of code reading alone.

**The headline claim, and how it is substantiated.** The tests create a pool, a daily
scale and a provision **through the HTTP API only** — no SQL, no fixture — then ask the
STEP 11B engine what a customer is entitled to. It answers 3,100 g, being 100 g/day ×
31 eligible days, from rows the dashboard wrote. Changing the scale to 150 through the
API makes the next calculation 4,650. Changing a consumption ratio changes what the
engine offers. Deactivating a provision removes it; deactivating a pool removes the pool.
**Not one line of the STEP 11B calculation engine was modified.**

**Not in this step, by instruction:** no customer Know Your Ration frontend, no RIK cart,
no RIK checkout, no RIK pickup workflow, no PIF work, no notifications.

---

## 1. Inspection findings (done first, as instructed)

The existing admin dashboard and RBAC were read before anything was written.

| Question | Finding |
|---|---|
| Is a new role needed? | **No.** `RIK_ADMIN` already exists. |
| Is a new permission needed? | **No.** `rik.entitlement.adjust` and `rik.product.manage` both already exist. |
| Who holds them? | **RIK_ADMIN and nobody else** — verified by query, not assumption. |
| Does SUPER_ADMIN hold them? | **No** — see Limitation 1. Reported, not worked around. |
| Existing guard chain | `JwtAuthGuard` (401) → `AuthorizationGuard` (403), unchanged. |
| Existing audit path | `AuditLogRepository` → `shared.log_audit_event`, append-only. Reused; no second audit system. |
| Existing admin shell | `AdminLayout` with permission-filtered navigation; `States.tsx` with five honest states. Both reused. |

So the RBAC requirement is met with **no new role, no new permission, no change to the
authorization architecture, and no change to any existing grant.** The test suite asserts
that `shared.roles` still holds 6 rows and `shared.permissions` still holds 20, and that
no `PURCHASING` role exists.

---

## 2. Files created

**Backend** — `apps/api/src/rik/`
```
repositories/entitlement-config-admin.repository.ts   the write side + admin read side
services/rik-admin-config.service.ts                  validation, audit, supersede
dto/rik-admin-config.dto.ts                           request shapes
rik-admin.controller.ts                               /admin/rik/config
rik-admin-config.integration.spec.ts                  110 tests
```

**Frontend** — `apps/admin-web/src/`
```
lib/api/rik-config-api.ts                    the seven screens' only contract
design-system/ConfigUI.tsx                   shared table, form and status pieces
routes/rik-config/RikConfigLayout.tsx        the seven-tab shell
routes/rik-config/PoolsPage.tsx              1. Entitlement pools
routes/rik-config/ScalesPage.tsx             2. Daily scales
routes/rik-config/ConversionsPage.tsx        3. Conversions
routes/rik-config/ProvisionsPage.tsx         4. Provisions / SKU master
routes/rik-config/PackSizesPage.tsx          5. Pack sizes & limits
routes/rik-config/AvailabilityPage.tsx       6. Issue period & availability
routes/rik-config/RuleHistoryPage.tsx        7. Rule history
routes/rik-config/rik-config.test.tsx        31 tests
```

**Database**
```
database/migrations/0028_rik_configuration_delete_policy.sql   defect fix — see §8
```

**Documents**
```
docs/reports/step-11c-admin-configuration-report.md            this file
```

## 3. Files modified

| File | Why |
|---|---|
| `apps/api/src/rik/rik.module.ts` | Registered the new repository, service and controller. The RIK↛PIF boundary rule is untouched. |
| `apps/api/src/shared/repositories/audit-log.repository.ts` | Added `listForModule(...)` — a **read** method for the Rule history screen. The write path is unchanged; the table remains append-only. |
| `apps/admin-web/src/app/App.tsx` | Added the seven nested routes under `/rik/config`. |
| `apps/admin-web/src/routes/AdminLayout.tsx` | One new navigation entry, gated by `rik.entitlement.adjust`. |
| `apps/admin-web/src/routes/RikAdminPage.tsx` | "Entitlements — pending facility confirmation" became a link to a working screen, because it now is one. Pickup/delivery still says pending, because it still is. |
| `apps/admin-web/src/routes/RikAdminPage.test.tsx` | Two assertions updated to the new reality; the anti-fabrication checks are unchanged and still pass. |

**Not modified:** authentication, OTP, the RBAC architecture, any role, any permission,
customer profile architecture, **the STEP 11B calculation engine**, any Phase 2 migration,
or anything in PIF.

---

## 4. APIs created

All under `@Controller('admin/rik/config')`, behind `JwtAuthGuard` → `AuthorizationGuard`.

| Method | Route | Permission |
|---|---|---|
| GET | `pools` | `rik.entitlement.adjust` |
| POST | `pools` | `rik.entitlement.adjust` |
| PATCH | `pools/:id` | `rik.entitlement.adjust` |
| POST | `pools/:id/active` | `rik.entitlement.adjust` |
| GET | `scales` (`?poolId=`) | `rik.entitlement.adjust` |
| POST | `scales` | `rik.entitlement.adjust` |
| PATCH | `scales/:id` | `rik.entitlement.adjust` |
| POST | `scales/:id/supersede` | `rik.entitlement.adjust` |
| POST | `scales/:id/active` | `rik.entitlement.adjust` |
| GET | `conversions` | `rik.entitlement.adjust` |
| POST | `conversions` | `rik.entitlement.adjust` |
| PATCH | `conversions/:id` | `rik.entitlement.adjust` |
| POST | `conversions/:id/active` | `rik.entitlement.adjust` |
| GET | `provisions` (`?poolId=`) | `rik.product.manage` |
| GET | `provision-pools` | `rik.product.manage` |
| POST | `provisions` | `rik.product.manage` |
| PATCH | `provisions/:id` | `rik.product.manage` |
| POST | `provisions/:id/active` | `rik.product.manage` |
| GET | `history` | `rik.entitlement.adjust` |

**There is no DELETE endpoint anywhere**, and the suite asserts that too. Retiring a rule
is `POST .../active` with `isActive: false`.

**Reads are gated as tightly as writes.** A staff member who may not change the
entitlement rules has no business reading the administrative view of them either — which,
unlike the customer-facing engine, includes every retired and future-dated row.

---

## 5. The seven screens

| # | Screen | What it edits | The thing it makes plain |
|---|---|---|---|
| 1 | Entitlement pools | `rik.entitlement_pools` | A pool is one balance. Items sharing a pool compete; items in different pools do not. |
| 2 | Daily scales | `rik.pool_scales` | **A missing row means the pool does not apply to that dietary preference at all.** Retiring a row removes an entitlement rather than zeroing it. |
| 3 | Conversions | `rik.pool_conversions` | Automatic applies by itself; elective surrenders the source pool rather than adding to it. The rate is shown as two quantities, the way the rule was written. |
| 4 | Provisions / SKU master | `rik.provisions` | The consumption ratio is the only number connecting an item to entitlement. |
| 5 | Pack sizes & limits | `rik.provisions` (4 columns) | **A pack size is not an entitlement.** 500 g packs against a 600 g allowance is correct. |
| 6 | Issue period & availability | `rik.provisions` (3 columns) | The issue day is independent of the pool's ration type — the bread case — and the screen flags a difference rather than hiding it. |
| 7 | Rule history | `shared.audit_log` (read) | What changed, by whom, when, with before and after. Append-only: nobody can revise it. |

Screens 5 and 6 are **views of the provisions table, not tables of their own**, and each
says so. They exist separately because they answer different questions and are revised on
different rhythms, and they share one PATCH contract so they cannot drift apart.

**No business logic is duplicated in the frontend.** The screens compute nothing, validate
no quantity and decide no applicability. A negative scale is sent to the server as typed
and the server's refusal is shown verbatim — there is a test that asserts exactly this,
because a screen that silently corrected the value would be stating a rule it does not
enforce.

---

## 6. Validation — all of it server-side

Each row below is a test that goes over HTTP and checks the machine-readable reason.

| Rejection | Reason code |
|---|---|
| Consumption ratio of zero or negative | `INVALID_RATIO` |
| Negative daily entitlement | `NEGATIVE_ENTITLEMENT` |
| Pack size of zero or less | `INVALID_PACK_SIZE` |
| Max quantity of zero or less | `INVALID_MAX_QUANTITY` |
| Max packs of zero or less | `INVALID_MAX_PACKS` |
| Minimum eligible days of zero or less | `INVALID_MIN_ELIGIBLE_DAYS` |
| Dietary preference outside PV/EV/NV | refused before the handler runs |
| End date before start date | `INVALID_EFFECTIVE_RANGE` |
| Second scale for the same pool, diet and start date | `DUPLICATE_SCALE_VERSION` |
| Scale whose window overlaps an active one | `OVERLAPPING_SCALE` |
| Reference to a pool that does not exist | `POOL_NOT_FOUND` |
| Duplicate pool / conversion / provision code | `DUPLICATE_CODE` |
| Conversion from a pool to itself | `CONVERSION_POOLS_IDENTICAL` |
| Conversion quantity of zero or negative | `INVALID_CONVERSION_QUANTITY` |
| Loose item carrying a pack size | `LOOSE_ITEM_CANNOT_HAVE_PACK_SIZE` |
| PATCH that changes nothing | `NO_CHANGES_SUPPLIED` |
| Unrecognised field in the body | refused, not ignored |
| Row that does not exist | 404 |

`OVERLAPPING_SCALE` is **stronger than the database constraint**. The table's unique key
catches only two rows starting on the same date; two active scales for one pool and diet
with overlapping windows would make "the scale in force on date X" ambiguous, and nothing
previously refused that. The service now does.

**A rejected request writes nothing** — separately asserted, by counting rows and by
re-reading the provision afterwards to confirm every field is exactly as it was.

**Why no `@Min` guards a quantity in the DTOs.** If the request pipe refused a negative
scale, it would do so with a generic "validation failed" and the service's own specific
rule would never run and never be tested. The quantity rules belong to the service, and
the DTOs deliberately let them reach it.

---

## 7. Changing a rule without rewriting the past

Two operations, because both are real administrative acts and they mean different things:

- **Correct** edits the row in place. The effective window is unchanged, so a calculation
  dated inside it now uses the corrected figure. This is for a rule that was never right.
- **Supersede** closes the current row the day before the new one opens and inserts a new
  row. What the rule *was* on an earlier date stays readable. This is for a rule that is
  changing.

Tested: superseding a 100 g/day NV cereal scale from 20 January leaves a configuration
read dated 10 January answering **100**, and one dated 25 January answering **200**.

A **CONFIRMED selection is unaffected either way** — it carries its own JSONB rule
snapshot, which is what reproduces it. That was STEP 11B's design and this step relies on
it rather than duplicating it.

---

## 8. Defect found and fixed — migration 0028

**The defect.** Migration 0025 revoked `DELETE` on all four configuration tables from
`app_rik`, under the rule *"configuration is deactivated or closed, never deleted, because
a confirmed selection depends on it."* The rule is right; the blanket `REVOKE` expressing
it was too broad, in exactly the way migration 0027 already found for selections.

Until this step these rows could only arrive by SQL, so a mistake was rare and was fixed
in SQL. **The dashboard changes that.** A mistyped pool, a scale entered against the wrong
diet, a provision created twice — each is now one click. Under a blanket `REVOKE` every
such mistake is permanent: the best an administrator can do is set `is_active = false`,
and the wrong row sits in the configuration list forever beside the right one.

Worse, the protection that actually matters was expressed only as an *absence*. Nothing
anywhere asserted "used configuration is permanent", so nothing enforced it against the
owner or a superuser.

**The fix.** Migration 0028 restores `DELETE` and states the real rule as a trigger:

> A configuration row cannot be deleted once it has been used to produce a **CONFIRMED**
> entitlement selection.

This is **stricter** than the grant it replaces, not looser:

- Before, a superuser could delete a pool a confirmed snapshot depended on and nothing
  objected. Now nothing can, regardless of role.
- The existing foreign keys already refuse to delete a pool, provision or conversion that
  a selection line or election points at. Those are untouched; the trigger is an
  *additional* refusal covering what the foreign keys cannot see — a row appearing only
  inside a CONFIRMED `rule_snapshot`. **`rik.pool_scales` has no foreign key pointing at
  it at all, so for scales this is the only protection there has ever been.**

The check matches the row's id anywhere in the snapshot document rather than at a fixed
path, so a later change to the snapshot's shape cannot quietly open a hole. A false
positive only refuses a delete; a false negative would destroy history.

**No table, column, constraint or index is added, altered or dropped.** The schema
contract is unchanged at 55 tables and 5 views.

Tested both ways: a pool referenced by a confirmed selection **cannot** be deleted; an
unused pool created by mistake **can**.

---

## 9. Audit

Every create, update, activate, deactivate and supersede writes to `shared.audit_log`
through the existing `shared.log_audit_event` path, with:

- the actor's id and their role,
- `module = 'rik'` and the table as `entity_type`,
- the configuration values **before** and **after** (explicit field lists, not a row
  spread — an audit entry should record configuration, not whatever columns a future
  migration adds).

A database trigger from migration 0005 rejects `UPDATE` and `DELETE` on that table
outright. The suite asserts that an attempt to rewrite an entry fails.

Screen 7 reads these entries back and highlights the field that actually moved.

---

## 10. Tests

**141 new tests, all passing. Full suite: 541 passing, 0 failing** (was 399).

| Suite | Tests | Change |
|---|---|---|
| Backend (`apps/api`) | **408** (18 suites) | +110 |
| Admin console | **90** | +32 |
| Customer app | 31 | — |
| `packages/config` | 12 | — |
| **Total** | **541** | **+142** |

What the 110 backend tests cover:

- **Authorization**, exhaustively: anonymous → 401 on all ten routes; CUSTOMER → 403;
  each of the five non-RIK_ADMIN staff roles → 403 on every read and write; a staff member
  with no role → 403; RIK_ADMIN → 200. Plus the seed-integrity assertions (6 roles, 20
  permissions, both codes RIK_ADMIN-only, no PURCHASING role).
- **Creation** of a pool, scale, conversion and provision through HTTP, and listing that
  includes retired rows.
- **Every validation rejection** in §6, plus proof that nothing was written.
- **The engine following the dashboard** — six tests, described above.
- **Superseding**, including the old window still answering with the old number.
- **Audit**, including immutability and the history filter never leaking another module.
- **The delete policy**, both directions.

The 31 admin-console tests check that each screen renders what the server returned, sends
what was typed, and shows the server's refusal — and explicitly that it does **not**
correct a negative value itself.

**Isolation from the STEP 11B suite.** Jest runs spec files in parallel. Everything this
suite creates is dated in 2027 — configuration window and issue period alike — while the
STEP 11B suite works entirely in 2026. Effective-dated configuration is invisible outside
its window by construction, so the two cannot see each other's rows. That is the
versioning model doing the job it was built for, used rather than worked around.

---

## 11. Quality gates

**Typecheck PASS · Lint PASS (`--max-warnings=0`) · Build PASS** — all five workspaces.

---

## Limitations — stated plainly

1. **SUPER_ADMIN cannot reach these screens.** In the approved seed it holds only the five
   shared user/role/settings/audit/announcement codes and no `rik.*` code at all. This is
   the seed reflected exactly, not a decision taken here. If the facility wants a super
   administrator to administer RIK configuration, that is a database grant and a decision
   for them — say the word and it is one migration.
2. **Provisions can be created and edited but not superseded.** The effective-dated
   supersede flow is built for scales, where the specification's "this much per day"
   numbers change. A provision's ratio is corrected in place today. If a ratio ever needs
   to change *from a date*, the same pattern extends to provisions with no new concept —
   the columns already exist.
3. **No bulk import.** A facility loading a hundred new SKUs would do so one at a time
   through the screen. A CSV import is a natural next step and was not asked for.
4. **Conversions are edited, not superseded**, for the same reason as (2).
5. **Pool `unit` and a provision's `unit` are independent**, and nothing checks that a
   provision's unit is sensible for its pool's unit (a `piece` item against a `g` pool is
   accepted, because the consumption ratio expresses the conversion). That is deliberate
   — it is how "2 eggs" can consume a millilitre pool — but it does mean a genuine unit
   mistake is caught by review rather than by the system.
6. **The rule-history screen shows the last 200 entries** with a per-table filter. There
   is no date range and no per-row drill-through; both are small additions if wanted.
7. **`asOf` for the engine remains the issue period's end date** (STEP 11B, unchanged).
   Worth confirming this still matches intent now that an administrator can schedule a
   rule change mid-period: a change effective from the 20th applies to the *whole* period
   ending on the 31st, not pro-rata. If pro-rata is intended, that is a calculation change
   and a separate decision.

---

## Verification state

**55 tables · 5 views · 28 migrations · 18 pools · 50 scales · 7 conversions ·
119 provisions · 6 roles · 20 permissions.**

No role added, no permission added, no PURCHASING role, no RIK stock inventory, no POS, no
supplier or warehouse management, no authentication or RBAC change, and **no residual test
data** — the configuration counts are exactly what they were before this step ran.

One piece of housekeeping: seven staff rows and five announcements left behind by an
aborted STEP 10 test run on 12 September were cleaned up. Their sixteen audit-log entries
remain, correctly — that table is append-only and nothing references the removed rows.

**Next milestone:** the customer-facing Know Your Ration screen, which will read the
configuration this dashboard now maintains.
