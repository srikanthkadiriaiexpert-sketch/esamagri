# e Samagri — Phase 3B — STEP 10 FINAL VERIFICATION

**Admin & Staff Application Foundation — closure review**
Base Victualling Yard, Visakhapatnam
Verification date: 16 September 2026
Mode: **verification only — no feature work, no redesign, no migration, no schema change**

---

## A. Overall status

### **PASS WITH WARNINGS**

Every item on your Section 18 acceptance gate is satisfied. Four things need your
decision before I would call STEP 10 finished; none is a code defect, and none was
worked around by inventing anything:

| | Warning | Needs |
|---|---|---|
| **F-1** | No PURCHASING role exists in the frozen seed | Your decision — **DATABASE_CHANGE_REQUIRED** |
| **F-2** | SUPER_ADMIN holds no `rik.*` or `pif.*` permission at all | Your decision — likely **DATABASE_CHANGE_REQUIRED** |
| **F-3** | `RIK_PICKUP_STAFF` / `DELIVERY_STAFF` have permissions but no screen yet | Acknowledgement only |
| **W-1** | 8 stale test rows in the database from a failed teardown on 12 Sep | Your approval to delete |

Full detail in Section W.

---

## B. Files changed

### Added by STEP 10

**`apps/admin-web/` — 49 files, the entire new workspace:**

```
.env.example  .env.local  .eslintrc.cjs  index.html  package.json
postcss.config.js  tailwind.config.js  vite.config.ts  vitest.config.ts
tsconfig.json  tsconfig.app.json  tsconfig.node.json  tsconfig.test.json
public/brand/e-samagri-logo.jpg
public/icons/{apple-touch-icon,favicon-32,icon-192,icon-512,icon-512-maskable}.png
src/main.tsx  src/env.ts  src/index.css  src/vite-env.d.ts
src/app/App.tsx
src/design-system/States.tsx
src/lib/api/{client,resource,admin-api}.ts
src/lib/auth/{StaffAuthContext,RequireStaffAuth}.tsx
src/routes/{AdminLayout,LoginPage,DashboardPage,AnnouncementsPage,
            RikAdminPage,PifAdminPage,IssueSchedulesPage,AccountPage,
            NotFoundPage}.tsx
src/routes/{AdminLayout,LoginPage,DashboardPage,AnnouncementsPage,
            RikAdminPage,IssueSchedulesPage,AccountPage}.test.tsx
src/test/{setup.ts,staff-session.ts}
```

**`apps/api/` — 8 files:**

```
src/admin/admin.controller.ts
src/admin/admin.module.ts
src/admin/admin.integration.spec.ts
src/admin/dto/announcement.dto.ts
src/admin/services/admin-announcements.service.ts
src/admin/services/admin-dashboard.service.ts
src/admin/services/announcement-scope.ts
src/rik/repositories/issue-schedules.repository.ts
```

**Docs:** `docs/reports/step-10-report.md`

### Modified by STEP 10 — 4 pre-existing files

| File | Why |
|---|---|
| `apps/api/src/shared/repositories/announcements.repository.ts` | Added the audience-scoped list/count/create/update the admin service calls. Reads and writes `shared.announcements` only. |
| `apps/api/src/shared/repositories/users.repository.ts` | Added `findById`, so `GET /admin/session` can return the signed-in staff member's username and display name. |
| `apps/api/src/shared/shared.module.ts` | Registered the above so `AdminModule` can inject them. |
| `apps/api/src/rik/rik.module.ts` | Placeholder module filled in to provide the read-only issue-schedule repository. |

`apps/api/src/app.module.ts` was **not** modified — `AdminModule`, `RikModule` and
`PifModule` were already registered as placeholders from an earlier phase.

### Deleted

**None.**

### Database files changed

**None.** The entire `database/` tree still carries its 10 September timestamp.

### Step 6 authentication files changed

**None.**

### Step 7 RBAC files changed

**None.**

### Added during *this* verification pass

