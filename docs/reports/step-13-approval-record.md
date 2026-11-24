# STEP 13 — APPROVAL RECORD

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 13 — RIK Catalogue Final Customer Experience & Admin Verification |
| **Status** | **APPROVED / CLOSED** |
| **Approval date** | **23 September 2026** |
| **Approved by** | Client |
| **Nature of the step** | Verification-only audit |
| **Audit record** | `docs/reports/step-13-rik-final-verification-report.md` |

---

## 1. What this approval covers

Step 13 was a **verification-only audit**. It inspected and tested the RIK catalogue,
entitlement engine, customer experience, admin workflows and access control against the
approved business rules. It did not implement anything.

**No changes were made during the audit.** Verified by checksum rather than assertion:

| | |
|---|---|
| Application source code | **unchanged** — 326 files, identical before and after |
| Database schema | **unchanged** — 56 tables, 5 views |
| Database data | **unchanged** — `rik.provisions`, all 20 fields across all 189 rows, identical |
| Migrations | **unchanged** — 34 files, none added |
| Catalogue images | **unchanged** — 173 files, combined MD5 identical |
| RBAC | **unchanged** — 6 roles, 20 permissions |
| Tests | **unchanged** — none altered to make anything pass |

## 2. What the audit found

**No blockers.**

Every business rule stated in the Step 13 brief was checked against the live configuration
and matched exactly — daily scales, conversion ratios, dietary applicability, pool
separation, pack limits and eligibility conditions alike.

| Area | Result |
|---|---|
| Catalogue — Fresh Vegetables | PASS |
| Catalogue — Fresh Fruits | PASS |
| Catalogue — Dry | PASS |
| Image mapping | PASS |
| Know Your Ration — PV / EV / NV | PASS |
| Entitlement calculations | PASS |
| Split entitlement | PASS |
| Selection → Cart | PASS |
| Checkout and availability acknowledgement | PASS |
| Historical snapshot protection | PASS |
| RIK Admin | PASS |
| RBAC | PASS |
| API / database consistency | PASS |

**Regression at approval:** 773 tests passed, 0 failed. Typecheck clean. Lint clean
(`--max-warnings=0`). Production build successful.

## 3. Items explicitly ACCEPTED AS OPEN

The following were reviewed and **accepted as open** at approval. They are **not** defects
to be corrected under this approval, and **must not be changed** as part of it.

### W1 — Eleven active, customer-selectable provisions have no image
Fresh Milk · Milk TD / Milkmaid · Eggs · Chicken / Fowl · Fish · Meat · Onion ·
Garlic (Fresh) · Potato · Fresh Vegetables (in lieu of potato) · Dry Fruits

These pools were never in scope for an image step. The placeholder behaves correctly; the
gap is coverage, not correctness. **Status: OPEN. No action authorised.**

### W2 — `OIL_HYDROGENATED` is customer-selectable with no image
Intentionally without an image (no supplied sheet depicts it), but unlike `TEA_LOOSE` and
`COFFEE_LOOSE` it is offered to customers, so it displays a placeholder.
**Status: OPEN. No action authorised.**

### W3 — Catalogue images are outside the PWA offline precache, and some are soft
The precache deliberately carries the app shell only, so a first visit stays at ~376 KiB
rather than ~36 MB; the consequence is that the catalogue is not browsable offline.
Separately, the images were enlarged from low-resolution source sheets.
**Status: OPEN. No action authorised.**

### Oil pack-unit discrepancy — BUSINESS DECISION, OPEN
Affected provisions: `OIL_SUNFLOWER_500`, `OIL_SUNFLOWER_1000`, `OIL_MUSTARD_500`,
`OIL_MUSTARD_1000`.

| Code | `pack_size` | `pack_unit` | entitlement unit | image displays |
|---|---|---|---|---|
| `OIL_SUNFLOWER_500` | 500.0000 | NULL | g | 500 ml |
| `OIL_SUNFLOWER_1000` | 1000.0000 | NULL | g | 1 Litre |
| `OIL_MUSTARD_500` | 500.0000 | NULL | g | 500 ml |
| `OIL_MUSTARD_1000` | 1000.0000 | NULL | g | 1 Litre |

Two readings remain and they are materially different. Either these packs really are 500 g
and 1000 g and the images are worded wrongly, or the oil is sold by volume and the
catalogue is holding a volume in a gram-typed field — in which case the 80 g/day oil
entitlement is being counted in grams against a litre-based pack.

**Status: OPEN, awaiting client business confirmation.**

**Not authorised under this approval:** changing `pack_size`, changing `unit`, changing
`pack_unit`, changing the image text, creating a migration, or altering entitlement
arithmetic.

A regression test currently pins the stored values of these four rows, so the discrepancy
cannot be closed silently: any change to `pack_size`, `unit` or `pack_unit` on them fails
the test suite until the decision is taken deliberately.

## 4. Scope of this approval

Approval of Step 13 is **approval of the audit and its findings**. It is **not**
authorisation to correct the open items above.

Not started, and not authorised by this record: Step 13A · Step 14 · PIF · any fix for
W1, W2 or W3 · any oil correction · any migration.

---

**Recorded:** 23 September 2026
**Step 13 status:** APPROVED / CLOSED
