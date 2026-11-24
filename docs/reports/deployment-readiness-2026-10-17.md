# Deployment readiness — known concerns

17 October 2026. **Documented, not changed.** No security setting was
altered, no permission granted, no credential rotated, no configuration file
edited.

Each item says what is true, what it breaks, and the smallest safe fix —
for you to approve and carry out.

---

## 1. `demo-bootstrap.cjs` drops and recreates the database

**Severity: highest.** It is one short command that looks harmless and
destroys every order on the machine it runs against. It restores
`database/demo/esamagri-demo-db.sql.gz` over whatever is there.

It is the reasonable-looking thing for a helper to run when something seems
wrong on the server.

**Fix:** do not ship it to the server at all, or rename it on the server to
something that cannot be run by reflex. If it must stay, it should refuse to
run unless an explicit environment variable is set. **Verified in this
container by reading the script, not by running it.**

## 2. Vite bakes `VITE_API_BASE_URL` into the bundle at build time

The customer and admin apps are compiled with the API address inside them.
On the server the API will not be at `localhost:3000`.

**Editing `.env` on the server does not change a bundle that is already
built.** The app will load and every request will fail.

**Fix:** set the address, then run `npm run build -w @esamagri/customer-web`
and the admin equivalent, in that order. Confirmed by reading
`demo-start.cjs`'s rebuild check, which looks at `index.html`, `.env`
freshness and whether the bundle carries the variable — **adding files under
`public/` does not trigger it**.

## 3. `CORS_ALLOWED_ORIGINS` must list the real origins

Same failure shape as above: pages render, requests are refused. It must
contain the exact scheme, host and port the browser uses.

## 4. The admin console binds to loopback only

`demo-start.cjs` starts the customer app on `0.0.0.0` (the LAN change of 12
October) and deliberately leaves the admin console on localhost. **On a
server, staff on other machines cannot reach the admin console at all.**

**Fix:** a deliberate decision, not an oversight to patch quietly. Exposing
an admin console on a network is a security choice — it should be bound only
behind whatever access control you intend, and I have not changed it.

## 5. Demo credentials and a fixed OTP

`demo_rik_admin` with a known password, and OTP `123456`. Fine in a demo on
one laptop. Not fine on a network anyone can reach.

**Fix:** real staff accounts before the server is reachable by anyone else.
I have not created, changed or granted any account.

## 6. OTP is limited to 5 requests an hour

`OTP_REQUEST_MAX_PER_WINDOW=5`, `OTP_REQUEST_WINDOW_SECONDS=3600`. A handover
demo with several sign-ins will lock out and return `OTP_RATE_LIMITED`.

This is **correct behaviour that looks like a broken app** in front of an
audience. Worth knowing before the room watches it happen; not worth
weakening.

## 7. The demo admin account cannot open the PIF screens

`demo_rik_admin` holds `RIK_ADMIN` only. Grocery orders and Product catalogue
both answer *"You do not have access to this area."* The screens are built
and routed; the role is the blocker.

**This blocks any demonstration of PIF administration, and it blocks the
catalogue import**, since the import runs through those screens.

**Fix:** a PIF-capable account. **I have not granted any permission** — doing
so silently is exactly what your brief forbids.

## 8. The service worker can serve a stale bundle

The customer app ships a PWA. After deploying a new build, a browser that
already has the old service worker may keep serving the old JavaScript. This
looks precisely like "the fix did not work".

**Fix:** a hard refresh clears it on a given device. On the server, confirm
the new asset filename is being served before concluding anything is broken.

## 9. Rehearsal products appear in the catalogue

Two `Rehearsal Sugar 1 kg` and two `Rehearsal Toor Dal 1 kg`, duplicated, in
Pulses, with no pack size. They are visible to shoppers today and referenced
by two order lines, so they cannot simply be deleted.

**Fix:** handled by migration 0055 without deleting anything — they receive
no business and therefore stop appearing, while keeping their history. Needs
your approval of that design.

## 10. Image licensing

Three PIF **category** photographs show third-party packaging — Lay's,
Kurkure, Oreo, Sunfeast; Tata Tea, Nescafé; Surf Excel — with no verified
licence. For a private company's product this is a real exposure, not a demo
nicety.

The **six business logos and five menu images** supplied by the client are a
different matter: they are the businesses' own artwork, provided for this
purpose. They are used unmodified and each sits only under its own business.

**Fix:** replace the three category images or obtain written permission.
Replacing them is a drop-in — the database stores a path, not pixels.

## 11. Product photographs

All 25 PIF products have `image_ref` NULL. Every product tile shows a grey
placeholder. No photograph has been invented or substituted.

---

## Deployment checklist

- [ ] Full `pg_dump` taken and its size checked
- [ ] `demo-bootstrap.cjs` removed from, or disarmed on, the server
- [ ] `VITE_API_BASE_URL` set, then **both** apps rebuilt
- [ ] `CORS_ALLOWED_ORIGINS` lists the real origins
- [ ] Admin console binding decided deliberately
- [ ] Real staff accounts created; demo credentials disabled
- [ ] A PIF-capable admin account exists
- [ ] New asset filename confirmed served, and a hard refresh tested
- [ ] Migration 0055 design approved (separate document) — **not yet written**
- [ ] Category image licensing resolved
