# Phase F — PIF Quick-Commerce Implementation

**Date:** 9 October 2026
**Scope:** PIF (Payment in Facility) — the facility's online grocery module:
a client-managed catalogue with product images, a cash-on-delivery shopping
flow, and an order desk inside the existing unified admin portal.
**RIK:** preserved. Not one RIK table, trigger, rule or screen was changed.
**Mode:** implementation (executed, not proposed).

Every number in this report comes from a command run in this session.

---

## 1. F0 — state check (performed before any change)

| Check | Finding |
|---|---|
| `docs/reports/pif-scope-correction-analysis.md` | Read first. PIF is **an online grocery ordering module only** — no POS, no billing, no invoices, no cash drawer, no purchasing, no suppliers, no stock. 14 of the 20 `pif.*` tables serve the superseded scope and hold 0 rows. |
| Existing PIF backend | `PifModule` was `@Module({})` — **empty**. No PIF route existed. |
| Existing PIF customer screens | Eight screens existed from STEP 9 and already called `/pif/categories`, `/pif/search`, `/pif/orders` … against an API that did not exist. Checkout **faked** an order with a 400 ms timer. |
| Existing PIF admin screen | `PifAdminPage` advertised 7 areas, 3 of them superseded (Inventory, Purchase orders, Point of sale). |
| `pif.orders` | Already carried the full lifecycle in its `status` CHECK **and** a Phase 2 trigger enforcing the legal order of it. Reused, not redefined. |
| `pif.categories` | Already had `parent_id` — subcategories needed no new table. |
| RBAC | 6 roles / 20 permissions. **No permission governed a PIF order at all** (the scope document's blocker), and SUPER_ADMIN held no `rik.*`/`pif.*` code (STEP 10's finding F-2). |
| Phase E | Intact: 1061 API tests passing, 65 tables / 5 views before this phase. |
| Checkpoint | The repository is not under version control, so the pre-Phase-F checkpoint is the Phase E archive created earlier today (`esamagri-PHASE-E-*`). The working database was **not** reset. |

Two decisions the scope document left open were answered by the Phase F
authorization itself and are implemented accordingly, not invented:
**e Samagri does hold prices** (§4–§5 require prices, GST, order totals and
COD), and **PLACED is the customer's submission, ACCEPTED is the facility's
acknowledgement** (§6 lists both).

---

## 2. Files created and modified

### New — API (`apps/api/src/pif/`)
| File | Purpose |
|---|---|
| `repositories/pif-catalogue.repository.ts` | Categories, products, tax rates. Separate customer/admin reads. |
| `repositories/pif-orders.repository.ts` | Orders, frozen lines, append-only events, order numbering. |
| `services/pif-pricing.service.ts` | **The only place money is computed.** |
| `services/pif-catalogue.service.ts` | Catalogue validation + audit. |
| `services/pif-media.service.ts` | Image upload: magic-byte check, generated key, path containment. |
| `services/pif-order.service.ts` | Checkout (idempotent), lifecycle, per-action authority. |
| `pif.controller.ts` | Customer: `/pif/*`. |
| `pif-admin.controller.ts` | Staff: `/admin/pif/*`. |
| `pif-media.controller.ts` | Serves an uploaded image. |
| `dto/pif-catalogue.dto.ts`, `dto/pif-order.dto.ts` | Request shapes (`forbidNonWhitelisted`). |
| `pif.integration.spec.ts` | 92 tests, real PostgreSQL + real HTTP. |
| `auth/decorators/require-any-permission.decorator.ts` | "At least one of these" — see §5. |

### New — migration
`database/migrations/0050_pif_commerce.sql` — **the only migration of this phase.**

### New — admin portal (`apps/admin-web`)
`lib/api/pif-admin-api.ts` · `routes/pif/PifDashboardPage.tsx` ·
`routes/pif/PifCategoriesPage.tsx` · `routes/pif/PifProductsPage.tsx` ·
`routes/pif/PifOrdersPage.tsx` · `routes/pif/pif-admin.test.tsx` (25 tests).

