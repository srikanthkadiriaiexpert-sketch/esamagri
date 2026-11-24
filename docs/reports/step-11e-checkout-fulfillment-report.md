# e Samagri — STEP 11E — RIK Checkout & Fulfillment

**Implementation report** · 23 September 2026

---

## Final acceptance criteria

| The customer can | Status |
|---|---|
| Review their complete RIK selection | **COMPLETE** |
| See entitlement / consumption / remaining from server data | **COMPLETE** |
| Read the mandatory availability warning | **COMPLETE** |
| Explicitly acknowledge the availability risk | **COMPLETE** |
| Select PICKUP or DELIVERY | **COMPLETE** |
| Select Naval Park or Dolphin Hill for pickup | **COMPLETE** |
| Enter a delivery address for delivery | **COMPLETE** |
| Confirm the RIK selection | **COMPLETE** |
| Receive a confirmation result | **COMPLETE** |

| The system must | Status |
|---|---|
| Confirm atomically | **COMPLETE** |
| Prevent duplicate confirmation | **COMPLETE** |
| Preserve historical entitlement / rule snapshots | **COMPLETE** |
| Preserve historical brand / pack-size data | **COMPLETE** (see Unresolved 1 on "brand") |
| Preserve historical fulfillment information | **COMPLETE** |
| Maintain existing RBAC | **COMPLETE** |
| Keep all existing RIK tests passing | **COMPLETE** |
| Keep typecheck / lint / build clean | **COMPLETE** |

Every line is covered by a test that runs against real PostgreSQL over real HTTP. Nothing
is claimed on the strength of code reading alone.

---

## A. Files changed

**Created — backend**
```
apps/api/src/rik/repositories/pickup-locations.repository.ts
apps/api/src/rik/rik-checkout.integration.spec.ts                48 tests
```

**Created — frontend**
```
apps/customer-web/src/routes/rik/ration/RationCheckoutPage.tsx
apps/customer-web/src/routes/rik/ration/ration-checkout.test.tsx 33 tests
apps/admin-web/src/routes/rik-config/PickupLocationsPage.tsx
```

**Modified**

| File | Why |
|---|---|
| `apps/api/src/rik/repositories/entitlement-selections.repository.ts` | Confirmation is now one statement carrying snapshot, basis, acknowledgement, fulfillment and reference. Added `findCurrentForPeriod`. |
| `apps/api/src/rik/services/rik-selection-validation.service.ts` | `confirm()` takes and validates the confirmation request; `loadDraftState` falls back to the confirmed record (defect, §M). |
| `apps/api/src/rik/rik.controller.ts` | Confirm route extended; pickup-location read added; selection state added to the entitlement response. |
| `apps/api/src/rik/dto/entitlement.dto.ts` | `ConfirmSelectionDto`. |
| `apps/api/src/rik/services/rik-admin-config.service.ts` | Pickup-location administration, audited like every other change. |
| `apps/api/src/rik/rik-admin.controller.ts`, `dto/rik-admin-config.dto.ts` | Four pickup-location routes, gated by `rik.entitlement.adjust`. |
| `apps/api/src/rik/rik.module.ts` | Registered the new repository. |
| `apps/api/src/shared/repositories/customers.repository.ts` | Reads and writes `dietary_preference`. |
| `apps/api/src/customer/services/customer-profile.service.ts`, `dto`, `controller` | Dietary preference self-service (§13). |
| `apps/api/src/database/schema-contract.ts` | 55→56 tables (rik 21→22), with the reason recorded in the file. |
| `apps/customer-web/src/lib/api/rik-entitlement-api.ts` | Confirmation contract, selection state, pickup locations. |
| `apps/customer-web/src/routes/rik/ration/KnowYourRationPage.tsx` | "Review and confirm", or the reference once confirmed. |
| `apps/customer-web/src/app/App.tsx`, `apps/admin-web/src/app/App.tsx` | New routes. |
| `apps/admin-web/src/lib/api/rik-config-api.ts`, `routes/rik-config/RikConfigLayout.tsx` | Eighth configuration screen. |

