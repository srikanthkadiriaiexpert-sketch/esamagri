import {
  PIF_SELF_REGISTRATION_DISABLED_MESSAGE,
  PIF_SELF_REGISTRATION_SETTING_KEY,
  readSelfRegistrationFlag,
  selfRegistrationSettingValue,
} from './pif-registration.gate';

/**
 * WHAT THIS FILE USED TO BE, AND WHY IT IS DIFFERENT NOW.
 *
 * It was a tripwire. It asserted `PIF_SELF_REGISTRATION_ENABLED === false`
 * and so failed the build the moment anyone flipped the constant, which
 * meant enabling self-registration could not happen quietly. The project
 * owner has authorised an Admin Portal control, and a value held in
 * `shared.settings` cannot be asserted at build time — so that specific
 * protection is gone, deliberately and with approval.
 *
 * WHAT REPLACED IT. Three things, and they are what this file and
 * pif-registration.gate.service.spec.ts now test instead:
 *
 *   1. the parser is strict, so only one exact stored shape means ON;
 *   2. the gate fails closed on absent, unreadable and failed reads;
 *   3. every change is recorded in shared.audit_log with the previous and
 *      the new value (see admin-settings.service.spec.ts).
 *
 * Prevention became attribution. That was the authorised trade, and these
 * tests are the part of it that can still be mechanically enforced.
 *
 * No database, no network, no Nest container: the parser is a pure
 * function and the message is a string.
 */

describe('PIF self-registration — the setting key and the refusal message', () => {
  it('uses the {module}.{setting_name} convention the settings table already follows', () => {
    // migration 0019 seeds rik.not_collected_ttl_days and
    // pif.online_reservation_timeout_minutes. A new key that invented its
    // own shape would make shared.settings inconsistent to read by hand.
    expect(PIF_SELF_REGISTRATION_SETTING_KEY).toBe('pif.self_registration_enabled');
    expect(PIF_SELF_REGISTRATION_SETTING_KEY).toMatch(/^(shared|rik|pif)\.[a-z0-9_]+$/);
  });

  it('keeps the refusal message byte-for-byte, because the Customer App asserts it', () => {
    // RegisterPage surfaces the server's own wording, and
    // registration.test.tsx asserts this exact sentence. Changing it here
    // would break a screen test in another workspace.
    expect(PIF_SELF_REGISTRATION_DISABLED_MESSAGE).toBe(
      'Self-registration is not yet available. Please ask the facility to register you.'
    );
  });

  it('has a message that does not blame the resident for the feature being off', () => {
    expect(PIF_SELF_REGISTRATION_DISABLED_MESSAGE).toContain('not yet available');
    expect(PIF_SELF_REGISTRATION_DISABLED_MESSAGE.toLowerCase()).not.toContain('error');
    expect(PIF_SELF_REGISTRATION_DISABLED_MESSAGE.toLowerCase()).not.toContain('invalid');
  });

  it('does not leak the reason it is off to an unauthenticated caller', () => {
    // The message is shown on a public endpoint, so it must not describe
    // the internals a caller has no business learning.
    const lower = PIF_SELF_REGISTRATION_DISABLED_MESSAGE.toLowerCase();
    expect(lower).not.toContain('rik');
    expect(lower).not.toContain('guard');
    expect(lower).not.toContain('migration');
    expect(lower).not.toContain('setting');
    expect(lower).not.toContain('admin');
  });
});

describe('readSelfRegistrationFlag — exactly one shape means ON', () => {
  it('reads the approved envelope as ON', () => {
    expect(readSelfRegistrationFlag({ value: true })).toBe(true);
    expect(readSelfRegistrationFlag({ value: true, status: 'SET', note: 'anything' })).toBe(true);
  });

  it('reads the approved envelope with a false value as OFF', () => {
    expect(readSelfRegistrationFlag({ value: false })).toBe(false);
    expect(readSelfRegistrationFlag({ value: false, status: 'SET', note: 'x' })).toBe(false);
  });

  it('TREATS EVERY MALFORMED SHAPE AS OFF', () => {
    // Each of these is something a hand-edit in psql could plausibly
    // leave behind, and each one a lenient parser would have read as ON.
    const malformed: unknown[] = [
      null,
      undefined,
      true, // bare boolean, not the envelope
      'true',
      'TRUE',
      'yes',
      '1',
      1,
      {},
      { enabled: true }, // right idea, wrong property name
      { value: 'true' }, // string, not boolean
      { value: 'TRUE' },
      { value: 1 },
      { value: null },
      { value: {} },
      [{ value: true }], // array, not object
      [true],
    ];
    for (const raw of malformed) {
      expect(readSelfRegistrationFlag(raw)).toBe(false);
    }
  });

  it('is asymmetric on purpose: a false negative is a second button press, a false positive is an open endpoint', () => {
    // Restating the rule as an invariant: nothing but a real boolean true
    // under `value` can ever come back true, whatever else is in the row.
    const nearMisses = [{ value: 'true', status: 'SET' }, { value: 1, status: 'SET' }, { status: 'SET' }];
    expect(nearMisses.map(readSelfRegistrationFlag)).toEqual([false, false, false]);
  });
});

describe('selfRegistrationSettingValue — what gets written', () => {
  it('writes a real boolean under `value`, so the strict parser will read it back', () => {
    expect(readSelfRegistrationFlag(selfRegistrationSettingValue(true))).toBe(true);
    expect(readSelfRegistrationFlag(selfRegistrationSettingValue(false))).toBe(false);
  });

  it('round-trips through JSON, because the column is jsonb', () => {
    for (const enabled of [true, false]) {
      const stored: unknown = JSON.parse(JSON.stringify(selfRegistrationSettingValue(enabled)));
      expect(readSelfRegistrationFlag(stored)).toBe(enabled);
    }
  });

  it('is self-describing, so a row read in psql explains itself', () => {
    const written = selfRegistrationSettingValue(false);
    expect(written.status).toBe('SET');
    expect(written.note).toContain('shared.settings.write');
    expect(written.note).toContain('audit');
    expect(written.note.toLowerCase()).toContain('absent row means off');
  });
});
