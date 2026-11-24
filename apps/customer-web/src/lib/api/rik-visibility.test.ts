import { describe, expect, it } from 'vitest';
import { rikModuleHidden, type CustomerProfile } from './customer-api';

/**
 * Whether the Customer App offers the RIK module.
 *
 * THE ASYMMETRY THIS PINS DOWN. The two ways to get this wrong are not equally
 * bad, and the rule is built around that rather than around tidiness:
 *
 *   offering RIK to a PIF-only resident  -> the server refuses every request,
 *                                           and RequireRikProfile shows one
 *                                           clear sentence. Visible, bounded,
 *                                           self-correcting.
 *
 *   hiding RIK from an approved officer  -> no error, no log, no exception.
 *                                           Their ration simply is not there,
 *                                           and the only way anyone finds out
 *                                           is a phone call.
 *
 * So an UNKNOWN answer shows RIK, and only an explicit `false` hides it. These
 * tests exist to stop someone "tightening" that into a truthiness check, which
 * would turn every stubbed profile, every older server and every failed
 * request into a hidden module.
 */

function profile(over: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    customerId: '11111111-1111-7111-8111-111111111111',
    name: 'Anil',
    mobileNumber: '9876543210',
    residence: null,
    ...over,
  };
}

describe('rikModuleHidden — the explicit answers', () => {
  it('hides RIK when the server says the customer is not authorised', () => {
    expect(rikModuleHidden(profile({ rikAuthorised: false }))).toBe(true);
  });

  it('shows RIK when the server says the customer is authorised', () => {
    expect(rikModuleHidden(profile({ rikAuthorised: true }))).toBe(false);
  });
});

describe('rikModuleHidden — every unknown answer SHOWS RIK', () => {
  it('shows RIK when the field is absent', () => {
    expect(rikModuleHidden(profile())).toBe(false);
  });

  it('shows RIK when the field is undefined', () => {
    expect(rikModuleHidden(profile({ rikAuthorised: undefined }))).toBe(false);
  });

  it('shows RIK when there is no profile yet', () => {
    expect(rikModuleHidden(null)).toBe(false);
  });

  it('is not a truthiness check — this is the regression it guards', () => {
    // If this were `!profile?.rikAuthorised`, every case below would hide the
    // module, including an officer whose profile simply has not loaded.
    expect(rikModuleHidden(null)).toBe(false);
    expect(rikModuleHidden(profile())).toBe(false);
    expect(rikModuleHidden(profile({ rikAuthorised: undefined }))).toBe(false);
  });
});

describe('rikModuleHidden — it decides nothing about access', () => {
  it('is a pure function of one field, with no request and no token', () => {
    // Worth asserting as documentation: this cannot grant anything. Access is
    // decided by @RequireRikCustomer on the server, which this never consults
    // and cannot influence.
    expect(rikModuleHidden({ rikAuthorised: true })).toBe(false);
    expect(rikModuleHidden({ rikAuthorised: false })).toBe(true);
  });
});
