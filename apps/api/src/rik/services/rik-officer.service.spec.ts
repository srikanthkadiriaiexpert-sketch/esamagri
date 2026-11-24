import {
  OfficerLinkConflictError,
  OfficerValidationError,
  RikOfficerService,
} from './rik-officer.service';
import type { AuthContext } from '../../auth/auth-context';
import type { OfficerRecord } from '../repositories/officers.repository';

/**
 * Officer registration and the new linking path, without a database.
 *
 * WHAT MATTERS HERE is the three-way decision taken after a mobile number is
 * canonicalised: create a new officer, LINK a resident who already has an
 * account, or refuse a number that already belongs to an officer. Each is a
 * branch, and each branch has something it must NOT do — the link must not
 * create a row, must not touch the display name, and must not touch the
 * dietary preference. Those negatives are what these tests are for; an
 * integration test proving the happy path would not catch any of them.
 *
 * The fakes record calls and return what they are told. Nothing here
 * re-implements a rule the service owns, so a passing test cannot mean "the
 * fake agreed with itself".
 */

const STAFF_ID = '99999999-9999-7999-8999-999999999999';

function staffContext(): AuthContext {
  return {
    principalType: 'STAFF',
    principalId: STAFF_ID,
    roles: new Set(['RIK_ADMIN']),
    permissions: new Set(['rik.entitlement.allocate']),
  };
}

/** An existing PIF-only resident: a customer row with NO officer identifier. */
function pifResident(over: Partial<OfficerRecord> = {}): OfficerRecord {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    rik_id: null,
    name: 'Anil',                 // the name THEY chose
    official_name: null,
    mobile_number: '9876543210',
    dietary_preference: null,     // never set during PIF registration
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
    created_by: null,
    quarter_block: 'B',
    quarter_number: '12',
    landmark: null,
    deleted_at: null,
    ...over,
  };
}

function linkedOfficer(over: Partial<OfficerRecord> = {}): OfficerRecord {
  return { ...pifResident(), rik_id: 'RIK-O-000042', official_name: 'A Kumar', ...over };
}

function newOfficer(over: Partial<OfficerRecord> = {}): OfficerRecord {
  return {
    ...pifResident(),
    id: '22222222-2222-7222-8222-222222222222',
    rik_id: 'RIK-O-000043',
    name: 'A Kumar',
    official_name: 'A Kumar',
    dietary_preference: 'PV',
    ...over,
  };
}

interface Harness {
  service: RikOfficerService;
  officers: {
    findCustomerByMobile: jest.Mock;
    findAnyByMobile: jest.Mock;
    linkExistingCustomer: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    setActive: jest.Mock;
    search: jest.Mock;
    count: jest.Mock;
  };
  auditLog: { logEvent: jest.Mock };
  /**
   * The session repository, added when officer session revocation landed.
   *
   * EXPOSED ON THE HARNESS, NOT JUST PASSED IN. Every other dependency here
   * is returned so a test can assert what the service did with it, and this
   * one carries the sharpest assertion of the three: that registering or
   * deactivating an officer does NOT quietly end their sessions. A mock that
   * were merely passed and never inspected would let that regression through.
   */
  sessions: { revokeAllForPrincipal: jest.Mock };
}

