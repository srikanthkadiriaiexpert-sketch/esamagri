# e Samagri — STEP 11D — Customer RIK "Know Your Ration" + Entitlement View

**Implementation report** · 23 September 2026

---

## STEP 11D STATUS

| Capability | Status |
|---|---|
| **KNOW YOUR RATION** | **COMPLETE** |
| **FRESH** | **COMPLETE** |
| **DRY** | **COMPLETE** |
| **PV** | **COMPLETE** |
| **EV** | **COMPLETE** |
| **NV** | **COMPLETE** |
| **SHARED POOLS** | **COMPLETE** |
| **ELECTIVE CONVERSIONS** | **COMPLETE** |
| **QUANTITY SELECTION** | **COMPLETE** |
| **VALIDATION** | **COMPLETE** |
| **SECURITY** | **COMPLETE** |
| **RESPONSIVE UI** | **COMPLETE** |

Each line is implemented **and** covered by a test. The entitlement behaviour is proved
over real HTTP against real PostgreSQL using the approved 119-provision seed; the screens
are proved against that same response shape.

**Not in this step, by instruction:** no RIK checkout, no pickup selection, no delivery
address, no issue-staff or pickup workflow, no notifications, no PIF.

---

## 1. Files created

**Customer app** — `apps/customer-web/src/`
```
lib/api/rik-entitlement-api.ts                    the entitlement contract + formatters
routes/rik/ration/useEntitlement.ts               load, reconcile, and the distinct states
routes/rik/ration/RationStates.tsx                loading / no period / no diet / no days / error
routes/rik/ration/KnowYourRationPage.tsx          the home screen
routes/rik/ration/RationCategoryPage.tsx          one category and its choices
routes/rik/ration/know-your-ration.test.tsx       38 tests
```

**Backend**
```
apps/api/src/rik/test-support/current-period-lock.ts        test infrastructure (see §7)
apps/api/src/rik/rik-know-your-ration.integration.spec.ts   54 tests
```

**Documents**
```
docs/reports/step-11d-know-your-ration-report.md            this file
```

## 2. Files modified

| File | Why |
|---|---|
| `apps/api/src/rik/services/rik-entitlement.service.ts` | Two **additive** fields — `unavailableProvisions` and `selectedPoolEquivalentQty`. No calculation changed; see §5. |
| `apps/api/src/rik/rik.controller.ts` | Exposes those two fields; adds stable `reason` codes to the four basis refusals; distinguishes "that period does not exist" from "no period is open". |
| `apps/api/src/rik/dto/entitlement.dto.ts` | **Defect fix** — the elections route rejected every real id. See §6, Defect 1. |
| `apps/api/src/rik/services/rik-selection-validation.service.ts` | **Defect fix** — confirming twice returned HTTP 500. See §6, Defect 2. |
| `apps/api/src/rik/rik-entitlement.integration.spec.ts` | Takes the period lock (§7). No assertion changed. |
| `apps/customer-web/src/app/App.tsx` | Two new routes under `/rik/ration`. |
| `apps/customer-web/src/routes/rik/RikHomePage.tsx` | The "entitlement pending confirmation" panel became the real Know Your Ration entry point. |

**Not modified:** authentication, OTP, RBAC, roles, permissions, the admin console, the
STEP 11C configuration system, the database schema (**still 55 tables, 5 views, 28
migrations**), or anything in PIF. **No migration was needed for this step.**

## 3. Routes and components created

| Route | Screen |
|---|---|
| `/rik/ration` | Know Your Ration — summary, then Fresh and Dry categories |
| `/rik/ration/:poolId` | One category: balance, alternatives, items, choices |

Components: `KnowYourRationPage`, `RationCategoryPage`, `RationStateView`, plus
`BalanceCard`, `AutomaticNote`, `Alternatives`, `SelectionSummary`, `ProvisionRow`,
`NotAvailableYet` and `Refusal` within the category screen. The existing design system
(`Header`, `Card`, `Badge`, `Button`, `StateViews`) is reused unchanged — no new visual
language, no redesign.

## 4. APIs consumed

| Method | Route | Used for |
|---|---|---|
| GET | `/rik/entitlements/current` | Both screens, and re-read after any failure |
| POST | `/rik/selections/quantity` | Setting an absolute quantity (0 removes) |
| POST | `/rik/selections/elections` | Choosing or releasing an alternative |
| POST | `/rik/entitlements/validate` | Available in the client; not yet called by a screen (see Limitation 3) |
| POST | `/rik/selections/confirm` | Available in the client; belongs to checkout, which is a later step |

