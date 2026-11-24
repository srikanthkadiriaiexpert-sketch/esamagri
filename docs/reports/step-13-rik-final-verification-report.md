# STEP 13 — RIK FINAL VERIFICATION REPORT

**e Samagri · RIK · Base Victualling Yard, Visakhapatnam** · verification-only audit · 23 September 2026

## 1. Executive Status

**PASS WITH WARNINGS**

No blockers. Every business rule stated in the audit brief was checked against the
live configuration and matched exactly. Three warnings, none of which stops approval,
plus one open business decision carried forward.

## 2. Environment Verified

- **database:** PostgreSQL 16, `esamagri_test`, measured independently — 56 tables, 5 views, 6 roles, 20 permissions, 18 pools, 50 scales, 7 conversions, 189 provisions, 173 images
- **application:** NestJS API — schema contract verified at boot on all 23 API suites (56/5)
- **customer web:** Vite/React PWA — production build succeeds, precache 9 entries / 375.54 KiB
- **admin:** admin-web — builds, typechecks, lints clean
- **test environment:** real PostgreSQL integration, 39 suites/files, 773 tests, 0 residual test rows afterwards

Baseline numbers were re-measured, not copied. Every figure above matches the claimed
Step 12C-2 closing state.

## 3. Catalogue Verification

### Fresh Vegetables
**PASS**
Details: 45 rows in the VEGETABLES pool — 44 active and customer-selectable, all 44
carrying an image, 1 retired (`VEG_FRESH`). No unrelated provision appears; Spring Onion
is present as a vegetable variety and is not the separate Onion provision.

### Fresh Fruits
**PASS**
Details: 28 rows in the FRUITS pool — 27 active and selectable, 1 retired (`FRUIT_FRESH`).
26 named fresh varieties all carry images. `FRUIT_DRY` (Dry Fruits) remains active,
selectable, correctly in the FRUITS pool at a ratio of 8.214286 (230 ÷ 8.214286 = 28 g/day),
and correctly did **not** receive a fresh-variety image. No Fresh/Dry image crossover.

### Dry Catalogue
**PASS**
Details: 106 dry provisions across the 11 dry pools. 103 carry an image; 3 intentionally
do not. 18 brands, 74 pack sizes and 1 pack unit are populated exactly as the catalogue
holds them. Tata Salt verified: the record remains `SALT_TABLE` / name **"Salt"** / no
brand — not renamed from the packaging text.

### Image Mapping
**PASS**
Details, all measured globally:
- 173 `image_ref` values, 173 distinct — no image shared by two provision codes: **0**
- Fresh provision carrying a dry image: **0**
- Dry provision carrying a fresh image: **0**
- `image_ref` outside the known folders: **0**
- Every `image_ref` resolves to a file on disk: **173/173**, missing **0**
- Files on disk not referenced by any provision: **0**
- Placeholder used where a verified image exists: **0**

## 4. Know Your Ration

**PV: PASS** — EGGS and MEAT have no scale for PV, so both pools are absent entirely.
`EGGS_TO_MILK_PV` and `MEAT_TO_MILK_PV` are AUTOMATIC: 250 base + 250 + 500 = **1,000 ml/day**.

**EV: PASS** — base milk 250 ml/day; eggs 2/day; meat pool absent. `EGGS_TO_MILK_EV`
(elective, +250 ml on declining eggs), `MEAT_TO_EGGS_EV` (+4 → **6 eggs/day**) and
`MEAT_TO_MILK_EV` (+500 ml) all present, and the two meat alternatives are mutually
exclusive.

**NV: PASS** — milk 250 ml/day with no automatic conversion; eggs 2/day; meat 260 g/day
with Fish (ratio 0.604651 → 430 g), Chicken/Fowl (1.485714 → 175 g) and `MEAT_TO_EGGS_NV`
(+4 eggs). No meat→milk conversion exists for NV, and no prohibited meat option is exposed
to PV or EV.

