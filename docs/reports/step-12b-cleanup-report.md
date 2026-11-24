# STEP 12B-CLEANUP — RETIRE GENERIC FRESH CATALOGUE PLACEHOLDERS

**e Samagri · Base Victualling Yard, Visakhapatnam**
**Module:** RIK (Ration in Kind)
**Status:** complete, awaiting approval
**Date:** 23 September 2026

---

## 1. Exact records retired

Two, and only two:

| Code | Name | Pool | Before | After |
|---|---|---|---|---|
| `VEG_FRESH` | Fresh Vegetables | VEGETABLES | active | **retired (inactive)** |
| `FRUIT_FRESH` | Fresh Fruits | FRUITS | active | **retired (inactive)** |

Both rows are still present. Nothing was deleted, renamed, re-pooled or
otherwise altered — the only field that moved on either row is `is_active`,
from true to false.

The full provision table was dumped before and after and compared field by
field. The entire difference is two lines, and in each the only changed value
is the active flag:

```
FRUIT_FRESH|Fresh Fruits|…|FRESH|10||f|t||||t|2026-01-01||-      (before)
FRUIT_FRESH|Fresh Fruits|…|FRESH|10||f|t||||f|2026-01-01||-      (after)

VEG_FRESH|Fresh Vegetables|…|FRESH|10||f|t||||t|2026-01-01||-    (before)
VEG_FRESH|Fresh Vegetables|…|FRESH|10||f|t||||f|2026-01-01||-    (after)
```

Name, brand, pack size, pack unit, unit, consumption ratio, pool, issue period,
display order, dietary preference, loose flag, customer-selectable flag, all
three limits, effective dates and `image_ref` are unchanged on both rows. Every
other row in the table is byte-identical.

---

## 2. How they were retired — through the Admin workflow

**No SQL was used for this business operation.** It was carried out the way an
administrator would carry it out, through the running application:

1. **Staff login.** A real session was opened at `POST /auth/staff/login` as
   `demo_rik_admin`, with a username and password. The request went through the
   ordinary staff authentication and returned an access token for a STAFF
   principal holding the RIK_ADMIN role.

2. **SKU Master listing.** `GET /admin/rik/config/provisions` — the call the
   SKU Master screen makes when it loads — was used to locate the two rows and
   read their ids, exactly as the screen does. Both showed as
   `active=True selectable=True` at that point.

3. **The Retire action, twice.** The SKU Master screen's **Retire** button calls
   `setProvisionActive(id, false)`, which is
   `POST /admin/rik/config/provisions/:id/active` with `{"isActive": false}`.
   That endpoint was called once for each row:

   ```
   POST /admin/rik/config/provisions/01a0ccc1-17b9-74e6-8f54-1be604fc2a46/active
        {"isActive": false}      ->  VEG_FRESH   isActive = False
   POST /admin/rik/config/provisions/01a0ccc1-17b9-7467-8c25-a23cb4caaa6a/active
        {"isActive": false}      ->  FRUIT_FRESH isActive = False
   ```

   Each request passed through the full chain the application always uses:
   `JwtAuthGuard` → `AuthorizationGuard` (permission `rik.product.manage`,
   RIK_ADMIN-exclusive) → controller → service → repository. No existing
   permission was changed and no new one was created.

4. **Audit trail.** Because it went through the workflow rather than the
   database, the change is in the Rule History screen, attributable to the
   person who made it:

   ```
   RIK_CONFIG_PROVISION_UPDATED | VEG_FRESH   | isActive True -> False
       by Demo RIK ADMIN (RIK_ADMIN) at 2026-09-23 17:52:52.254892+00
   RIK_CONFIG_PROVISION_UPDATED | FRUIT_FRESH | isActive True -> False
       by Demo RIK ADMIN (RIK_ADMIN) at 2026-09-23 17:52:52.308664+00
   ```

**On terminology:** the SKU Master screen labels this action **Retire** (and
offers **Restore** on an inactive row), and the underlying field is `is_active`.
They are the same operation — the screen's word for the flag. The existing
terminology was used as-is; nothing was renamed.

**Reversible.** Retirement is a flag, not a deletion. Either row can be brought
back from the same screen with **Restore**, and its history, name and
configuration are all intact.

---

## 3. Active Fresh Vegetable count

**44.**

| | |
|---|---|
| Rows in the VEGETABLES pool | 45 |
| Active | **44** |
| Active **and** customer-selectable | **44** |
| Retired | 1 (`VEG_FRESH`) |

All 44 are the named client varieties. Verified from the customer entitlement
API, not only from the table: the vegetable category offers exactly 44
provisions, every code begins `VEG_`, none is named "Fresh Vegetables", and
`VEG_FRESH` appears neither among the offered items nor among the withheld ones
— a retired provision leaves the catalogue entirely rather than showing up with
a reason.

---

## 4. Active Fresh Fruit count

**26 named fresh varieties**, plus Dry Fruits.

| | |
|---|---|
| Rows in the FRUITS pool | 28 |
| Active | **27** |
| Named fresh varieties, active and selectable | **26** |
| `FRUIT_DRY` (Dry Fruits), active and selectable | 1 |
| Retired | 1 (`FRUIT_FRESH`) |