function harness(over: { existing?: OfficerRecord | null } = {}): Harness {
  const officers = {
    findCustomerByMobile: jest.fn().mockResolvedValue(over.existing ?? null),
    findAnyByMobile: jest.fn().mockResolvedValue(over.existing ?? null),
    linkExistingCustomer: jest.fn().mockResolvedValue(linkedOfficer()),
    create: jest.fn().mockResolvedValue(newOfficer()),
    findById: jest.fn().mockResolvedValue(newOfficer()),
    setActive: jest.fn().mockResolvedValue(newOfficer()),
    search: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') };
  // Returns a count, like the real repository. 0 rather than a truthy
  // number by default: no test in this file revokes anything, so the
  // honest default is "nothing was revoked".
  const sessions = { revokeAllForPrincipal: jest.fn().mockResolvedValue(0) };
  const service = new RikOfficerService(
    officers as never,
    auditLog as never,
    sessions as never
  );
  return { service, officers, auditLog, sessions };
}

const VALID_NEW = {
  name: 'A Kumar',
  mobileNumber: '9876543210',
  quarterBlock: 'B',
  quarterNumber: '12',
  dietaryPreference: 'PV',
};

// ---------------------------------------------------------------------------

describe('RikOfficerService.register — a brand new officer (unchanged behaviour)', () => {
  it('creates the officer and reports REGISTERED', async () => {
    const h = harness({ existing: null });
    const result = await h.service.register(staffContext(), VALID_NEW);

    expect(result.outcome).toBe('REGISTERED');
    expect(h.officers.create).toHaveBeenCalledTimes(1);
    expect(h.officers.linkExistingCustomer).not.toHaveBeenCalled();
  });

  it('still records who registered them, and the dietary preference they chose', async () => {
    const h = harness({ existing: null });
    await h.service.register(staffContext(), VALID_NEW);

    expect(h.officers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'A Kumar',
        officialName: 'A Kumar',
        mobileNumber: '9876543210',
        dietaryPreference: 'PV',
        createdBy: STAFF_ID,
      })
    );
  });

  it('writes RIK_OFFICER_REGISTERED, not the link event', async () => {
    const h = harness({ existing: null });
    await h.service.register(staffContext(), VALID_NEW);

    expect(h.auditLog.logEvent).toHaveBeenCalledTimes(1);
    expect(h.auditLog.logEvent.mock.calls[0][0]).toMatchObject({
      action: 'RIK_OFFICER_REGISTERED',
    });
  });

  it('STILL REQUIRES the dietary preference on this path', async () => {
    const h = harness({ existing: null });
    const { dietaryPreference: _omitted, ...withoutDiet } = VALID_NEW;

    await expect(h.service.register(staffContext(), withoutDiet)).rejects.toMatchObject({
      name: 'OfficerValidationError',
      code: 'INVALID_DIETARY_PREFERENCE',
      field: 'dietaryPreference',
    });
    expect(h.officers.create).not.toHaveBeenCalled();
  });

  it('still refuses a dietary preference outside the approved set', async () => {
    const h = harness({ existing: null });
    await expect(
      h.service.register(staffContext(), { ...VALID_NEW, dietaryPreference: 'VEGAN' })
    ).rejects.toBeInstanceOf(OfficerValidationError);
  });

  it('still refuses a blank name and a blank quarter', async () => {
    const h = harness({ existing: null });
    await expect(
      h.service.register(staffContext(), { ...VALID_NEW, name: '   ' })
    ).rejects.toMatchObject({ code: 'BLANK_FIELD', field: 'name' });
    await expect(
      h.service.register(staffContext(), { ...VALID_NEW, quarterBlock: '' })
    ).rejects.toMatchObject({ code: 'BLANK_FIELD', field: 'quarterBlock' });
  });

  it('still refuses a mobile number that is not an Indian mobile', async () => {
    const h = harness({ existing: null });
    await expect(
      h.service.register(staffContext(), { ...VALID_NEW, mobileNumber: '12345' })
    ).rejects.toMatchObject({ code: 'INVALID_MOBILE', field: 'mobileNumber' });
  });
});

