# e-Samagri — SMS Gateway Hub OTP Integration

**Staging project only:** `C:\esamagri\staging-esamagri-app`
**Date:** 17 November 2026
**Backup:** `C:\esamagri\backups\20261117-0835_sms-gateway-hub\`
**Status:** code complete, tested, **not switched on**. Nothing sends an SMS until you put your API key in and change one setting.

---

## 1. In plain language, what was built

Your app already created the one-time code, scrambled it, stored it and checked it. The one thing it could not do was *deliver* it to a phone — there was a labelled empty socket where a delivery service should plug in.

This work built the plug for SMS Gateway Hub and put it in that socket.

What deliberately did **not** change: how the code is generated, how it is stored, the five-minute validity, the five-attempt limit, the single-use rule, the hourly request limit, how customers sign in, how RIK access is restricted, or PIF registration. The file that handles sign-in (`customer-auth.service.ts`) was **not edited at all** — that is the point of the socket.

---

## 2. Files

### Inspected (read only, before any change)
| File | Why |
|---|---|
| `apps/api/src/notification/otp-sms.service.ts` | the socket |
| `apps/api/src/auth/services/customer-auth.service.ts` | the only thing that uses it |
| `packages/config/src/api-env.ts` | where settings are declared and validated |
| `apps/api/src/notification/notification.module.ts` | how the pieces are connected |
| `apps/api/src/notification/otp-sms.service.spec.ts` | the existing safety tests |
| `apps/api/.env.example` | the settings template |
| `apps/api/.env` | read only, to confirm current state — **not modified** |
| `packages/config/src/api-env.test.ts`, `env-utils.ts` | to be sure nothing else broke |
| `apps/api/src/shared/repositories/audit-log.repository.ts` | to confirm the new failure reasons record cleanly |

### Created
| File | Size | SHA-256 (first 12) |
|---|---|---|
| `apps/api/src/notification/smsgatewayhub.provider.ts` | 18,822 B | `5ba4075426d1` |
| `apps/api/src/notification/smsgatewayhub.provider.spec.ts` | 20,875 B | `247948112b49` |

### Modified
| File | Before | After | Bytes |
|---|---|---|---|
| `apps/api/src/notification/otp-sms.service.ts` | `75bbaea9db90` | `18da5f335369` | 5,722 → 9,360 |
| `apps/api/src/notification/notification.module.ts` | `3e5c5b96e8e1` | `1b34899d371a` | 2,142 → 2,328 |
| `apps/api/src/notification/otp-sms.service.spec.ts` | `a1253841cd27` | `61659d158592` | 9,868 → 20,593 |
| `packages/config/src/api-env.ts` | `3277075458a3` | `ba99eb723c5f` | 17,862 → 22,182 |
| `apps/api/.env.example` | `fb70edbf03e2` | `dd97b2af7d0a` | 4,528 → 6,061 |

The "before" copies of all five are in the backup folder named at the top.

**Not touched:** `customer-auth.service.ts`, `auth.module.ts`, `apps/api/.env`, any database file, any migration, any RIK or PIF file, anything in `C:\esamagri\esamagri-app`.

---

## 3. Settings added

All in `packages/config/src/api-env.ts`, with placeholders in `.env.example`.

| Setting | Default | Meaning |
|---|---|---|
| `SMS_GATEWAY_HUB_API_KEY` | *(none)* | **SECRET.** Your key. Required only when the provider is selected. |
| `SMS_GATEWAY_HUB_SENDER_ID` | *(none)* | Your DLT-approved sender header. Required only when selected. |
| `SMS_GATEWAY_HUB_ROUTE` | `1` | Page 10: Route 1 = default |
| `SMS_GATEWAY_HUB_CHANNEL` | `2` | Page 10: 2 = transactional |
| `SMS_GATEWAY_HUB_DCS` | `0` | Page 10: 0 = English, 8 = Unicode |
| `SMS_GATEWAY_HUB_TIMEOUT_MS` | `10000` | how long a sign-in waits for the gateway |

`OTP_DELIVERY_PROVIDER` now accepts `SMS_GATEWAY_HUB` as well as `NONE` and `WHATSAPP`.

**Three deliberate omissions:**

- **No base-URL setting.** The address is fixed in code, because the request carries your API key and a web address read from a settings file is one a typo can point at somebody else's server.
- **No FlashSms setting.** Fixed at `0` (a normal, saved SMS). A flash message flashes on screen without being saved, and a code nobody can scroll back to is useless.
- **The two credentials are optional in the schema but required the moment you select the provider.** So your existing `.env` keeps working untouched, and selecting SMS without a key is refused at startup with a message naming the missing setting — instead of starting fine and failing silently on the first customer.

---

## 4. The request that goes to SMS Gateway Hub

`POST https://www.smsgatewayhub.com/api/mt/SendSms`, `Content-Type: application/xml`, body:

