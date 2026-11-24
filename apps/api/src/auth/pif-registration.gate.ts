/**
 * Whether PIF customer self-registration is reachable.
 *
 * ================================================================
 * THIS IS NOW A RUNTIME SETTING, NOT A COMPILE-TIME CONSTANT.
 * IT IS STILL OFF UNTIL AN ADMINISTRATOR TURNS IT ON.
 * ================================================================
 *
 * WHAT THIS FILE USED TO BE. `export const PIF_SELF_REGISTRATION_ENABLED
 * = false` — a constant that could only be changed by editing code,
 * rebuilding and redeploying, with a unit test (pif-registration.gate.spec.ts)
 * that failed the build the moment anyone flipped it. That was the right
 * design while the four Stage 3 preconditions were outstanding; those are
 * now met, and the project owner has authorised an Admin Portal control
 * instead.
 *
 * WHAT WAS GIVEN UP, SAID PLAINLY. A build-time constant cannot be
 * changed without a code review; a database row can be changed by any
 * holder of `shared.settings.write` — in the approved seed, SUPER_ADMIN
 * alone. So enabling registration is no longer *prevented* by this file;
 * it is *recorded*, by an append-only audit row naming the administrator,
 * the previous value, the new value and the time. That trade was the
 * authorised one. The compensating controls are the three below.
 *
 * CONTROL 1 — ABSENT MEANS OFF. The setting has no seed row, by design:
 * seeding one would have needed a migration, and "no row" is a clearer
 * default than a row that says false. `shared.settings` is queried on
 * every registration request and a missing key is OFF.
 *
 * CONTROL 2 — ANYTHING UNINTERPRETABLE MEANS OFF. `value` is jsonb, and
 * any `psql` session can put arbitrary JSON in it. `readSelfRegistrationFlag`
 * below accepts exactly one shape and treats everything else — a bare
 * `true`, the string `"true"`, the number 1, a missing `value` key, null —
 * as OFF. A setting nobody can read confidently is not a setting that
 * should open a public endpoint.
 *
 * CONTROL 3 — A FAILED QUERY MEANS OFF. See PifRegistrationGate: the
 * database call is wrapped, and an error returns false. A connection blip
 * must not become open public registration.
 *
 * WHAT DID NOT CHANGE. The refusal is still HTTP 503 with the message
 * below, byte for byte, because the Customer App's RegisterPage surfaces
 * the server's own wording and a test asserts that exact string. The
 * check still runs FIRST in each handler, before the DTO matters, so
 * nothing downstream — not the OTP table, not SMS, not shared.customers —
 * is touched while registration is off.
 *
 * SEPARATELY, AND NOT CONTROLLED HERE: no SMS provider is implemented, so
 * even with this setting ON no verification code can be delivered. That is
 * a property of the notification module, not of this gate, and it is
 * deliberately NOT wired into this decision — a provider being selected
 * would not prove that delivery works, and a gate that pretended otherwise
 * would be worse than one that says only what it knows.
 */

/**
 * The `shared.settings` key. Follows the table's own
 * `{module}.{setting_name}` convention, as established by the two rows
 * migration 0019 seeds (`rik.not_collected_ttl_days`,
 * `pif.online_reservation_timeout_minutes`).
 */
export const PIF_SELF_REGISTRATION_SETTING_KEY = 'pif.self_registration_enabled';

/** Message shown if a request reaches a gated route. Unchanged. */
export const PIF_SELF_REGISTRATION_DISABLED_MESSAGE =
  'Self-registration is not yet available. Please ask the facility to register you.';

/**
 * Builds the jsonb payload written for this setting.
 *
 * The envelope matches the shape migration 0019 established for the other
 * two settings rows — `value` alongside a `status` and a `note` — so a
 * human reading `SELECT * FROM shared.settings` finds every row self-
 * describing rather than having to know which keys are bare booleans.
 */
export function selfRegistrationSettingValue(enabled: boolean): {
  value: boolean;
  status: 'SET';
  note: string;
} {
  return {
    value: enabled,
    status: 'SET',
    note:
      'Whether a resident may create their own PIF account after OTP verification. ' +
      'Set from the Admin Portal by a holder of shared.settings.write; every change is ' +
      'recorded in shared.audit_log. Absent row means OFF.',
  };
}

/**
 * Interprets the stored jsonb. STRICT, AND FAIL-CLOSED BY CONSTRUCTION.
 *
 * Returns true for exactly one input: an object whose `value` property is
 * the boolean `true`. Everything else is false — including every shape
 * that a careless hand-edit might produce and that a lenient parser would
 * have read as "on":
 *
 *   null, undefined                     → false  (no row, or a null value)
 *   true                                → false  (bare boolean, not the envelope)
 *   "true", "TRUE", "yes", "1"          → false  (strings are never truthy here)
 *   1                                   → false
 *   {}                                  → false  (no value key)
 *   { value: "true" }                   → false  (string, not boolean)
 *   { value: 1 }                        → false
 *   { value: null }                     → false
 *   [{ value: true }]                   → false  (array, not object)
 *   { value: true }                     → TRUE
 *
 * Being this unforgiving is the point. The asymmetry is deliberate: a
 * false negative means an administrator presses the control again, while a
 * false positive means a public registration endpoint opens because of a
 * typo.
 */
export function readSelfRegistrationFlag(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return (raw as { value?: unknown }).value === true;
}
