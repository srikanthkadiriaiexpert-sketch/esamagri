import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { CustomersRepository } from '../../shared/repositories/customers.repository';
import { OtpRequestsRepository, type OtpPurpose } from '../../shared/repositories/otp-requests.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { OtpService } from './otp.service';
import { TokenService, type IssuedSession } from './token.service';
import { OtpSmsService } from '../../notification/otp-sms.service';
import { canonicalMobileForMatch } from '../../shared/mobile-number';
import { PifRegistrationGate } from '../pif-registration.gate.service';
import {
  RegistrationTicketInvalidError,
  RegistrationTicketService,
  TICKET_TTL_SECONDS,
} from './registration-ticket.service';

export class OtpRateLimitedError extends Error {
  constructor() {
    super('Too many OTP requests for this mobile number. Try again later.');
    this.name = 'OtpRateLimitedError';
  }
}
export class OtpInvalidError extends Error {
  constructor(message = 'The code is incorrect.') {
    super(message);
    this.name = 'OtpInvalidError';
  }
}
export class OtpExpiredError extends Error {
  constructor() {
    super('The code has expired. Request a new one.');
    this.name = 'OtpExpiredError';
  }
}
export class OtpLockedError extends Error {
  constructor() {
    super('Too many incorrect attempts. Request a new code.');
    this.name = 'OtpLockedError';
  }
}

export class RegistrationCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationCredentialError';
  }
}

type VerifyOutcome =
  | { kind: 'valid'; otpRequestId: string }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'locked' };

/**
 * What a correct code led to.
 *
 * A DISCRIMINATED UNION RATHER THAN AN ERROR, on purpose. Two of these three
 * outcomes are not failures — the code was right in all three cases — and
 * modelling them as thrown errors is what produced the bug this replaces: a
 * resident with a correct code was told their code was incorrect, because
 * "no account" had been squeezed into `OtpInvalidError`. A union makes the
 * controller handle each one explicitly and makes a fourth outcome, if one is
 * ever added, a compile error rather than a silent fall-through.
 */
export type CustomerLoginOutcome =
  /** The number has an account. Signed in. */
  | { kind: 'SESSION'; session: IssuedSession }
  /**
   * The number has no account and self-registration is ON. The ticket proves
   * to the registration endpoint that this number was verified, so the
   * resident is never asked for a second code.
   */
  | { kind: 'NOT_REGISTERED'; registrationTicket: string; mobileNumber: string }
  /**
   * The number has no account and self-registration is OFF. No ticket exists
   * to give, and the only route left is registration by the facility.
   */
  | { kind: 'REGISTRATION_CLOSED' };

/**
 * How a registration proves which number it is for.
 *
 * Exactly one of the two, never both and never neither — the DTO enforces the
 * shape and `resolveRegistrationNumber` is written as an exhaustive switch on
 * `kind`, so a third credential cannot be added without the compiler asking
 * what it proves.
 */
export type RegistrationCredential =
  /** "Create an account" — a REGISTER-purpose code for a number in the body. */
  | { kind: 'OTP'; mobileNumber: string; code: string }
  /** Common login — a signed ticket that carries the number itself. */
  | { kind: 'TICKET'; ticket: string };

