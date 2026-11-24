# Common Customer Experience — Phases 1-4

Target: C:\esamagri\staging-esamagri-app

INDEPENDENT OF the pending Fresh/Dry package (fresh-dry.zip). No file appears
in both, so they can be applied in either order.

## Apply

```powershell
Expand-Archive -Path "$HOME\Downloads\common-ux.zip" -DestinationPath "C:\esamagri\staging-esamagri-app" -Force
```

## Then run and send me the real output

```powershell
cd C:\esamagri\staging-esamagri-app
npm run typecheck
npm run build
npm --workspace apps/api run test -- --testPathPattern "registration-ticket|customer-auth|announcement-audience"
npm --workspace apps/customer-web run test
npm --workspace apps/admin-web run test
```

The API integration suites need a database and are not runnable here.

## Manual test matrix

1. RIK officer signs in -> lands on / -> RIK card + all three feature cards
   -> entitlements, vouchers, issue schedule all still work.
2. Existing PIF customer signs in -> lands on / -> NO RIK card, but banners,
   New Arrivals, Nutrition Info, announcements, showcase and PIF all present.
3. Unregistered number: sign IN (not register) -> enter the real code ->
   lands on the registration form with the number filled in and locked ->
   name + block + number -> Create account -> lands on / with a session.
   NO second OTP is requested at any point.
4. Same number again -> ordinary sign-in, no duplicate record.
5. Switch PIF self-registration OFF -> step 3 shows
   "Self-registration is not yet available..." and no ticket is issued.
6. PIF customer hits /rik/entitlements/current -> 403.
7. PIF customer opens /rik/nutrition -> redirected to /nutrition, page loads.