### New — customer app (`apps/customer-web`)
`lib/api/pif-api.ts` · `routes/pif/pif-shop.test.tsx` (23 tests).

### Modified
| File | Change |
|---|---|
| `apps/api/src/pif/pif.module.ts` | Wired; doc comment rewritten to the corrected scope (it still described POS, purchasing, suppliers and shared inventory). |
| `apps/api/src/auth/guards/authorization.guard.ts` | Added the any-of check. Additive: no existing route's authorization changed. |
| `apps/api/src/database/schema-contract.ts` (+ 3 specs) | 65→66 tables, `pif` 20→21, with a Phase F history entry. |
| 10 RIK/admin/auth specs | Assertions updated for the deliberate RBAC change (§5), each made **more** specific. |
| `packages/shared-types/src/permissions.ts` | +2 PIF permission codes. |
| `packages/config/src/api-env.ts`, `apps/api/.env`, `.env.example` | `PIF_MEDIA_ROOT`, `PIF_MEDIA_MAX_BYTES` (defaults supplied, so an existing deployment starts unchanged). |
| `apps/admin-web/src/routes/AdminLayout.tsx` | Nav split into **RIK Administration** and **PIF Administration** sections, each item permission-gated; both module overviews now gated too. |
| `apps/admin-web/src/routes/PifAdminPage.tsx` | Rewritten: the 3 superseded areas are **removed**, not relabelled. |
| `apps/admin-web/src/app/App.tsx` | 4 PIF routes. |
| `apps/admin-web/src/design-system/ConfigUI.tsx` | `serverMessage` now passes a 409's own sentence through (duplicate SKU, category in use). |
| `apps/admin-web/src/test/staff-session.ts` | Grants re-transcribed from the database after 0050. |
| `apps/customer-web/.../PifHomePage, PifCategoryPage, PifSearchPage, PifProductDetailPage, PifCartPage, PifCheckoutPage, PifOrdersPage, PifOrderDetailPage` | Wired to the real API; **the faked checkout is gone**. |
| `apps/customer-web/src/design-system/OrderStatusStepper.tsx` | PIF steps corrected to the database's real states (it used a provisional guess the server would never send). |
| `apps/customer-web/src/lib/api/types.ts` | `PifOrderStatus` corrected to the real 9 states; `PifProduct` extended. |

---

## 3. Migration 0050 — what changed in the database

**One new table.** `pif.order_events` — the order's append-only operational
history, and the only path by which an order's status moves.

**Columns added to tables that already existed** (nothing dropped, nothing
rewritten):
- `pif.products`: `brand`, `description`, `pack_size`, `pack_unit`,
  `min_order_qty`, `max_order_qty`, `qty_step`, `available`, `variant_group`,
  `variant_label`, `created_by`, `updated_by`.
- `pif.categories`: `description`, `image_ref`, `sort_order`, timestamps,
  `created_by`, `updated_by`.
- `pif.orders`: `fulfillment_mode`, `payment_method`, address and contact
  **snapshots**, `customer_note`, `subtotal`, `discount_total`, `tax_total`,
  `total`, and the per-state timestamps.
- `pif.order_items`: `sku`, `product_name`, `brand`, `unit`, `pack_size`,
  `tax_rate_name`, `tax_rate_pct`, `discount_pct`, `line_subtotal`,
  `line_discount`, `line_tax`, `line_total`.