| File | Purpose |
|---|---|
| `apps/api/src/admin/rbac-matrix.verification.spec.ts` | The Section 4 authorization matrix, over real HTTP against the real database — 46 tests. Adds no product behaviour. |
| `docs/reports/step-10-final-verification-report.md` | This report. |

Nothing else was touched. No production code was modified during verification.

---

## C. Admin/staff features verified

| Feature | Verified |
|---|---|
| Staff authentication on the existing Step 6 flow | ✅ Real sign-in with username + password through the built console against the live API |
| Role-aware navigation | ✅ Per-permission, verified for 4 roles |
| Admin shell (header, identity, content region) | ✅ At 5 widths |
| Dashboard foundation | ✅ Real counts or stated reasons, permission-filtered server-side |
| Account / profile / logout | ✅ Roles and exact permission codes; logout returns to sign-in |
| Unauthorized state | ✅ Rendered from a real 403 |
| Loading state | ✅ Distinct component |
| Empty state | ✅ Distinct component |
| Error state | ✅ Distinct component, no raw server text |
| RIK administrative foundation | ✅ Pending / not-built, nothing invented |
| PIF administrative foundation | ✅ Pending / not-built, nothing invented |
| Announcement foundation | ✅ With server-side audience isolation |
| Issue schedule foundation | ✅ Read-only, honest empty state |
| Responsive behaviour | ✅ 120 live combinations, zero defects |

---

## D. Roles verified

Your Section 3 names six roles. The frozen `shared.roles` table holds six, but they
are not the same six:

| Your term | Seed role | Status | Access behaviour observed |
|---|---|---|---|
| SUPER_ADMIN | `SUPER_ADMIN` | ✅ exists | Session, dashboard, all announcement audiences incl. ALL. **No RIK or PIF module access** — see F-2 |
| RIK_ADMIN | `RIK_ADMIN` | ✅ exists | Session, dashboard, RIK announcements, RIK issue schedules. Refused PIF and ALL audiences |
| PIF_ADMIN | `PIF_ADMIN` | ✅ exists | Session, dashboard, PIF announcements. Refused RIK announcements and RIK issue schedules |
| CASHIER | `PIF_CASHIER` | ✅ exists | Session, dashboard (POS tile only). Refused announcements and issue schedules |
| DELIVERY | `DELIVERY_STAFF` | ✅ exists | Session, dashboard. Refused announcements and issue schedules |
| **PURCHASING** | — | ❌ **does not exist** | See F-1 |
| — | `RIK_PICKUP_STAFF` | ✅ exists | Session, dashboard. Refused announcements and issue schedules |
| CUSTOMER | `shared.customers` | ✅ | **403 on every staff route** |

---

## E. Security — exact 401 / 403 verification results

Measured over **real HTTP against the real database**, every principal carrying a real
signed token and a real `shared.user_roles` grant. Not frontend behaviour — API status
codes.

### Unauthenticated → 401 (never 403, never data)

| Route | Status |
|---|---|
| `GET /admin/session` | **401** |
| `GET /admin/dashboard` | **401** |
| `GET /admin/announcements` | **401** |
| `POST /admin/announcements` | **401** |
| `GET /admin/rik/issue-schedules` | **401** |

### CUSTOMER principal → 403 on every staff route

| Route | Status |
|---|---|
| `GET /admin/session` | **403** |
| `GET /admin/dashboard` | **403** |
| `GET /admin/announcements` | **403** |
| `POST /admin/announcements` | **403** |
| `GET /admin/rik/issue-schedules` | **403** |

A customer is authenticated but not staff, so 403 is correct — and it is 403 for the
*whole* staff surface, not merely the permission-gated part.

### Staff roles × routes — observed status

| Role | `/admin/session` | `/admin/dashboard` | `GET /announcements` | `POST /announcements` (ALL) | `/rik/issue-schedules` |
|---|---|---|---|---|---|
| SUPER_ADMIN | 200 | 200 | 200 | **201** | **403** ← F-2 |
| RIK_ADMIN | 200 | 200 | 200 | **403** | 200 |
| PIF_ADMIN | 200 | 200 | 200 | **403** | **403** |
| PIF_CASHIER | 200 | 200 | **403** | **403** | **403** |
| RIK_PICKUP_STAFF | 200 | 200 | **403** | **403** | **403** |
| DELIVERY_STAFF | 200 | 200 | **403** | **403** | **403** |

