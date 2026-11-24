# e Samagri — Corrected Product Specification

**Status:** Authoritative. Supersedes the product-behaviour assumptions embedded in the
Phase 3A blueprint and in the STEP 8 prototype wherever the two disagree.

**Issued:** 12 September 2026, following the client's *STEP 8 — Major Product Requirements
Correction*.

**Client confirmation:** ratified by the client on 12 September 2026 as the AUTHORITATIVE PRODUCT REQUIREMENTS DOCUMENT, superseding any conflicting product-behaviour assumptions in the Phase 3A blueprint and the STEP 8 prototype. To be used together with `implementation-backlog.md` and `open-decisions.md` as the source of truth for all remaining implementation phases.

**Binding rule:** this document records requirements only. It does not invent business
data, entitlement values, conversion ratios, pickup locations or delivery rules. Every such
value is carried in `open-decisions.md` as `BUSINESS_DECISION_REQUIRED` until the client
confirms it. The Phase 2 database (47 tables, 5 views, 24 migrations) remains frozen; any
gap discovered while implementing this specification is raised as `DATABASE_CHANGE_REQUIRED`
and approved separately, never silently patched.

---

## 1. Purpose and reading order

e Samagri is a single customer application serving two operationally separate services for
Base Victualling Yard, Visakhapatnam, plus a staff/admin application governing them.

RIK (Ration in Kind) is an entitlement-driven ration issue system. PIF (Payment Issue Facility)
is a complete, universal grocery quick-commerce service. These are **not** two skins on one
engine: they differ in data, business rules, money handling and fulfilment, and the customer
experiences them as two distinct services reached from one home screen.

Later implementation phases consume this document together with `implementation-backlog.md`
(what gets built when) and `open-decisions.md` (what is still unknown).

---

## 2. Common application requirements

### 2.1 Natural scrolling (CR-1)

The customer application must support normal mobile scrolling throughout. No screen may be
constrained to an artificial fixed height that prevents the customer from reaching content.
Any screen whose content exceeds the viewport scrolls naturally, using the platform's own
scrolling behaviour. This applies to the production application and to any prototype or
design artefact representing it — a demonstration that hides content below an un-scrollable
fold misrepresents the product.

Fixed positioning is permitted only for genuine chrome (the app header and the bottom
navigation bar), and only where it does not clip or trap page content.

### 2.2 Platform (CR-2)

Mobile-first, Android-compatible, installable PWA. The layout adapts responsively across
Android screen sizes while preserving the same visual hierarchy; it is never a desktop
layout scaled down, nor a mobile layout that shrinks content to avoid scrolling.

### 2.3 Design authority (CR-3)

The final supplied e Samagri logo and the final supplied customer-app UI reference image are
the visual authority. The logo is used exactly as supplied — never recreated, redrawn,
recomposed or cropped. The hero section and overall home composition follow the approved
reference; arbitrary icons or generic placeholder artwork are not an acceptable substitute
for the approved composition. Where the reference contains imagery that has not been
supplied as a production asset, that asset is requested from the client rather than
approximated (see `open-decisions.md`, ASSET register).

### 2.4 Honest state (CR-4)

Every screen has designed loading, empty and error states. Placeholder content is never
presented as real production data, and unimplemented functionality is never made to look
implemented. Conversely, a prototype must still communicate the intended final product
structure accurately.

---

## 3. Customer application

### 3.1 Authentication (CUST-AUTH)

Mobile number, OTP verification, session, then the application. This uses the existing
STEP 6 authentication architecture and the STEP 7 authorisation model; no second
authentication mechanism is introduced, and no OTP success is ever simulated in production
paths.

### 3.2 Home (CUST-HOME)

The home screen presents the brand and the RIK/PIF choice as the primary decision, following
the approved UI reference: header with menu, centred logo and notifications; hero section;
the RIK and PIF module cards with their respective actions; quick actions; announcements;
and the bottom navigation (Home, Categories, Orders, Account). The module selector is always
prominent and never hidden inside a menu.

