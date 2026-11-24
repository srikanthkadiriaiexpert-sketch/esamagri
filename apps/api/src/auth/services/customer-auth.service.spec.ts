import {
  CustomerAuthService,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpRateLimitedError,
} from './customer-auth.service';
import { RegistrationTicketInvalidError } from './registration-ticket.service';

/**
 * Customer login and PIF self-registration, without a database.
 *
 * The branches that matter here are the ones where getting it wrong is quiet
 * rather than loud: a registration that creates a second account for a number
 * that already has one, a login that cannot find an officer because nobody
 * canonicalised the number, a registration that writes a dietary preference or
 * a RIK ID it had no business writing, or an error message that tells an
 * attacker which numbers are registered.
 *
 * The fakes record calls and return what they are told. `withTransaction` runs
 * the callback with a stub client, which is enough because the transactional
 * guarantees belong to PostgreSQL, not to this service.
 */

const CUSTOMER_ID = '11111111-1111-7111-8111-111111111111';
const SESSION = { accessToken: 'at', refreshToken: 'rt', principal: {} } as never;

function otpRow(over: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    mobile_number: '9876543210',
    otp_hash: 'hashed',
    purpose: 'LOGIN',
    expires_at: new Date(Date.now() + 60_000),
    attempt_count: 0,
    max_attempts: 5,
    consumed_at: null,
    created_at: new Date(),
    ...over,
  };
}

function customerRow(over: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    mobile_number: '9876543210',
    name: 'Anil',
    is_active: true,
    dietary_preference: null,
    ...over,
  };
}

interface Harness {
  service: CustomerAuthService;
  customers: {
    findByMobileNumber: jest.Mock;
    findById: jest.Mock;
    createPifCustomer: jest.Mock;
  };
  otpRequests: {
    create: jest.Mock;
    countRecentForMobile: jest.Mock;
    findLatestActiveForUpdate: jest.Mock;
    incrementAttempt: jest.Mock;
    markConsumed: jest.Mock;
    findConsumedById: jest.Mock;
  };
  auditLog: { logEvent: jest.Mock };
  otp: {
    generateCode: jest.Mock;
    hashCode: jest.Mock;
    verifyCode: jest.Mock;
    ttlSeconds: jest.Mock;
    maxAttempts: jest.Mock;
    requestWindowSeconds: jest.Mock;
    requestMaxPerWindow: jest.Mock;
  };
  tokens: { issueSession: jest.Mock };
  otpSms: { send: jest.Mock };
  selfRegistration: { isEnabled: jest.Mock };
  tickets: { issue: jest.Mock; read: jest.Mock };
  actions: () => string[];
}

