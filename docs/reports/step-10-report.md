# e Samagri — Phase 3B — STEP 10 Report

**Admin & Staff Application Foundation**
Base Victualling Yard, Visakhapatnam
Date: 12 September 2026
Status: **Complete — awaiting your formal review and approval**

> Section letters A–T below are my own labelling for this report. Each section
> names the kickoff section it answers so you can check them off against your
> numbered document.

---

## A. Scope delivered

STEP 10 delivered the **foundation** of the admin/staff application: a real,
authenticated, responsive staff console built on the existing STEP 6
authentication and STEP 7 authorization, plus the server-side API that feeds
it. It deliberately did **not** deliver any RIK or PIF business module, because
those depend on decisions BD-1 through BD-7, which remain open.

Two workspaces changed and one is new:

| Workspace | Change |
|---|---|
| `apps/api` | New `src/admin/` module — staff session, dashboard, announcement administration, read-only RIK issue schedules |
| `apps/admin-web` | **New workspace** — the staff console (React + TypeScript + Vite + Tailwind) |
| `apps/customer-web` | **Untouched.** No file was modified in STEP 10 |

---

## B. What was NOT changed (kickoff §2, §19)

I modified none of the following, and found no defect that would have justified
doing so:

- Authentication architecture, OTP security, JWT behaviour, refresh-token rotation
- RBAC permissions, roles, or grants
- Existing SECURITY DEFINER protections
- Database roles (`esamagri_app`, `app_shared`, `app_rik`, `app_pif`)
- Any customer-facing screen or behaviour

The staff console signs in through the **existing** `POST /auth/staff/login`
(username + password + TOTP where the account requires it), uses the **existing**
rotating httpOnly refresh cookie, and keeps the access token in memory only —
exactly as the customer app does. **No second authentication mechanism was
introduced and no authentication endpoint was added.**

---

## C. Server-side RBAC enforcement (kickoff §2, §9)

Every admin route is behind `JwtAuthGuard` (401 — who are you?) then
`AuthorizationGuard` (403 — may you?), in that order, declared once at the
controller:

```ts
@Controller('admin')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
```

A CUSTOMER principal holds no permissions at all — customers have no row in
`shared.user_roles` — so every permission-gated staff route is automatically 403
for a customer without needing a customer-specific rule. `GET /admin/session`
and `GET /admin/dashboard` carry no permission requirement (they only report who
the caller already is), so both additionally refuse a CUSTOMER explicitly: the
console fails closed rather than rendering a shell for a non-staff identity.