Reading the table:

- **`/admin/session` and `/admin/dashboard` are 200 for every staff role by design** —
  they report who you already are. The dashboard's *content* is permission-filtered
  server-side, so a cashier gets 200 and sees no announcement or entitlement tile.
- **`POST /admin/announcements` carries the `ALL` audience.** RIK_ADMIN and PIF_ADMIN
  hold `shared.announcement.manage` yet are still refused, because an ALL announcement
  reaches the other module's customers. That 403 *is* the Section 8 isolation working.
- **SUPER_ADMIN is refused the RIK issue-schedule route.** Not a bug — the seed grants
  it no `rik.*` code. See F-2.

Your Section 4 checklist, item by item:

| # | Requirement | Result |
|---|---|---|
| 1 | CUSTOMER → staff routes → rejected | ✅ 403 on all 5 |
| 2 | RIK_ADMIN → unauthorized PIF routes → rejected | ✅ 403 on PIF-audience create; PIF announcements invisible in list |
| 3 | PIF_ADMIN → unauthorized RIK routes → rejected | ✅ 403 on RIK create, RIK edit, and issue schedules |
| 4 | CASHIER → admin/config routes → rejected | ✅ 403 on announcements and issue schedules |
| 5 | DELIVERY → purchasing/admin routes → rejected | ✅ 403 on announcements and issue schedules |
| 6 | PURCHASING → cashier/admin routes → rejected | ⚠️ **cannot test — the role does not exist** (F-1) |
| 7 | SUPER_ADMIN → authorized administrative routes → allowed | ✅ where the seed grants it; **not** for RIK/PIF (F-2) |

**Direct URL access was tested, not just navigation.** A hidden navigation item does
not remove its route: typing the URL renders the screen, the screen calls the API, the
API returns 403, and the screen shows the unauthorized state. Verified live — a
PIF_CASHIER navigating directly to `/announcements` at 390 px sees "You do not have
access to this area", with no announcement data in the response.

---

## F. Step 6 regression — **PASS**

**Evidence.** Every file under `apps/api/src/auth` (31 files) still carries its
**11 September** timestamp — not one was modified by STEP 10 or by this verification.

The Step 6 suites pass unchanged: **9 suites, 116 tests**, covering OTP authentication,
JWT access-token behaviour, refresh-token rotation, session handling and the
authentication guards.

The admin console signs in through the existing `POST /auth/staff/login` and uses the
existing rotating refresh cookie — verified live, not by inspection. No parallel
authentication mechanism was introduced and no auth endpoint was added.

---

## G. Step 7 regression — **PASS**

**Evidence.** Same untouched tree, same timestamp. `JwtAuthGuard` → `AuthorizationGuard`
ordering, the permission architecture, and `ROLE_MODULE_SCOPE` are used as they stand;
`packages/shared-types` was last modified 11 September.

Ownership checks are intact: the Step 9 customer suite still proves 403 for customer A
on customer B, a generic 403 body, 404 for a deactivated customer, and 403 for a staff
principal on customer-owned routes.

Audit behaviour is unchanged — announcement writes go through the **existing**
`AuditLogRepository`, the same path Step 7 already uses for denials. No second audit
system exists.

---

## H. RIK foundation

**What exists:** a RIK landing screen listing the areas the service will need, each
marked *pending a facility decision* or *not built yet*; a read-only issue-schedule
view; RIK announcement management; RIK dashboard tiles.

**Confirmation that BD-1 – BD-5 were not implemented.** A live runtime sweep of the
built console found **zero** occurrences of:

| Prohibited | Found |
|---|---|
| Entitlement quantities | **none** |
| allowed / issued / reserved / remaining values | **none** |
| Substitution ratios | **none** |
| Conversion ratios | **none** |
| Pooling rules | **none** |
| Pickup locations | **none** |
| Collection timings | **none** |
| Delivery eligibility | **none** |
| NOT_COLLECTED rules | **none** |