**Please read the 27 carefully — it is correct, not a miscount.** The fruit
category shows a customer **27** items: the 26 named fresh varieties plus
**Dry Fruits**, which you asked to keep active and which is a provision in its
own right rather than a placeholder. It shares the fruit pool, so it is listed
with them. Excluding it, the named fresh count is exactly 26.

Verified from the customer entitlement API: `FRUIT_FRESH` appears neither among
the offered items nor the withheld ones; the offered list is 27 long; removing
`FRUIT_DRY` leaves exactly 26, none of them named "Fresh Fruits".

---

## 5. FRUIT_DRY remains active — confirmed

| Code | Name | `is_active` | `is_customer_selectable` |
|---|---|---|---|
| `FRUIT_DRY` | Dry Fruits | **true** | **true** |

Untouched, and it is still offered to customers wherever the fruit category is
offered. It was never a candidate for retirement: it is a real provision, not a
generic stand-in.

---

## 6. No records were deleted — confirmed

| | Before | After |
|---|---|---|
| Rows in `rik.provisions` | 189 | **189** |
| `VEG_FRESH` present | yes | **yes**, inactive |
| `FRUIT_FRESH` present | yes | **yes**, inactive |

The endpoint used cannot delete: the admin API offers no DELETE route for a
provision at all, and a `DELETE` request to one returns 404. Retirement is the
only removal the system provides, by design — confirmed selections point at
provisions by id, so a deleted row would orphan history.

Neither placeholder was referenced by any confirmed selection line
(checked: 0 rows), so no historical record was touched even indirectly.

### Nothing else changed

| | Before | After |
|---|---|---|
| Entitlement pools | 18 | **18**, byte-identical |
| Pool scales | 50 | **50**, byte-identical |
| Conversions | 7 | **7**, byte-identical |
| Provisions with a picture | 70 | **70** |
| Roles / Permissions | 6 / 20 | **6 / 20** |
| VEGETABLES daily scale | 170 g/day | **170 g/day** |
| FRUITS daily scale | 230 g/day | **230 g/day** |

No entitlement calculation changed, no pool changed, no conversion changed, and
no historical selection changed.

---

## 7. Test result

**759 passed, 0 failed.**

| Workspace | Suites / files | Tests |
|---|---|---|
| `@esamagri/api` | 22 | **550** |
| `@esamagri/customer-web` | 6 | **105** |
| `@esamagri/admin-web` | 8 | **92** |
| `@esamagri/config` | 2 | **12** |
| **Total** | **38** | **759 passed, 0 failed** |

Added by this cleanup: **+6** regression tests (STEP 12B closed at 753). They
sit in `apps/api/src/rik/rik-fresh-images.integration.spec.ts`:

1. Both records still exist, keep their names, and are inactive.
2. `FRUIT_DRY` was left active — it is a real provision, not a placeholder.
3. Nothing was deleted — the catalogue still holds every row it did (189).
4. The customer is offered the 44 named vegetables and no generic entry.
5. The customer is offered the 26 named fruits, plus Dry Fruits, and no generic entry.
6. Retiring them changed no pool, no scale and no conversion.

The RIK catalogue suites specifically — STEP 11B engine, 11C admin config,
11D Know Your Ration, 11E checkout, 12A catalogue foundation and 12B images —
all pass unchanged. No existing test needed editing, which is itself worth
noting: nothing in the system depended on those two placeholders being
selectable.

---

## 8. Typecheck result

**Clean.** `tsc --noEmit` on `api`, `admin-web` and `customer-web` — no errors.

## 9. Lint result

**Clean.** `npm run lint` across all workspaces with `--max-warnings=0` — exit 0,
no errors, no warnings.

## 10. Build result

**Success.** `npm run build` across all workspaces. The customer PWA precache is
unchanged at 9 entries / 375.54 KiB.

---

## One thing that needs your decision

**This retirement exists as data in the working database, not in a migration.**

That is a direct consequence of doing it the way you asked — through the Admin
workflow rather than SQL — and it is the right way to have done it: the action
is attributable, audited and reversible from the screen, which a migration would
not be. But it means:

- A database rebuilt from migrations alone will have `VEG_FRESH` and
  `FRUIT_FRESH` **active again**, because migrations 0032 and 0033 create them
  active and nothing afterwards retires them.
- The six new regression tests will then fail. That failure is deliberate and
  self-explanatory (the test file says so in a comment), but it will look like a
  broken build to whoever hits it.

Every other environment therefore needs the same two clicks. There are two ways
to close this, and it is a decision for you rather than for me:

**(a) Repeat the action in each environment.** An administrator opens RIK Admin
→ SKU Master, filters to the pool, and clicks **Retire** on the two rows. Two
minutes, fully audited in that environment, consistent with treating this as a
business operation.

**(b) Add a migration that sets the flag.** Reproducible and automatic, but it
records the change as a deployment step with no administrator behind it, and it
contradicts the instruction that this be a business operation rather than SQL.

**My recommendation is (a)** for correctness of the audit trail, with one
addition: note the two clicks in the deployment runbook
(`docs/DEMO-RUNBOOK.md`) so nobody has to rediscover them. I have not edited the
runbook, because that was not in scope for this cleanup — say the word and it is
a one-line change.

---

## STOP

**STEP 12B-CLEANUP is complete and stops here**, as instructed.

**Step 12C Dry Catalogue Image Integration has NOT been started.** No entitlement
logic was changed, no catalogue structure was modified, and no new SKU was
created. Awaiting your approval.
