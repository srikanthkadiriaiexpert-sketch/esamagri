import { RikOfficerService, OfficerNotFoundError } from './rik-officer.service';
import type { AuthContext } from '../../auth/auth-context';

/**
 * SIGNING A CUSTOMER OUT OF EVERY DEVICE.
 *
 * WHY THIS CONTROL EXISTS AT ALL. A customer session is a rolling 365 days,
 * which is the point: it stops the facility paying for an OTP every time
 * somebody opens the app. The price of a long session is that a lost or
 * handed-on phone stays signed in for a year — so the facility needs a way
 * to end one. `revokeAllForPrincipal` had existed since the session table was
 * built and was only ever called with 'STAFF'; this is the customer half of a
 * control that was already half there.
 *
 * WHAT THESE TESTS PIN, beyond "it calls the repository":
 *
 *   * the principal type is HARD-CODED to 'CUSTOMER' and never taken from a
 *     caller, so this cannot be aimed at a staff account;
 *   * the officer's record is untouched — this is not a quiet deactivation;
 *   * an unknown officer is refused BEFORE anything is revoked;
 *   * every revocation is audited with the actor, the RIK ID and the count;
 *   * no token value is read, returned or audited.
 */

const ACTOR: AuthContext = {
  principalType: 'STAFF',
  principalId: 'staff-1',
  roles: ['RIK_ADMIN'],
  permissions: ['rik.entitlement.allocate'],
} as unknown as AuthContext;

function officerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'officer-1',
    rik_id: 'RIK-O-000042',
    name: 'An Officer',
    official_name: null,
    mobile_number: '9876543210',
    is_active: true,
    dietary_preference: 'NV',
    ...over,
  };
}

function harness(over: { officer?: unknown; revoked?: number } = {}) {
  const officers = {
    findById: jest.fn().mockResolvedValue('officer' in over ? over.officer : officerRow()),
    setActive: jest.fn(),
    search: jest.fn(),
    count: jest.fn(),
  };
  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-1') };
  const sessions = {
    revokeAllForPrincipal: jest.fn().mockResolvedValue(over.revoked ?? 3),
  };
  const service = new RikOfficerService(
    officers as never,
    auditLog as never,
    sessions as never
  );
  return { service, officers, auditLog, sessions };
}

describe('revokeSessions — what it ends', () => {
  it('revokes every session for the officer and reports how many', async () => {
    const h = harness({ revoked: 3 });
    const result = await h.service.revokeSessions(ACTOR, 'officer-1');
    expect(result.revokedSessions).toBe(3);
    expect(h.sessions.revokeAllForPrincipal).toHaveBeenCalledTimes(1);
  });

  it('ALWAYS passes CUSTOMER — the principal type is not a parameter', async () => {
    // The one assertion that stops this becoming a way to sign out staff.
    const h = harness();
    await h.service.revokeSessions(ACTOR, 'officer-1');
    expect(h.sessions.revokeAllForPrincipal).toHaveBeenCalledWith('CUSTOMER', 'officer-1');
  });

  it('treats "no active sessions" as a normal answer, not a failure', async () => {
    const h = harness({ revoked: 0 });
    await expect(h.service.revokeSessions(ACTOR, 'officer-1')).resolves.toMatchObject({
      revokedSessions: 0,
    });
  });
});

describe('revokeSessions — what it leaves alone', () => {
  it('does NOT deactivate the officer', async () => {
    // Deactivate is the other button on the same row and a bigger hammer.
    // Conflating them would mean a staff member reaching for the small one
    // and getting the large one.
    const h = harness();
    await h.service.revokeSessions(ACTOR, 'officer-1');
    expect(h.officers.setActive).not.toHaveBeenCalled();
  });

  it('returns the officer unchanged, RIK ID and active state intact', async () => {
    const h = harness();
    const result = await h.service.revokeSessions(ACTOR, 'officer-1');
    expect(result.officer.rik_id).toBe('RIK-O-000042');
    expect(result.officer.is_active).toBe(true);
  });

  it('refuses an unknown officer BEFORE revoking anything', async () => {
    const h = harness({ officer: null });
    await expect(h.service.revokeSessions(ACTOR, 'nobody')).rejects.toBeInstanceOf(
      OfficerNotFoundError
    );
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });
});

describe('revokeSessions — the audit record', () => {
  it('records the action, the actor and the count', async () => {
    const h = harness({ revoked: 2 });
    await h.service.revokeSessions(ACTOR, 'officer-1');

    const entry = h.auditLog.logEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.action).toBe('RIK_OFFICER_SESSIONS_REVOKED');
    expect(entry.actorId).toBe('staff-1');
    expect(entry.entityId).toBe('officer-1');
    expect(entry.after).toMatchObject({ rikId: 'RIK-O-000042', revokedSessions: 2 });
  });

  it('writes NO token value of any kind into the audit row', async () => {
    // A revocation record that carried a token would turn the audit log into
    // a place where sessions could be stolen from.
    const h = harness();
    await h.service.revokeSessions(ACTOR, 'officer-1');
    const serialised = JSON.stringify(h.auditLog.logEvent.mock.calls[0]![0]);
    expect(serialised).not.toMatch(/refresh/i);
    expect(serialised).not.toMatch(/token/i);
    expect(serialised).not.toMatch(/hash/i);
  });

  it('audits even when nothing was revoked, so the attempt is on record', async () => {
    const h = harness({ revoked: 0 });
    await h.service.revokeSessions(ACTOR, 'officer-1');
    expect(h.auditLog.logEvent).toHaveBeenCalledTimes(1);
    expect(
      (h.auditLog.logEvent.mock.calls[0]![0] as { after: { revokedSessions: number } }).after
        .revokedSessions
    ).toBe(0);
  });
});