/**
 * Customer authentication: ONE mobile-number login for every resident,
 * whether the facility has approved them for rations or not.
 *
 * ================================================================
 * ONE LOGIN, AND THE SERVER DECIDES WHO YOU ARE
 * ================================================================
 *
 * There is one login screen, one OTP, and three things a correct code can
 * mean — see `CustomerLoginOutcome`. The client chooses none of them: it does
 * not say whether it thinks it is a RIK officer or a PIF resident, and it
 * could not be believed if it did. RIK authorisation is read from
 * `shared.customers.rik_id` by the server, on every request that depends on
 * it, and nothing a client sends can add to it.
 *
 * `requestOtp` STILL ANSWERS IDENTICALLY whether or not the number belongs to
 * a real customer. That has not changed and must not: step one of a login
 * must not be a way to find out which numbers exist. Rate limiting is also
 * still per number regardless of whether an account is behind it, since it
 * guards the otp_requests table and the SMS bill rather than an account.
 *
 * WHAT DID CHANGE, AND WHY. `verifyOtp` used to report "correct code, no such
 * account" as `OtpInvalidError`, identically to a wrong code, so that the
 * verify step could not be used as an enumeration oracle either. The price
 * was that a resident holding a code that was genuinely correct was told it
 * was incorrect, and had no way to discover that what they actually needed
 * was to register. The approved common-login decision reverses that trade:
 * verify now says so, and hands back a short-lived registration ticket. The
 * disclosure is bounded by the fact that a caller must already hold a valid
 * code for the number they are asking about. See the branch itself for the
 * full reasoning.
 *
 * MOBILE NUMBER CANONICALISATION (Task 2, approved decision T2-4).
 *
 * Officers are stored with a canonical ten-digit number, because
 * RikOfficerService normalises before inserting. RequestOtpDto, however,
 * accepts `^\+?[1-9]\d{7,14}$` — so an officer registered as 9876543210 who
 * typed +919876543210 at the login screen was looked up verbatim, not found,
 * and told their code was incorrect (the no-account branch deliberately
 * reports the same error as a wrong code, to avoid an enumeration oracle). The
 * effect was a correct officer being unable to sign in, with a message that
 * sent them looking for the wrong problem.
 *
 * Every path below now canonicalises through the ONE shared implementation in
 * shared/mobile-number.ts — the same one RIK registration, the eligibility
 * import and PIF self-registration use. Both halves of a login canonicalise,
 * because the OTP row is keyed on the number as written and a code requested
 * under one form must be verifiable under the other.
 *
 * `canonicalMobileForMatch` falls back to the input when it is not an Indian
 * mobile, so a number that works today cannot stop working: the change can
 * only ADD a match. The customer lookup additionally retries the raw form,
 * which covers any historic row stored in a non-canonical shape.
 *
 * One known limit, stated rather than hidden: an OTP requested before this
 * change, under a non-canonical number, will not verify after it. Codes expire
 * in minutes, so the window is the deployment itself.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly customers: CustomersRepository,
    private readonly otpRequests: OtpRequestsRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly otpSms: OtpSmsService,
    /**
     * Consulted when a correct code belongs to no account: whether there is a
     * registration path to offer at all. Asked HERE rather than in the
     * controller so that no ticket is minted when registration is off — the
     * cheapest way to be sure one cannot leak out of a branch that should not
     * have reached for it.
     */
    private readonly selfRegistration: PifRegistrationGate,
    private readonly tickets: RegistrationTicketService
  ) {}

  async requestOtp(rawMobileNumber: string, ipAddress: string | null, deviceInfo: string | null): Promise<void> {
    return this.issueOtp(rawMobileNumber, 'LOGIN', ipAddress, deviceInfo);
  }

  /**
   * The registration code, for a resident who has no account yet.
   *
   * Purpose 'REGISTER' rather than 'LOGIN'. That value is not new: it has been
   * in the otp_requests_purpose_chk CHECK constraint since migration 0004 and
   * in the OtpPurpose type since the repository was written, so this needs no
   * migration. It matters because a code issued to register must not be
   * usable to sign in to an account that already exists, and vice versa —
   * findLatestActiveForUpdate filters on purpose, so the two are separate
   * pools.
   *
   * It answers IDENTICALLY whether or not the number is already registered,
   * for the same reason requestOtp does: anything else turns this into an
   * oracle for which numbers have accounts.
   *
   * The rate limit is deliberately SHARED with login — countRecentForMobile
   * does not filter on purpose — because what it protects is the SMS bill and
   * the otp_requests table, not an account. A caller cannot double their
   * budget by alternating between the two endpoints.
   */
  async requestRegistrationOtp(
    rawMobileNumber: string,
    ipAddress: string | null,
    deviceInfo: string | null
  ): Promise<void> {
    return this.issueOtp(rawMobileNumber, 'REGISTER', ipAddress, deviceInfo);
  }

  private async issueOtp(
    rawMobileNumber: string,
    purpose: OtpPurpose,
    ipAddress: string | null,
    deviceInfo: string | null
  ): Promise<void> {
    const mobileNumber = canonicalMobileForMatch(rawMobileNumber);
    // Only a non-LOGIN purpose is recorded, so existing LOGIN audit rows keep
    // exactly the shape they have always had.
    const purposeDetail = purpose === 'LOGIN' ? {} : { purpose };
    const recentCount = await this.otpRequests.countRecentForMobile(mobileNumber, this.otp.requestWindowSeconds());
    if (recentCount >= this.otp.requestMaxPerWindow()) {
      this.logger.warn(`OTP request rate-limited for mobile hash ${this.hashForAudit(mobileNumber)}`);
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'CUSTOMER',
        module: 'shared',
        action: 'OTP_REQUEST_RATE_LIMITED',
        entityType: 'shared.otp_requests',
        entityId: null,
        after: { mobileNumberHash: this.hashForAudit(mobileNumber), ...purposeDetail },
        ipAddress,
        deviceInfo,
      });
      throw new OtpRateLimitedError();
    }

    const code = this.otp.generateCode();
    const otpHash = this.otp.hashCode(code);
    const expiresAt = new Date(Date.now() + this.otp.ttlSeconds() * 1000);

    await this.otpRequests.create({
      mobileNumber,
      otpHash,
      purpose,
      expiresAt,
      maxAttempts: this.otp.maxAttempts(),
    });

    await this.auditLog.logEvent({
      actorId: null,
      actorRole: 'CUSTOMER',
      module: 'shared',
      action: 'OTP_REQUESTED',
      entityType: 'shared.otp_requests',
      entityId: null,
      after: { mobileNumberHash: this.hashForAudit(mobileNumber), ...purposeDetail },
      ipAddress,
      deviceInfo,
    });

    // Delivery. `code` is handed to OtpSmsService and to nothing else:
    // it is still never logged here, never returned, and never written
    // anywhere but as its HMAC above. The provider is a transport only —
    // verification remains entirely local (see OtpSmsService's doc).
    //
    // A delivery failure deliberately does NOT throw. requestOtp answers
    // identically whether or not the number belongs to a real customer
    // (see the class doc above), and a gateway outage must not become
    // the one case that answers differently — that would turn an SMS
    // problem into an account-enumeration oracle. The OTP row stays as
    // written: a code nobody receives simply goes unused and expires.
    //
    // Only failures are audited. A successful send is logged by the
    // service; recording every one here would fill shared.audit_log with
    // routine traffic, which the authorization layer's own doc warns
    // against.
    const delivery = await this.otpSms.send(mobileNumber, code);
    if (delivery.status === 'FAILED') {
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'CUSTOMER',
        module: 'shared',
        action: 'OTP_DELIVERY_FAILED',
        entityType: 'shared.otp_requests',
        entityId: null,
        after: {
          mobileNumberHash: this.hashForAudit(mobileNumber),
          reason: delivery.reason,
          ...purposeDetail,
        },
        ipAddress,
        deviceInfo,
      });
    }
  }

  /**
   * Verifies a presented code and, on success, issues a session. The
   * find + expiry/lock check + increment sequence runs inside one
   * DatabaseService.withTransaction with `SELECT ... FOR UPDATE` on the
   * OTP row (OtpRequestsRepository.findLatestActiveForUpdate), so two
   * concurrent verify attempts against the same OTP request can't both
   * pass the attempt-count check before either one increments it.
   */
  async verifyOtp(params: {
    mobileNumber: string;
    code: string;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<CustomerLoginOutcome> {
    const mobileNumber = canonicalMobileForMatch(params.mobileNumber);
    const otpRequestId = await this.consumeOtp({
      mobileNumber,
      code: params.code,
      purpose: 'LOGIN',
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    const customer = await this.findCustomerByAnyForm(mobileNumber, params.mobileNumber);
    if (!customer) {
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'CUSTOMER',
        module: 'shared',
        action: 'OTP_VERIFY_NO_ACCOUNT',
        entityType: 'shared.customers',
        entityId: null,
        after: { mobileNumberHash: this.hashForAudit(mobileNumber) },
        ipAddress: params.ipAddress,
        deviceInfo: params.deviceInfo,
      });

      /**
       * A CORRECT CODE IS NO LONGER REPORTED AS AN INCORRECT ONE.
       *
       * This branch used to throw `OtpInvalidError`, so that requesting and
       * verifying a code could not be used to discover which numbers have
       * accounts. The cost of that was a resident holding a correct code
       * being told it was wrong — a false statement, and one that sent them
       * to the wrong problem. The approved common-login decision reverses
       * the trade and carries them into registration instead.
       *
       * WHAT STILL BOUNDS THE DISCLOSURE. To reach this line a caller must
       * already hold a valid, unexpired, unconsumed code for the number they
       * are asking about. Nothing here answers for a number the caller has
       * not already received an SMS for, so the oracle cannot be swept across
       * a range; and `requestOtp` itself is unchanged, still answering
       * identically whether or not an account exists.
       */
      if (!(await this.selfRegistration.isEnabled())) {
        return { kind: 'REGISTRATION_CLOSED' };
      }

      const registrationTicket = this.tickets.issue({ mobileNumber, otpRequestId });
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'CUSTOMER',
        module: 'shared',
        action: 'REGISTRATION_TICKET_ISSUED',
        entityType: 'shared.otp_requests',
        entityId: otpRequestId,
        after: { mobileNumberHash: this.hashForAudit(mobileNumber) },
        ipAddress: params.ipAddress,
        deviceInfo: params.deviceInfo,
      });

      // The number is returned so the app can SHOW it on the registration
      // form. It is display only: the registration call reads the number it
      // acts on out of the ticket and ignores anything the body claims.
      return { kind: 'NOT_REGISTERED', registrationTicket, mobileNumber };
    }

    const session = await this.tokens.issueSession({
      principalType: 'CUSTOMER',
      principalId: customer.id,
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    await this.auditLog.logEvent({
      actorId: customer.id,
      actorRole: 'CUSTOMER',
      module: 'shared',
      action: 'CUSTOMER_LOGIN_SUCCESS',
      entityType: 'shared.customers',
      entityId: customer.id,
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    return { kind: 'SESSION', session };
  }

  /**
   * PIF self-registration: verify the code, create the account, sign them in.
   *
   * AN ALREADY-REGISTERED NUMBER IS NOT AN ERROR, AND NOT A DUPLICATE. The
   * resident is signed in to the account they already have. That single
   * decision answers three requirements at once:
   *
   *   * no duplicate account, because nothing is inserted (requirement 5);
   *   * no enumeration oracle, because registering a known number and an
   *     unknown one produce the same outcome — a session — so the caller
   *     learns nothing about which numbers exist (requirement 6 of the
   *     earlier security review);
   *   * an existing RIK officer who taps "register" lands in their own
   *     account with their rik_id untouched and RIK access intact
   *     (requirement 13), rather than being told their number is taken.
   *
   * The race is handled in the database, not here: ON CONFLICT DO NOTHING plus
   * `customers_mobile_uq` means two simultaneous registrations cannot both
   * insert, and the loser reads the winner's row.
   *
   * WHAT IT DOES NOT WRITE: no rik_id (passed explicitly as NULL), no
   * dietary_preference (left NULL), no official_name, no is_active override.
   * See CustomersRepository.createPifCustomer.
   */
  async registerCustomer(params: {
    credential: RegistrationCredential;
    name: string;
    quarterBlock: string;
    quarterNumber: string;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<IssuedSession> {
    const mobileNumber = await this.resolveRegistrationNumber(params.credential, {
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    const { customer, created } = await this.customers.createPifCustomer({
      mobileNumber,
      name: params.name.trim(),
      quarterBlock: params.quarterBlock.trim(),
      quarterNumber: params.quarterNumber.trim(),
    });

    const session = await this.tokens.issueSession({
      principalType: 'CUSTOMER',
      principalId: customer.id,
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    await this.auditLog.logEvent({
      actorId: customer.id,
      actorRole: 'CUSTOMER',
      module: 'shared',
      action: created ? 'CUSTOMER_SELF_REGISTERED' : 'CUSTOMER_LOGIN_SUCCESS',
      entityType: 'shared.customers',
      entityId: customer.id,
      after: created
        ? { mobileNumberHash: this.hashForAudit(mobileNumber), viaSelfRegistration: true }
        : { mobileNumberHash: this.hashForAudit(mobileNumber), existingAccount: true },
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    return session;
  }

  /**
   * THE NUMBER A REGISTRATION ACTS ON, AND WHERE IT IS ALLOWED TO COME FROM.
   *
   * Two credentials reach registration, and both end in a number the SERVER
   * established rather than one the client asserted:
   *
   *   OTP     the resident came through "Create an account", so they hold a
   *           REGISTER-purpose code. It is consumed here, exactly as before —
   *           same transaction, same lock, same attempt counting. The number
   *           is canonicalised from the body, but the body is only believed
   *           because a code delivered to that number was presented with it.
   *
   *   TICKET  the resident came through the common login, verified a
   *           LOGIN-purpose code, and had no account. The number comes OUT OF
   *           THE SIGNED TICKET. Any `mobileNumber` in the body is not
   *           consulted — the DTO refuses to carry one on this path at all.
   *
   * PURPOSE SEPARATION SURVIVES BOTH. A LOGIN code still cannot be presented
   * as a REGISTER code or the reverse: `consumeOtp` filters on purpose, and
   * the ticket path consumes nothing, it only cites a row that the LOGIN
   * verify already consumed. The two pools remain distinct.
   */
  private async resolveRegistrationNumber(
    credential: RegistrationCredential,
    context: { ipAddress: string | null; deviceInfo: string | null }
  ): Promise<string> {
    if (credential.kind === 'OTP') {
      const mobileNumber = canonicalMobileForMatch(credential.mobileNumber);
      await this.consumeOtp({
        mobileNumber,
        code: credential.code,
        purpose: 'REGISTER',
        ipAddress: context.ipAddress,
        deviceInfo: context.deviceInfo,
      });
      return mobileNumber;
    }

    // Signature first: nothing in the payload is believed until the HMAC and
    // the expiry have both passed. Throws RegistrationTicketInvalidError.
    const claims = this.tickets.read(credential.ticket);

    /**
     * THE DATABASE ANCHOR. A valid signature says this server minted the
     * ticket; this read says the verification it refers to really happened,
     * was a LOGIN verification, was for this very number, and is still
     * recent. Both must hold.
     *
     * The window is the ticket's own TTL, so an expired ticket and a stale
     * anchor cannot disagree about how long "recent" is.
     */
    const anchor = await this.otpRequests.findConsumedById(
      claims.otpRequestId,
      'LOGIN',
      TICKET_TTL_SECONDS
    );
    if (anchor === null || anchor.mobile_number !== claims.mobileNumber) {
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'CUSTOMER',
        module: 'shared',
        action: 'REGISTRATION_TICKET_REJECTED',
        entityType: 'shared.otp_requests',
        entityId: null,
        after: {
          mobileNumberHash: this.hashForAudit(claims.mobileNumber),
          reason: anchor === null ? 'no_recent_consumed_verification' : 'number_mismatch',
        },
        ipAddress: context.ipAddress,
        deviceInfo: context.deviceInfo,
      });
      throw new RegistrationTicketInvalidError('BAD_SIGNATURE');
    }

    return claims.mobileNumber;
  }

  /**
   * Verify and consume a code for one purpose, then return.
   *
   * Extracted from verifyOtp so login and registration share ONE
   * implementation of the part that must not be got wrong: the find, the
   * expiry and lock checks and the attempt increment run inside a single
   * DatabaseService.withTransaction with `SELECT ... FOR UPDATE` on the OTP
   * row, so two concurrent attempts against the same request cannot both pass
   * the attempt-count check before either increments it. A second copy of this
   * for registration would be a second chance to get that wrong.
   */
  private async consumeOtp(params: {
    mobileNumber: string;
    code: string;
    purpose: OtpPurpose;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<string> {
    const { mobileNumber } = params;

    const outcome = await this.db.withTransaction<VerifyOutcome>(async (client) => {
      const record = await this.otpRequests.findLatestActiveForUpdate(
        client,
        mobileNumber,
        params.purpose
      );
      if (!record) {
        return { kind: 'invalid' };
      }
      if (record.expires_at.getTime() <= Date.now()) {
        return { kind: 'expired' };
      }
      if (record.attempt_count >= record.max_attempts) {
        return { kind: 'locked' };
      }

      const matches = this.otp.verifyCode(params.code, record.otp_hash);
      if (!matches) {
        await this.otpRequests.incrementAttempt(client, record.id);
        return { kind: 'invalid' };
      }

      await this.otpRequests.markConsumed(client, record.id);
      // The row id travels back so a caller that needs to cite this
      // verification later — the registration ticket does — refers to the
      // row that was actually consumed rather than looking one up again and
      // possibly finding a different one.
      return { kind: 'valid', otpRequestId: record.id };
    });

    if (outcome.kind !== 'valid') {
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'CUSTOMER',
        module: 'shared',
        action: 'OTP_VERIFY_FAILURE',
        entityType: 'shared.otp_requests',
        entityId: null,
        after: { mobileNumberHash: this.hashForAudit(mobileNumber), reason: outcome.kind },
        ipAddress: params.ipAddress,
        deviceInfo: params.deviceInfo,
      });
      if (outcome.kind === 'expired') throw new OtpExpiredError();
      if (outcome.kind === 'locked') throw new OtpLockedError();
      throw new OtpInvalidError();
    }

    return outcome.otpRequestId;
  }

  /**
   * Audit rows must never carry a raw mobile number as free-text
   * beyond what's operationally needed, and never the OTP code. A
   * short, non-reversible hash lets an investigator correlate "same
   * number, multiple events" across audit rows without the audit log
   * becoming a second copy of customers' phone numbers.
   */
  /**
   * The customer behind a number, trying the canonical form first and the form
   * as typed second.
   *
   * The second attempt is pure insurance for a row that predates
   * canonicalisation or was loaded by a demo script in a non-canonical shape.
   * It runs only when the two forms differ and the first found nothing, so it
   * adds no query on the normal path and can only add a match.
   */
  private async findCustomerByAnyForm(canonical: string, asTyped: string) {
    const found = await this.customers.findByMobileNumber(canonical);
    if (found !== null || canonical === asTyped) return found;
    return this.customers.findByMobileNumber(asTyped);
  }

  private hashForAudit(mobileNumber: string): string {
    return createHash('sha256').update(mobileNumber).digest('hex').slice(0, 16);
  }
}
