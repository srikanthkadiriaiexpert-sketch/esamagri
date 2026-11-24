import { describe, it, expect } from 'vitest';
import { eligibleDaysLabel } from '../../../lib/api/rik-eligibility-days-api';

/**
 * How an officer's two eligible-day figures read on screen
 * (STEP 16 / migration 0066).
 *
 * THE WHOLE POINT OF THIS FILE is the distinction between "the facility has
 * not published this figure yet" and "the facility published nought days".
 * They mean entirely different things to an officer standing at a counter,
 * and the one way to get this wrong is to render a missing figure as 0 — at
 * which point the screen states, with a straight face, that the officer is
 * entitled to nothing.
 *
 * The label function is tested directly rather than through the pages because
 * it is where the decision lives. The two pages each render it twice, and a
 * page test would assert the same rule twice more while coupling it to the
 * card layout.
 *
 * NOT ASSERTED HERE, deliberately: any entitlement quantity. The entitlement
 * engine was not modified by this change — it still calculates from the
 * original single eligibility figure — so these two numbers are displayed
 * alongside quantities they do not yet drive. That is expected until the
 * separate calculation change is approved, and an assertion here that tied
 * them together would be a claim the engine had changed.
 */

describe('eligibleDaysLabel — not published is said in words', () => {
  it('says "Not yet published" for null, and never "0"', () => {
    const label = eligibleDaysLabel(null);
    expect(label).toBe('Not yet published');
    // Belt and braces: the string must not contain a digit at all, so no
    // future rewording can slip a zero back in.
    expect(label).not.toMatch(/[0-9]/);
  });

  it('says "0 days" for a published zero — a real statement, kept distinct', () => {
    expect(eligibleDaysLabel(0)).toBe('0 days');
    // And the two must never read the same.
    expect(eligibleDaysLabel(0)).not.toBe(eligibleDaysLabel(null));
  });

  it('reads naturally for one day and for many', () => {
    expect(eligibleDaysLabel(1)).toBe('1 day');
    expect(eligibleDaysLabel(7)).toBe('7 days');
    expect(eligibleDaysLabel(30)).toBe('30 days');
    expect(eligibleDaysLabel(60)).toBe('60 days');
  });

  it('states the officer-wise figures from the brief exactly as given', () => {
    // Officer E in the approved requirement: fresh 7, dry 27. Different
    // officers hold different figures; nothing here rounds, caps or defaults.
    expect(eligibleDaysLabel(7)).toBe('7 days');
    expect(eligibleDaysLabel(27)).toBe('27 days');
    expect(eligibleDaysLabel(13)).toBe('13 days');
  });
});