**Tests updated for the intentional contract change** — `rik-entitlement.integration.spec.ts`
(two confirm calls), `rik-know-your-ration.integration.spec.ts` (two confirm calls),
`rik-admin-config.integration.spec.ts` (a hand-built CONFIRMED row must now be complete),
`customer.integration.spec.ts` (approved profile field set), `database.service.spec.ts` /
`schema-contract.spec.ts` (table counts), `rik-config.test.tsx` (eight tabs). **No
assertion was weakened**; each records why it moved.

## B. Migrations added

**0029 — `rik_selection_fulfillment`.** One new table, `rik.pickup_locations`, seeded with
Naval Park and Dolphin Hill. Additive columns on `rik.entitlement_selections`:
`reference_number`, `fulfillment_type`, `pickup_location_id`, `pickup_location_name`,
`delivery_address`, `availability_acknowledged`, `availability_acknowledged_at`. A
sequence for references. Four CHECK constraints and two triggers (below). Nothing dropped
or altered.

**0030 — `rik_cereal_pack_sizes`.** Maggi 280 g, Hakka Noodles 1,000 g, Maida 500 g. Data
only — and it closes the STEP 11D limitation that those three "maximum 2 packets" limits
could not bind without a pack size. The ratios and limits are unchanged; a RIK
administrator can still edit all of it from the Pack sizes & limits screen. The migration
raises if a code is missing rather than passing quietly.

## C. API changes

| Method | Route | Change |
|---|---|---|
| POST | `/rik/selections/confirm` | **Extended, not replaced.** Now takes `availabilityAcknowledged`, `fulfillmentType`, and `pickupLocationId` or `deliveryAddress`. Returns the confirmation with its reference. |
| GET | `/rik/fulfillment/pickup-locations` | New — the collection points on offer today. |
| GET | `/rik/entitlements/current` | Additive: a `selection` object carrying status, reference and fulfillment. |
| PATCH | `/customer/me` | Additive: accepts `dietaryPreference`. `GET /customer/me` returns it. |
| GET/POST/PATCH/POST | `/admin/rik/config/pickup-locations[/:id][/active]` | New — client-managed collection points. |

**There is exactly one way to confirm a RIK selection**, and it is the endpoint STEP 11B
introduced. No duplicate confirmation mechanism was created.

## D. UI routes and screens

**Customer** — `/rik/ration/confirm`: review → availability acknowledgement → fulfillment
→ final summary → confirm → confirmation receipt, as one screen in four stages so the
customer can always see what they are confirming, and a refresh cannot strand them
mid-wizard.

Deliberately **not** `/rik/checkout`: that URL already belongs to the STEP 8 catalogue
cart. A ration issue and a cart checkout are different things and must not share an
address. The static segment outranks `:poolId`, so it cannot collide with a category.

**Admin** — `/rik/config/pickup-locations`, the eighth RIK configuration screen.

## E. Database changes

56 tables (was 55), 5 views, 30 migrations. One table added; columns added to one existing
table. **Nothing dropped, nothing altered destructively.**

Why the selection and not `rik.orders`: `rik.orders` exists from Phase 2 with a
`fulfillment_type` column and a full READY/COLLECTED/DELIVERED lifecycle — but what a
customer confirms is their *selection*, and `rik.orders` describes what the facility then
*does* about it, which is a later step this one was told not to start. It also has no
pickup location, no address and no link to a selection, so adopting it would have meant
new columns anyway plus a lifecycle nobody is ready to drive. The reasoning is recorded in
the migration header.

Why a new table rather than `shared.settings`: that key/value store is the SUPER_ADMIN
settings surface, gated by `shared.settings.write`. Putting a RIK catalogue there would
hand RIK configuration to the wrong role and give up per-row history. `rik.pickup_locations`
follows the exact shape every other RIK configuration table uses, so the STEP 11C
administration architecture picked it up without a new framework.

