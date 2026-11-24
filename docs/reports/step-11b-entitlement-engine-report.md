# e Samagri — STEP 11B — RIK Entitlement Calculation Service

**Implementation report** · 23 September 2026

---

## Status

| Capability | Status |
|---|---|
| **FRESH** | **COMPLETE** |
| **DRY** | **COMPLETE** |
| **PV** | **COMPLETE** |
| **EV** | **COMPLETE** |
| **NV** | **COMPLETE** |
| **AUTOMATIC CONVERSIONS** | **COMPLETE** |
| **ELECTIVE CONVERSIONS** | **COMPLETE** |
| **SHARED POOLS** | **COMPLETE** |
| **OVER-ENTITLEMENT PROTECTION** | **COMPLETE** |
| **ADMIN-DATA DRIVEN** | **COMPLETE** |
| **HISTORICAL SNAPSHOT** | **COMPLETE** |

Each of these is implemented **and** covered by a test that asserts it against the real
database. Nothing above is claimed on the strength of code reading alone.

**Not in this step, by instruction:** no Know Your Ration UI, no RIK cart, no RIK
checkout, no PIF, and no RIK admin configuration UI (§21 — the admin *API* surface is
also not yet built; see Limitations).

---

## 1. Files created

**Repositories** — `apps/api/src/rik/repositories/`
```
entitlement-config.repository.ts        pools, scales, conversions, provisions
entitlement-periods.repository.ts       the issue period a calculation runs against
entitlement-selections.repository.ts    drafts, lines, elections, confirmation
```

**Services** — `apps/api/src/rik/services/`
```
entitlement-math.ts                     precision, display rounding, ratio maths
rik-eligibility.service.ts              basis resolution + provision availability
rik-conversion.service.ts               AUTOMATIC / ELECTIVE cross-pool conversion
rik-entitlement.service.ts              the calculator
rik-selection-validation.service.ts     server-side enforcement, concurrency, snapshot
```

**API / other**
```
apps/api/src/rik/rik.controller.ts                      customer entitlement API
apps/api/src/rik/dto/entitlement.dto.ts                 request shapes
apps/api/src/rik/rik-entitlement.integration.spec.ts    54 tests
database/migrations/0027_rik_selection_delete_policy.sql
docs/reports/step-11b-entitlement-engine-report.md
```

## 2. Files modified