function harness(
  over: {
    existingCustomer?: unknown;
    otp?: unknown;
    codeMatches?: boolean;
    created?: boolean;
    /** Whether an administrator has switched PIF self-registration on. */
    selfRegistrationEnabled?: boolean;
    /** The consumed OTP row a registration ticket cites, or null for none. */
    anchor?: unknown;
  } = {}
): Harness {
  const db = {
    withTransaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({})),
  };
  const customers = {
    findByMobileNumber: jest
      .fn()
      .mockResolvedValue('existingCustomer' in over ? over.existingCustomer : null),
    findById: jest.fn().mockResolvedValue(customerRow()),
    createPifCustomer: jest.fn().mockResolvedValue({
      customer: customerRow(),
      created: over.created ?? true,
    }),
  };
  const otpRequests = {
    create: jest.fn().mockResolvedValue(undefined),
    countRecentForMobile: jest.fn().mockResolvedValue(0),
    // `in` rather than `??`: an explicit `otp: null` means "no outstanding
    // code", and `null ?? otpRow()` would have silently restored the default
    // and made that test pass for the wrong reason.
    findLatestActiveForUpdate: jest
      .fn()
      .mockResolvedValue('otp' in over ? over.otp : otpRow()),
    incrementAttempt: jest.fn().mockResolvedValue(1),
    markConsumed: jest.fn().mockResolvedValue(undefined),
    // The database anchor a registration ticket cites. Defaults to a genuine
    // recently-consumed LOGIN row for this number; the tests that care about
    // a missing or mismatched anchor override it.
    findConsumedById: jest
      .fn()
      .mockResolvedValue(
        'anchor' in over ? over.anchor : otpRow({ purpose: 'LOGIN', consumed_at: new Date() })
      ),
  };
  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') };
  const otp = {
    generateCode: jest.fn().mockReturnValue('123456'),
    hashCode: jest.fn().mockReturnValue('hashed'),
    verifyCode: jest.fn().mockReturnValue(over.codeMatches ?? true),
    ttlSeconds: jest.fn().mockReturnValue(300),
    maxAttempts: jest.fn().mockReturnValue(5),
    requestWindowSeconds: jest.fn().mockReturnValue(900),
    requestMaxPerWindow: jest.fn().mockReturnValue(3),
  };
  const tokens = { issueSession: jest.fn().mockResolvedValue(SESSION) };
  const otpSms = { send: jest.fn().mockResolvedValue({ status: 'SENT' }) };
  /**
   * The registration gate, defaulting to ON.
   *
   * ON by default so that the common-login path — correct code, no account,
   * carry them to registration — is what the unmarked tests exercise. The
   * closed case is asked for explicitly, which is the right way round: the
   * open path is the one with a ticket in it.
   */
  const selfRegistration = {
    isEnabled: jest.fn().mockResolvedValue(over.selfRegistrationEnabled ?? true),
  };
  /**
   * The ticket service is a STUB, not the real one.
   *
   * These tests are about what the service DECIDES — whether a ticket is
   * minted at all, whether the anchor is checked, which number is registered.
   * The ticket's own cryptography is proved to the byte in
   * registration-ticket.service.spec.ts, and verifying a real signature here
   * would make every one of these tests depend on a config secret for no
   * additional assurance.
   */
  const tickets = {
    issue: jest.fn().mockReturnValue('v1.stub.ticket'),
    read: jest.fn().mockReturnValue({
      mobileNumber: '9876543210',
      otpRequestId: 'otp-1',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }),
  };

  const service = new CustomerAuthService(
    db as never,
    customers as never,
    otpRequests as never,
    auditLog as never,
    otp as never,
    tokens as never,
    otpSms as never,
    selfRegistration as never,
    tickets as never
  );

  return {
    service,
    customers,
    otpRequests,
    auditLog,
    otp,
    tokens,
    otpSms,
    selfRegistration,
    tickets,
    actions: () => auditLog.logEvent.mock.calls.map((c) => c[0].action),
  };
}

/**
 * The "Create an account" registration: a REGISTER-purpose code, with the
 * number it was sent to. Unchanged in substance — the number and code simply
 * moved inside `credential`, because a registration can now also arrive with
 * a ticket instead and the two must not be confusable.
 */
const REGISTRATION = {
  credential: { kind: 'OTP' as const, mobileNumber: '9876543210', code: '123456' },
  name: 'Anil',
  quarterBlock: 'B',
  quarterNumber: '12',
  ipAddress: null,
  deviceInfo: null,
};

/** The same registration arriving from the common login, with a ticket. */
const TICKET_REGISTRATION = {
  credential: { kind: 'TICKET' as const, ticket: 'v1.stub.ticket' },
  name: 'Anil',
  quarterBlock: 'B',
  quarterNumber: '12',
  ipAddress: null,
  deviceInfo: null,
};

// ---------------------------------------------------------------------------

describe('requestRegistrationOtp', () => {
  it('writes an OTP with purpose REGISTER, not LOGIN', async () => {
    const h = harness();
    await h.service.requestRegistrationOtp('9876543210', null, null);
    expect(h.otpRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'REGISTER', mobileNumber: '9876543210' })
    );
  });

  it('canonicalises the number before storing it', async () => {
    const h = harness();
    await h.service.requestRegistrationOtp('+91 98765 43210', null, null);
    expect(h.otpRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({ mobileNumber: '9876543210' })
    );
  });

  it('sends the code, and never logs or returns it', async () => {
    const h = harness();
    await h.service.requestRegistrationOtp('9876543210', null, null);
    expect(h.otpSms.send).toHaveBeenCalledWith('9876543210', '123456');
    const audited = JSON.stringify(h.auditLog.logEvent.mock.calls);
    expect(audited).not.toContain('123456');
  });

  it('shares the rate limit with login, so the two cannot be alternated', async () => {
    const h = harness();
    h.otpRequests.countRecentForMobile.mockResolvedValue(3);
    await expect(
      h.service.requestRegistrationOtp('9876543210', null, null)
    ).rejects.toBeInstanceOf(OtpRateLimitedError);
    // No purpose argument: one budget per number, whatever it is for.
    expect(h.otpRequests.countRecentForMobile).toHaveBeenCalledWith('9876543210', 900);
  });

  it('records the purpose on the audit row so the two flows are distinguishable', async () => {
    const h = harness();
    await h.service.requestRegistrationOtp('9876543210', null, null);
    const requested = h.auditLog.logEvent.mock.calls.find((c) => c[0].action === 'OTP_REQUESTED');
    expect(requested![0].after).toMatchObject({ purpose: 'REGISTER' });
  });

  it('leaves the LOGIN audit payload exactly as it was, with no purpose field', async () => {
    const h = harness();
    await h.service.requestOtp('9876543210', null, null);
    const requested = h.auditLog.logEvent.mock.calls.find((c) => c[0].action === 'OTP_REQUESTED');
    expect(requested![0].after).not.toHaveProperty('purpose');
  });
});