The dashboard's RIK entitlement tile reads *"The entitlement configuration is pending
confirmation by the facility."* — a reason, not a number.

**The handwritten entitlement material does not exist as production data.** There are
no entitlement rows, no seeded quantities, and no code path that could display one.

---

## I. PIF foundation

**What exists:** a PIF landing screen listing categories/subcategories, products,
inventory, orders and delivery, purchasing, point of sale and reports — each stating
what it is waiting for; PIF announcement management; PIF dashboard tiles.

**Confirmation that BD-6 and BD-7 were not implemented.** The sweep found **zero**
invented category taxonomy, subcategory taxonomy, products, SKU data, prices, delivery
charges, minimum-order values, delivery areas, delivery windows or tax/charge rules.

No categories were seeded, because the final taxonomy is administered data rather than
something the application decides. BD-6 and BD-7 remain open.

---

## J. Announcements

**Model:** priorities `LOW` / `NORMAL` / `HIGH` / `URGENT` and audiences `ALL` / `RIK` /
`PIF` — the frozen table's own CHECK-constraint values, with a 400 for anything outside
them.

**Audience restrictions are enforced server-side**, proven by direct API requests:

| Test | Result |
|---|---|
| RIK_ADMIN creates a RIK announcement | ✅ allowed |
| RIK_ADMIN creates a **PIF**-targeted announcement | ✅ **refused** |
| PIF_ADMIN creates a **RIK**-targeted announcement | ✅ **refused** |
| A module admin creates an **ALL**-audience announcement | ✅ **refused** — it would reach the other module |
| SUPER_ADMIN creates an ALL-audience announcement | ✅ allowed |
| PIF_ADMIN edits an existing RIK announcement **by omitting the audience** | ✅ **refused** — checked against the row's current audience |
| Anyone changes an existing announcement's audience | ✅ **refused** — the field is immutable |
| A module admin lists announcements | ✅ sees own audience + ALL, **never the other module's** |

The refusal returns the same generic 403 the guards use — it never reveals which
audiences exist or which the caller lacks.

**Why this needed a scope rule rather than a permission:** the seed grants
`shared.announcement.manage` to SUPER_ADMIN, RIK_ADMIN *and* PIF_ADMIN alike, and the
permission carries no audience dimension. The isolation therefore uses the existing
Step 7 `ROLE_MODULE_SCOPE` map. No new permission, role or database object was created.

---

## K. Issue schedules

Uses the existing `rik.issue_schedules` table and the existing
`rik.issue_schedule.manage` permission. **No new schema structure was created.**

- Only a role holding that permission reaches the route — everyone else, SUPER_ADMIN
  included, gets **403**.
- **Read-only by construction:** the repository has no insert path and the server
  exposes no creation endpoint. The response carries `canCreate: false`.
- The live database holds **0** issue schedules, and the screen shows an honest empty
  state: *"Schedules will appear here once the facility's issue days and windows are
  confirmed and entered."* No schedule was invented.

---

## L. Database

Verified with `pg_catalog` against the live database.

| Item | Expected | Actual | |
|---|---|---|---|
| Tables (`shared`, `rik`, `pif`) | 47 | **47** | ✅ |
| Views | 5 | **5** | ✅ |
| Migration files | 24 | **24** | ✅ |

Independently corroborated at API boot:

```
[DatabaseService] Schema contract verified: 47 tables / 5 views
                  (matches approved Phase 2 contract)
```

Recorded for future comparison: 204 constraints, 134 indexes, 583 table grants,
4 database roles, 6 SECURITY DEFINER functions, 6 roles, 20 permission codes.

---

## M. Database changes

# ZERO

- New migrations: **0**
- Table changes: **0**
- View changes: **0**
- Constraints added: **0**
- Indexes added: **0**
- Permissions changed: **0**

**No `DATABASE_CHANGE_REQUIRED` is raised by the implementation.** (F-1 and F-2 in
Section W would each *require* one if you decide to act on them — neither has been
written.)