| File | Why |
|---|---|
| `apps/api/src/rik/rik.module.ts` | Registered the repositories, services and controller; imports `SharedModule` (the guard's audit repository) and `AuthModule` (the guards). The RIK↛PIF boundary rule is untouched. |
| `apps/api/src/database/schema-contract.ts` | Baseline 47→55 tables (rik 13→21), with the reason and the eight new table names recorded in the file. |
| `apps/api/src/database/database.integration.spec.ts` | Two labels, 47→55. Assertions already read the contract constant. |
| `apps/api/src/database/database.service.spec.ts` | Mocked fixture rik 13→21. |
| `apps/api/src/database/schema-contract.spec.ts` | Mocked fixtures rik 13→21, and the deliberate "one short" case 12→20. |
| `database/migrations/0026_…seed.sql` | Added explicit `effective_from` (see Defect 2). |

**Not modified:** authentication, RBAC, permissions, roles, the customer app, the admin
console, or any Phase 2 migration.

## 3. Services created

- **`RikEligibilityService`** — resolves the authoritative basis (dietary preference,
  eligible days, `asOf`) from the database, and answers whether a provision may be
  offered. Throws distinct errors for "no dietary preference", "no eligible days",
  "no such period" rather than substituting a default.
- **`RikConversionService`** — turns configured conversion rows into effects; detects
  two elections that surrender the same source pool.
- **`RikEntitlementService`** — the calculator.
- **`RikSelectionValidationService`** — validation, persistence, concurrency, snapshot.

## 4. APIs created

| Method | Route | Purpose |
|---|---|---|
| GET | `/rik/entitlements/current` | Know Your Ration — FRESH and DRY, with provisions and conversion options |
| POST | `/rik/entitlements/validate` | Pre-flight a quantity, writing nothing |
| POST | `/rik/selections/quantity` | Set one provision's absolute quantity (0 removes) |
| POST | `/rik/selections/elections` | Choose elective conversions (replaces prior choice) |
| POST | `/rik/selections/confirm` | Confirm the draft, writing the rule snapshot |

All behind `JwtAuthGuard` → `AuthorizationGuard` with `@RequireCustomer()`. **No customer
id is accepted anywhere in the controller** — identity comes from the verified token, so
there is no id to tamper with and no way to read another officer's entitlement. Verified:
unauthenticated → 401, staff principal → 403.

## 5. Database tables used

Read: `rik.entitlement_pools`, `rik.pool_scales`, `rik.pool_conversions`,
`rik.provisions`, `rik.entitlement_periods`, `rik.customer_period_eligibility`,
`shared.customers.dietary_preference`.
Written: `rik.entitlement_selections`, `rik.entitlement_selection_items`,
`rik.entitlement_elections`.

**No schema change beyond migration 0027** (a defect fix — see below). Still **55 tables,
5 views, 6 roles, 20 permissions**.

## 6. Calculation examples — measured, not asserted

| Pool | Daily | 30 days | 31 days |
|---|---|---|---|
| Milk (NV base) | 250 ml | **7,500** | **7,750** |
| Cereals | 450 g | **13,500** | **13,950** |
| Dal | 40 g | **1,200** | **1,240** |
| Salt | 20 g | **600** | **620** |
| Onion/Garlic | 60 g | **1,800** | **1,860** |

**PV milk** — 250 base + 250 (eggs, AUTOMATIC) + 500 (meat, AUTOMATIC) = **1,000 ml/day**,
**30,000 ml** over 30 days. Derived from the conversion rows; the test also recomputes it
straight from the configuration and compares.

**Shared pool** — 400 g onion off 1,800 g leaves 1,400 g, which the engine offers as
**233 g of garlic** (1,400 ÷ 6, floored — you cannot be offered a fraction of a gram more
than the entitlement allows).

**Ratio** — 1,000 g pizza base × 4.5 = **4,500 g** consumed, leaving **9,000 g**.

**Split** — rice 2,000 (1:1) + atta 3,000 (1:1) + pav 500 (1:3 → 1,500) + rusk 400
(1:3 → 1,200) = **7,700 g** against one pool, leaving 5,800 g.

**Bread** — 1,600 g of sandwich bread leaves **11,900 g** of Cereals. It is a **DRY pool,
FRESH issue**: filtering to the FRESH issue period still reports the pool as DRY.

**Rejection** — with 11,500 g consumed, 500 g of pizza base (2,250 g equivalent) is
refused with `EXCEEDS_ENTITLEMENT` and the full detail: entitlement 13,500, already
consumed 11,500, requested equivalent 2,250, remaining 2,000, pool CEREALS. A rejected
selection is **not written** — separately asserted.

**Pack size is not entitlement** — salt entitlement is 600 g at 30 days while the pack
remains 500 g.

## 7–8. Tests

**54 new tests, all passing.** Full suite: **399 passing, 0 failing**.

| Suite | Tests |
|---|---|
| Backend (`apps/api`) | **298** (17 suites) — includes the 54 new |
| Customer app | 31 |
| Admin console | 58 |
| `packages/config` | 12 |
| **Total** | **399** |

Coverage against your §18 list: 30-day and 31-day scales · PV / EV / NV · meat→eggs ·
meat→milk · eggs→milk · conflicting elections refused · onion/garlic split ·
sugar/jaggery split · cereal split · pizza base 1:4.5 · pav 1:3 · rusk 1:3 · cup cake
1:7.5 · rice ratios · oats 30-day minimum · max packs · max quantity · not-selectable
provision · inactive provision · effective-date window · issue-period filtering ·
Fresh/Dry separation · bread DRY-pool/FRESH-issue · fresh vs condiment garlic isolation ·
over-entitlement rejection · exact-boundary acceptance · concurrency · historical
snapshot · API ownership.

**On §19** — the suite does not restate constants the engine hard-codes, because the
engine hard-codes none. One test reads every pool's scale back out of the database and
asserts the calculation equals scale × days for all 18. Four more mutate configuration
inside a transaction and assert the behaviour follows.

## 9–11. Quality gates

**Typecheck PASS · Lint PASS (`--max-warnings=0`) · Build PASS** — all five workspaces.

## 12. Concurrency handling

Every mutation runs in a transaction that first takes `SELECT … FOR UPDATE` on the
selection row, so parallel requests serialise and the second recalculates against what
the first committed.

Two races surfaced and were fixed:

- **Draft creation.** Two first-requests both find no draft and both insert; the partial
  unique index rejects the loser. The loser now re-reads the winner's row and proceeds.
- **The retry needed a SAVEPOINT.** In PostgreSQL a failed statement aborts the whole
  transaction, so without one the loser could only roll back. The insert is now wrapped in
  `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`.

Tested: two parallel 8,000 g selections against a 13,500 g pool — exactly one succeeds,
and the committed total never exceeds the entitlement.

## 13. Historical snapshot

On confirmation the selection stores a JSONB snapshot of the basis, the pools, the scales
for that dietary preference, the conversions, the elections taken, the provisions used,
and every line with **the ratio actually applied**. `recalculateFromSnapshot()` rebuilds
the calculation from that stored configuration rather than from the live tables, so an
administrative change today cannot restate a selection confirmed last month. A CHECK
constraint makes a CONFIRMED row without a snapshot impossible.

---

## Defects found and fixed

**Defect 1 — migration 0025 revoked DELETE on `rik.entitlement_selections`.** Too broad:
it grouped selections with configuration. A DRAFT is working state, and since a partial
unique index allows only one open draft per customer per period, an undeletable abandoned
draft would block that officer permanently. **Migration 0027** restores DELETE and
protects the case that actually matters with a trigger refusing to delete a CONFIRMED
selection — *stricter* than the grant it replaces, because it now binds the owner and
superuser too. Configuration tables keep their REVOKE exactly as 0025 set it.

**Defect 2 — the seed's `effective_from` defaulted to `CURRENT_DATE`.** That pinned the
whole configuration to the day the migration happened to run, so any period ending before
it resolved *no* active configuration. The engine was right; the data was wrong. Fixed in
0026 with an explicit 2026-01-01 start. Caught by the 31-day tests.

**Defect 3 — the schema-contract guard.** Not a defect in the guard: it failed 173 tests
the moment the new tables appeared, which is what it is for. Updated deliberately, with
the reason recorded, rather than loosened.

---

## Limitations — stated plainly

1. **No RIK admin configuration API or UI yet.** The schema and engine are fully
   data-driven and an administrator changing a row changes behaviour immediately — proven
   by test — but today that means a SQL update, not a screen. The CRUD endpoints and the
   admin screens are the next step.
2. **Elective conversions have no default.** An EV officer who elects neither meat
   alternative receives no meat-derived entitlement. The specification states the two
   options and no default, so none was invented. Worth confirming.
3. **One draft per customer per period**, enforced by a partial unique index.
4. **Vegetables has a single generic provision.** No vegetable SKU list was supplied;
   more are `INSERT`s, not code.
5. **`asOf` is the period's end date**, so a calculation for a past period uses the
   configuration in force then. Deliberate, and worth confirming it matches intent.
6. **Bread issue-period assignment** is my reading of your wording (the four items named
   "Bread" are FRESH-issue; rusk, cup cake, pizza base, cream roll and burger bun are DRY).
   One configurable column if you want it different.

---

## Verification state

**55 tables · 5 views · 27 migrations · 18 pools · 50 scales · 7 conversions ·
119 provisions · 6 roles · 20 permissions.** No role added, no permission added, no
PURCHASING role, no RIK inventory, no authentication or RBAC change, and no residual test
data.

**Next milestone:** the RIK admin configuration API and dashboard, so a RIK administrator
can edit pools, scales, conversions, provisions and limits without SQL.