**No new endpoint was created.** Every existing route was used as it stands.

---

## 5. The architecture rule, and how it is enforced rather than asserted

The frontend calculates **nothing**. There is no `dailyScale × eligibleDays` and no
`quantity × consumptionRatio` anywhere in the customer app — the two screens receive
every figure already computed and choose only the words and the layout.

Three tests exist specifically to keep it that way, and each asserts a **negative**:

- A response is served whose `totalEntitlement` is deliberately **not** daily × days
  (9,999 g against a 450 × 30 scale). The screen must show 9,999. If it ever multiplies
  for itself, that test fails.
- A quantity far beyond the advertised ceiling is typed in. The screen must **send it**
  and report the refusal, not block it locally.
- The whole rendered screen is scanned for internal vocabulary ("entitlement pool",
  "conversion engine", "rule snapshot", "consumption ratio") and must contain none.

**The only arithmetic in the customer app** is composing a *requested* quantity from pack
steps (`selected + packSize`) when the plus key is pressed. That forms an input, which the
server then validates like any other; it never produces a displayed entitlement figure.
Where there is no pack size and the unit is not countable, no stepper is offered at all
rather than inventing a step of, say, 100 g.

**Two fields were added to the engine's output** — additive, changing no calculation, and
each because the alternative was to restate a rule in React:

- **`unavailableProvisions`** with the engine's own `reason`. Previously an item blocked
  by the minimum-eligible-days rule was filtered out and the reason discarded, so the app
  could only stay silent or say "oats needs 30 days" itself. §16 forbids the latter. The
  engine already knew the sentence (`RikEligibilityService.unavailableReason`); it had
  nowhere to put it. Kept in a **separate array** from `provisions`, so `provisions` still
  means exactly "what may be selected" and no existing caller or test saw any change.
  A provision excluded by dietary preference is deliberately **not** listed — that is
  categorical, and telling a pure vegetarian "meat is unavailable to you" would be worse
  than silence.
- **`selectedPoolEquivalentQty`** per item. §8 and §9 require "uses 2,250 g of your
  Cereals", which is exactly `quantity × ratio` — the one multiplication §2 names. The
  engine already computed it to total `consumed`; it simply did not report it per line.

---

## 6. Defects found and fixed

Three real defects, all found by exercising the customer routes over HTTP for the first
time. The STEP 11B suite reached the same logic through the services, **below** the
validation pipe and **outside** the transaction wrapper, which is precisely why none of
these was visible then.

**Defect 1 — the elections endpoint rejected every real id.** `SetElectionsDto` declared
`@IsUUID('4', { each: true })`, but every id in this system comes from
`shared.uuid_generate_v7()` — UUID **version 7**, chosen in Phase 2 for index locality.
So `POST /rik/selections/elections` answered **400 for every genuine conversion id**: no
customer could ever have chosen an alternative. Fixed to be version-neutral, matching
`SetProvisionQuantityDto`, which was always correct — which is why quantities worked and
elections did not.

**Defect 2 — confirming twice returned HTTP 500.** `DatabaseService.withTransaction`
deliberately replaces any error escaping its callback with a generic `SafeDatabaseError`,
so driver detail can never reach a caller. Correct for database failures — but it also
swallowed `SelectionNotOpenError`, a deliberate domain signal thrown inside the
transaction. The customer saw "a database error occurred" instead of "this is no longer
open". Fixed **locally in the RIK service**: the verdict is now carried out of the
transaction as a value and thrown outside it. `withTransaction` is untouched, and the
check still happens under the same `SELECT … FOR UPDATE` row lock.

**Defect 3 — four different refusals were indistinguishable.** "No period is open",
"that period does not exist", "set your dietary preference" and "your eligible days are
not recorded" call for four genuinely different responses from the customer — but three
shared HTTP 404 and differed only in their English sentence. Matching on prose would put
the distinction in a string anyone could reword. Each now carries a stable
`details.reason` (`NO_OPEN_PERIOD`, `PERIOD_NOT_FOUND`, `DIETARY_PREFERENCE_NOT_SET`,
`ELIGIBILITY_NOT_RECORDED`); **statuses and messages are unchanged**, so the change is
purely additive. A named-but-missing period also now says so, rather than reporting that
no period is open.