Corroborating evidence: the `database/` tree is untouched since 10 September; there is
no stray `.sql` file anywhere under `apps/` or `packages/`; and a scan of all
application source found **zero** `CREATE` / `ALTER` / `DROP` / `GRANT` / `REVOKE`
statements. The admin module's only writes are to `shared.announcements` (via the
existing repository) and `shared.audit_log`.

---

## N. Fake fixtures — **PASS**

The built admin console was driven **against the real API and the real database** —
nothing stubbed — for 4 roles × 5 widths × 6 routes = **120 combinations**. Every
figure on screen therefore came from PostgreSQL.

Searched for and **not found**: fake customers, fake orders, fake products, fake SKUs,
fake prices, fake inventory, fake sales, fake revenue, fake entitlement values, fake
schedules, fake categories, fake suppliers, dev-fixtures, "preview data", mock
production records, and hardcoded production-looking values.

The five states are separate components, so a screen cannot render "empty" when it
means "forbidden". All five were observed live: **loading**, **empty** (announcements,
issue schedules), **unavailable** (RIK/PIF pending areas), **error**, **unauthorized**
(cashier on announcements, super admin on issue schedules).

The admin app's `useResource` hook has **no fallback parameter at all** — there is no
code path in the staff console that can substitute fixture data for real data.

*See W-1 for stale test rows in the database — data residue, not application fixtures.*

---

## O. Customer regression — **PASS**

- **No customer-app file was modified by STEP 10.** The newest file under
  `apps/customer-web/` is 20:53 on 12 Sep; STEP 10's backend work begins at 21:10.
- Customer frontend suite: **31 tests pass**, unchanged.
- Customer ownership protection: **20 backend tests pass** — 401 unauthenticated,
  403 for customer A on customer B, generic 403 body, 404 for a deactivated customer,
  403 for a staff principal.
- Customer authentication, Home with the approved hero, RIK/PIF separation, Account,
  My RIK Orders and My PIF Orders all render correctly, verified at 360/390/768/1024/1440
  with **no horizontal overflow** and natural scrolling.
- AS-1 hero asset is byte-identical and used uncropped.

---

## P. Responsive — exact viewport results

Live console, real API, 4 roles × 6 routes at each width:

| Width | Overflow | Element wider than viewport | Control under 44 px | Table outside a scroll container | Dialog off-screen | Navigation reachable | Console error |
|---|---|---|---|---|---|---|---|
| 360 px | none | 0 | 0 | 0 | 0 | ✅ | 0 |
| 390 px | none | 0 | 0 | 0 | 0 | ✅ | 0 |
| 768 px | none | 0 | 0 | 0 | 0 | ✅ | 0 |
| 1024 px | none | 0 | 0 | 0 | 0 | ✅ | 0 |
| 1440 px | none | 0 | 0 | 0 | 0 | ✅ | 0 |

- **Trapped scroll containers: none.** Every clipping box either fits its content or
  scrolls.
- **Tables have a deliberate responsive treatment**: announcements and issue schedules
  each sit inside their own `overflow-x` container, so the table scrolls sideways and
  the page body never does.
- **Forms remain usable** at 360 px — the announcement form stacks to one column and
  every control keeps a 44 px target.
- **Navigation remains usable**: a persistent sidebar at ≥1024 px, a labelled
  collapsible drawer below it with correct `aria-expanded`.

The only browser console entries were Chromium's own network logging of the 401 on the
sign-in screen and the deliberate 403s — **zero uncaught exceptions, zero application
errors.**

---

## Q. Tests — exact counts

| Suite | Suites / Files | Tests | Result |
|---|---|---|---|
| **Backend** (`apps/api`) | 16 | **244** | ✅ all pass |
| — Step 6/7 auth + RBAC | 9 | 116 | ✅ |
| — Step 9 customer module | 1 | 20 | ✅ |
| — Step 10 admin integration | 1 | 37 | ✅ |
| — Step 10 RBAC matrix (this pass) | 1 | 46 | ✅ |
| **Frontend — customer** | 4 | **31** | ✅ all pass |
| **Frontend — admin** | 7 | **58** | ✅ all pass |
| **Shared / packages / config** | 2 | **12** | ✅ all pass |
| **TOTAL** | **29** | **345** | ✅ **0 failures** |