### 3.3 Module separation (CUST-SEP)

RIK and PIF maintain separate carts, separate order contexts, separate inventory contexts,
separate business rules and separate reports. Switching modules never carries the other
module's cart. Frontend separation is a user-experience guarantee; the backend remains
authoritative for the same separation.

---

## 4. RIK — Ration in Kind

### 4.1 Nature of the module (RIK-1)

RIK is a **customised ration system**, not a generic quick-commerce grocery store. The
customer's experience is shaped by their own entitlement, not by a general catalogue.

### 4.2 Category navigation (RIK-2)

RIK requires proper category navigation: RIK categories, category product listing, and
product details. Categories are administered data, not a fixed constant of the application.

### 4.3 Entitlement customisation (RIK-3)

RIK selection is entitlement-aware. The customer sees, per applicable item or category:
entitlement allowed, quantity issued, quantity reserved, and quantity remaining. Selection is
validated against remaining entitlement. Approved alternatives and substitutions are offered
where applicable, governed by conversion/substitution ratios and by category pooling where
the approved model calls for it.

The per-person entitlement scale, the conversion and substitution ratios, and the pooling
rules are **not finalised**. They are not to be invented, not to be derived from the
handwritten entitlement material, and not to be hardcoded into production logic. They are
configuration, sourced from approved data, and are tracked as `BUSINESS_DECISION_REQUIRED`.

Presentation note carried forward from the approved UI direction: entitlement is shown as
plain figures. No entitlement progress bar or entitlement scale graphic is to be built.

### 4.4 RIK has no commercial payment (RIK-4)

RIK items are issued against entitlement. RIK screens carry no prices, no payment method, no
totals due and no checkout payment step.

### 4.5 My RIK Orders (RIK-5)

The customer has a distinct **My RIK Orders** history, never merged into PIF order history.
It shows the order/request number, date, products, quantities, status, pickup or delivery
method, the relevant entitlement impact, and collection or delivery status.

### 4.6 Pickup or delivery (RIK-6)

RIK fulfilment requires an explicit customer choice between **Pickup** and **Delivery**.

When Pickup is selected, the approved pickup location and collection instructions are shown.
When Delivery is selected, a **delivery address is mandatory**: a delivery request cannot be
submitted without a valid delivery address.

The pickup location content, the collection instructions, the delivery eligibility rules and
any delivery restrictions are configurable business data. They are not invented; see
`open-decisions.md`.

### 4.7 RIK order status (RIK-7)

Confirmed → Ready for Pickup / Out for Delivery → Collected / Delivered, with a distinct
NOT_COLLECTED terminal state for entitlement issued but not collected within the applicable
window. The exact window and the consequences of NOT_COLLECTED are business configuration.

---

## 5. PIF — Payment Issue Facility

### 5.1 Nature of the module (PIF-1)

PIF is a **complete, universal grocery quick-commerce application**. It is not a simplified
RIK, and it is not a reduced catalogue. It should feel like a complete modern grocery
application built in e Samagri's own design system.

### 5.2 The full shopping journey (PIF-2)

PIF supports the whole journey, end to end:

Categories → Products → Product details → Add to Cart → Quantity → Cart → Checkout →
Delivery Address → Cash on Delivery → Order Confirmation → Order Status → My Orders.

No stage in that chain may be omitted from the product.

### 5.3 Category browsing (PIF-3)

PIF requires a proper category browsing experience with categories and subcategories.

Initial category examples supplied by the client: Dairy, Vegetables, Fruits, Drinks &
Beverages, Fresh Meat, Frozen, Snacks, Staples, Rice, Pulses, Flour, Spices, Cooking Oils,
Personal Care, Household, Bakery, Packaged Foods, Ice Cream.

