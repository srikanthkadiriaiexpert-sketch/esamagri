# e Samagri — PIF Scope Correction — Verification Analysis

**Date:** 16 September 2026
**Mode:** verification only — nothing implemented, no database touched, no production
code modified, Open Decisions Register unmodified.

---

## Acknowledgement

PIF is **only an online grocery ordering module**. The authoritative flow is:

> Customer → browse → cart → delivery address → confirm → **PIF dashboard + buzzer** →
> staff prepare → **bill created in the client's separate existing billing software** →
> delivery → completed.

e Samagri does not bill, invoice, run a POS, manage cash, purchase, hold suppliers, or
maintain operational stock. It also stays a **full grocery catalogue** — categories,
subcategories, 3,000+ SKUs — not a demonstration catalogue.

Two headline results, before the detail:

- **No migration is required to support the corrected scope.** The frozen schema already
  expresses the simplified order lifecycle.
- **Two genuine blockers surfaced**, both needing your decision rather than my judgement:
  **there is no PIF order-management permission in the seed**, and **prices are mandatory
  at both catalogue and order-line level** even though billing is external. Details in
  items 4, 5 and 11.

---

## 1. Which existing Step 10 / PIF requirements are now superseded

### Superseded by your Section 7

| Requirement | Where it currently appears |
|---|---|
| PIF POS | Spec §8 ("plus the PIF point-of-sale application"), backlog ADM-4, `PifAdminPage` area, dashboard tile `pif-pos`, `PifModule` doc comment |
| PIF cashier workflow | Spec §8 role list, `PifModule` doc comment |
| PIF purchasing / purchase orders | Backlog ADM-3, `PifAdminPage` area, dashboard tile `pif-purchasing`, `PifModule` doc comment |
| Supplier management | `PifModule` doc comment |
| PIF inventory management | Spec §3.3 (CUST-SEP "separate inventory contexts"), backlog CUST-SEP and ADM-3, `PifAdminPage` area, `PifModule` doc comment |
| Counter billing, invoice generation, receipt printing | `PifModule` doc comment, backlog ADM-4 |
| Cash collection / change | Backlog ADM-4 |
| POS returns / refunds | `PifModule` doc comment |
| Online ↔ POS shared stock synchronisation | `PifModule` doc comment — states this as a **non-negotiable boundary rule** |
| Online order → POS bill relationship | `PifModule` doc comment |

### Superseded by your Section 8

| Requirement | Where |
|---|---|
| PURCHASING role | Spec §8 role list, backlog ADM-1, and **STEP 10 finding F-1** |

**F-1 is hereby resolved as a scope/report mismatch, not a defect.** No purchasing role
is needed, none was created, and no migration is required. I will mark it closed on your
word; I have not edited any register.

### NOT superseded — explicitly reaffirmed

PIF-1 (complete universal grocery app), PIF-2 (full journey), PIF-3 (categories **and**
subcategories, admin-managed), PIF-4 (product experience), PIF-5 (3,000+ SKUs), PIF-6
(mandatory delivery address), PIF-7 (the five status labels), PIF-8 (My PIF Orders),
PIF-9 (order confirmation screen), ORD-1 (RIK/PIF order separation).

---

## 2. Which existing PIF code, files and screens are affected

**The good news: almost no behaviour exists to unwind.** Both backend PIF modules are
empty placeholders — the superseded scope lives almost entirely in *documentation and
comments*, not in shipped logic.

### Backend — `apps/api`

| File | Affected how |
|---|---|
| `src/pif/pif.module.ts` | **Doc comment only.** The module body is `@Module({})` — empty. Its comment enumerates "catalog, cart, checkout, POS, purchasing, suppliers, inventory, billing, returns, cash management" and states a boundary rule about "PIF counter POS" sharing inventory tables. That comment is now wrong and needs rewriting. **No behaviour to remove.** |
| `src/notification/notification.module.ts` | **Doc comment is correct and already anticipates the buzzer** ("visual + audible buzzer where permitted, always with a visible fallback"). Module body empty — the buzzer is unbuilt. |
| `src/admin/services/admin-dashboard.service.ts` | Contains two now-superseded tiles: `pif-purchasing` ("Purchase orders") and `pif-pos` ("Point of sale"). Both currently render as *unavailable*, so nothing false is shown — but they advertise modules that will never exist. |