describe('registerCustomer — the happy path', () => {
  it('creates the account and issues a session', async () => {
    const h = harness({ created: true });
    const session = await h.service.registerCustomer(REGISTRATION);

    expect(h.customers.createPifCustomer).toHaveBeenCalledTimes(1);
    expect(h.tokens.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ principalType: 'CUSTOMER', principalId: CUSTOMER_ID })
    );
    expect(session).toBe(SESSION);
  });

  it('collects exactly the four approved fields and nothing else', async () => {
    const h = harness();
    await h.service.registerCustomer(REGISTRATION);
    expect(Object.keys(h.customers.createPifCustomer.mock.calls[0][0]).sort()).toEqual([
      'mobileNumber',
      'name',
      'quarterBlock',
      'quarterNumber',
    ]);
  });

  it('SENDS NO RIK ID — a resident registering for PIF gets none', async () => {
    const h = harness();
    await h.service.registerCustomer(REGISTRATION);
    const sent = h.customers.createPifCustomer.mock.calls[0][0];
    expect(sent).not.toHaveProperty('rikId');
    expect(sent).not.toHaveProperty('rik_id');
  });

  it('SENDS NO DIETARY PREFERENCE — it stays NULL through registration', async () => {
    const h = harness();
    await h.service.registerCustomer(REGISTRATION);
    const sent = h.customers.createPifCustomer.mock.calls[0][0];
    expect(sent).not.toHaveProperty('dietaryPreference');
    expect(sent).not.toHaveProperty('dietary_preference');
  });

  it('sends no official_name, is_active or created_by', async () => {
    const h = harness();
    await h.service.registerCustomer(REGISTRATION);
    const sent = h.customers.createPifCustomer.mock.calls[0][0];
    expect(sent).not.toHaveProperty('officialName');
    expect(sent).not.toHaveProperty('isActive');
    expect(sent).not.toHaveProperty('createdBy');
  });

  it('trims the name and the quarter before storing them', async () => {
    const h = harness();
    await h.service.registerCustomer({
      ...REGISTRATION,
      name: '  Anil  ',
      quarterBlock: ' B ',
      quarterNumber: ' 12 ',
    });
    expect(h.customers.createPifCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Anil', quarterBlock: 'B', quarterNumber: '12' })
    );
  });

  it('canonicalises the number, so registration and login agree on it', async () => {
    const h = harness();
    await h.service.registerCustomer({
      ...REGISTRATION,
      credential: { kind: 'OTP', mobileNumber: '+919876543210', code: '123456' },
    });
    expect(h.customers.createPifCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ mobileNumber: '9876543210' })
    );
  });

  it('audits a real registration as CUSTOMER_SELF_REGISTERED', async () => {
    const h = harness({ created: true });
    await h.service.registerCustomer(REGISTRATION);
    expect(h.actions()).toContain('CUSTOMER_SELF_REGISTERED');
  });
});

