import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from '@esamagri/config';

/**
 * THE REGISTRATION TICKET: proof that this mobile number was verified, a
 * moment ago, by this server.
 *
 * WHAT PROBLEM IT SOLVES. Under the common-login decision (Option 4a), a
 * resident whose number has no account verifies their OTP on the LOGIN
 * endpoint and is then carried straight to the registration form. The
 * registration call that follows must not ask for a second code — the
 * resident already proved possession of the number — but it also must not
 * believe the number the client sends it. A client-supplied `mobileNumber` is
 * a claim, not a proof: accepting one would let anybody register an account
 * for a number they have never held, which is worse than the inconvenience
 * the ticket exists to remove.
 *
 * So the number travels inside a ticket the server minted and the server
 * alone can verify, and the registration path reads the number OUT of the
 * ticket and ignores anything the body says about it.
 *
 * ================================================================
 * WHAT A TICKET IS
 * ================================================================
 *
 *   v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256 of the payload)>
 *
 * The payload carries four things and nothing else:
 *
 *   m  the CANONICAL mobile number, as `canonicalMobileForMatch` produced it.
 *      Canonical and not as-typed, so a ticket cannot be replayed against a
 *      differently-spelled form of the same number.
 *   o  the id of the `shared.otp_requests` row that was consumed to mint it.
 *      This is what anchors the ticket to a real event in the database — see
 *      below.
 *   e  the expiry, as epoch seconds. Short: TICKET_TTL_SECONDS.
 *   n  a random nonce, so two tickets for the same number in the same second
 *      are not byte-identical.
 *
 * ================================================================
 * THE FOUR THINGS THAT MAKE IT TRUSTWORTHY
 * ================================================================
 *
 * 1. IT CANNOT BE FORGED. The HMAC key is derived from `JWT_ACCESS_SECRET`,
 *    which only the server holds. A ticket with an edited number fails
 *    verification.
 *
 * 2. IT IS NOT A SESSION, AND CANNOT BECOME ONE. The key is deliberately NOT
 *    the JWT signing key: it is `HMAC(JWT_ACCESS_SECRET, TICKET_KEY_DOMAIN)`,
 *    a one-way derivation into a separate domain. A ticket is therefore not a
 *    valid bearer token and a bearer token is not a valid ticket, whichever
 *    way round somebody tries it. No new environment variable was needed for
 *    this, which matters: the change required no configuration edit.
 *
 * 3. IT EXPIRES, AND SOON. Ten minutes — long enough to type a name and a
 *    quarter number, short enough that a ticket in a log or a back button is
 *    stale before it is useful. Expiry is inside the signed payload, so a
 *    client cannot extend it.
 *
 * 4. IT IS ANCHORED IN THE DATABASE. The signature alone is not the whole
 *    check. The registration path looks up `o` and requires a row that exists,
 *    carries this exact number, was issued for the LOGIN purpose, has been
 *    CONSUMED, and was consumed within the ticket's own lifetime. So a ticket
 *    is only honoured while a genuine, recent, successful verification stands
 *    behind it — and the OTP row's own replay protection (`consumed_at`) is
 *    not bypassed but depended upon.
 *
 * ================================================================
 * WHAT IT DOES NOT DO, SAID PLAINLY
 * ================================================================
 *
 * A ticket is not single-use. Presenting the same ticket twice inside its ten
 * minutes does not create a second account — `createPifCustomer` is an upsert
 * and the second call signs the resident into the account the first one made,
 * so the "no duplicate customer records" requirement holds by construction.
 * What a second presentation does yield is a second session. That is the same
 * exposure as replaying the session token the first call already returned, so
 * single-use here would protect nothing that is not already protected, and
 * achieving it would have required a new table — which this change was not
 * authorised to add.
 *
 * A ticket is not a credential for anything else. It authorises exactly one
 * operation, the creation of a PIF account for the number inside it, and the
 * registration gate is still consulted on that call.
 */

