import {
  RegistrationTicketInvalidError,
  RegistrationTicketService,
  TICKET_KEY_DOMAIN,
  TICKET_TTL_SECONDS,
} from './registration-ticket.service';
import {
  hasConflictingCredentials,
  registrationCredentialOf,
} from '../dto/register-customer.dto';
import { createHmac } from 'node:crypto';

/**
 * THE REGISTRATION TICKET, AND THE PROMISES IT MAKES.
 *
 * Pure: no database, no Nest container, no HTTP. The service's only
 * dependency is a ConfigService it reads one value from, so a two-line stub
 * is the whole fixture.
 *
 * What is asserted here is the list of things the ticket is relied on for.
 * Each one is a sentence somebody could otherwise only check by reading the
 * implementation and believing it:
 *
 *   * a ticket round-trips the canonical number and the OTP row id;
 *   * a ticket cannot be forged, edited, or re-signed under another key;
 *   * a ticket minted by a server with a different secret is refused;
 *   * a ticket cannot be presented as a bearer token, because the signing
 *     key is not the JWT key;
 *   * a ticket expires, and the expiry cannot be extended by the client;
 *   * the signature is checked BEFORE the payload is believed;
 *   * exactly one credential reaches registration, never both, never neither.
 */

const SECRET = 'test-jwt-access-secret-value-not-a-real-one';

function serviceWith(secret: string = SECRET): RegistrationTicketService {
  // The service reads exactly one key. Anything else it asked for would show
  // up here as an undefined, which is what makes this stub honest.
  const config = {
    get: (key: string) => {
      if (key !== 'JWT_ACCESS_SECRET') throw new Error(`unexpected config key ${key}`);
      return secret;
    },
  };
  return new RegistrationTicketService(config as never);
}

const MOBILE = '9876543210';
const OTP_ROW = '3f1c9a1e-0000-7000-8000-000000000001';

describe('a ticket round-trips what the server put in it', () => {
  it('returns the canonical number and the OTP row it was minted from', () => {
    const service = serviceWith();
    const claims = service.read(service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW }));
    expect(claims.mobileNumber).toBe(MOBILE);
    expect(claims.otpRequestId).toBe(OTP_ROW);
  });

  it('expires TICKET_TTL_SECONDS after it was minted, and not later', () => {
    const service = serviceWith();
    const ticket = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW, nowSeconds: 1000 });
    expect(service.read(ticket, 1000).expiresAt).toBe(1000 + TICKET_TTL_SECONDS);
  });

  it('is not usable for an hour — the TTL is minutes', () => {
    expect(TICKET_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it('mints two different tickets for the same number in the same second', () => {
    // The nonce. Two byte-identical tickets would make one a usable copy of
    // the other in any log that captured either.
    const service = serviceWith();
    const a = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW, nowSeconds: 1000 });
    const b = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW, nowSeconds: 1000 });
    expect(a).not.toBe(b);
  });
});