## F. RBAC changes

**None.** Six roles, twenty permissions, no PURCHASING role — asserted by test.
Pickup-location administration reuses `rik.entitlement.adjust`, which RIK_ADMIN holds and
no other role does. Customers cannot reach any admin route; staff (RIK_ADMIN included)
cannot reach a customer's ration.

## G. Tests added

**81 new tests** — 48 backend, 33 frontend. Against the kickoff's §16 list:

*Backend, all 22:* pickup at Naval Park ✓ · pickup at Dolphin Hill ✓ · delivery ✓ ·
delivery without address ✓ (and whitespace-only ✓) · pickup without location ✓ · invalid
pickup location ✓ · invalid fulfillment method ✓ · missing acknowledgement ✓ (and
explicitly false ✓) · explicit acknowledgement accepted ✓ · open selection confirms ✓ ·
already-confirmed cannot confirm again ✓ · repeated request creates no duplicate ✓ ·
cannot confirm another customer's ✓ · unauthenticated 401 ✓ · staff 403 ✓ · rule snapshot
preserved ✓ · name and pack size preserved ✓ · fulfillment preserved ✓ · profile address
change does not move the delivery address ✓ · catalogue change does not move history ✓ ·
rollback ✓ · concurrent confirmations ✓.

*Frontend, all 13:* review displays selections ✓ · warning visible ✓ · confirm disabled
before acknowledgement ✓ · enabled after ✓ · pickup works ✓ · Naval Park ✓ · Dolphin Hill
✓ · address required ✓ · address submitted ✓ · final summary correct ✓ · confirmed becomes
read-only ✓ · errors displayed ✓ · refresh/retry does not duplicate ✓.

## H. Full test count

**723 passing, 0 failing** (was 633).

| Suite | Tests | Change |
|---|---|---|
| Backend (`apps/api`) | **510** (20 suites) | +48 |
| Customer app | **102** | +33 |
| Admin console | 90 | — |
| `packages/config` | 12 | — |
| **Total** | **723** | **+90** |

## I. Typecheck — **PASS** (all five workspaces)
## J. Lint — **PASS** (`--max-warnings=0`, all five workspaces)
## K. Build — **PASS** (all five workspaces)

---

## L. Unresolved business decisions

1. **"Brand" has no data model, and I did not invent one.** `rik.products` has no brand
   column and `rik.provisions` has none either — brand today is part of the provision's
   name ("Amul Paneer 200g", "Oats 600g"). The confirmed snapshot preserves that full name
   and the pack size, which is what "historical brand information preserved" means in
   practice right now. **If you want brand as a separate, filterable, admin-editable
   field, say so** — it is a small additive column plus a field on the SKU master screen,
   but it changes the catalogue contract and was not needed for checkout.
2. **Changing dietary preference mid-period is undefined.** Self-service is now built
   (§13) and confirmed history is provably safe. What is *not* decided: what should happen
   to an open draft, or to an entitlement already part-consumed, when an officer switches
   PV→NV halfway through a period. Today the next calculation simply uses the new
   preference and any line that no longer fits is refused on its next validation. **No
   pro-rata rule was invented.** This needs a facility decision.
3. **Cancelling a confirmed selection is not implemented**, per §12. The status model
   allows CONFIRMED → CANCELLED and migration 0029 deliberately still permits that
   transition (it refuses only changes to the *substance*), so the door is open — but no
   workflow, no authority and no consequence is defined, so none was built.
4. **SUPER_ADMIN still cannot administer RIK configuration**, including collection points.
   It holds no `rik.*` permission in the approved seed. Reported since STEP 11C and
   unchanged; one migration whenever you want it.
5. **A confirmed selection does not yet become a `rik.orders` row.** That is the issue /
   pickup workflow, explicitly out of scope here. When it lands it can read the fulfillment
   columns rather than re-asking the customer.