describe('RikOfficerService.register — linking an existing PIF resident', () => {
  it('links instead of refusing, and reports LINKED', async () => {
    const h = harness({ existing: pifResident() });
    const result = await h.service.register(staffContext(), VALID_NEW);

    expect(result.outcome).toBe('LINKED');
    expect(result.officer.rik_id).toBe('RIK-O-000042');
    expect(h.officers.linkExistingCustomer).toHaveBeenCalledTimes(1);
  });

  it('CREATES NO SECOND CUSTOMER ROW', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);
    expect(h.officers.create).not.toHaveBeenCalled();
  });

  it('keeps the existing customer id, so PIF orders and history are untouched', async () => {
    const h = harness({ existing: pifResident() });
    const result = await h.service.register(staffContext(), VALID_NEW);

    expect(h.officers.linkExistingCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: '11111111-1111-7111-8111-111111111111' })
    );
    expect(result.officer.id).toBe('11111111-1111-7111-8111-111111111111');
  });

  it('DOES NOT OVERWRITE the display name — it sends no name at all', async () => {
    const h = harness({ existing: pifResident({ name: 'Anil' }) });
    await h.service.register(staffContext(), { ...VALID_NEW, name: 'A Kumar' });

    const sent = h.officers.linkExistingCustomer.mock.calls[0][0];
    expect(sent).not.toHaveProperty('name');
    expect(sent.officialName).toBe('A Kumar');
  });

  it('DOES NOT OVERWRITE the dietary preference — it sends none', async () => {
    const h = harness({ existing: pifResident({ dietary_preference: null }) });
    await h.service.register(staffContext(), VALID_NEW);

    const sent = h.officers.linkExistingCustomer.mock.calls[0][0];
    expect(sent).not.toHaveProperty('dietaryPreference');
  });

  it('does not overwrite a preference the resident had already recorded', async () => {
    const h = harness({ existing: pifResident({ dietary_preference: 'EV' }) });
    await h.service.register(staffContext(), { ...VALID_NEW, dietaryPreference: 'NV' });

    const sent = h.officers.linkExistingCustomer.mock.calls[0][0];
    expect(sent).not.toHaveProperty('dietaryPreference');
  });

  it('TREATS THE DIETARY PREFERENCE AS OPTIONAL on this path', async () => {
    const h = harness({ existing: pifResident() });
    const { dietaryPreference: _omitted, ...withoutDiet } = VALID_NEW;

    const result = await h.service.register(staffContext(), withoutDiet);
    expect(result.outcome).toBe('LINKED');
  });

  it('ignores an INVALID dietary preference on this path rather than refusing', async () => {
    // It is never written, so validating it would refuse a legitimate link
    // over a value that has no effect.
    const h = harness({ existing: pifResident() });
    const result = await h.service.register(staffContext(), {
      ...VALID_NEW,
      dietaryPreference: 'NOT_A_DIET',
    });
    expect(result.outcome).toBe('LINKED');
  });

  it('records the facility spelling as official_name', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), { ...VALID_NEW, name: 'Kumar, A.' });
    expect(h.officers.linkExistingCustomer.mock.calls[0][0].officialName).toBe('Kumar, A.');
  });

  it('passes the quarter through, for a resident whose address is missing', async () => {
    const h = harness({ existing: pifResident({ quarter_block: null, quarter_number: null }) });
    await h.service.register(staffContext(), VALID_NEW);
    expect(h.officers.linkExistingCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ quarterBlock: 'B', quarterNumber: '12' })
    );
  });

  it('records the approving staff member as created_by', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);
    expect(h.officers.linkExistingCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: STAFF_ID })
    );
  });
});

describe('RikOfficerService.register — the RIK_OFFICER_LINKED audit event', () => {
  it('writes RIK_OFFICER_LINKED, never RIK_OFFICER_REGISTERED', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);

    expect(h.auditLog.logEvent).toHaveBeenCalledTimes(1);
    const row = h.auditLog.logEvent.mock.calls[0][0];
    expect(row.action).toBe('RIK_OFFICER_LINKED');
    expect(row.action).not.toBe('RIK_OFFICER_REGISTERED');
  });

  it('names the actor, the module and the customer the event is about', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);

    expect(h.auditLog.logEvent.mock.calls[0][0]).toMatchObject({
      actorId: STAFF_ID,
      module: 'rik',
      entityType: 'rik.officer',
      entityId: '11111111-1111-7111-8111-111111111111',
    });
  });

  it('records rik_id moving from null to the issued identifier', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);

    const row = h.auditLog.logEvent.mock.calls[0][0];
    expect(row.before).toMatchObject({ rikId: null });
    expect(row.after).toMatchObject({ rikId: 'RIK-O-000042', linkedExistingCustomer: true });
  });

  it('records that the display name and dietary preference did not move', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);

    expect(h.auditLog.logEvent.mock.calls[0][0].after).toMatchObject({
      displayNamePreserved: true,
      dietaryPreferencePreserved: true,
    });
  });
});

describe('RikOfficerService.register — a number that already belongs to an officer', () => {
  it('still refuses with DUPLICATE_MOBILE and names the RIK ID', async () => {
    const h = harness({ existing: linkedOfficer({ rik_id: 'RIK-O-000007' }) });

    await expect(h.service.register(staffContext(), VALID_NEW)).rejects.toMatchObject({
      code: 'DUPLICATE_MOBILE',
      field: 'mobileNumber',
    });
    expect(h.officers.create).not.toHaveBeenCalled();
    expect(h.officers.linkExistingCustomer).not.toHaveBeenCalled();
  });

  it('no longer says "officer null" for a resident with no RIK ID', async () => {
    const h = harness({ existing: pifResident() });
    const result = await h.service.register(staffContext(), VALID_NEW);
    // The old behaviour was a refusal reading "already belongs to officer null".
    expect(result.outcome).toBe('LINKED');
  });

  it('writes no audit row when it refuses', async () => {
    const h = harness({ existing: linkedOfficer() });
    await expect(h.service.register(staffContext(), VALID_NEW)).rejects.toBeInstanceOf(
      OfficerValidationError
    );
    expect(h.auditLog.logEvent).not.toHaveBeenCalled();
  });
});

