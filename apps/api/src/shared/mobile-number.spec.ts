import { canonicalMobileForMatch, normaliseMobileOrNull } from './mobile-number';

/**
 * The single canonicaliser every path shares.
 *
 * This is the function that decides whether a resident who already shops on
 * PIF is recognised as the SAME PERSON when RIK staff register them, and
 * whether an officer who types +91 in front of their number can sign in. If it
 * disagrees with itself across paths, a resident gets two accounts or is
 * locked out of the one they have — so the behaviour is pinned here rather
 * than left to each caller.
 */

describe('normaliseMobileOrNull — the canonical form', () => {
  it('accepts a plain ten-digit number as it stands', () => {
    expect(normaliseMobileOrNull('9876543210')).toBe('9876543210');
    expect(normaliseMobileOrNull('6000000000')).toBe('6000000000');
    expect(normaliseMobileOrNull('7123456789')).toBe('7123456789');
    expect(normaliseMobileOrNull('8123456789')).toBe('8123456789');
  });

  it('strips a +91 prefix', () => {
    expect(normaliseMobileOrNull('+919876543210')).toBe('9876543210');
  });

  it('strips a bare 91 prefix', () => {
    expect(normaliseMobileOrNull('919876543210')).toBe('9876543210');
  });

  it('strips a 091 prefix', () => {
    expect(normaliseMobileOrNull('0919876543210')).toBe('9876543210');
  });

  it('strips a single leading 0', () => {
    expect(normaliseMobileOrNull('09876543210')).toBe('9876543210');
  });

  it('removes spaces, hyphens, brackets and dots wherever they appear', () => {
    expect(normaliseMobileOrNull('98765 43210')).toBe('9876543210');
    expect(normaliseMobileOrNull('98765-43210')).toBe('9876543210');
    expect(normaliseMobileOrNull('+91 (98765) 43210')).toBe('9876543210');
    expect(normaliseMobileOrNull('98765.43210')).toBe('9876543210');
    expect(normaliseMobileOrNull(' +91-98765 43210 ')).toBe('9876543210');
  });

  /**
   * The ordering rule that makes the whole thing safe. 9123450011 is an
   * ordinary number that happens to begin "91". Stripping a trunk prefix
   * unconditionally would leave eight digits and refuse a valid officer, so a
   * ten-digit number is taken as it stands BEFORE any prefix is considered.
   */
  it('does not mistake a number beginning 91 for a prefixed one', () => {
    expect(normaliseMobileOrNull('9123450011')).toBe('9123450011');
  });

  it('does not mistake a number beginning 9 followed by 1 for a 091 case', () => {
    expect(normaliseMobileOrNull('9190000000')).toBe('9190000000');
  });
});

describe('normaliseMobileOrNull — what it refuses', () => {
  it.each([
    ['too short', '98765432'],
    ['nine digits', '987654321'],
    ['eleven digits with no recognised prefix', '12345678901'],
    ['starts with 5', '5876543210'],
    ['starts with 0 and is not then valid', '0123456789'],
    ['letters', '98765abcde'],
    ['empty', ''],
    ['only punctuation', '+-() .'],
  ])('refuses %s', (_label, value) => {
    expect(normaliseMobileOrNull(value)).toBeNull();
  });

  it('refuses null and undefined without throwing', () => {
    expect(normaliseMobileOrNull(null)).toBeNull();
    expect(normaliseMobileOrNull(undefined)).toBeNull();
  });

  it('never returns a partially stripped number', () => {
    // '915876543210' would become '5876543210' if the prefix were stripped
    // blindly, which is not a valid Indian mobile. It must refuse outright
    // rather than hand back something that merely looks like ten digits.
    expect(normaliseMobileOrNull('915876543210')).toBeNull();
  });
});

describe('normaliseMobileOrNull — idempotence', () => {
  it('canonicalising a canonical number changes nothing', () => {
    const once = normaliseMobileOrNull('+919876543210');
    expect(once).not.toBeNull();
    expect(normaliseMobileOrNull(once)).toBe(once);
  });

  it('every written form of one number collapses to the same value', () => {
    const forms = [
      '9876543210',
      '+919876543210',
      '919876543210',
      '09876543210',
      '0919876543210',
      '+91 98765 43210',
      '(+91)-98765-43210',
    ];
    const canonical = new Set(forms.map((f) => normaliseMobileOrNull(f)));
    expect([...canonical]).toEqual(['9876543210']);
  });
});

describe('canonicalMobileForMatch — the lookup form', () => {
  it('returns the canonical form for an Indian mobile', () => {
    expect(canonicalMobileForMatch('+919876543210')).toBe('9876543210');
  });

  /**
   * RequestOtpDto accepts 8 to 15 digits with an optional '+', which is wider
   * than this canonicaliser understands. Falling back to the input is what
   * makes the login fix strictly additive: a number that works today cannot
   * stop working.
   */
  it('returns the input unchanged when it is not an Indian mobile', () => {
    expect(canonicalMobileForMatch('+14155550123')).toBe('+14155550123');
    expect(canonicalMobileForMatch('12345678')).toBe('12345678');
  });

  it('is stable, so a code requested under one form verifies under another', () => {
    const requested = canonicalMobileForMatch('+91 98765 43210');
    const verified = canonicalMobileForMatch('9876543210');
    expect(requested).toBe(verified);
  });
});