/** Ten minutes. Long enough to fill a short form; short enough to be stale fast. */
export const TICKET_TTL_SECONDS = 600;

/**
 * The domain string the HMAC key is derived under.
 *
 * Changing it invalidates every ticket in flight, which is why it carries a
 * version: a future change gets `:v2` rather than a silent re-key.
 */
export const TICKET_KEY_DOMAIN = 'esamagri:pif-registration-ticket:v1';

const TICKET_PREFIX = 'v1';

export interface RegistrationTicketClaims {
  /** The canonical mobile number this ticket proves was verified. */
  mobileNumber: string;
  /** The `shared.otp_requests` row consumed to mint it. */
  otpRequestId: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export class RegistrationTicketInvalidError extends Error {
  constructor(readonly reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED') {
    super('The registration session is no longer valid. Please sign in again.');
    this.name = 'RegistrationTicketInvalidError';
  }
}

interface TicketPayload {
  m: string;
  o: string;
  e: number;
  n: string;
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

@Injectable()
export class RegistrationTicketService {
  private readonly key: Buffer;

  constructor(@Inject(ConfigService) config: ConfigService<ApiEnv, true>) {
    // One-way derivation into a separate key domain. See point 2 above: this
    // is what stops a ticket being a bearer token and a bearer token being a
    // ticket.
    this.key = createHmac('sha256', config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update(TICKET_KEY_DOMAIN)
      .digest();
  }

  /**
   * Mint a ticket for a number that has just been verified.
   *
   * `nowSeconds` is injectable for tests only; production always passes
   * nothing and gets the real clock.
   */
  issue(params: {
    mobileNumber: string;
    otpRequestId: string;
    nowSeconds?: number;
  }): string {
    const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
    const payload: TicketPayload = {
      m: params.mobileNumber,
      o: params.otpRequestId,
      e: now + TICKET_TTL_SECONDS,
      n: base64url(randomBytes(12)),
    };
    const encoded = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return `${TICKET_PREFIX}.${encoded}.${base64url(this.sign(encoded))}`;
  }

  /**
   * Read a ticket, or refuse it.
   *
   * THE SIGNATURE IS CHECKED BEFORE THE PAYLOAD IS BELIEVED, and the
   * comparison is constant-time. The expiry is checked last, so an attacker
   * cannot learn anything from the ORDER of the refusals: a forged ticket is
   * BAD_SIGNATURE whether or not its expiry would have passed.
   */
  read(ticket: string, nowSeconds?: number): RegistrationTicketClaims {
    const parts = ticket.split('.');
    if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) {
      throw new RegistrationTicketInvalidError('MALFORMED');
    }
    const [, encoded, signature] = parts as [string, string, string];

    const expected = this.sign(encoded);
    const presented = fromBase64url(signature);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new RegistrationTicketInvalidError('BAD_SIGNATURE');
    }

    let payload: TicketPayload;
    try {
      payload = JSON.parse(fromBase64url(encoded).toString('utf8')) as TicketPayload;
    } catch {
      // Signed, and still not readable. Only reachable if this server once
      // minted a shape it can no longer parse, so it is a malformation rather
      // than an attack — but it is refused all the same.
      throw new RegistrationTicketInvalidError('MALFORMED');
    }

    if (
      typeof payload.m !== 'string' ||
      payload.m === '' ||
      typeof payload.o !== 'string' ||
      payload.o === '' ||
      typeof payload.e !== 'number' ||
      !Number.isFinite(payload.e)
    ) {
      throw new RegistrationTicketInvalidError('MALFORMED');
    }

    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (payload.e <= now) {
      throw new RegistrationTicketInvalidError('EXPIRED');
    }

    return { mobileNumber: payload.m, otpRequestId: payload.o, expiresAt: payload.e };
  }

  private sign(encodedPayload: string): Buffer {
    return createHmac('sha256', this.key).update(encodedPayload).digest();
  }
}