## 5. Entitlement Calculations

**PASS**

Every rule in §5, §6 and §7 verified against configuration:

| Rule | Stated | Configured | |
|---|---|---|---|
| Cereals | 450 g/day | 450 | ✅ |
| Dal | 40 g/day | 40 | ✅ |
| Hydrogenated Oil | 80 g/day | 80 | ✅ |
| Sugar | 90 g/day | 90 | ✅ |
| Jaggery | 45 g/day equiv. | ratio 2.0 → 90 ÷ 2 = 45 | ✅ |
| Tea | 9 g/day | 9 | ✅ |
| Coffee | 4 g/day | ratio 2.25 → 9 ÷ 2.25 = 4 | ✅ |
| Daliya | 20 g/day | 20 | ✅ |
| Butter/Ghee | 20 g/day | 20 | ✅ |
| Salt | 20 g/day | 20 | ✅ |
| Cheese | 50 g/day, PV/EV only | 50 for PV and EV, **none for NV** | ✅ |
| Condiments | 14 g/day | 14 | ✅ |
| Garam Masala Whole | 6 g/day | 6 | ✅ |
| Milk base | 250 ml/day | 250 | ✅ |
| Milk TD / Milkmaid | 100 g/day | ratio 2.5 → 250 ÷ 2.5 = 100 | ✅ |
| Eggs | 2/day EV+NV, hidden PV | 2 / 2 / none | ✅ |
| Meat | 260 g/day NV only | 260 NV only | ✅ |
| Fresh Vegetables | 170 g/day | 170 | ✅ |
| Fresh Onion | 60 g/day | 60 (own pool) | ✅ |
| Garlic | 10 g/day equiv. | ratio 6.0 → 60 ÷ 6 = 10 | ✅ |
| Fresh Potato | 110 g/day | 110 (own pool) | ✅ |
| Potato alt: Fresh Vegetables | 110 g/day | ratio 1.0 in the POTATO pool | ✅ |
| Fresh Fruits | 230 g/day | 230 | ✅ |
| Dry Fruits | 28 g/day | ratio 8.214286 → 28 | ✅ |
| Sago / Corn Flour / Custard | 7 g each | ratio 2.857143 → 7 | ✅ |
| Oats | 20 g, ≥30 eligible days | ratio 1.0, `min_eligible_days` = 30 | ✅ |
| Cornflakes / Semolina | 30 g each | ratio 0.666667 → 30 | ✅ |
| Maggi / Hakka Noodles / Maida | max 2 packets | `max_packs` = 2 on all three | ✅ |
| Millets | max 1 kg | `max_quantity` = 1000 | ✅ |
| Bread | FRESH issue, CEREALS pool | issue_period FRESH, CEREALS pool, ratio 1.0 | ✅ |

Onion and Potato are confirmed as **separate pools** from the 170 g/day Fresh Vegetables
pool — three distinct pool ids, three distinct scales.