describe('RikOfficerService.register — a removed account', () => {
  it('refuses a number belonging to a soft-deleted PIF resident rather than linking it', async () => {
    const h = harness({
      existing: pifResident({ deleted_at: '2026-10-20T00:00:00.000Z' }),
    });

    await expect(h.service.register(staffContext(), VALID_NEW)).rejects.toMatchObject({
      code: 'DUPLICATE_MOBILE',
      field: 'mobileNumber',
    });
    expect(h.officers.linkExistingCustomer).not.toHaveBeenCalled();
    expect(h.officers.create).not.toHaveBeenCalled();
    expect(h.auditLog.logEvent).not.toHaveBeenCalled();
  });

  it('still refuses a number belonging to a soft-deleted OFFICER, naming the RIK ID', async () => {
    const h = harness({
      existing: linkedOfficer({ rik_id: 'RIK-O-000009', deleted_at: '2026-10-20T00:00:00.000Z' }),
    });
    await expect(h.service.register(staffContext(), VALID_NEW)).rejects.toMatchObject({
      code: 'DUPLICATE_MOBILE',
    });
  });
});

describe('RikOfficerService.register — mobile number matching', () => {
  it('looks the resident up by the CANONICAL number, whatever the staff member typed', async () => {
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), { ...VALID_NEW, mobileNumber: '+91 98765 43210' });

    expect(h.officers.findCustomerByMobile).toHaveBeenCalledWith('9876543210');
  });

  it('matches a resident who registered on PIF in a different written form', async () => {
    const h = harness({ existing: pifResident({ mobile_number: '9876543210' }) });
    const result = await h.service.register(staffContext(), {
      ...VALID_NEW,
      mobileNumber: '098765-43210',
    });
    expect(result.outcome).toBe('LINKED');
  });

  it('stores the canonical form when creating a new officer', async () => {
    const h = harness({ existing: null });
    await h.service.register(staffContext(), { ...VALID_NEW, mobileNumber: '+919876543210' });
    expect(h.officers.create).toHaveBeenCalledWith(
      expect.objectContaining({ mobileNumber: '9876543210' })
    );
  });
});

describe('RikOfficerService.register — a concurrent link', () => {
  it('reports a conflict rather than issuing a second identifier', async () => {
    const h = harness({ existing: pifResident() });
    h.officers.linkExistingCustomer.mockResolvedValue(null);

    await expect(h.service.register(staffContext(), VALID_NEW)).rejects.toBeInstanceOf(
      OfficerLinkConflictError
    );
    expect(h.officers.create).not.toHaveBeenCalled();
    expect(h.auditLog.logEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE DEPENDENCY THAT MUST STAY QUIET.
 *
 * Adding session revocation to this service put a new power within reach of
 * every method on it. These tests say where it is NOT used.
 *
 * The risk is not theoretical. `setActive(false)` deactivates an officer, and
 * "while we are here, sign them out too" is a plausible-sounding change that
 * would silently turn a reversible administrative state into an action that
 * also kicks someone off their phone mid-order. If that is ever wanted it
 * should be a decision with its own test, not a side effect — and these fail
 * the moment it happens by accident.
 *
 * Revocation's own behaviour is proved in officer-session-revocation.spec.ts.
 */
describe('session revocation is never a side effect of another operation', () => {
  it('registering an officer revokes nothing', async () => {
    const h = harness();
    await h.service.register(staffContext(), VALID_NEW);
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });

  it('linking an existing resident revokes nothing', async () => {
    // The riskiest of the three: this one touches an account that may well
    // have a live session on the resident's phone right now.
    const h = harness({ existing: pifResident() });
    await h.service.register(staffContext(), VALID_NEW);
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });

  it('DEACTIVATING an officer does not also sign them out', async () => {
    const h = harness();
    h.officers.findById.mockResolvedValue(newOfficer({ is_active: true }));
    h.officers.setActive.mockResolvedValue(newOfficer({ is_active: false }));
    await h.service.setActive(staffContext(), 'officer-1', false);
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });

  it('reactivating an officer does not touch sessions either', async () => {
    const h = harness();
    h.officers.findById.mockResolvedValue(newOfficer({ is_active: false }));
    h.officers.setActive.mockResolvedValue(newOfficer({ is_active: true }));
    await h.service.setActive(staffContext(), 'officer-1', true);
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });

  it('reading an officer revokes nothing', async () => {
    const h = harness();
    await h.service.get('officer-1');
    await h.service.search({ limit: 10, offset: 0 });
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });
});