```xml
<SmsQueue><Account><APIKey>…</APIKey><SenderId>…</SenderId><Channel>2</Channel>
<DCS>0</DCS><FlashSms>0</FlashSms><Route>1</Route></Account>
<Messages><Message><Number>919XXXXXXXXX</Number><Text>…</Text></Message></Messages></SmsQueue>
```

This is the format on pages 9–10, which is the only one the vendor document shows end to end — a complete request *and* a captured successful response. The content type lives in a single named constant so that if SMS Gateway Hub tells you it wants something else, it is a one-line change.

**Phone numbers** are converted to the `91XXXXXXXXXX` form every example uses. The app still stores and matches `+919XXXXXXXXX` exactly as before — the conversion happens only on the way out to the gateway.

**Text safety.** Every value is XML-escaped, ampersand first. A test feeds the message field a deliberately hostile string containing fake XML tags and confirms it cannot smuggle in a second recipient.

**The message** is the DLT-approved wording, unchanged:

> Your OTP for e-Samagri login is **{code}**. Valid for 5 minutes. Do not share this OTP with anyone. - Sri Lakshmi Srinivasa Mart

It lives in one named function so there is exactly one place it could ever be altered — and altering it would make the gateway answer "template mismatch" and deliver nothing.

---

## 5. API key handling

- Read only from `apps/api/.env` through the validated settings layer.
- **Never** hard-coded, never in `.env.example` (placeholder only), never printed, never logged, never in an error message, never in a test file. The test suite uses an obviously fake sentinel value and then asserts that no log line produced by *any* path contains it.
- The startup check confirms the key is **present** without reading its value out. A test proves the refusal message does not echo the key back.
- The full XML request is never logged — not at debug level, not on failure. It contains both the key and the OTP.
- Network errors are logged by error *name and system code* only (`TypeError: ENOTFOUND`), never the error message, because the underlying library quotes the request in its messages.

---

## 6. Error handling

A reply of HTTP 200 is **not** treated as success. Every documented failure arrives as a 200 with a non-zero code, so the code itself is checked. Success is `ErrorCode` `000`.

| Gateway code | Recorded as | What you would do |
|---|---|---|
| 007, 008, 009, 010, 011, 014, 001 | `PROVIDER_AUTH` | check the key, account status, or IP allowlist in the panel |
| 015 | `PROVIDER_SENDER_ID` | sender header not approved for this account |
| 024 | `PROVIDER_TEMPLATE` | message text does not match the registered DLT template |
| 021 | `PROVIDER_CREDITS` | top up |
| 013, 023, 025, and similar | `PROVIDER_REQUEST` | the request was malformed |
| anything else non-zero | `PROVIDER_REJECTED` | contact support with the code |

Plus: `NOT_CONFIGURED` (no key or sender ID — nothing is sent at all), `INVALID_RECIPIENT`, `PROVIDER_UNAVAILABLE` (non-200), `MALFORMED_RESPONSE` (reply was not usable JSON), `TIMEOUT`, `NETWORK`.

