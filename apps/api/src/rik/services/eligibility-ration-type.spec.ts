import { parseEligibleDays } from './rik-eligibility-admin.service';
import { RATION_TYPES, RATION_TYPE_MAX_DAYS } from '../dto/rik-eligibility.dto';

/**
 * Fresh and Dry eligible days are read from the sheet against DIFFERENT
 * limits (STEP 16 / migration 0066).
 *
 * WHAT THESE TESTS ARE FOR. The facility's approved maximums are 30 days for
 * Fresh and 60 for Dry. Those two numbers are enforced in three places — this
 * parser, the single-officer adjustment path, and a CHECK constraint in the
 * database — and the database is the one that counts. The parser exists so a
 * mistake is REPORTED to the administrator in the preview, with the limit
 * named, rather than surfacing later as a raw constraint violation that fails
 * the whole upload.
 *
 * So the assertions below are mostly about the BOUNDARIES and about the
 * MESSAGE, because a bound that is off by one and a message that names the
 * wrong limit are the two ways this goes wrong quietly.
 *
 * WHAT THESE TESTS DELIBERATELY DO NOT TOUCH. No entitlement calculation, no
 * pool, no scale, no conversion, no ration-type-to-pool mapping. Under this
 * phase the two figures are STORED AND DISPLAYED ONLY: the entitlement engine
 * still calculates from the original `eligible_days` column and not one line
 * of it was modified. Nothing here asserts otherwise, because nothing here
 * should: an assertion about engine behaviour in this file would be a claim
 * that this change touched the engine.
 */

describe('parseEligibleDays — the limit depends on the ration type', () => {
  it('accepts 30 for Fresh and refuses 31, naming the limit', () => {
    expect(parseEligibleDays('30', 'FRESH')).toEqual({ ok: true, value: 30 });

    const over = parseEligibleDays('31', 'FRESH');
    expect(over.ok).toBe(false);
    // The message has to name BOTH the figure and the limit. "must be between
    // 0 and 30" against a dry sheet would send an administrator hunting for a
    // fault in a file that is correct.
    expect(over.ok === false && over.reason).toMatch(/Fresh eligible days must be between 0 and 30/);
    expect(over.ok === false && over.reason).toMatch(/the sheet says 31/);
  });

  it('accepts 60 for Dry and refuses 61, naming the limit', () => {
    expect(parseEligibleDays('60', 'DRY')).toEqual({ ok: true, value: 60 });

    const over = parseEligibleDays('61', 'DRY');
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.reason).toMatch(/Dry eligible days must be between 0 and 60/);
  });

  it('accepts a Dry figure that Fresh would refuse — the whole point of two limits', () => {
    // 31..60 is the band where the two types genuinely disagree. If this test
    // ever fails, the parser has started applying one limit to both.
    for (const days of ['31', '45', '60']) {
      expect(parseEligibleDays(days, 'DRY').ok).toBe(true);
      expect(parseEligibleDays(days, 'FRESH').ok).toBe(false);
    }
  });

  it('accepts zero for both — an officer with no eligible days is a real statement', () => {
    for (const type of RATION_TYPES) {
      expect(parseEligibleDays('0', type)).toEqual({ ok: true, value: 0 });
    }
  });

  it('keeps every refusal the original parser made, with the same wording', () => {
    // These four are not new behaviour and must not become new behaviour. A
    // decimal is refused rather than rounded; a blank, a negative and a
    // non-number are each reported as themselves.
    for (const type of RATION_TYPES) {
      expect(parseEligibleDays('', type)).toEqual({
        ok: false,
        reason: 'Eligible days is blank.',
      });
      expect(parseEligibleDays('7.5', type)).toEqual({
        ok: false,
        reason: 'Eligible days must be a whole number; the sheet says 7.5.',
      });
      expect(parseEligibleDays('-1', type)).toEqual({
        ok: false,
        reason: 'Eligible days cannot be negative; the sheet says -1.',
      });
      expect(parseEligibleDays('many', type)).toEqual({
        ok: false,
        reason: 'Eligible days is not a number; the sheet says many.',
      });
    }
  });

  it('is unchanged when no ration type is given — the legacy bound still applies', () => {
    // The legacy `eligible_days` column still permits up to 366 and is left
    // exactly as it was, so the parser called without a type must behave
    // exactly as it did before this change. If this test fails, the original
    // behaviour has been altered rather than extended.
    expect(parseEligibleDays('366')).toEqual({ ok: true, value: 366 });
    expect(parseEligibleDays('31')).toEqual({ ok: true, value: 31 });
    expect(parseEligibleDays('61')).toEqual({ ok: true, value: 61 });
    expect(parseEligibleDays('367')).toEqual({
      ok: false,
      reason: 'Eligible days must be between 0 and 366; the sheet says 367.',
    });
  });

  it('bounds come from the one table, so a limit cannot be changed in only one place', () => {
    expect(RATION_TYPE_MAX_DAYS).toEqual({ FRESH: 30, DRY: 60 });
    for (const type of RATION_TYPES) {
      const max = RATION_TYPE_MAX_DAYS[type];
      expect(parseEligibleDays(String(max), type).ok).toBe(true);
      expect(parseEligibleDays(String(max + 1), type).ok).toBe(false);
    }
  });
});