---

## 7. A latent test flake, fixed

`rik.entitlement_periods` carries a **global** exclusion constraint on its date range, so
the period covering *today* is a single exclusive resource — and every route that resolves
the current period needs one to exist. Jest runs spec files in parallel, so two RIK suites
both wanting it would collide.

`CurrentPeriodLock` takes a PostgreSQL advisory lock on its **own dedicated connection**
(not the pool — a session-level lock belongs to the connection that took it, and a pooled
unlock could land elsewhere and silently do nothing). Both suites take it; the second
waits. An aborted run releases it automatically when the process dies. Test infrastructure
only: no application code takes this lock.

---

## 8. Screens implemented

**Know Your Ration** (`/rik/ration`) — the customer's name, dietary preference in words
("Non-vegetarian", not "NV"), ration period with its dates, and eligible days; then Fresh
and Dry sections built **entirely from the response**. There is no category list in the
source and there must never be one. A row shows the entitlement, and once something is
chosen, what is left.

**Category** (`/rik/ration/:poolId`) —

- **The balance first**: entitlement, selected so far, still available, and the daily
  figure it came from, with the line *"Every item below draws on this one entitlement.
  Choosing more of one leaves less for the others."*
- **Included automatically** — base scale, each automatic conversion with the engine's own
  description, and the daily total. For a pure vegetarian: 250 + 250 + 500 = 1,000 ml,
  every figure the server's.
- **Choose an alternative** — elective conversions as a single choice. Taking one replaces
  the other rather than adding to it, so the customer cannot build a combination that will
  only be rejected. The server still refuses a clash, and that refusal is shown.
- **What you have chosen** — each item, its quantity, and what it costs the shared
  balance, then the total used and what remains. This is the screen's answer to "why is
  there less left than I expected".
- **Available items** — name, rate ("1 g uses 4.5 g"), pack size **only where one is
  recorded** (otherwise "Not specified" — never a fabricated number), per-item maximum,
  maximum packs, and which day it is collected on. The collection day is always shown,
  because it is genuinely independent of the entitlement it is drawn from: bread comes out
  of a dry entitlement and is handed over on the fresh day, and an officer who turns up on
  the wrong day has been failed by the screen.
- **Not available to you this period** — items the customer's diet allows that a condition
  blocks, with the engine's sentence verbatim.

**Customer language throughout**: "Your entitlement", "Selected so far", "Still
available", "Choose an alternative", "Collect on". A test scans the rendered screen and
fails on any internal vocabulary.