### The guards are in the database, not only in the service
| Guard | Mechanism |
|---|---|
| The application cannot write an order's status | `app_pif` holds **SELECT, INSERT** on `pif.orders` and nothing else; status is projected by a `SECURITY DEFINER` AFTER-INSERT trigger on `pif.order_events`. Status and history cannot disagree. |
| The legal order of states | The **Phase 2** trigger `pif.trg_validate_order_status_transition`, untouched. The projection's UPDATE passes through it. |
| Two staff in the same instant | `UNIQUE (order_id, sequence_no)`. |
| History and order lines are immutable | Append-only triggers + UPDATE/DELETE revoked from `app_pif`. |
| An order's header must match its lines | `CHECK`s on the line arithmetic plus a **DEFERRABLE** constraint trigger comparing the header to the sum of its own lines at commit (which also refuses an order with no lines). |
| COD only | `CHECK (payment_method = 'COD')`. |
| A delivery order must have an address; a pickup order must not | `CHECK` + a trigger proving the address is **this** customer's. |
| Two levels of taxonomy | Trigger on `pif.categories`. |
| Catalogue rows are deactivated, never deleted | DELETE revoked on `pif.products` and `pif.categories`. |
| Duplicate checkout | `shared.idempotency_keys` (Phase 2, previously unused) granted SELECT+INSERT to `app_shared`, append-only. |

**No stock quantity was introduced** — asserted by the migration's own
verification block and by two tests. The 14 superseded `pif.*` tables are
untouched, empty, and referenced by no code.

---

## 4. What was built

### Customer (mobile-first PWA)
Browse categories and subcategories → search by name, brand or SKU →
product detail (photo, brand, pack, price, GST note, order limits, other
sizes) → cart → **server-priced** totals → cash-on-delivery checkout →
order confirmation with the server's order number → order history and a
live status timeline.

- A deactivated product reads as **not in the catalogue**; an unavailable one
  is shown and marked, and cannot be ordered.
- The cart calls `/pif/quote` on every change: line totals, discount, GST and
  the total are the server's, and items the facility will not sell today come
  back with the facility's own sentence and block checkout until removed.
- Checkout sends ids, quantities, mode and an idempotency key — **no price,
  no total, no product name**. A second press sends the same key.
- The destination is the officer's own recorded residence; there is no
  free-text address field, and the server freezes the address onto the order.
- No payment is simulated anywhere, and nothing is confirmed that the server
  did not record.

### Admin portal — one portal, two sections
Navigation now has **RIK Administration** and **PIF Administration** headings,
and a heading appears only when the signed-in staff member can reach
something inside it. PIF screens: dashboard (new-order count with `aria-live`
and a 60-second refresh), order desk (customer, destination, what to pick,
cash to collect, lane-correct actions, internal notes, full history with each
actor named), categories, and the product catalogue with prices, GST, order
limits, availability and **real image upload** (multipart, magic-byte checked,
server-generated filename, placeholder when absent, replacement deletes the
old file).

### API
`/pif/categories`, `/pif/categories/:id/products`, `/pif/search`,
`/pif/products/:id`, `/pif/quote`, `/pif/checkout`, `/pif/orders`,
`/pif/orders/:id`, `/pif/media/...` and nine `/admin/pif/*` routes.

---

## 5. Exact role and permission changes

**Two permissions added** (`shared.permissions` 20 → 22), **no role added**,
**no PURCHASING role**:

| Code | Granted to |
|---|---|
| `pif.order.manage` | PIF_ADMIN, SUPER_ADMIN |
| `pif.order.prepare` | PIF_ADMIN, PIF_CASHIER, SUPER_ADMIN |