### Admin console — `apps/admin-web`

| File | Affected how |
|---|---|
| `src/routes/PifAdminPage.tsx` | Lists 7 areas. **3 are superseded**: Inventory, Purchase orders, Point of sale. 2 are retained: Categories/subcategories, Products. "Orders and delivery" becomes the module's *primary* area. "Reports" is ambiguous — see item 11. |
| `src/routes/DashboardPage.tsx` | **One combined dashboard for RIK and PIF.** Your Sections 5 and 11 require two clearly separate operational dashboards. This is the single largest structural change the correction implies. |
| `src/routes/AdminLayout.tsx` | Navigation has one "Dashboard" entry; separating the dashboards changes this. |
| `src/test/staff-session.ts`, `RikAdminPage.test.tsx` | Assert `PIF_CASHIER` sees "Point of sale". Those assertions become obsolete when the area is removed. |

### Customer app — `apps/customer-web` (STEP 9, closed)

| File | Affected how |
|---|---|
| `routes/pif/PifHomePage`, `PifCategoryPage`, `PifProductDetailPage`, `PifSearchPage`, `PifCartPage`, `PifOrdersPage`, `PifOrderDetailPage` | **Unaffected.** All are exactly the corrected scope. |
| `routes/pif/PifCheckoutPage.tsx` | Shows "Payment method: Cash on Delivery" and **"Total to pay on delivery"** computed from cart prices. Needs your ruling — see item 11. |
| `design-system/OrderStatusStepper.tsx` | Already uses your exact five labels. **Unaffected.** |
| `lib/api/types.ts` | `PifOrderStatus = 'CONFIRMED' \| 'PREPARING' \| 'READY' \| 'OUT_FOR_DELIVERY' \| 'DELIVERED'` — a *provisional* type that does **not** match the database's values. See item 6. |
| `features/pif/README.md` | Empty folder marker; text mentions no superseded scope. Unaffected. |

### Documentation

`docs/product-specification.md` §8 and §3.3, and `docs/implementation-backlog.md` rows
CUST-SEP, ADM-1, ADM-3, ADM-4 — see item 9.

---

## 3. Database tables and permissions no longer needed by the PIF scope

### Tables now unused — **14 of the 20 `pif.*` tables**

```
pif.pos_bills              pif.pos_bill_items
pif.cashier_shifts         pif.cash_movements
pif.returns                pif.return_items
pif.purchase_orders        pif.purchase_order_items
pif.suppliers              pif.goods_receipts
pif.goods_receipt_items    pif.inventory
pif.inventory_transactions pif.tax_rates
```

All 14 hold **0 rows**.

### Tables still needed — 6

```
pif.categories   (has parent_id — supports subcategories already)
pif.products
pif.carts
pif.cart_items
pif.orders
pif.order_items
```

Plus `shared.customer_addresses` for the delivery address.

### Permissions now unused — 4 of the 8 `pif.*` codes

| Permission | Held by | Status |
|---|---|---|
| `pif.pos.open_bill` | PIF_CASHIER | **unused** |
| `pif.pos.finalize_bill` | PIF_CASHIER | **unused** |
| `pif.pos.return` | PIF_CASHIER | **unused** |
| `pif.purchase_order.approve` | PIF_ADMIN | **unused** |

**Consequence you should see clearly: `PIF_CASHIER` holds those three POS permissions and
nothing else.** Under the corrected scope it becomes a role with **zero applicable
permissions** — it can sign in, and see nothing. Per your Section 12 I have not deleted or
migrated it and have invented no new usage. It simply sits dormant, and I am flagging that
plainly rather than quietly leaving a role that does nothing.

**I am recommending no deletion of any of this.** Dropping tables, permissions or a role
would be a migration against a frozen database, for no functional gain. Leaving them unused
costs nothing and preserves the Phase 2 baseline exactly.

---

## 4. Is any database change actually necessary?

### For the order-only workflow: **NO.**

### But two constraints need your ruling, and one may force a change

#### 4a. `unit_price` and `selling_price` are NOT NULL