**States**: loading ("Loading your ration details…"), no open period (explicitly *"Nothing
is wrong with your account"*), missing dietary preference (a prompt and a button to the
profile — **never a default diet**), missing eligible days (explained as a facility
record, not the customer's fault), and a real failure (retry, no stack trace — asserted).

**Responsive**: built on the existing customer PWA conventions — `app-shell`, single
column, `min-h-touch` targets, a table-free layout that reflows rather than scrolls
sideways. Every control is labelled with the item it belongs to, and remaining/over-limit
is stated **in words** ("Fully used", "Still available") rather than by colour alone.

---

## 9. Security

The ownership boundary is **structural, not a check that could be forgotten**: no customer
id appears in any request shape, in the client or on the server. Identity comes from the
verified access token on every route.

Tested over HTTP: all five routes are **401** without a token and **403** for a staff
principal (RIK_ADMIN included — holding admin rights does not grant access to a customer's
ration). A request that tries to name another customer is **refused with 400**, not
silently ignored — ignoring would leave a reader unsure which id was used. Two customers
calling the same route receive two different rations. A confirmed selection is verified in
the database to belong to the customer who confirmed it. No admin configuration endpoint
is reachable from the customer app, and a scan asserts no stack trace, SQL or table name
reaches the customer.

---

## 10. Tests

**92 new tests. Full suite: 633 passing, 0 failing** (was 541).

| Suite | Tests | Change |
|---|---|---|
| Backend (`apps/api`) | **462** (19 suites) | +54 |
| Customer app | **69** | +38 |
| Admin console | 90 | — |
| `packages/config` | 12 | — |
| **Total** | **633** | **+92** |

Coverage against the §27 list — all 25:

1. Customer opens Know Your Ration ✓ · 2. receives own entitlement ✓ · 3. anonymous
rejected ✓ (all five routes) · 4. staff cannot access ✓ (all five routes) · 5. PV ✓ ·
6. EV ✓ · 7. NV ✓ · 8. Fresh categories ✓ · 9. Dry categories ✓ · 10. shared pool
display ✓ · 11. split selections ✓ · 12. elective conversion display **and** choosing,
releasing and conflict ✓ · 13. quantity selection ✓ · 14. over-entitlement error ✓ ·
15. maximum quantity ✓ · 16. maximum packs ✓ · 17. minimum eligible days ✓ (both
directions) · 18. inactive provision not shown ✓ (checked against the database) ·
19. issue-period filtering ✓ · 20. NULL pack size ✓ · 21. missing dietary preference ✓ ·
22. missing eligible days ✓ · 23. cannot access another customer's data ✓ ·
24. STEP 11B tests green ✓ (164, unchanged) · 25. STEP 11C tests green ✓ (110, unchanged).

**On assertion style**: where a figure is configuration — 450 g of cereals a day — the
test reads it from the response and asserts the **relationship** the customer depends on
(`total = daily × eligibleDays`, `remaining = total − consumed`) rather than restating the
constant. Where a fact is structural — a pure vegetarian is offered no meat — it is
asserted directly, because that *is* the requirement.

## 11. Quality gates

**Typecheck PASS · Lint PASS (`--max-warnings=0`) · Build PASS** — all five workspaces.

---

## Limitations — stated plainly

1. **A customer cannot set their own dietary preference, and this step did not add a way.**
   `PATCH /customer/me` accepts name and residence only; `shared.customers.dietary_preference`
   is currently writable by SQL alone. The screen therefore prompts and links to the
   profile, where the field does not yet appear — an honest dead end rather than a
   fabricated default. **This is a decision for you, not for me**: allowing an officer to
   change their own dietary preference changes their entitlement (PV → NV adds a meat
   allowance), and whether that is self-service or a facility action is a business rule.
   Say which, and it is a small, contained change either way.
2. **Confirming a selection is wired in the API client but not surfaced on a screen.**
   Confirmation is the first step of checkout, and §29 excludes checkout. The route works
   and is tested; nothing calls it from the UI yet.
3. **`POST /rik/entitlements/validate` is not called by either screen.** Every change goes
   through `selections/quantity`, which validates and persists atomically and returns the
   recalculated entitlement — so a separate pre-flight would be a second round trip for
   the same answer. It is kept in the client for a future "check before you commit" step.
4. **`maxPacks` has no effect where `pack_size` is NULL.** Maggi, Hakka Noodles and Maida
   each carry "maximum 2 packs" with no pack size recorded, so the engine cannot convert
   that into a quantity ceiling and the limit does not bind. The screen displays "Most
   packs: 2" truthfully, but nothing enforces it. **Recording those three pack sizes in the
   admin dashboard makes the limit real** — no code change needed. Worth doing before the
   facility relies on it.
5. **The quantity box works in the item's own unit** (grams, millilitres, pieces), not in
   packs. Officers used to ordering "2 packets" may expect a pack count. The plus/minus
   keys do step by a pack where one is recorded, which is the compromise; a pack-first
   input is a straightforward change if the facility prefers it.
6. **No search or filter within a category.** Cereals has twenty items and Condiments
   twenty-one, which is a long scroll on a phone. Grouping or a filter would help and was
   not asked for.
7. **The issue-period filter is supported by the API but not offered as a UI control.**
   Each item states its collection day instead. A Fresh/Dry toggle is a small addition if
   the facility wants the list split that way.
8. **Concurrency across devices is server-safe but not live.** Two devices editing the
   same draft serialise correctly on the server (row lock, absolute quantities), and the
   second change wins; the first screen learns of it on its next action rather than
   immediately. No push or polling was in scope.

---

## Verification state

**55 tables · 5 views · 28 migrations · 18 pools · 50 scales · 7 conversions ·
119 provisions · 6 roles · 20 permissions.**

No schema change, no migration, no role added, no permission added, no new API endpoint,
no change to the STEP 11B calculation or the STEP 11C admin system beyond the three
documented defect fixes and two additive output fields — and **no residual test data**.

**Next milestone:** RIK checkout — confirming the selection, then pickup or delivery.
