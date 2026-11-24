# e Samagri — Open Decisions Register

Three registers. Nothing here may be guessed, derived from informal material, or hardcoded
into production logic. Work that depends on an open item stops at the boundary and is
reported, not improvised.

**Issued:** 12 September 2026 (STEP 8 requirements correction).

**Status:** companion to `product-specification.md`, which the client ratified on 12 September 2026 as authoritative. Binding for all remaining implementation phases.

---

## 1. BUSINESS_DECISION_REQUIRED

Client decisions needed before the dependent module can be implemented.

### BD-1 — Per-person RIK entitlement scale
**Blocks:** RIK-3 (entitlement-aware selection), the whole RIK entitlement engine.
**What is needed:** the approved entitlement quantity per item or per category, per entitled
person/category of person, and the period it applies to.
**Explicitly not to be done:** the handwritten entitlement material seen earlier is *not*
approved production data. It must not be transcribed into code, fixtures, seed data or
migrations. Until BD-1 is confirmed, all entitlement figures anywhere in the system are
clearly-labelled placeholders.

### BD-2 — Conversion and substitution ratios; approved alternatives
**Blocks:** RIK-3a, RIK-3b.
**What is needed:** which items may substitute for which, at what ratio, under what
conditions, and who authorises a substitution.
**Explicitly not to be done:** no ratio is to be inferred, estimated or carried over from any
draft. An uncertain ratio is not implemented at all.

### BD-3 — Category pooling rules
**Blocks:** RIK-3c, and the data model decision behind it.
**What is needed:** whether entitlement pools at category level (so items draw from a shared
category allowance) or is fixed per item, and where each behaviour applies.
**Note:** this decision may have schema consequences — see DR-1.

### BD-4 — RIK pickup location and collection instructions
**Blocks:** RIK-6a.
**What is needed:** the approved pickup point(s), collection window/timings, and the exact
instruction text to show the customer. Also whether delivery is available to all customers or
is restricted.

### BD-5 — NOT_COLLECTED policy
**Blocks:** RIK-7a.
**What is needed:** how long entitlement stays reserved for collection, what happens to
uncollected entitlement (returns to balance, lapses, carries forward), and who may reverse it.

### BD-6 — PIF catalogue taxonomy and delivery rules
**Blocks:** PIF-3a (final taxonomy), PIF-6 (delivery rules).
**What is needed:** the confirmed category/subcategory taxonomy to seed, delivery areas or
eligibility, any delivery charge or minimum-order rule, and delivery time windows.
**Note:** the 18 categories the client listed are treated as design examples, not as
confirmed production data.

### BD-7 — PIF pricing source
**Blocks:** PIF-4 (selling price display) in production.
**What is needed:** where facility selling prices come from, who maintains them, and whether
any tax or charge is shown separately at checkout. No price shown anywhere in the prototype is
real.

---

## 2. DATABASE_CHANGE_REQUIRED

The Phase 2 database — 47 tables, 5 views, 24 migrations — is frozen. Nothing below has been
changed; these are flagged risks to be assessed when the dependent phase starts, and each
would need separate written approval before any migration is written.

### DR-1 — Entitlement model expressiveness *(open risk, not yet a request)*
Once BD-1 and BD-3 are answered, the approved entitlement model must be checked against the
existing RIK schema. If category pooling or the final scale cannot be expressed by the
frozen tables, the work stops and a formal `DATABASE_CHANGE_REQUIRED` is raised then. No
assessment can be completed before BD-1/BD-3 exist.

### DR-2 — PIF subcategories *(open risk, not yet a request)*
PIF-3 requires categories *and* subcategories. Whether the frozen PIF category table supports
a parent/child hierarchy must be confirmed at the start of the PIF catalogue phase. If it does
not, this becomes a formal request at that point.

**Current status: no database change is being requested. No migration, table, view,
constraint or permission has been modified.**

---

## 3. ASSET_REQUIRED

Client-supplied assets needed to finish the approved visual design exactly, rather than
approximating it.

### AS-1 - Hero imagery from the approved UI reference - CLOSED (12 Sep 2026)
The client supplied the approved production hero banner on 12 September 2026. It is stored
unmodified at `apps/customer-web/public/brand/hero-home.png` (1842x854, MD5
`3bf2ed0615c718a918d47cc659e8c162`, byte-identical to the delivered file), with `.webp`
derivatives at 640/920/1200/1842 px that are uniform downscales only - no crop, no
recomposition. The development stand-in illustration has been removed from the codebase.

**Residual question (needs a decision, not blocking):** the asset is a single wide banner
(2.157:1). Used uncropped at phone width it renders about 358x166 px, so the headline inside
the artwork is small on a phone. Cropping is prohibited, so closing that gap needs either a
portrait/square mobile variant of the artwork from the client, or explicit approval of a
different mobile treatment. See the STEP 8 hero-integration report.

### AS-2 — Horizontal logo lockup for the app header
The supplied final logo is a square lockup containing emblem, wordmark, tagline and a row of
four feature icons. The approved UI reference's header shows a wide horizontal lockup — which
would be a crop of the square asset, and cropping the logo is prohibited. The prototype
therefore uses the full square asset scaled up, which reads well but renders the tagline and
feature icons small at header size. **Requested:** a horizontal header version of the logo as
a separate approved asset, or confirmation that the square asset as used is acceptable.

### AS-3 — PIF product imagery
PIF-4 requires a product image per SKU. No product photography has been supplied; the
prototype uses placeholder graphics. **Requested:** the image source and standards (dimensions,
background, naming) for ~3,000+ SKUs, and who supplies them.