```
pif.order_items.unit_price   numeric  NOT NULL   (no default)
pif.products.selling_price   numeric  NOT NULL
```

The schema **requires a price** on every catalogue product and every order line.

Your Section 3 says "Price display **where applicable**", and Section 6 says e Samagri must
not calculate accounting totals because billing happens in the client's software. If the
intent is that e Samagri carries prices for display and the external software prices the
bill, the schema is fine as-is. **But if the intent is that e Samagri holds no prices at
all**, then `NOT NULL` on both columns blocks it and this becomes:

> **DATABASE_CHANGE_REQUIRED** — making `pif.products.selling_price` and
> `pif.order_items.unit_price` nullable. I have not written it.

This also means **BD-7 (PIF pricing source) still gates the catalogue**: no product row can
exist until a price source is confirmed, or until the columns are relaxed.

#### 4b. `pif.orders` has no foreign keys at all

`customer_id` and `delivery_address_id` are unconstrained UUIDs — nothing ties them to
`shared.customers` or `shared.customer_addresses`. This predates the correction and is not
caused by it, but the corrected scope makes `pif.orders` **the** central business object,
so referential integrity matters more now than before. Adding FKs would be a migration.
**Reported, not fixed.**

---

## 5. Is any RBAC change necessary?

### **There is no PIF order-management permission in the seed. This is the blocker.**

Compare the two modules:

| RIK | PIF |
|---|---|
| `rik.order.manage` ✅ | **— nothing equivalent —** ❌ |
| `rik.order.mark_ready`, `rik.order.mark_collected` | `pif.order.mark_delivered`, `pif.order.mark_not_delivered` |

The corrected PIF dashboard is **primarily an order management / order awareness
dashboard**. No permission governs viewing or preparing a PIF order. The only options are:

- **(a)** Gate PIF order management on `pif.report.view` — it is what PIF_ADMIN holds, but
  the code means "view reports". Semantically wrong, and it would let anyone with report
  access open customer orders and delivery addresses. **I do not recommend it.**
- **(b)** Add `pif.order.manage`, granted to PIF_ADMIN — mirrors RIK exactly.
  **DATABASE_CHANGE_REQUIRED**; I have not written the migration.
- **(c)** Something else you specify.

Your Section 12 says not to add roles to satisfy the old specification — this is the
opposite case: a permission the **new** specification needs and the seed does not have. I
have invented nothing and am stopping here for your decision.

### Everything else: no RBAC change

Roles stay exactly as they are — SUPER_ADMIN, RIK_ADMIN, PIF_ADMIN, PIF_CASHIER,
RIK_PICKUP_STAFF, DELIVERY_STAFF. No PURCHASING role. `DELIVERY_STAFF` already holds
precisely the two permissions the corrected delivery step needs. **F-2 (SUPER_ADMIN holding
no `rik.*`/`pif.*` permission) is untouched and remains your separate decision**, per your
Section 13.

---

## 6. Can the current PIF order schema support the simplified order-only workflow?

### **YES — with no schema change.** The status constraint already permits the exact lifecycle.

```
CHECK (status IN ('PLACED','ACCEPTED','PREPARING','READY_PICKED','OUT_FOR_DELIVERY',
                  'DELIVERED','COD_COLLECTED','SALE_FINALIZED','CANCELLED','NOT_DELIVERED'))
```

| Your customer-facing label | Database value | |
|---|---|---|
| Order Confirmed | `PLACED` (and/or `ACCEPTED`) | ✅ |
| Being Prepared | `PREPARING` | ✅ |
| Ready/Picked | `READY_PICKED` | ✅ |
| Out for Delivery | `OUT_FOR_DELIVERY` | ✅ |
| Delivered | `DELIVERED` | ✅ |

A CHECK constraint **permits** values; it never requires them. The two billing states —
`COD_COLLECTED` and `SALE_FINALIZED` — simply go unused, as do the nullable columns
`cod_collected_at`, `finalized_at` and `cod_amount`. `CANCELLED` and `NOT_DELIVERED` are
operational, not billing, and stay available. **Nothing needs to be removed.**

`pif.order_items.inventory_reserve_txn_id` is **nullable**, so orders can be written with
no inventory involvement at all. ✅