**SUPER_ADMIN now holds both modules explicitly** — 7 `rik.*` + 6 `pif.*`
codes as rows in `shared.role_permissions`. This resolves STEP 10's finding
F-2 and is what §2 requires ("SUPER_ADMIN must receive explicit permissions
for both modules. Do not infer authorization… from the role name"). The four
superseded codes (`pif.pos.*`, `pif.purchase_order.approve`) are deliberately
**not** granted, because the corrected scope has no point of sale and no
purchasing. 10 existing specs encoded the old "SUPER_ADMIN can reach nothing"
reality and were updated to the new grants.

| Role | `rik.*` | `pif.*` |
|---|---|---|
| SUPER_ADMIN | all 7 | 6 of 10 (not the superseded 4) |
| RIK_ADMIN | 5 | **none** |
| PIF_ADMIN | **none** | 5 |
| PIF_CASHIER | none | `pif.order.prepare` + 3 dormant `pos.*` |
| RIK_PICKUP_STAFF | 2 | none |
| DELIVERY_STAFF | none | `mark_delivered`, `mark_not_delivered` |

`RequireAnyPermission` was added because a PIF order is worked by three roles
with deliberately different authority who must all be able to *open* the
order they are working on. It gates the door on "any of these"; the service
then checks, per action, the permission that specific move needs. Both checks
are server-side and read the live grant.

---

## 6. Tests actually executed

| Suite | Result |
|---|---|
| **PIF focused** `pif.integration.spec.ts` | **92 / 92 passed** (12 groups) |
| **Full API regression** | **1136 / 1136 passed, 30 / 30 suites** |
| **admin-web** (incl. 25 new PIF tests) | **204 / 204 passed, 14 files** |
| **customer-web** (incl. 23 new PIF shop tests) | **186 / 186 passed, 9 files** |
| **packages/config** | 12 / 12 passed (unchanged) |
| Typechecks | api, admin-web, customer-web, shared-types, config — **clean** |
| Lint (whole monorepo) | **clean** |
| Production builds | api, admin-web, customer-web — **all built** |
| Fresh database | all **50** migrations applied in order to a new database → **66 tables / 5 views**, `pif` 21, 22 permissions, 6 roles, SUPER_ADMIN 13 module permissions, `app_pif` = `INSERT, SELECT` on `pif.orders`, 4 triggers on `pif.order_events`; re-applying 0050 is **idempotent** |

### The 20 acceptance checks
| # | Check | Evidence |
|---|---|---|
| 1 | SUPER_ADMIN reaches both modules | PIF group 1 (HTTP, both `/admin/pif/*` and `/admin/rik/*`) ✅ |
| 2 | RIK_ADMIN cannot reach PIF admin | PIF group 1 — 4 routes, 403 each ✅ |
| 3 | PIF_ADMIN cannot reach RIK admin | PIF group 1 ✅ |
| 4 | Authorized PIF staff: only permitted functions | PIF group 1 (cashier, delivery staff) + admin UI tests ✅ |
| 5 | Product create/edit/activate/deactivate | PIF group 2 + admin UI ✅ |
| 6 | Images upload, save, load, display | PIF group 11 (9 tests incl. serving the bytes back) + admin UI ✅ |
| 7 | Price/unit/pack/tax validation | PIF group 2 (negative, 3-decimal, unconfigured tax rate, bad limits) ✅ |
| 8 | Inactive/unavailable cannot be ordered | PIF group 5 ✅ |
| 9 | Cart quantities and totals correct | PIF group 4 (to the paise, incl. discount-then-GST) ✅ |
| 10 | Server-side checkout uses authoritative prices | PIF groups 4–5; a body with a price is **refused** ✅ |
| 11 | Duplicate checkout cannot duplicate an order | PIF group 6 (same key twice, and two at once) ✅ |
| 12 | Concurrent actions, no conflicting history | PIF group 8 (duplicate sequence refused; status projected by trigger) ✅ |
| 13 | COD recorded correctly | PIF group 7 (`COD_COLLECTED`, amount, and **no** bill rows) ✅ |
| 14 | Preparation and handover enforced | PIF group 7 (sequence jump refused; per-role authority) ✅ |
| 15 | Customer status read-only, reflects real events | PIF group 10 + customer-web tests ✅ |
| 16 | Historical amounts unchanged after a price change | PIF group 9 ✅ |
| 17 | Unauthorized API requests rejected | PIF group 1 (401/403) ✅ |
| 18 | RIK workflows, permissions and data intact | PIF group 12 + the full 1136-test regression ✅ |
| 19 | Migrations apply in order to a fresh database | Verified above ✅ |
| 20 | Tests, typechecks, lint, builds | Verified above ✅ |

---

## 7. Two defects found and fixed while building

1. **A customer-facing response clobber (PIF side):** none — but the
   equivalent Phase E bug (`fulfillment` overwritten) informed the naming
   here, which is why the PIF order view adds no key that an existing block
   already uses.
2. **`trg_assert_order_totals` used a `CASE` over `NEW`**, and plpgsql
   resolves every branch — so the trigger failed with *record "new" has no
   field "order_id"* when it fired on `pif.orders`. Rewritten as `IF`.
3. **`shared.idempotency_keys` carried no application grant** (it had never
   been used), so the first idempotent checkout failed with *permission
   denied*. Granted SELECT+INSERT to `app_shared`, append-only, with the
   migration asserting both.
4. **An idempotency key claimed by another customer** would have produced a
   500. It is now an explicit 409 refusal, and the key is random per checkout
   attempt (a key derived from the cart would have blocked a legitimate
   repeat order of the same basket).

---

## 8. Remaining work and deployment prerequisites

**Not built, by the document's own priority order (§11 item 7):**
- **Bulk Excel/CSV product import.** Manual creation and image upload were
  prioritised as instructed. The import would reuse the existing `exceljs`
  dependency and the eligibility-import pattern (upload → validate → preview
  → confirm → audit); it is the natural next PIF increment.
- **PIF reports** beyond the dashboard counts (`pif.report.view` exists and
  PIF_ADMIN holds it; no report screen was built).
- **The audible new-order buzzer.** The dashboard shows the visible alert and
  announces it to assistive technology; a sound that plays itself needs an
  approved decision about volume, mute and fallback, so nothing was invented.

**Deployment prerequisites:**
1. `PIF_MEDIA_ROOT` must point at a **persistent, writable** path — product
   images are files, not database rows. Defaults are supplied so an existing
   `.env` still starts.
2. The API serves `/pif/media/...` itself; if a CDN or reverse proxy fronts
   it, that path must be cached and passed through (responses are immutable).
3. Nothing else: no new service, no queue, no external dependency.

**No historical data needs manual resolution.** `pif.orders`,
`pif.order_items` and `pif.carts` were empty before this phase and the
catalogue had only 3 seeded categories and 1 tax rate, so nothing was
migrated or reinterpreted.

**The billing boundary, stated rather than implemented:** e Samagri records
the order, its amounts, and the cash collected at handover. It raises no bill,
invoice or receipt, and `SALE_FINALIZED` is left unused precisely because this
application cannot know what the facility's separate billing software did. No
integration with that software exists, and none is simulated.

---

## 9. Readiness

**The PIF end-to-end grocery workflow is ready for submission**, and RIK is
unchanged. Catalogue administration, image management, cart, server-priced
COD checkout, the order desk, the full lifecycle with audit, and the
customer's read-only tracking are all implemented, enforced in the database,
and covered by 92 focused API tests inside a 1136-test regression, plus 48
new UI tests, with clean typechecks, clean lint, three production builds and a
verified fresh-database migration path.

---

## 10. What completing the application needs next

1. **Bulk product import** — the catalogue is meant to hold 3,000+ SKUs; one
   validated spreadsheet import is worth more than any other remaining PIF
   feature.
2. **Real catalogue data and images** — the facility's own categories,
   products, prices, GST rates and photographs, entered through the screens
   this phase delivered (no developer involvement needed).
3. **The buzzer decision** (sound, volume, mute, fallback) and PIF reports.
4. **An end-to-end rehearsal on a fresh database** with real staff accounts
   and the bootstrap credential step from
   `database/docs/deployment-and-rollback.md`.
5. **Operational hardening already noted in earlier phases** — rate limiting
   and the global exception filter remain STEP 8 scope and are unchanged by
   this phase.
