/**
 * Mobile number canonicalisation — ONE implementation, for every path.
 *
 * WHY THIS MOVED HERE. The logic was written inside RikOfficerService, whose
 * own comment explained why it was exported: "Phase B's eligibility import
 * must normalise the facility's spreadsheet the SAME way this normalised the
 * number at registration — two different normalisations would mean an officer
 * who can never be matched."
 *
 * That reasoning now reaches further than RIK. Customer login matches a stored
 * number, PIF self-registration writes one, and RIK officer registration has
 * to recognise that a resident who already uses PIF is the SAME PERSON. If any
 * of those normalised differently, a resident would end up with two accounts or
 * be unable to sign in to the one they have.
 *
 * It lives in `shared` rather than in `rik` because AuthModule deliberately
 * does not depend on RikModule (see AuthModule's own doc). Importing a RIK
 * service into the authentication core to get at a string function would be the
 * wrong dependency for the right reason.
 *
 * RikOfficerService still exports `normaliseMobile`, which wraps this and
 * throws its own OfficerValidationError, so RIK's behaviour and error messages
 * are byte-for-byte what they were.
 *
 * WHAT IT TOLERATES: spaces, hyphens, brackets and dots anywhere; a leading
 * `+`; and the `+91` / `91` / `0` trunk prefixes an Indian number is written
 * with. WHAT IT DOES NOT: anything that is not then ten digits starting 6, 7, 8
 * or 9. A number this cannot canonicalise returns null — it is never guessed
 * at, and never partially stripped.
 */

const NATIONAL = /^[6-9][0-9]{9}$/;

/** Canonical ten-digit form, or null when the input is not an Indian mobile. */
export function normaliseMobileOrNull(value: string | null | undefined): string | null {
  const stripped = (value ?? '').replace(/[\s\-().]/g, '').replace(/^\+/, '');

  // A ten-digit number is taken AS IT STANDS. This order matters: 9123450011 is
  // a perfectly ordinary number that begins "91", and stripping a trunk prefix
  // from it unconditionally would leave eight digits and refuse a valid
  // officer. A prefix is only considered when there is something left over for
  // it to be.
  if (NATIONAL.test(stripped)) return stripped;

  for (const prefix of ['091', '91', '0']) {
    if (stripped.startsWith(prefix)) {
      const national = stripped.slice(prefix.length);
      if (NATIONAL.test(national)) return national;
    }
  }

  return null;
}

/**
 * The form to match a stored number against.
 *
 * Returns the canonical ten digits when the input is an Indian mobile, and the
 * input otherwise. Used by the authentication path, which accepts a wider set
 * of numbers than this canonicaliser understands (RequestOtpDto allows 8 to 15
 * digits with an optional `+`) and must not start refusing one it accepts
 * today. Falling back to the input can only ADD a match, never remove one.
 *
 * Both halves of a login — requesting the code and verifying it — must call
 * this, because the OTP row is keyed on the number as written.
 */
export function canonicalMobileForMatch(value: string): string {
  return normaliseMobileOrNull(value) ?? value;
}