### Three mapping decisions to settle before implementation

1. **`PLACED` vs `ACCEPTED`.** Both exist. Does "Order Confirmed" mean the customer
   submitted it (`PLACED`), or that staff acknowledged it (`ACCEPTED`)? Your flow has the
   dashboard *receive* the order, which suggests `PLACED` on submission and `ACCEPTED`
   optionally on staff acknowledgement — but that is my reading, not your instruction.
2. **The frontend vocabulary does not match the database.** `lib/api/types.ts` declares
   `'CONFIRMED' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED'`, against the
   database's `PLACED`/`ACCEPTED` and `READY_PICKED`. That file is explicitly marked
   provisional and is wired to nothing, so it is not a live defect — but the mapping must
   be fixed before the order engine is built.
3. **`cod_amount`.** Keep recording it as order information, or leave it null because
   billing is external?

---

## 7. What screens should remain in PIF

### Customer app — all of these stay, unchanged

PIF landing · Categories · Subcategories · Product listing (paginated, server-side search)
· Product details · Add to Cart · Quantity ± · Cart · Delivery address · Order confirmation
screen · Order status · My PIF Orders.

### PIF admin console — its **own** dashboard, separate from RIK

New PIF orders list · prominent visual new-order alert · **large audible buzzer with a
visible fallback** · order detail (customer details needed for fulfilment, products,
quantities, delivery address) · prepare order · update operational status · order history ·
PIF catalogue (categories, subcategories, products) · PIF operational announcements.

---

## 8. What should NOT be built

POS / point of sale · cashier workflow · bills or invoices of any kind · GST invoices ·
receipt printing · billing records · accounting totals · cashier transactions · cash and
change handling · refunds · POS returns · purchase orders · purchasing workflows · supplier
management · stock receiving · stock adjustment · warehouse stock · counter-sale stock ·
POS inventory synchronisation · a PURCHASING role · **a combined RIK+PIF operational
dashboard**.

Per your Section 7, none of this should be preserved as hidden "future functionality".
The 14 unused `pif.*` tables stay in the schema only because removing them would mean a
migration against a frozen database — **no code will reference them**.

---

## 9. Changes required to the Architecture & Implementation Backlog

*Proposed only — I have modified nothing.*

| Row | Change |
|---|---|
| **ADM-4** — "PIF POS shell (scanner, search, cart, bill, cash, change, print)" | **Delete — superseded** |
| **ADM-1** — role shells "… CASHIER, DELIVERY, PURCHASING" | **Correct to the six real seed roles**; remove PURCHASING |
| **ADM-3** — "Dashboard, products, inventory, orders, customers, reports, announcements, settings" | **Remove inventory**; split into separate RIK and PIF dashboard rows |
| **CUST-SEP** — "Separate RIK/PIF carts, orders, **inventory**, rules, reports" | **Remove "inventory"** from the PIF side |
| **PIF-6a** — "Cash on Delivery only; no simulated payment" | **Clarify**: payment is collected outside e Samagri and billed in the client's software |
| *(new)* **PIF-10** | PIF dashboard is a separate order-management dashboard with a new-order buzzer and visible fallback |
| *(new)* **PIF-11** | Billing, invoicing and accounting are **out of scope** — performed in the client's existing software |

---

## 10. Contradictions with the Corrected Product Specification

The specification you ratified on 12 September conflicts with this correction in four
places. **It is the authoritative document, so I am not editing it — these need your
ruling.**

| # | Spec text | Conflict |
|---|---|---|
| **C-1** | §8: "Admin scope includes … **inventory** … **plus the PIF point-of-sale application**" | Directly contradicts Sections 1, 6, 7 and 9 of this correction |
| **C-2** | §8: "serves SUPER_ADMIN, RIK_ADMIN, PIF_ADMIN, **CASHIER**, **DELIVERY** and **PURCHASING** roles" | PURCHASING is now excluded (§8); CASHIER/DELIVERY are not the real seed names either |
| **C-3** | §3.3 (CUST-SEP): "separate carts, separate order contexts, **separate inventory contexts**" | PIF no longer has an inventory context |
| **C-4** | §5.7 (PIF-9): the confirmation screen carries "payment method and **amount due**"; §5.9 (PIF-8): My PIF Orders shows "**amount**" | Sits against §6's "do not calculate accounting totals" — see item 11 |

