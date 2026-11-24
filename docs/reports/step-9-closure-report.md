# e Samagri — Phase 3B — STEP 9 Final Closure Report

**Customer Profile + Core Customer Application Foundation**
Base Victualling Yard, Visakhapatnam
Verification date: 16 September 2026
Status: **All STEP 9 acceptance criteria pass — awaiting your formal approval**

---

## ⚠ One line in your checklist cannot be confirmed

Your Section 3 checklist asks me to confirm **"Step 10 has not started."**

**I cannot confirm that line, because it is not true.** After the STEP 9 report was
delivered, you issued the kickoff *"e SAMAGRI — PHASE 3B — STEP 10 ADMIN & STAFF
APPLICATION FOUNDATION"*, and STEP 10 was implemented and reported to you on 12
September 2026. It is complete and itself awaiting your review.

I have flagged this rather than tick the box, in case this verification request was
re-sent from before that kickoff. **Everything else in your checklist is confirmed
below**, and STEP 10 changed nothing in the STEP 9 surface — evidence in Section D.

---

## A. STEP 9 acceptance criteria

**All pass.** Customer profile read and update on the frozen schema, server-resolved
identity, ownership enforcement, the five UI states, and the approved customer
application foundation are all in place and covered by tests.

---

## B. Exact test counts

| Suite | Files / Suites | Tests | Result |
|---|---|---|---|
| Backend — all (`apps/api`) | 15 | 198 | ✅ pass |
| — of which STEP 9 customer module | 1 | **20** | ✅ pass |
| — of which STEP 6/7 auth + RBAC | 9 | **116** | ✅ pass |
| Frontend — customer app (STEP 9) | 4 | **31** | ✅ pass |
| `packages/config` | 2 | 12 | ✅ pass |
| Frontend — admin console (STEP 10) | 7 | 58 | ✅ pass |
| **Total** | **28** | **299** | ✅ **0 failures** |

---

## C. Build / typecheck / lint

| Check | Scope | Result |
|---|---|---|
| `npm run typecheck` | all 5 workspaces | ✅ clean |
| `npm run lint` | all workspaces, `--max-warnings=0` | ✅ clean, zero warnings |
| `npm run build` | production builds | ✅ succeeded |

---

## D. Database status

Verified against `pg_catalog` (not `information_schema`, which hides tables the
application role lacks grants on):

| Item | Required | Actual | |
|---|---|---|---|
| Tables (`shared`, `rik`, `pif`) | 47 | **47** | ✅ |
| Views | 5 | **5** | ✅ |
| Migration files | 24 | **24** | ✅ |
| Migrations added | 0 | **0** | ✅ |
| Schema changes | 0 | **0** | ✅ |
| Roles | 6 | **6** | ✅ |
| Permission codes | 20 | **20** | ✅ |
| SECURITY DEFINER functions | unchanged | **6** | ✅ |

**Step 6 authentication and Step 7 RBAC unchanged.** Every file under
`apps/api/src/auth` still carries its 11 September timestamp — nothing in that tree
has been modified since STEP 7 closed. Their 116 tests pass unchanged.

---

## E. Security and ownership verification

The STEP 9 customer suite proves, against the real database:

- No token → **401** on `GET /customer/me`, `GET /customer/:id`, `PATCH /customer/me`
- Garbage or expired token → **401**, not 403
- Customer A requesting customer B's profile by id → **403**
- That 403 body is generic — it never reveals whether the other customer exists
- A deactivated customer → **404**, never another customer's data
- A STAFF principal → **403** on customer-owned profile routes

The browser never holds a customer id: the app calls `/customer/me` and the server
resolves identity from the verified access token. `PATCH` runs through
`ValidationPipe({ whitelist, forbidNonWhitelisted })`, so an unexpected field is
rejected rather than silently ignored.

---

## F. No business decisions were invented