describe('registerCustomer — the OTP is mandatory', () => {
  it('consumes a REGISTER code, never a LOGIN one', async () => {
    const h = harness();
    await h.service.registerCustomer(REGISTRATION);
    expect(h.otpRequests.findLatestActiveForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      '9876543210',
      'REGISTER'
    );
  });

  it('creates nothing when there is no outstanding code', async () => {
    const h = harness({ otp: null });
    await expect(h.service.registerCustomer(REGISTRATION)).rejects.toBeInstanceOf(OtpInvalidError);
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
    expect(h.tokens.issueSession).not.toHaveBeenCalled();
  });

  it('creates nothing when the code is wrong, and counts the attempt', async () => {
    const h = harness({ codeMatches: false });
    await expect(h.service.registerCustomer(REGISTRATION)).rejects.toBeInstanceOf(OtpInvalidError);
    expect(h.otpRequests.incrementAttempt).toHaveBeenCalledTimes(1);
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
  });

  it('creates nothing when the code has expired', async () => {
    const h = harness({ otp: otpRow({ expires_at: new Date(Date.now() - 1000) }) });
    await expect(h.service.registerCustomer(REGISTRATION)).rejects.toBeInstanceOf(OtpExpiredError);
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
  });

  it('creates nothing when the attempts are exhausted', async () => {
    const h = harness({ otp: otpRow({ attempt_count: 5, max_attempts: 5 }) });
    await expect(h.service.registerCustomer(REGISTRATION)).rejects.toBeInstanceOf(OtpLockedError);
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
  });

  it('marks the code consumed, so it cannot be replayed', async () => {
    const h = harness();
    await h.service.registerCustomer(REGISTRATION);
    expect(h.otpRequests.markConsumed).toHaveBeenCalledTimes(1);
  });
});

describe('registerCustomer — a number that already has an account', () => {
  it('creates NO duplicate and signs the resident in to the account they have', async () => {
    const h = harness({ created: false });
    const session = await h.service.registerCustomer(REGISTRATION);

    expect(session).toBe(SESSION);
    expect(h.tokens.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: CUSTOMER_ID })
    );
  });

  it('audits it as a login, not as a registration', async () => {
    const h = harness({ created: false });
    await h.service.registerCustomer(REGISTRATION);
    expect(h.actions()).toContain('CUSTOMER_LOGIN_SUCCESS');
    expect(h.actions()).not.toContain('CUSTOMER_SELF_REGISTERED');
  });

  it('is indistinguishable to the caller from a first registration', async () => {
    // Both return a session. Nothing in the result says whether the account
    // already existed, so this endpoint is not an oracle for which numbers
    // are registered.
    const first = await harness({ created: true }).service.registerCustomer(REGISTRATION);
    const again = await harness({ created: false }).service.registerCustomer(REGISTRATION);
    expect(first).toEqual(again);
  });
});

// ---------------------------------------------------------------------------
// AN EXISTING RIK OFFICER WHO TAPS "CREATE AN ACCOUNT" (Stage 2, requirement 3)
//
// The block above proves no duplicate row is created. These prove the part
// that matters to an officer specifically: the account they are signed into is
// THEIR OWN, carrying the rik_id they already hold, and registering is not a
// way around the code.
//
// The field-level guarantees are not re-asserted here — "collects exactly the
// four approved fields" and "SENDS NO RIK ID" above already pin the payload,
// and a second copy of them would be a second place for them to drift.
// ---------------------------------------------------------------------------

describe('registerCustomer — an existing RIK officer who registers', () => {
  const OFFICER_RIK_ID = 'RIK-000042';

  /** An officer's row: same id, but holding a RIK ID, and already existing. */
  function officerHarness(over: { codeMatches?: boolean } = {}) {
    const h = harness({ created: false, ...over });
    h.customers.createPifCustomer.mockResolvedValue({
      customer: customerRow({ rik_id: OFFICER_RIK_ID, name: 'Anil' }),
      created: false,
    });
    return h;
  }

  it('signs them into their own row, so the rik_id they held is the one they keep', async () => {
    const h = officerHarness();
    await h.service.registerCustomer(REGISTRATION);

    expect(h.tokens.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ principalType: 'CUSTOMER', principalId: CUSTOMER_ID })
    );
    // Nothing in this path writes rik_id, so the value read back is the one
    // the officer already had. shared.trg_protect_officer_rik_id() refuses a
    // change to it at the database as well — two independent guarantees.
    const { customer } = await h.customers.createPifCustomer.mock.results[0].value;
    expect(customer.rik_id).toBe(OFFICER_RIK_ID);
  });

  it('records it as a login, not as a new self-registration', async () => {
    const h = officerHarness();
    await h.service.registerCustomer(REGISTRATION);

    expect(h.actions()).toContain('CUSTOMER_LOGIN_SUCCESS');
    expect(h.actions()).not.toContain('CUSTOMER_SELF_REGISTERED');
  });

  it('attempts the insert exactly once — ON CONFLICT decides, not a pre-check', async () => {
    const h = officerHarness();
    await h.service.registerCustomer(REGISTRATION);
    expect(h.customers.createPifCustomer).toHaveBeenCalledTimes(1);
  });

  it('still requires a valid REGISTER code — being an officer is not a bypass', async () => {
    const h = officerHarness({ codeMatches: false });

    await expect(h.service.registerCustomer(REGISTRATION)).rejects.toBeInstanceOf(OtpInvalidError);
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
    expect(h.tokens.issueSession).not.toHaveBeenCalled();
  });
});