---

## 11. Business decisions still required

| ID | Decision | Why it matters |
|---|---|---|
| **New — PIF order permission** | Add `pif.order.manage`, reuse `pif.report.view`, or something else? | **Blocks the PIF dashboard.** Nothing currently authorises PIF order management |
| **New — does e Samagri hold prices?** | If yes, the schema is fine. If no, `selling_price` and `unit_price` NOT NULL must be relaxed | **Blocks the catalogue and order lines** |
| **New — may the app show an order total?** | §6 forbids calculating accounting totals; the spec's PIF-9/PIF-8 and the current checkout show an amount due | The checkout today says "Total to pay on delivery" |
| **New — `PLACED` vs `ACCEPTED`** | Which database value is "Order Confirmed"? | Needed before the order engine |
| **New — PIF "Reports"** | Your Section 11 PIF dashboard list omits reports, but §6 does not forbid them. Keep the area or drop it? | `pif.report.view` exists and PIF_ADMIN holds it |
| **New — availability without inventory** | §9 says availability is handled "according to the approved catalogue/business design". What determines whether a product is in stock? | PIF-4 requires an availability indicator |
| **New — PIF_CASHIER's future** | The role now has zero applicable permissions | You said keep it; confirming you accept a dormant role |
| **BD-6** | PIF catalogue taxonomy and delivery rules | **Still open** — unchanged |
| **BD-7** | PIF pricing source | **Still open** — and now coupled to the NOT NULL question above |
| **AS-3** | PIF product imagery for 3,000+ SKUs | **Still open** — unchanged |

---

## 12. Impact on STEP 10 closure

STEP 10 was delivered, verified and reported as **PASS WITH WARNINGS** on 16 September. This
correction changes that picture as follows.

### What is unaffected — the large majority

Staff authentication, the application shell, role-aware navigation, the account screen,
announcements and their server-side audience isolation, the RIK administrative foundation,
issue schedules, the five UI states, responsive behaviour, all 345 tests, and the database
freeze. **None of it depended on the superseded PIF scope.**

### What changes

| | Impact |
|---|---|
| **F-1 (no PURCHASING role)** | **Resolved.** Your Section 8 declares it a scope mismatch; no role is needed and no migration is required. Ready to close on your word. |
| **F-2 (SUPER_ADMIN has no `rik.*`/`pif.*`)** | **Unchanged and still open** — your Section 13 explicitly defers it. |
| **F-3 (roles with no screen)** | **Partly worse.** `DELIVERY_STAFF` gains a clear home in the PIF order flow. But `PIF_CASHIER` now has no purpose at all under the corrected scope, not merely no screen yet. |
| **The single combined dashboard** | **Now a defect against the corrected requirements.** Sections 5 and 11 require separate RIK and PIF operational dashboards; STEP 10 shipped one. |
| **`PifAdminPage` areas** | 3 of 7 advertise superseded modules (Inventory, Purchase orders, Point of sale). |
| **Two dashboard tiles** | `pif-purchasing` and `pif-pos` advertise modules that will never exist. |

### My recommendation

**Close STEP 10 on its own terms** — it was built and verified against the scope in force at
the time, and it invented nothing. Then take the dashboard split and the removal of the
superseded PIF areas as a **small, explicitly scoped STEP 10.1 correction**, rather than
reopening STEP 10 or folding it silently into the next build.

Nothing currently shows a user anything false: every superseded area renders as *pending* or
*not built*, so the console is honest today — just advertising more than the product will
ever contain.

---

## Confirmation of constraints

- ❌ Nothing implemented
- ❌ No migration, table, column, index, view, role, permission, seed or fixture created
- ❌ Database unchanged — **47 tables / 5 views / 24 migrations**
- ❌ No production code modified
- ❌ Open Decisions Register unmodified
- ❌ No requirement invented

**Awaiting your decisions on the items in Section 11 — particularly the PIF order
permission and the pricing question, which together gate any PIF implementation.**