---

## R. Typecheck — **PASS**

`npm run typecheck` across all five workspaces: clean, zero errors.

## S. Lint — **PASS**

`npm run lint` (`eslint . --max-warnings=0`): clean, zero errors, zero warnings.

## T. Production build — **PASS**

`npm run build`: all workspaces succeeded — API TypeScript build, customer app and
admin app Vite production bundles.

---

## U. Open decisions

**`docs/open-decisions.md` is unmodified** (still 12 September) and holds exactly 12
entries.

| ID | Status |
|---|---|
| BD-1 — Per-person RIK entitlement scale | **OPEN** — not implemented |
| BD-2 — Conversion and substitution ratios | **OPEN** — not implemented |
| BD-3 — Category pooling rules | **OPEN** — not implemented |
| BD-4 — RIK pickup location and collection instructions | **OPEN** — not implemented |
| BD-5 — NOT_COLLECTED policy | **OPEN** — not implemented |
| BD-6 — PIF catalogue taxonomy and delivery rules | **OPEN** — not implemented |
| BD-7 — PIF pricing source | **OPEN** — not implemented |
| DR-1, DR-2 | Open risks, unchanged |

**BD-8 status:** **not in the register — 0 occurrences in `docs/open-decisions.md`.**
It is referenced only in `docs/reports/step-10-report.md` and this report, described
exactly as:

> **NEW BUSINESS DECISION REQUIRED** — proposed/unratified item surfaced during STEP 9
> regarding mobile-number-change policy.

No BD-8 policy is implemented. No mobile-number change workflow exists in the codebase.

---

## V. Assets

| ID | Status |
|---|---|
| **AS-1** — Hero imagery | **CLOSED** (12 Sep 2026). Asset byte-identical, used uncropped. |
| **AS-2** — Horizontal logo lockup | **OPEN.** The admin header uses the square logo scaled, never cropped. |
| **AS-3** — PIF product imagery | **OPEN.** No PIF product imagery introduced. |

---

## W. Issues and warnings

### F-1 — No PURCHASING role exists — *DATABASE_CHANGE_REQUIRED if you want one*

Your Section 3 and Section 4 both name a PURCHASING role. The frozen `shared.roles`
table holds `SUPER_ADMIN`, `RIK_ADMIN`, `PIF_ADMIN`, `PIF_CASHIER`,
`RIK_PICKUP_STAFF`, `DELIVERY_STAFF` — and no purchasing role.

Purchasing exists today only as a permission, `pif.purchase_order.approve`, granted to
`PIF_ADMIN`. **Nobody can hold purchasing rights without also holding full PIF
administration.** Section 4 item 6 is therefore untestable as written.

Creating the role needs a migration inserting into `shared.roles` and
`shared.role_permissions`. **I have not written it.** Please confirm whether a separate
purchasing role is wanted and what it may and may not do.

### F-2 — SUPER_ADMIN holds no RIK or PIF permission

Read from `shared.role_permissions`, SUPER_ADMIN holds exactly five codes:
`shared.announcement.manage`, `shared.audit_log.view`, `shared.role.grant`,
`shared.settings.write`, `shared.user.manage`. No `rik.*`, no `pif.*`.

The consequence is visible in the matrix in Section E: **a super administrator is
refused the RIK issue-schedule route while a RIK_ADMIN is allowed it**, and sees no RIK
or PIF administration at all. The console reflects the seed rather than widening the
role, because widening it is a database change.

Three options, all yours:

- **(a)** Leave it — SUPER_ADMIN administers users, roles, settings, audit and
  announcements only, and module administration is delegated.
- **(b)** Grant SUPER_ADMIN the `rik.*` and `pif.*` codes — **DATABASE_CHANGE_REQUIRED**.
- **(c)** Give SUPER_ADMIN an implicit "holds every permission" rule in the
  authorization service — no migration, but it changes Step 7 behaviour, which I will
  not touch without your explicit instruction.

