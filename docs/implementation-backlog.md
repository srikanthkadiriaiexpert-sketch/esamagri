# e Samagri — Architecture & Implementation Backlog

**Purpose:** carries every requirement in `product-specification.md` into a designated
implementation phase, so nothing corrected at STEP 8 is lost when later phases begin.

**Issued:** 12 September 2026, from the client's *STEP 8 — Major Product Requirements
Correction*.

**Status:** companion to `product-specification.md`, which the client ratified on 12 September 2026 as authoritative. Binding for all remaining implementation phases.

**Discipline rule (client-set):** STEP 8 does not attempt to implement the missing business
functions. STEP 8 corrects the specification, records the backlog, and keeps the prototype as
a visual foundation. The business modules are built in their designated later phases.

## How to read the status column

- **Represented (STEP 8)** — structure and navigation exist in the prototype / frontend
  shell; no real business logic behind it.
- **Backlog (STEP n)** — not built; assigned to the named phase.
- **Blocked** — cannot be built until a `BUSINESS_DECISION_REQUIRED` item in
  `open-decisions.md` is answered.

Phase numbering follows the approved Phase 3B/3C implementation sequence. Where a phase is
named as a range, the exact step is fixed when that phase is kicked off.

---

## A. Common application

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| CR-1 | Natural mobile scrolling; no artificial fixed-height screen | Represented (STEP 8) — prototype corrected | STEP 8 + all later UI |
| CR-2 | Mobile-first Android-compatible responsive PWA | Represented (STEP 8) | STEP 8 |
| CR-3 | Final logo + approved UI reference are the design authority | Represented (STEP 8) | STEP 8 |
| CR-4 | Loading / empty / error states; no fake data, no fake functionality | Represented (STEP 8) | Every phase |

## B. Customer — authentication, home, separation

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| CUST-AUTH | Mobile → OTP → session, on existing STEP 6 architecture | Implemented (STEP 6) + represented in UI | Done / STEP 8 UI |
| CUST-HOME | Home per approved reference; RIK/PIF selector always prominent | Represented (STEP 8) | STEP 8 |
| CUST-SEP | Separate RIK/PIF carts, orders, inventory, rules, reports | Represented (STEP 8, frontend) | Backend in RIK/PIF module phases |

## C. RIK — Ration in Kind

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| RIK-1 | RIK treated as customised ration system, not quick-commerce | Represented (STEP 8) | RIK module phase |
| RIK-2 | RIK categories → category listing → product details | Represented (STEP 8) | RIK catalogue phase |
| RIK-3 | Entitlement-aware selection: allowed / issued / reserved / remaining | Represented (STEP 8, placeholder figures) | **Blocked** → BD-1, BD-2, BD-3 |
| RIK-3a | Approved alternatives and substitutions | Represented (STEP 8, text only) | **Blocked** → BD-2 |
| RIK-3b | Conversion / substitution ratios | Not built | **Blocked** → BD-2 |
| RIK-3c | Category pooling where applicable | Not built | **Blocked** → BD-3 |
| RIK-3d | Entitlement shown as figures; no progress bar / scale graphic | Represented (STEP 8) | STEP 8 |
| RIK-4 | No prices, no payment, no totals anywhere in RIK | Represented (STEP 8) | Enforced every phase |
| RIK-5 | **My RIK Orders** — request number, date, products, quantities, status, method, entitlement impact, collection status | Represented (STEP 8, all fields) | RIK order engine phase |
| RIK-6 | Explicit Pickup / Delivery choice | Represented (STEP 8) | RIK order engine phase |
| RIK-6a | Pickup → show approved pickup location + instructions | Structure only | **Blocked** → BD-4 |
| RIK-6b | Delivery → delivery address mandatory; cannot submit without it | Represented (STEP 8, validated in UI) | RIK order engine phase |
| RIK-7 | Status: Confirmed → Ready/Out for Delivery → Collected/Delivered, + NOT_COLLECTED | Represented (STEP 8) | RIK order engine phase |
| RIK-7a | NOT_COLLECTED window and consequences | Not built | **Blocked** → BD-5 |

## D. PIF — Payment Issue Facility

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| PIF-1 | PIF is a complete universal grocery quick-commerce app | Represented (STEP 8) | PIF module phases |
| PIF-2 | Full journey: categories → … → order status → my orders | Represented (STEP 8) | PIF module phases |
| PIF-3 | Categories **and subcategories**, admin-managed | Categories represented; subcategories not yet | PIF catalogue phase |
| PIF-3a | Seed taxonomy from the 18 client-supplied examples, not hardcoded | Represented as example data only | PIF catalogue + admin phase |
| PIF-4 | Product: image, name, pack/unit, price, availability, Add to Cart, qty ± , details | Represented (STEP 8; availability states shown, images are placeholders) | PIF catalogue phase |
| PIF-5 | ~3,000+ SKUs via pagination / server-side search / lazy loading | Architecture in place; not load-tested | PIF catalogue phase |
| PIF-6 | Delivery address mandatory at checkout | Represented (STEP 8, validated in UI) | PIF order engine phase |
| PIF-6a | Cash on Delivery only; no simulated payment | Represented (STEP 8) | PIF order + cash phase |
| PIF-6b | No GPS / live map tracking required | N/A — explicitly out of scope | — |
| PIF-7 | Status: Order Confirmed → Being Prepared → Ready/Picked → Out for Delivery → Delivered (exact labels) | Represented (STEP 8) | PIF order engine phase |
| PIF-9 | Explicit Order Confirmation screen (number, method, address, payment, amount) | Represented (STEP 8) | PIF order engine phase |
| PIF-8 | **My PIF Orders** — order number, date, items, quantities, amount, payment, method, status | Represented (STEP 8, all fields) | PIF order engine phase |

## E. Orders separation

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| ORD-1 | My RIK Orders and My PIF Orders never merged into one ambiguous list | Represented (STEP 8) | All order phases |
| ORD-2 | Optional combined "All Orders" view as a later *addition* only | Not built — deliberately deferred | Post-MVP, optional |

## F. Notifications, announcements, account

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| NOT-1 | Announcement: title, message, priority, audience, date, dismissal | Represented (STEP 8) | Announcements module phase |
| NOT-2 | Backend authoritative for audience restriction | Not built | Announcements module phase |
| ACC-1 | Account limited to name, mobile, quarter/residence + profile/orders/RIK info/notifications/logout | Represented (STEP 8) | Customer profile phase |

## G. Staff / admin

| ID | Requirement | Status | Phase |
|----|-------------|--------|-------|
| ADM-1 | Role-aware shells for SUPER_ADMIN, RIK_ADMIN, PIF_ADMIN, CASHIER, DELIVERY, PURCHASING | Not built | STEP 10 (admin shell) |
| ADM-2 | Category/subcategory administration for RIK and PIF | Not built | Admin catalogue phase |
| ADM-3 | Dashboard, products, inventory, orders, customers, reports, announcements, settings | Not built | Admin module phases |
| ADM-4 | PIF POS shell (scanner area, search, cart, bill, cash, change, print) | Not built | POS phase |
| ADM-5 | RBAC remains backend-authoritative; UI hiding is never the control | Implemented (STEP 7) | Done — enforced onward |

---

## Notes carried into later phases

Nothing in this backlog authorises a change to the frozen Phase 2 database. If implementing
any row above turns out to require schema that the 47 tables / 5 views / 24 migrations cannot
express — the most likely candidates being the final entitlement model (RIK-3) and PIF
subcategories (PIF-3) — the work stops and is reported as `DATABASE_CHANGE_REQUIRED` in
`open-decisions.md` for separate approval.