Every one of these is recorded in the audit log as `OTP_DELIVERY_FAILED` **and does not break the sign-in**. That existing behaviour was preserved exactly, and it matters: if a gateway failure made sign-in behave differently for a real customer than for a stranger, the sign-in screen would become a way to find out who has an account.

**Important:** the gateway *accepting* a message is not the same as the phone *receiving* it. The log says "accepted for delivery" and nothing stronger. The delivery-report API is not called — a one-time code is not worth holding a sign-in open to poll for.

---

## 7. Test, typecheck and build results

**Where these ran — please read this.** The link to your computer this session gives file access but **no command shell**, so `npm` could not be run on your machine. The code was compiled and tested in an identical reconstructed setup here, built from your actual staged files, with your project's exact compiler settings and the same package versions. **You should still run the commands in section 9 on your own machine before the demo.**

```
$ npx tsc --noEmit        # your apps/api/tsconfig.json settings
(no output — exit 0)

$ npx jest
PASS apps/api/src/notification/smsgatewayhub.provider.spec.ts
PASS apps/api/src/notification/otp-sms.service.spec.ts
Test Suites: 2 passed, 2 total
Tests:       102 passed, 102 total

$ npx vitest run packages/config/src/api-env.test.ts
✓ packages/config/src/api-env.test.ts (14 tests) 17ms
Test Files  1 passed (1)
```

**116 tests, all passing.** That covers all 25 items on your list, plus module wiring.

The existing `fetch` tripwire — the test that fails if any code tries to reach the internet when it should not — is still armed and still green on the NONE and WHATSAPP paths.

**Two existing tests had to be changed, and I want to be explicit about both:**

1. `'no longer defines any SMS_2FACTOR_* setting at all'` asserted that *no* setting name began with `SMS_`. That was correct while there was no SMS provider. It now asserts the thing that was always meant: every `SMS_*` setting belongs to the provider that actually exists, and none belongs to the retired 2Factor one. Narrowed, not weakened.
2. `'tells the operator, in the refusal, that no value enables SMS'` asserted a sentence that has stopped being true. It now asserts that the refusal points at the value that *does* work. The refusal itself — refusing `SMS_2FACTOR` and `SMS_GATEWAY` by name — is unchanged and still covered by its own tests.

**I also checked the tests can actually fail.** Three deliberate faults were introduced one at a time and the suite caught each:

| Fault introduced | Caught by |
|---|---|
| provider not connected to the service | 1 test — the wiring test |
| a failure code treated as success | 3 tests |
| XML escaping done in the wrong order | 3 tests |

**Build:** `npm run build` for the API was not run, for the same reason as above — it is `tsc -p tsconfig.build.json`, i.e. the same compiler that reported clean, writing output files.

---

## 8. Entering your API key — exact steps

1. Open `C:\esamagri\staging-esamagri-app\apps\api\.env` in Notepad.
2. Add these lines at the end (the first two have no value yet):

```
SMS_GATEWAY_HUB_API_KEY=
SMS_GATEWAY_HUB_SENDER_ID=
SMS_GATEWAY_HUB_ROUTE=1
SMS_GATEWAY_HUB_CHANNEL=2
SMS_GATEWAY_HUB_DCS=0
SMS_GATEWAY_HUB_TIMEOUT_MS=10000
```

3. Sign in at **https://www.smsgatewayhub.com/Panel/WebAPI/APICodes.aspx**, copy your API key, and paste it after `SMS_GATEWAY_HUB_API_KEY=` — no quotes, no spaces.
4. Put your DLT-approved sender header after `SMS_GATEWAY_HUB_SENDER_ID=` (the vendor documents six characters).
5. **Leave `OTP_DELIVERY_PROVIDER=NONE` for now.** Nothing will send yet. That is deliberate — see the next section.
6. Save and close. Do not paste the key into a chat, a document, a screenshot or a commit. I have not asked for it and do not need it.