These are **examples for design and navigation purposes only**. They are not permanently
hardcoded production data. The admin application must be able to add, edit and remove
categories and subcategories, and the final catalogue taxonomy is administered data.

### 5.4 Product experience (PIF-4)

Every purchasable PIF product supports: product image, product name, pack/unit, selling
price, availability, Add to Cart, quantity increase/decrease, and a product details view.
Add to Cart is never omitted.

### 5.5 Catalogue scale (PIF-5)

Product listings are designed for approximately 3,000+ SKUs, using pagination, server-side
search and lazy loading. The full catalogue is never loaded into the browser.

### 5.6 Delivery and payment (PIF-6)

PIF is a delivery-oriented grocery service. The customer provides or selects a delivery
address during checkout, and a **delivery address is mandatory for a PIF delivery order**.

Payment is Cash on Delivery only at this stage. No payment processing is simulated, and no
billing confirmation is fabricated.

No GPS or live map tracking is required.

### 5.7 Order confirmation (PIF-9)

Placing an order produces an explicit **Order Confirmation** stage — a distinct screen, not a
transient toast — carrying the order number, fulfilment method, delivery address where
applicable, payment method and amount due, with routes onward to the order history and back
to shopping. RIK's request submission produces the equivalent confirmation.

### 5.8 PIF order status (PIF-7)

Order Confirmed → Being Prepared → Ready/Picked → Out for Delivery → Delivered. These exact
labels are the customer-facing wording.

### 5.9 My PIF Orders (PIF-8)

The customer has a distinct **My PIF Orders** history with order number, date, items,
quantities, amount, payment method, status and delivery details.

---

## 6. Orders — separation rule (ORD-1)

The customer must be able to distinguish **My RIK Orders** from **My PIF Orders**
unambiguously. The two are never combined into a single ambiguous list. A combined "All
Orders" convenience view may be added later as an *addition*, but the module-specific
histories always remain available and remain the primary route.

---

## 7. Notifications, announcements and account

Notifications and announcements are reusable components supporting title, message, priority
(LOW / NORMAL / HIGH / URGENT), audience (ALL / RIK / PIF), optional date/time and dismissal,
with the backend authoritative for audience restriction. Customer account data is limited to
the approved fields — name, mobile number and quarter/residence — plus profile, orders, RIK
information, notifications and logout. No additional personal information is collected and no
defence-specific fields are invented.

---

## 8. Staff and admin application

The staff/admin application serves SUPER_ADMIN, RIK_ADMIN, PIF_ADMIN, CASHIER, DELIVERY and
PURCHASING roles under the existing STEP 7 RBAC, which remains backend-authoritative. Hiding
a control in the interface is never the security mechanism. Admin scope includes the
dashboard, products, categories and subcategories, inventory, orders, customers, reports,
announcements and settings, plus the PIF point-of-sale application.

Category and subcategory administration for both modules is a first-class admin requirement,
because the customer-facing taxonomies in this document are administered data.

---

## 9. Target product summary

Customer application: Authentication, Home, RIK, PIF, Categories, Products, Search, Product
Details, RIK Entitlement, RIK Customisation, My RIK Orders, PIF Cart, PIF Checkout, Delivery
Address, Cash on Delivery, My PIF Orders, Notifications, Announcements, Account.

Staff/admin application: SUPER ADMIN, RIK ADMIN, PIF ADMIN, CASHIER, DELIVERY, PURCHASING,
each under appropriate RBAC.

---

## 10. Status of the STEP 8 prototype

The STEP 8 prototype is a **UI/UX foundation and clickable design prototype**. It is not the
final production application and must not be represented as one. Its purpose is to
communicate the intended final product structure accurately and to establish the design
system; the business modules behind it are implemented in their designated later phases per
`implementation-backlog.md`.

Requirements in this document are therefore satisfied in two different senses, and the
backlog records which is which: *represented* in the prototype (structure and navigation
visible), and *implemented* in a later phase (real data and real business rules).