I would settle this before STEP 11, because it decides who can administer what from the
moment the console goes live.

### F-3 — Two roles have permissions but no screen

`RIK_PICKUP_STAFF` (`rik.order.mark_ready`, `rik.order.mark_collected`) and
`DELIVERY_STAFF` (`pif.order.mark_delivered`, `pif.order.mark_not_delivered`) hold real
permissions, but every one of them acts on an **order**, and no order module exists.
Both sign in successfully and see the shell, an empty dashboard, and honest "not
assigned to you" messages. Correct behaviour for a foundation step — but those roles
have nothing to do until the order modules are built, which depends on BD-1 – BD-7.

### W-1 — Stale test rows in the database — *awaiting your approval to remove*

A test teardown failed during STEP 10 development on 12 September and left residue in
`esamagri_test`:

| Residue | Count |
|---|---|
| Staff user rows (`jest_step10_*`) | 7 |
| Customer row (`Jest STEP10 Customer …`) | 1 |
| Soft-deleted announcement rows | 46 (0 live) |
| Audit log rows | 16 |

Bounding the risk honestly: all 7 accounts hold **zero role grants**, so signing in as
one would show only an empty dashboard; all announcements are soft-deleted, so **0 live
announcements** exist and nothing reaches the customer app. The teardown bug was fixed
and the suites now clean up correctly — running all 244 backend tests during this
verification added no new residue.

Still, they are ACTIVE accounts whose password is a constant visible in the test
source. **I have not deleted them**, because this is a verification pass and 16 of the
rows are audit history. Say the word and I will remove the user and customer rows and
leave the audit trail intact.

### Note on the verification spec

`apps/api/src/admin/rbac-matrix.verification.spec.ts` was added by this pass. It adds no
product behaviour, touches no business rule, no schema and no auth code — it only
asserts the matrix in Section E. Its expectations are transcribed from the seed and the
first six tests fail if that transcription ever drifts from
`shared.role_permissions`. Tell me if you would rather it not be kept.

---

## X. Final recommendation

### **RECOMMEND CLOSURE OF STEP 10, CONDITIONAL ON YOUR DECISION ON F-1 AND F-2.**

The Section 18 acceptance gate is fully satisfied:

| | Criterion |
|---|---|
| ✅ | Admin/staff foundation exists as production code |
| ✅ | Authentication uses the existing Step 6 architecture |
| ✅ | RBAC uses the existing Step 7 architecture |
| ✅ | Server-side role isolation verified over real HTTP |
| ✅ | Admin/staff navigation is role-aware |
| ✅ | Dashboard contains no fabricated business numbers |
| ✅ | RIK foundation does not implement BD-1 – BD-5 |
| ✅ | PIF foundation does not implement BD-6 / BD-7 |
| ✅ | Announcement audience restrictions are server-side |
| ✅ | Issue schedule foundation respects the existing schema |
| ✅ | No fake production fixtures |
| ✅ | Customer application has no regression |
| ✅ | Responsive behaviour passes |
| ✅ | No horizontal overflow |
| ✅ | Natural scrolling works |
| ✅ | Database remains exactly 47 tables / 5 views / 24 migrations |
| ✅ | No unauthorized migrations |
| ✅ | No unauthorized schema changes |
| ✅ | No unauthorized authentication changes |
| ✅ | No unauthorized RBAC changes |
| ✅ | Tests pass — 345 / 345 |
| ✅ | Typecheck passes |
| ✅ | Lint passes at `--max-warnings=0` |
| ✅ | Production build passes |

The reason I say *conditional* rather than an unqualified pass: **F-2 changes who can
administer what.** A super administrator that cannot reach either service module is a
governance outcome you should choose deliberately rather than inherit from a seed, and
F-1 means one of the roles your kickoff assumes simply is not there. Both are decisions
only you can make, and both would need a migration you have not authorised.

---

**Verification complete. STEP 11 not started. No RIK entitlement logic. No PIF commerce
logic. No business decision invented. Open Decisions Register unmodified. No migration
created.**

**Awaiting your formal approval.**