describe('verifyOtp — login is unchanged, and now finds a canonicalised number', () => {
  it('consumes a LOGIN code, never a REGISTER one', async () => {
    const h = harness({ existingCustomer: customerRow() });
    await h.service.verifyOtp({
      mobileNumber: '9876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(h.otpRequests.findLatestActiveForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      '9876543210',
      'LOGIN'
    );
  });

  /**
   * The defect this fixes: an officer stored as 9876543210 who typed
   * +919876543210 was looked up verbatim, not found, and told their code was
   * incorrect.
   */
  it('finds an officer who typed +91 in front of their number', async () => {
    const h = harness({ existingCustomer: customerRow() });
    const outcome = await h.service.verifyOtp({
      mobileNumber: '+919876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(h.customers.findByMobileNumber).toHaveBeenCalledWith('9876543210');
    expect(outcome).toEqual({ kind: 'SESSION', session: SESSION });
  });

  it('falls back to the number as typed for a non-Indian format', async () => {
    const h = harness({ existingCustomer: customerRow() });
    await h.service.verifyOtp({
      mobileNumber: '+14155550123',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(h.customers.findByMobileNumber).toHaveBeenCalledWith('+14155550123');
  });

  it('retries the raw form only when the canonical one found nothing', async () => {
    const h = harness();
    h.customers.findByMobileNumber
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(customerRow());
    await h.service.verifyOtp({
      mobileNumber: '+91 98765 43210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(h.customers.findByMobileNumber).toHaveBeenNthCalledWith(1, '9876543210');
    expect(h.customers.findByMobileNumber).toHaveBeenNthCalledWith(2, '+91 98765 43210');
  });

  it('does not retry when the two forms are identical', async () => {
    const h = harness();
    const outcome = await h.service.verifyOtp({
      mobileNumber: '9876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    // No account behind it, so the outcome is the registration hand-off
    // rather than a session — and the lookup still happened only once.
    expect(outcome.kind).toBe('NOT_REGISTERED');
    expect(h.customers.findByMobileNumber).toHaveBeenCalledTimes(1);
  });

  /**
   * THE BEHAVIOUR THIS CHANGE EXISTS TO FIX.
   *
   * This test used to assert the opposite — that a CORRECT code belonging to
   * no account was reported as an invalid code, so that verifying could not
   * be used to discover which numbers have accounts. The cost was telling a
   * resident holding a correct code that it was wrong, which is false and
   * sent them to the wrong problem. The approved common-login decision
   * reverses the trade.
   */
  it('reports a correct code with no account as NOT REGISTERED, not as invalid', async () => {
    const h = harness({ existingCustomer: null });
    const outcome = await h.service.verifyOtp({
      mobileNumber: '9876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(outcome.kind).toBe('NOT_REGISTERED');
    expect(h.actions()).toContain('OTP_VERIFY_NO_ACCOUNT');
    // No session: they have no account to be signed in to yet.
    expect(h.tokens.issueSession).not.toHaveBeenCalled();
  });

  it('hands back a ticket bound to the row that was actually consumed', async () => {
    const h = harness({ existingCustomer: null });
    await h.service.verifyOtp({
      mobileNumber: '+91 98765 43210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    // The CANONICAL number, and the id of the consumed row — not the number
    // as typed and not a second lookup.
    expect(h.tickets.issue).toHaveBeenCalledWith({
      mobileNumber: '9876543210',
      otpRequestId: 'otp-1',
    });
    expect(h.actions()).toContain('REGISTRATION_TICKET_ISSUED');
  });

  it('MINTS NO TICKET when self-registration is switched off', async () => {
    const h = harness({ existingCustomer: null, selfRegistrationEnabled: false });
    const outcome = await h.service.verifyOtp({
      mobileNumber: '9876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(outcome).toEqual({ kind: 'REGISTRATION_CLOSED' });
    // Not merely withheld from the response — never created. A credential
    // that is never minted cannot leak out of a branch that should not have
    // reached for it.
    expect(h.tickets.issue).not.toHaveBeenCalled();
    expect(h.actions()).not.toContain('REGISTRATION_TICKET_ISSUED');
  });

  it('still reports a genuinely WRONG code as invalid', async () => {
    // The change must not have blurred the two cases together.
    const h = harness({ existingCustomer: null, codeMatches: false });
    await expect(
      h.service.verifyOtp({
        mobileNumber: '9876543210',
        code: '000000',
        ipAddress: null,
        deviceInfo: null,
      })
    ).rejects.toBeInstanceOf(OtpInvalidError);
    expect(h.tickets.issue).not.toHaveBeenCalled();
  });

  it('never creates a customer — login is login', async () => {
    const h = harness({ existingCustomer: customerRow() });
    await h.service.verifyOtp({
      mobileNumber: '9876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
  });

  it('creates no customer on the NOT_REGISTERED path either', async () => {
    // Verifying hands back a ticket; it does not quietly register anybody.
    // The account is created by the registration call, behind the gate.
    const h = harness({ existingCustomer: null });
    await h.service.verifyOtp({
      mobileNumber: '9876543210',
      code: '123456',
      ipAddress: null,
      deviceInfo: null,
    });
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
  });
});

describe('registering with a ticket — no second code, and the number is not the client\u2019s', () => {
  it('registers the number inside the TICKET, not one from the body', async () => {
    const h = harness();
    h.tickets.read.mockReturnValue({
      mobileNumber: '9000000007',
      otpRequestId: 'otp-1',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    h.otpRequests.findConsumedById.mockResolvedValue(
      otpRow({ mobile_number: '9000000007', purpose: 'LOGIN', consumed_at: new Date() })
    );

    await h.service.registerCustomer(TICKET_REGISTRATION);

    expect(h.customers.createPifCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ mobileNumber: '9000000007' })
    );
  });

  it('CONSUMES NO CODE — the code was already consumed by the login', async () => {
    const h = harness();
    await h.service.registerCustomer(TICKET_REGISTRATION);
    expect(h.otpRequests.findLatestActiveForUpdate).not.toHaveBeenCalled();
    expect(h.otpRequests.markConsumed).not.toHaveBeenCalled();
  });

  it('checks the DATABASE ANCHOR, for a LOGIN row inside the ticket lifetime', async () => {
    const h = harness();
    await h.service.registerCustomer(TICKET_REGISTRATION);
    const [rowId, purpose, withinSeconds] = h.otpRequests.findConsumedById.mock.calls[0];
    expect(rowId).toBe('otp-1');
    // LOGIN, because that is the purpose the ticket was minted from. A
    // REGISTER row must not satisfy a ticket and vice versa.
    expect(purpose).toBe('LOGIN');
    expect(withinSeconds).toBeGreaterThan(0);
  });

  it('refuses a ticket with NO recent consumed verification behind it', async () => {
    // A valid signature is not enough. This is what a leaked signing key
    // would still have to get past.
    const h = harness({ anchor: null });
    await expect(h.service.registerCustomer(TICKET_REGISTRATION)).rejects.toBeInstanceOf(
      RegistrationTicketInvalidError
    );
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
    expect(h.actions()).toContain('REGISTRATION_TICKET_REJECTED');
  });

  it('refuses a ticket whose number disagrees with the row it cites', async () => {
    const h = harness({ anchor: otpRow({ mobile_number: '9000000009', consumed_at: new Date() }) });
    await expect(h.service.registerCustomer(TICKET_REGISTRATION)).rejects.toBeInstanceOf(
      RegistrationTicketInvalidError
    );
    expect(h.customers.createPifCustomer).not.toHaveBeenCalled();
  });

  it('creates no duplicate when the ticket is presented twice', async () => {
    // `createPifCustomer` is an upsert: the second call signs the resident
    // into the account the first one made. This is what makes the ticket
    // single-use for REGISTRATION without any state of its own.
    const first = await harness({ created: true }).service.registerCustomer(TICKET_REGISTRATION);
    const again = await harness({ created: false }).service.registerCustomer(TICKET_REGISTRATION);
    expect(first).toBe(SESSION);
    expect(again).toBe(SESSION);
  });
});