Confirmed. No RIK entitlement quantity, substitution, conversion ratio, pooling rule,
pickup location, collection timing, delivery eligibility or NOT_COLLECTED rule; no PIF
category, subcategory, product, price, delivery charge, minimum order, delivery window
or tax rule appears anywhere in the shipped application.

**BD-1 through BD-7 are untouched**, and the authoritative register at
`docs/open-decisions.md` is unmodified.

**No fake fixtures.** `apps/customer-web/src/lib/dev-fixtures/` does not exist and no
call site supplies fallback data — every one passes `undefined`, so an unbuilt module
renders an honest state rather than invented content.

**Asset decisions:** AS-1 **closed** (12 Sep 2026), AS-2 **open**, AS-3 **open** — all
exactly as recorded, none altered.

---

## G. RIK entitlement remains pending

Verified both in the source and at runtime against the production build.

The RIK customer area shows a single honest pending-confirmation panel:

> **Your entitlement** — Entitlement details are not available yet. Your household's
> ration scale is still being confirmed by the facility. Once it is, this section will
> show what you are allowed, what has been issued, what is reserved and what remains.

A runtime sweep of six RIK customer routes (`/rik`, `/rik/cart`, `/rik/orders`,
`/rik/search`, `/rik/categories/:id`, `/rik/products/:id`) confirms **zero** of the
following appear anywhere:

| Prohibited | Found |
|---|---|
| Entitlement quantities | **none** |
| Progress bars / scales / meters / percentages | **none** (no `<progress>`, `<meter>` or `role="progressbar"` element exists in the app at all) |
| Handwritten / draft entitlement values | **none** |
| Invented ratios | **none** |
| Pooling rules | **none** |

**One thing you should know, stated plainly:** a presentation-only component,
`design-system/EntitlementCard.tsx`, exists from STEP 8. It was written against the
kickoff's field list and renders whatever it is given — it hardcodes no value, contains
no progress bar by explicit design, and holds no ratio or pooling logic. It is
currently **unreachable**: the only thing that could populate it is the RIK catalogue
endpoint, which does not exist, and there are no fixtures. So it displays nothing
today. I have left it exactly as it is rather than change STEP 9 code at an approval
gate; say the word if you would prefer it removed until BD-1/BD-2/BD-3 are settled.

BD-1, BD-2 and BD-3 are unchanged.

---

## H. BD-8 — documented only, not implemented

Recorded here, and **only** here, exactly as you directed:

> **NEW BUSINESS DECISION REQUIRED** — proposed/open item surfaced during STEP 9:
> Policy for changing the mobile number that is also the customer's authentication
> identity.

Confirmed:

- **The authoritative Open Decisions Register is unmodified.** `docs/open-decisions.md`
  holds BD-1…BD-7, DR-1, DR-2, AS-1, AS-2, AS-3 — and no BD-8.
- **No policy has been invented.** Nothing states who may approve a change, what proof
  is required, or whether it is permitted at all.
- **No mobile-number change workflow exists** anywhere in the codebase — no endpoint,
  no service method, no screen, no form.
- **The mobile number is read-only** in the profile screen (`readOnly disabled`), with
  the neutral hint: *"Your mobile number is how you sign in. Contact the facility to
  change it."*
- **The server refuses it structurally**: `mobileNumber` is absent from
  `UpdateCustomerProfileDto`, and `forbidNonWhitelisted` means a request carrying it is
  rejected outright rather than ignored.

---

## I. Stop boundary

- ❌ RIK entitlement engine — not started
- ❌ PIF commerce engine — not started
- ❌ No migration created; no schema change of any kind
- ❌ Step 6 authentication untouched
- ❌ Step 7 RBAC untouched
- ❌ Open Decisions Register unmodified
- ⚠️ **Step 10 — started and completed on 12 September 2026, on your kickoff.** See the
  note at the top of this report and `docs/reports/step-10-report.md`.

**Awaiting your formal approval of STEP 9 closure.**