---

## 9. Controlled live test — the only way to prove SMS actually works

Everything so far proves the code is correct. **It does not prove a single SMS has ever arrived.** Only this does.

Run these on your machine first, from `C:\esamagri\staging-esamagri-app`:

```
npm run --workspace @esamagri/api typecheck
npm run --workspace @esamagri/api test
npm run --workspace @esamagri/api build
```

Then, when you are ready and watching a phone:

1. Confirm with SMS Gateway Hub that your account has credit and your sender header and DLT template are approved and active.
2. In `apps/api/.env`, change `OTP_DELIVERY_PROVIDER=NONE` to `OTP_DELIVERY_PROVIDER=SMS_GATEWAY_HUB`.
3. Restart the API. **If the key or sender ID is missing it will refuse to start and tell you which one** — that is working as designed, not a crash.
4. On the Customer App, request an OTP for **one** number you are physically holding.
5. Watch the API window. You want to see `SMS Gateway Hub accepted the message for delivery. jobId=…`
6. Check the phone. **Arrival on the handset is the only real proof.**
7. If the message does not arrive but the log said "accepted", the gateway took it and the carrier did not deliver it — that is a DLT or route question for SMS Gateway Hub, with the `jobId` from the log.
8. If you see `ErrorCode=024` → the message text does not match your registered template. **Do not edit the message to make it fit** — send me the exact registered text and I will reconcile it.
9. **To switch delivery back off at any time:** set `OTP_DELIVERY_PROVIDER=NONE` and restart. Nothing else needs to change.

Test with one number, not several. Each attempt counts against the existing five-per-hour limit, which was not altered.

---

## 10. Still unresolved — questions for SMS Gateway Hub

None of these block the code; all of them could stop a real message arriving.

1. **Entity ID / Content Template ID.** No such field exists anywhere in the 11-page document, yet error 024 is "invalid template or template mismatch" — so the platform clearly matches templates somehow. Most likely it matches on sender header plus exact message text, with no ID sent. **Needs confirming.** If an ID turns out to be required, it is two extra XML elements and a setting.
2. **Is there a separate OTP channel?** Page 3 says "for OTP = OTP"; page 10 says transactional is `2`. The code follows page 10 but the value is a setting, so their answer is a `.env` edit.
3. **Is the content type right?** The document contradicts itself. The implemented choice is the one it demonstrates working. One-line change if they say otherwise.
4. **Is IP allowlisting on for your account?** If so, the machine running the API has to be registered or every send fails with code 011 — which looks like a wrong key and is not.
5. **Is the route ID for your account really 1?** Page 10 says 1 is the default; the page-2 examples contain a broken `route=clickhere` placeholder.

I can draft these as an email for you to send.

---

## 11. Needing your decision

1. **Confirm the DLT message text is exactly right**, character for character, against what is registered. One different full stop causes error 024 and no customer gets a code.
2. **Run the three commands in section 9 on your machine** — they have not been run there by me, and I will not claim they have.
3. **`PifBusinessesPage-1.tsx` is still sitting in `apps\customer-web\src\routes\pif\`** from earlier work. It is unrelated to this task and does not affect the API, but it will make a Customer App typecheck fail. It needs deleting — I can write files to your machine but not delete them.

---

## 12. Completed vs pending

**Completed:** documentation review; read-only inspection; configuration and validation; the provider; wiring; `.env.example` placeholders; 116 tests; typecheck clean; mutation checks; timestamped backup; files written to the staging project.

**Pending:** your API key and sender ID; your own typecheck/test/build run; the live single-number SMS test; the five provider questions; confirmation of the DLT text.

**Not started, and deliberately so:** switching delivery on. `OTP_DELIVERY_PROVIDER` is still `NONE`. Nothing deployed, nothing committed to version control, no database change, no migration, PIF self-registration still OFF.