describe('a ticket cannot be forged or edited', () => {
  const service = serviceWith();

  it('refuses a ticket whose payload was changed', () => {
    const ticket = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW });
    const [prefix, payload, signature] = ticket.split('.') as [string, string, string];

    // Re-encode the payload with somebody else's number, keeping the
    // signature. This is the attack the HMAC exists to stop.
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Record<string, unknown>;
    decoded.m = '9000000001';
    const tampered = Buffer.from(JSON.stringify(decoded), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(() => service.read(`${prefix}.${tampered}.${signature}`)).toThrow(
      RegistrationTicketInvalidError
    );
  });

  it('refuses a ticket minted by a server holding a different secret', () => {
    const theirs = serviceWith('a-completely-different-secret');
    const ticket = theirs.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW });
    expect(() => service.read(ticket)).toThrow(RegistrationTicketInvalidError);
  });

  it('refuses a ticket signed with the RAW JWT secret rather than the derived key', () => {
    /**
     * THE SEPARATION THAT STOPS A TICKET BEING A BEARER TOKEN.
     *
     * If the ticket key were the JWT secret itself, anything able to sign a
     * token could mint tickets and the reverse. This builds a ticket the way
     * a naive implementation would — HMAC straight over the JWT secret — and
     * requires it to be rejected, which can only hold while the real key is a
     * derivation.
     */
    const payload = Buffer.from(
      JSON.stringify({ m: MOBILE, o: OTP_ROW, e: Math.floor(Date.now() / 1000) + 600, n: 'x' }),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const naive = createHmac('sha256', SECRET)
      .update(payload)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(() => service.read(`v1.${payload}.${naive}`)).toThrow(RegistrationTicketInvalidError);
  });

  it('accepts a ticket signed with the DERIVED key, proving the derivation is the one documented', () => {
    const derived = createHmac('sha256', SECRET).update(TICKET_KEY_DOMAIN).digest();
    const payload = Buffer.from(
      JSON.stringify({ m: MOBILE, o: OTP_ROW, e: 2_000_000_000, n: 'x' }),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const signature = createHmac('sha256', derived)
      .update(payload)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(service.read(`v1.${payload}.${signature}`, 1_000_000_000).mobileNumber).toBe(MOBILE);
  });

  it('refuses rubbish, an empty string, and the wrong number of parts', () => {
    for (const bad of ['', 'nonsense', 'v1.only-two', 'v1.a.b.c', 'v2.a.b']) {
      expect(() => service.read(bad)).toThrow(RegistrationTicketInvalidError);
    }
  });

  it('reports a forged ticket as a bad signature even when it is also expired', () => {
    // The order of the checks is itself a property: a forger must not be able
    // to tell a wrong key from a stale clock by reading the refusal.
    const payload = Buffer.from(JSON.stringify({ m: MOBILE, o: OTP_ROW, e: 1, n: 'x' }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    try {
      service.read(`v1.${payload}.AAAA`);
      throw new Error('should have refused');
    } catch (err) {
      expect((err as RegistrationTicketInvalidError).reason).toBe('BAD_SIGNATURE');
    }
  });
});

describe('a ticket expires, and the client cannot extend it', () => {
  const service = serviceWith();

  it('is valid one second before expiry', () => {
    const ticket = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW, nowSeconds: 1000 });
    expect(service.read(ticket, 1000 + TICKET_TTL_SECONDS - 1).mobileNumber).toBe(MOBILE);
  });

  it('is refused at the moment of expiry, not merely after it', () => {
    const ticket = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW, nowSeconds: 1000 });
    try {
      service.read(ticket, 1000 + TICKET_TTL_SECONDS);
      throw new Error('should have refused');
    } catch (err) {
      expect((err as RegistrationTicketInvalidError).reason).toBe('EXPIRED');
    }
  });

  it('cannot have its expiry pushed out, because the expiry is signed', () => {
    const ticket = service.issue({ mobileNumber: MOBILE, otpRequestId: OTP_ROW, nowSeconds: 1000 });
    const [, payload, signature] = ticket.split('.') as [string, string, string];
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Record<string, unknown>;
    decoded.e = 9_999_999_999;
    const extended = Buffer.from(JSON.stringify(decoded), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(() => service.read(`v1.${extended}.${signature}`, 1000)).toThrow(
      RegistrationTicketInvalidError
    );
  });
});

describe('exactly one registration credential, decided in one place', () => {
  it('reads a ticket on its own', () => {
    expect(registrationCredentialOf({ registrationTicket: 'v1.a.b' })).toEqual({
      kind: 'TICKET',
      ticket: 'v1.a.b',
    });
  });

  it('reads a mobile number and code on their own', () => {
    expect(registrationCredentialOf({ mobileNumber: '+919876543210', code: '123456' })).toEqual({
      kind: 'OTP',
      mobileNumber: '+919876543210',
      code: '123456',
    });
  });

  it('refuses a body carrying BOTH rather than silently preferring one', () => {
    const both = { registrationTicket: 'v1.a.b', mobileNumber: '+919876543210', code: '123456' };
    expect(registrationCredentialOf(both)).toBeNull();
    expect(hasConflictingCredentials(both)).toBe(true);
  });

  it('treats a ticket with a bare mobile number as a conflict too', () => {
    // No code, but still two claims about which number to register. The
    // ticket decides, so sending a second number can only be noise or an
    // attempt to steer it — refused either way.
    expect(hasConflictingCredentials({ registrationTicket: 'v1.a.b', mobileNumber: '+91987' })).toBe(
      true
    );
  });

  it('refuses a body carrying neither', () => {
    expect(registrationCredentialOf({})).toBeNull();
    expect(registrationCredentialOf({ mobileNumber: '+919876543210' })).toBeNull();
    expect(registrationCredentialOf({ code: '123456' })).toBeNull();
    expect(hasConflictingCredentials({})).toBe(false);
  });

  it('treats empty strings as absent, not as present-and-blank', () => {
    expect(registrationCredentialOf({ registrationTicket: '' })).toBeNull();
    expect(registrationCredentialOf({ mobileNumber: '', code: '123456' })).toBeNull();
    expect(hasConflictingCredentials({ registrationTicket: '', mobileNumber: '+91987' })).toBe(false);
  });
});