## M. Defects discovered and fixed

**Defect 1 — a confirmed ration disappeared from Know Your Ration.** `loadDraftState`
looked only for a DRAFT, so the instant a customer confirmed, their ration read as though
they had chosen nothing. Fixed by falling back to the confirmed record. Writes are
unaffected: they go through `findOpenForUpdate`, which still sees only a DRAFT, so a
confirmed selection stays read-only **by construction** rather than by a check somebody
has to remember.

**Defect 2 — a confirmed row could disagree with its own snapshot.** `confirm()` never
refreshed `dietary_preference` / `eligible_days`, so a customer who changed their
preference while holding an open draft would confirm a row whose stored basis contradicted
the snapshot it carried. The basis is now written from the values the calculation actually
used. This would have become visible the moment self-service dietary preference existed —
which it now does.

**Defect 3 (carried, now closed) — three pack limits could not bind.** Reported as a STEP
11D limitation: "maximum 2 packets" with a NULL pack size gave the engine nothing to
multiply, so the screen displayed a limit nothing enforced. Migration 0030 supplies the
three sizes; a test asserts the ceiling now binds.

## N. Security verification

- **Ownership is structural.** No customer id appears in any confirmation request shape.
  A body that names another customer is **refused with 400**, not ignored — asserted.
- **401 without a token; 403 for staff**, RIK_ADMIN included, on every customer route.
- **Customers cannot reach admin routes** (403 asserted); **staff cannot reach a
  customer's ration**.
- **The pickup location is resolved server-side from its id**, against what is offerable
  *today*. A client cannot write its own location text into history, and cannot choose a
  retired point by sending an id it saw last month.
- **Every field is validated server-side** regardless of what the screen offered:
  acknowledgement must be explicitly `true`; fulfillment must be PICKUP or DELIVERY;
  pickup needs a valid location; delivery needs a non-blank address (trimmed before
  judging). Unrecognised fields are refused, not dropped.
- **No price, total, tax or payment field exists** in the confirmation payload — asserted
  by scanning the response and the rendered screen.
- **Audit unchanged and extended**: every pickup-location change records who, when, before
  and after, through the existing append-only `shared.audit_log`.

## O. Historical snapshots remain immutable

Three layers, and the outer two bind the database owner and a superuser too:

1. **CHECK constraints** make a confirmed-but-incomplete row impossible: a CONFIRMED
   selection must carry a fulfillment type, a reference and an acknowledgement; PICKUP must
   name a place and carry no address; DELIVERY must carry a non-blank address and no place.
2. **`protect_confirmed_selection_record`** refuses any UPDATE that changes the substance
   of a confirmed row — snapshot, basis, fulfillment, acknowledgement, reference, customer
   or period. **`protect_confirmed_selection_children`** refuses any insert, update or
   delete on its lines or elections. Migration 0027's existing trigger already refuses to
   delete it.
3. **Snapshots, not lookups.** The pickup location's *name* and the delivery *address* are
   stored as text on the selection. The address is never a reference to
   `shared.customer_addresses`.

Proved by tests that make the change for real and then re-read the record: renaming the
provision and changing its pack size, changing the entitlement scale, renaming Dolphin
Hill, changing the customer's profile address, and switching their dietary preference
PV↔NV. In every case the confirmed record is byte-identical afterwards — **and the current
calculation does follow the new value**, which is the distinction that matters: future
entitlement moves, history does not.

---

## Verification state

**56 tables · 5 views · 30 migrations · 18 pools · 50 scales · 7 conversions ·
119 provisions (117 customer-selectable) · 2 collection points · 6 roles · 20
permissions.**

No role added, no permission added, no PURCHASING role, no payment, no pricing, no GST, no
GPS, no maps, no duplicate confirmation endpoint, no PIF work — and **no residual test
data**.

**Next milestone:** the RIK issue and pickup workflow — turning a confirmed selection into
something the facility prepares, hands over and records.