**Month length:** the engine multiplies the daily scale by *eligible days*, never by a
calendar assumption. Covered by the existing suite ("base entitlement scales by eligible
days, never by calendar month") which runs both a 30-day and a 31-day period. Dal: 40 × 30
= 1.2 kg, 40 × 31 = 1.24 kg.

## 6. Split Entitlement

**PASS**

Four shared-pool scenarios are exercised by the existing engine suite against real
catalogue provisions, including the two examples named in the brief:

- **Onion/Garlic** — 400 g onion off 1,800 g leaves 1,400 g, i.e. 233 g of garlic (the
  brief's own example, asserted)
- **Bread/Cereals** — 1,600 g bread off 13,500 g leaves 11,900 g (the brief's own example,
  asserted)
- **Sugar/Jaggery** — one balance at the configured 2:1
- **Cereals across four provisions** — aggregated against one pool, each at its own ratio

Over-spend is refused server-side with a structured error and nothing is written; a
selection landing exactly on the entitlement is accepted; two simultaneous requests
serialise and cannot overspend.

## 7. Selection → Cart

**PASS**

Verified through the existing flow tests: invalid quantities rejected, over-entitlement
rejected with the server's own message, split entitlement calculated server-side, dietary
restrictions enforced (PV selecting meat is refused), non-selectable provisions refused
(loose tea), configured maximum quantity and maximum packs enforced, deactivated
provisions removed from the offer. The frontend performs no entitlement arithmetic —
confirmed by source scan (§12).

## 8. Checkout

**PASS**

The confirmation carries the availability warning **verbatim** as specified:

> ⚠️ IMPORTANT — PROVISIONS ARE SUBJECT TO AVAILABILITY
> The provisions/varieties selected by you are subject to availability on the date of
> issue. Selection of a particular provision does not guarantee its availability. If a
> selected provision is unavailable, an applicable alternative may be provided as per RIK
> rules.

It appears at the final confirmation stage; the acknowledgement checkbox starts unticked
and `canConfirm` requires it; the server independently requires `availabilityAcknowledged`
and refuses anything but an explicit true. It cannot be bypassed from the client. Order
creation, order items, selected provision and quantity, and the rule/conversion snapshot
are all exercised, including double-submit and genuinely concurrent confirmation.

## 9. Historical Snapshot

**PASS**

A confirmed selection recalculates from its own `rule_snapshot`, not from live
configuration — the snapshot carries pools, scales, conversions, provisions and the basis.
Database triggers refuse alteration of a confirmed selection and its line items. Existing
tests change a provision's name, brand, pack size, pack unit and image through the admin
API after confirmation and re-read the record: snapshot, quantity, ratio, pool equivalent
and reference number are byte-identical.

## 10. RIK Admin

**PASS**

SKU Master manages name, brand, pack size, pack unit, image reference and availability;
pack sizes and limits are managed on their own screen. Retirement is a flag, not a
deletion — the two generic fresh placeholders retired earlier remain present with their
names and history intact, and are excluded from the customer offer. Image handling is
create/edit/clear with no accidental reassignment (one image, one provision, verified
globally). Routine configuration — pools, scales, conversions, provisions, pack sizes,
limits, pickup locations — is administered from the dashboard without developer
intervention. No new role exists; no PURCHASING role exists.

## 11. RBAC

**PASS**

Exactly 6 roles — SUPER_ADMIN, RIK_ADMIN, PIF_ADMIN, PIF_CASHIER, RIK_PICKUP_STAFF,
DELIVERY_STAFF — and exactly 20 permissions, unchanged. RIK catalogue and configuration
writes are gated by `rik.product.manage` and `rik.entitlement.adjust`, both RIK_ADMIN
exclusive. Every other staff role is refused with 403 and anonymous with 401, asserted
route by route. A customer cannot read another customer's entitlement; a staff principal
cannot read a customer entitlement.

## 12. API / Database Consistency

**PASS**

Customer UI, API and database agree on active provisions, `image_ref`, brand, pack size,
pack unit, pools, conversions, dietary filtering and availability.

**UI hardcoding scan: clean.** No entitlement figure, daily scale, consumption ratio or
`dailyScale × eligibleDays` expression appears anywhere in customer-web or admin-web
source outside tests. The only match for an arithmetic pattern is a comment stating that
the module contains none. Every figure on screen is server-computed.

## 13. Regression

- **Tests:** 773 passed, 0 failed — api 563 (23 suites), customer-web 106 (6 files),
  admin-web 92 (8 files), config 12 (2 files)
- **Typecheck:** clean — api, admin-web, customer-web
- **Lint:** clean — all workspaces, `--max-warnings=0`, exit 0
- **Build:** success — all workspaces; customer PWA precache unchanged at 9 entries / 375.54 KiB

No test was altered to make it pass. No incorrect test was found.

## 14. Warnings

**W1 — Eleven active, customer-selectable provisions have no image and show the
placeholder.** Not a defect of Steps 12B/12C, which covered the fresh and dry catalogues
only; these pools were never in scope for an image step. Affected:

| Pool | Provisions |
|---|---|
| MILK | Fresh Milk, Milk TD / Milkmaid |
| EGGS | Eggs |
| MEAT | Chicken / Fowl, Fish, Meat |
| ONION_GARLIC | Onion, Garlic (Fresh) |
| POTATO | Potato, Fresh Vegetables (in lieu of potato) |
| FRUITS | Dry Fruits |

An officer browsing Milk, Eggs, Meat, Onion or Potato sees an empty frame throughout.
The fallback behaves correctly; the gap is coverage, not correctness.

**W2 — `OIL_HYDROGENATED` is active and customer-selectable with no image.** Intentional
per Step 12C-2 (no sheet depicts it), but unlike `TEA_LOOSE` and `COFFEE_LOOSE` — which
are marked not customer-selectable — this one **is** offered to customers, so it shows a
placeholder in the live catalogue. Worth confirming whether that is intended.

**W3 — Catalogue images are not available offline and are soft at full size.** They are
correctly excluded from the service-worker precache (first load stays 376 KiB, not 36 MB),
but a PWA used offline shows placeholders for the whole catalogue. Separately, every
image was enlarged roughly five times from low-resolution source sheets. Both were
recorded at the time and neither has changed.

## 15. Blockers

**None.**

## 16. Open Business Decisions

**OIL PACK UNIT — unchanged, unresolved, reported only.**

Verified this run, read-only:

| Code | pack_size | pack_unit | entitlement unit | image shows |
|---|---|---|---|---|
| `OIL_SUNFLOWER_500` | 500.0000 | NULL | g | 500 ml |
| `OIL_SUNFLOWER_1000` | 1000.0000 | NULL | g | 1 Litre |
| `OIL_MUSTARD_500` | 500.0000 | NULL | g | 500 ml |
| `OIL_MUSTARD_1000` | 1000.0000 | NULL | g | 1 Litre |

Nothing was changed: not the unit, not `pack_size`, not `pack_unit`, not the image text.
No migration was created and no entitlement arithmetic was touched.

Two readings remain, and they are materially different. Either these packs really are
500 g and 1000 g and the images are worded wrongly, or the oil is sold by volume and the
catalogue is holding a volume in a gram-typed field — in which case the 80 g/day oil
entitlement is being counted in grams against a litre-based pack. Deciding between them
is a business question.

A regression test currently **pins** the stored values, so the discrepancy cannot be
closed quietly: any change to `pack_size`, `unit` or `pack_unit` on these four rows fails
the suite until the decision is made deliberately.

**Secondary note:** `pack_unit` is populated on exactly one provision in the entire dry
catalogue (Amul Ghee, "tin"). The field is available and administrable but essentially
unused. Whether the facility wants pack units recorded more widely is a related business
decision, not a defect.

## 17. Files Changed

**NONE.**

Verified by checksum rather than assertion:

- Source tree, 326 files (`.ts`, `.tsx`, `.sql`, `.json`, `.md`, `.js`, `.cjs` across
  `apps/`, `packages/`, `database/`, `docs/`) — **identical** before and after
- Catalogue images, 173 files — combined MD5 **identical** (`038cd4bc…`)
- `rik.provisions`, all 20 fields across all 189 rows — **identical**
- Migrations — 34 files, unchanged, none added
- Residual test data after the suite — **0 rows**

No schema change, no data change, no migration, no source change, no image change, no
RBAC change. Nothing was fixed during this run.

## 18. Final Recommendation

**READY FOR STEP 13 APPROVAL**

The audit found no blockers and no rule discrepancy. The three warnings are coverage and
delivery observations rather than defects, and the oil pack unit remains an open business
decision that is correctly isolated and guarded. Whether W1 and W2 become fix work is your
call to make separately.