**The frontend is not a security boundary and does not pretend to be one.** The
navigation hides entries a staff member has no permission for, purely so the
console is not full of dead ends. Every route remains reachable by typing its
URL, and doing so produces the honest unauthorized state driven by a real 403
from the server. There is an explicit test for this
(`AdminLayout.test.tsx` → "hiding a navigation item does not remove the route —
the server is the boundary").

---

## D. RIK ↔ PIF announcement isolation (kickoff §7)

This needed a design decision, so I want to be explicit about it.

**The problem.** The approved seed grants `shared.announcement.manage` to
SUPER_ADMIN, RIK_ADMIN **and** PIF_ADMIN alike, and the permission carries no
audience dimension. So "RIK_ADMIN must not manage PIF-targeted announcements"
**cannot be expressed by the permission alone.**

**The resolution, without touching the database.** I used the STEP 7
`ROLE_MODULE_SCOPE` map that already exists for exactly this purpose
(`apps/api/src/admin/services/announcement-scope.ts`):

| Role scope | May create / modify |
|---|---|
| `rik` (RIK_ADMIN) | `RIK` only |
| `pif` (PIF_ADMIN) | `PIF` only |
| `ANY` (SUPER_ADMIN) | `ALL`, `RIK`, `PIF` |

Three points worth your attention:

1. **`ALL` is reserved to SUPER_ADMIN.** An `ALL` announcement reaches PIF
   customers as well as RIK ones, so letting a RIK_ADMIN publish one would be
   precisely the cross-module reach §7 forbids, just by a different route.
2. **Reading is wider than writing, on purpose.** A module admin may *see* `ALL`
   announcements — they are global notices affecting that admin's own module —
   but may not create or alter them.
3. **Update is checked against the row's *current* audience**, not against the
   submitted body. Omitting `targetAudience` from a PATCH therefore does not let
   a PIF_ADMIN edit a RIK row, and the audience field is not editable at all.

No new permission, role, or database object was invented to achieve any of this.

---

## E. Admin/staff API surface delivered

| Method | Route | Permission required |
|---|---|---|
| GET | `/admin/session` | staff principal only |
| GET | `/admin/dashboard` | staff principal only (tiles permission-filtered) |
| GET | `/admin/announcements` | `shared.announcement.manage` |
| POST | `/admin/announcements` | `shared.announcement.manage` + audience scope |
| PATCH | `/admin/announcements/:id` | `shared.announcement.manage` + audience scope |
| GET | `/admin/rik/issue-schedules` | `rik.issue_schedule.manage` |

Every write uses `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`,
so an unexpected field is rejected rather than silently ignored. Error responses
use the shared `ApiErrorBody` envelope and never reveal which audiences exist or
which the caller lacks — an audience refusal returns the same generic 403 shape
the guards use.

`GET /admin/session` returns `userId`, `username`, `displayName`, `roles`,
`permissions` — **no password hash, no TOTP secret, no token, and no other staff
member's details.** There is a test asserting this.

---

## F. Dashboard — real figures or honest unavailability (kickoff §4)

The hard rule I implemented: a tile either reports a **real figure read from the
frozen database**, or it reports that it is **unavailable, with the reason**.
There is no third option.

Only two things can be counted honestly today:

- **Announcements** — a real count, scoped to the audiences the caller may read
- **RIK issue schedules** — a real `COUNT(*)` over `rik.issue_schedules`

Every other tile the console will eventually want depends on a module that does
not exist (RIK entitlements, RIK orders, RIK catalogue, PIF catalogue, PIF
reports, purchasing, POS), so each is returned as `status: 'unavailable'` with a
plain-language reason. **No sales, revenue, inventory, order, customer,
entitlement, product, cash or purchasing figure is fabricated anywhere.** A test
asserts that an unavailable tile renders no digit at all, so a regression cannot
quietly turn "not available" into a zero.

Tiles are permission-filtered **server-side**, not in the browser.

---

## G. RIK administration foundation (kickoff §5)

The RIK screen lists the areas the product will need, so the structure is
visible, and marks each one honestly:

| Area | State shown |
|---|---|
| Entitlements | Pending facility confirmation |
| RIK catalogue | Not built yet |
| RIK orders | Not built yet |
| Pickup and delivery | Pending facility confirmation |
| Issue schedules | Built — links to the read-only view |

**Nothing on this screen states an entitlement quantity, a substitution, a
conversion ratio, a pooling rule, a pickup location, a collection timing, a
delivery eligibility rule, or NOT_COLLECTED behaviour.** BD-1 through BD-5 are
untouched. A test sweeps the rendered text against patterns for quantities,
prices, ratios and timings and fails if any appears.

---

## H. PIF administration foundation (kickoff §6)

Same approach. Every PIF area is shown as unavailable, with what it is waiting
for:

- Categories and subcategories — taxonomy pending (**BD-6**)
- Products — pending the taxonomy and the pricing source (**BD-6, BD-7**)
- Inventory, purchasing, point of sale, reports — not built
- Orders and delivery — pending delivery rules: areas, charges, minimum order
  and time windows all unconfirmed (**BD-6**)

**No category, subcategory, product, price, delivery charge, minimum order,
delivery window or tax rule is invented anywhere**, and no categories were
seeded, because the final taxonomy is administered data rather than something
the application decides.

---

## I. RIK issue schedules — read-only (kickoff §8)

A read-only administrative view over the existing `rik.issue_schedules` table,
gated by `rik.issue_schedule.manage`.

**Creation is deliberately not offered, and this is a boundary rather than a
hidden button:** the server exposes no creation endpoint, and the repository has
no insert path at all. Real issue dates, category windows and collection timings
are unresolved (BD-4, and BD-1/BD-3 for anything category-scoped). The response
carries `canCreate: false` explicitly. The screen currently shows an honest
empty state, because the table is empty.

---

## J. Staff application shell (kickoff §3)

`apps/admin-web` — a real responsive application, not a mockup:

- Authenticated staff header with application identity and facility name
- Role-aware navigation — a collapsible drawer below 1024px, a persistent
  sidebar at 1024px and above, so one build serves a facility desktop and a phone
- Dashboard / home foundation
- Navigation into the authorized modules
- **Your account** screen: identity, roles, and the exact permission codes the
  server enforces, listed verbatim — a staff member asking "why can't I see X"
  gets the truth, not a paraphrase
- Logout, in the header and on the account screen
- A distinct "this page does not exist" that cannot be mistaken for "you are not
  allowed here"

The approved e Samagri logo is used **unaltered and uncropped**, scaled to fit
the header. **AS-2 remains open** — no horizontal lockup has been supplied, and I
did not manufacture one.

---

## K. The five states, kept separate (kickoff §15)

`loading`, `empty`, `unavailable`, `error`, and `unauthorized` are five separate
components rather than one component with a mode, so a screen cannot accidentally
render "empty" when it means "forbidden". 401 and 403 are surfaced distinctly:

- **401** → "Your session has expired. Please sign in again."
- **403** → "You do not have access to this area"

Raw server text is never shown. A test feeds a database error message through and
asserts none of it reaches the screen.

The admin app's `useResource` hook was written **without** the customer app's
`devFallback` parameter. There is no code path in the staff console that can
substitute fixture data for real data — "not built yet" surfaces as an explicit
unavailable state, never as data.

---

## L. Responsive verification (kickoff §16)

I served the **production build** and drove it with a real browser at every
required width, photographing each screen and measuring the layout.

- Widths: **360, 390, 768, 1024, 1440**
- Screens: login, dashboard (as SUPER_ADMIN and as RIK_ADMIN), announcements,
  RIK, PIF, issue schedules, account
- **40 page/width combinations checked**

Result: **zero horizontal overflow, zero element wider than the viewport outside
an intentional scroll container, zero interactive control below the 44px
touch-target minimum, zero application console error.** (The only console
messages were the Google Fonts stylesheet failing through this sandbox's
outbound proxy, and the intentional 401 on the sign-in screen.)

Wide tables — announcements, issue schedules — scroll horizontally inside their
own container rather than pushing the page sideways.

---

## M. Audit logging

Announcement creation and update are recorded in `shared.audit_log` through the
**existing** `AuditLogRepository` — the same audit path STEP 7 already uses for
denials. No second audit system was introduced.

---

## N. Database freeze verification (kickoff §2)

Verified against `pg_catalog` (not `information_schema`, which hides tables the
application role lacks grants on):

| Baseline | Required | Actual | |
|---|---|---|---|
| Tables (`shared`, `rik`, `pif`) | 47 | **47** | ✅ |
| Views | 5 | **5** | ✅ |
| Migration files | 24 | **24** | ✅ |
| Roles | 6 | **6** | ✅ |
| Permission codes | 20 | **20** | ✅ |

**No migration, table, view, constraint, index, or database permission was
created.** The admin module performs DDL nowhere. Its only writes are to
`shared.announcements` (via the existing repository) and `shared.audit_log`.
`rik.issue_schedules` is read-only by construction.

---

## O. Test results

| Workspace | Suites | Tests | Result |
|---|---|---|---|
| `apps/api` | 15 | 198 | ✅ all pass |
| — of which `src/admin` | 1 | **37** | ✅ |
| `apps/admin-web` | 7 | **58** | ✅ all pass |
| `apps/customer-web` | 4 | 31 | ✅ all pass (no regression) |
| `packages/config` | 2 | 12 | ✅ all pass |
| **Total** | **28** | **299** | ✅ |

`typecheck`, `lint --max-warnings=0`, and `build` are green across all five
workspaces.

The 37 backend admin tests cover: 401 when unauthenticated; 403 for a customer on
every staff route; a staff session carrying no secret; permission-gated dashboard
tiles; RIK_ADMIN ↔ PIF_ADMIN announcement isolation in both directions;
`ALL` reserved to SUPER_ADMIN; audience immutable on update; audit rows written;
and validation failures that leak no database or stack detail.

---

## P. What was deliberately NOT invented (kickoff §11)

For the record, nothing in this step states or implies any of:

RIK entitlement quantities · RIK substitutions · RIK conversion ratios · RIK
pooling · pickup locations · collection timings · delivery eligibility ·
NOT_COLLECTED rules · PIF categories · PIF subcategories · PIF products · PIF
prices · delivery charges · minimum order · delivery windows · tax rules.

Where a screen needed to say something about one of these, it says what the
decision is waiting for and nothing else.

---

## Q. FINDINGS REQUIRING YOUR DECISION

These are reported, **not acted on**. None of them was worked around by
inventing anything.

### F-1 — No PURCHASING role exists in the approved seed

The kickoff names cashier, delivery and purchasing staff. The frozen
`shared.roles` table holds exactly six roles:

`SUPER_ADMIN`, `RIK_ADMIN`, `PIF_ADMIN`, `PIF_CASHIER`, `RIK_PICKUP_STAFF`,
`DELIVERY_STAFF`

So the mapping is only partial:

| Kickoff term | Seed role | Status |
|---|---|---|
| Cashier | `PIF_CASHIER` | ✅ exists |
| Delivery | `DELIVERY_STAFF` | ✅ exists |
| **Purchasing** | — | ❌ **no such role** |

Purchasing capability exists today only as a *permission*,
`pif.purchase_order.approve`, granted to `PIF_ADMIN`. There is no dedicated
purchasing role and no staff member can hold purchasing rights without also
holding full PIF administration.

**Creating one would be a database change.** Per your instruction I stopped at
that boundary:

> **DATABASE_CHANGE_REQUIRED** — a dedicated purchasing role (and its grant)
> would require a new migration inserting into `shared.roles` and
> `shared.role_permissions`. I have not written it. Please confirm whether a
> separate purchasing role is wanted, and if so what it may and may not do.

### F-2 — SUPER_ADMIN holds no RIK or PIF permission at all

Read back from `shared.role_permissions`, SUPER_ADMIN holds exactly five codes:

`shared.announcement.manage`, `shared.audit_log.view`, `shared.role.grant`,
`shared.settings.write`, `shared.user.manage`

It holds **no** `rik.*` and **no** `pif.*` code. The practical consequence,
visible in the screenshots: a SUPER_ADMIN signing in sees one dashboard tile, no
RIK administration, no PIF administration, and not even the RIK issue-schedule
view — while a RIK_ADMIN sees more of the system than the super administrator
does.

I implemented the console to **reflect the seed exactly** rather than widening
any role, because widening it is a database change. But I suspect this is not
what you intend for a role named SUPER_ADMIN, so please decide:

- **(a)** Leave it as is — SUPER_ADMIN administers users, roles, settings, audit
  and announcements only, and module administration is delegated; or
- **(b)** Grant SUPER_ADMIN the `rik.*` and `pif.*` codes — **DATABASE_CHANGE_REQUIRED**,
  a new migration inserting into `shared.role_permissions`; or
- **(c)** Give SUPER_ADMIN an implicit "holds every permission" rule in the
  authorization service — no migration, but it changes STEP 7 authorization
  behaviour, which I will not touch without your explicit instruction.

I caught this because a test fixture I had written *assumed* SUPER_ADMIN held all
twenty permissions. I checked it against the live grants, found it wrong,
corrected the fixture, and two tests then failed — correctly. Those tests now
assert the real behaviour and are labelled with this finding.

### F-3 — `RIK_PICKUP_STAFF` and `DELIVERY_STAFF` have no screen yet

Both roles exist and hold real permissions (`rik.order.mark_ready`,
`rik.order.mark_collected`; `pif.order.mark_delivered`,
`pif.order.mark_not_delivered`), but every one of those permissions acts on an
**order**, and no order module exists. A staff member in either role signing in
today sees the shell, an empty dashboard, and honest "not assigned to you"
messages.

This is not a defect — it is the correct behaviour for a foundation step — but
you should know those two roles have nothing to do until the order modules are
built, which depends on BD-1 through BD-7.

---

## R. Minor housekeeping (no action needed from you)

- **H-1** — `apps/customer-web/src/lib/api/resource.ts` still carries the
  `devFallback` parameter from before the fixtures were removed. Every call site
  passes `undefined` and the fixtures directory is gone, so it cannot produce
  fake data; it is simply a dead parameter. I did **not** remove it, because
  customer-web is STEP 9 code and was closed. Worth tidying in a future step.
- **H-2** — `tailwind.config.js` in the new admin workspace needed a `touch`
  spacing token so `h-touch` / `w-touch` resolve to a real 44px target; the
  customer config expresses the same value only as `minHeight`/`minWidth`.

---

## S. Open register — unchanged by this step

- **BD-1 … BD-7** — all still open. None was implemented, assumed, or
  partially implemented.
- **AS-1** — closed (approved hero integrated in STEP 8).
- **AS-2** — **still open.** No horizontal logo lockup has been supplied. The
  square logo is used unaltered and uncropped.
- **AS-3** — still open.
- **DR-1, DR-2** — risks, unchanged.
- **BD-8** — per your instruction, **not** added to the authoritative register.

New this step: **F-1**, **F-2**, **F-3** above. I have not written them into
`docs/open-decisions.md` — tell me whether you want them registered there and
under what identifiers.

---

## T. Stop boundary

Per your kickoff I have stopped here.

- ❌ STEP 11 not started
- ❌ BD-1 through BD-7 not implemented
- ❌ No migration created
- ❌ No database object created, altered or dropped
- ❌ No authentication, RBAC or security-definer behaviour modified
- ❌ No customer-app file touched

**Awaiting your formal review and approval.**

Two of the three findings above (F-1, F-2) are decisions only you can make, and
F-2 in particular affects who can administer what from the moment the console
goes live. I would suggest resolving F-2 before STEP 11.
