import { AdminStaffService, StaffAdminError } from './admin-staff.service';
import type { AuthContext } from '../../auth/auth-context';
import type { StaffAccountRecord } from '../../shared/repositories/users.repository';

/**
 * Staff administration rules, without a database.
 *
 * WHY UNIT TESTS FOR THIS AND NOT ONLY INTEGRATION TESTS. The refusals in this
 * service are the part that must never regress: the last active Super Admin,
 * self-lockout, an unknown role, a password containing the username, a
 * credential reaching a response or an audit row. Each is a branch, and a
 * branch is cheapest to pin down here — these run in milliseconds, in CI,
 * without Postgres, so there is no excuse not to run them.
 *
 * The DB-backed matrix (staff.integration.spec.ts and the role x route rows
 * added to rbac-matrix.verification.spec.ts) proves the other half: that the
 * guards actually refuse a non-Super-Admin over real HTTP. Neither suite
 * substitutes for the other.
 *
 * The fakes below are deliberately dumb: they record calls and return what
 * they are told to. Nothing here re-implements a rule the service owns, so a
 * passing test cannot mean "the fake agreed with itself".
 */

const NOW = new Date('2026-11-10T04:00:00.000Z');

function account(over: Partial<StaffAccountRecord> = {}): StaffAccountRecord {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    username: 'a.kumar',
    display_name: 'A Kumar',
    status: 'ACTIVE',
    totp_enabled: false,
    last_login_at: null,
    created_at: NOW,
    updated_at: NOW,
    created_by: null,
    ...over,
  };
}

function superAdminContext(principalId = '99999999-9999-7999-8999-999999999999'): AuthContext {
  return {
    principalType: 'STAFF',
    principalId,
    roles: new Set(['SUPER_ADMIN']),
    permissions: new Set(['shared.user.manage', 'shared.role.grant']),
  };
}

interface Harness {
  service: AdminStaffService;
  users: {
    create: jest.Mock;
    findAccountById: jest.Mock;
    updateDisplayName: jest.Mock;
    updateStatus: jest.Mock;
    updatePasswordHash: jest.Mock;
    countActiveWithRole: jest.Mock;
    list: jest.Mock;
    countMatching: jest.Mock;
  };
  userRoles: {
    roleExists: jest.Mock;
    grant: jest.Mock;
    revoke: jest.Mock;
    rolesForUsers: jest.Mock;
    resolveForUser: jest.Mock;
    listRolesWithPermissions: jest.Mock;
  };
  sessions: { revokeAllForPrincipal: jest.Mock };
  passwords: { hash: jest.Mock };
  auditLog: { logEvent: jest.Mock };
}

function harness(): Harness {
  const users = {
    create: jest.fn().mockResolvedValue(account()),
    findAccountById: jest.fn().mockResolvedValue(account()),
    updateDisplayName: jest.fn().mockResolvedValue(account({ display_name: 'New Name' })),
    updateStatus: jest.fn().mockImplementation((_id: string, status: string) =>
      Promise.resolve(account({ status }))
    ),
    updatePasswordHash: jest.fn().mockResolvedValue(true),
    countActiveWithRole: jest.fn().mockResolvedValue(3),
    list: jest.fn().mockResolvedValue([account()]),
    countMatching: jest.fn().mockResolvedValue(1),
  };
  const userRoles = {
    roleExists: jest.fn().mockResolvedValue(true),
    grant: jest.fn().mockResolvedValue(true),
    revoke: jest.fn().mockResolvedValue(true),
    rolesForUsers: jest.fn().mockResolvedValue(new Map([[account().id, ['RIK_ADMIN']]])),
    resolveForUser: jest.fn().mockResolvedValue({ roles: ['RIK_ADMIN'], permissions: ['rik.order.manage'] }),
    listRolesWithPermissions: jest.fn().mockResolvedValue([]),
  };
  const sessions = { revokeAllForPrincipal: jest.fn().mockResolvedValue(2) };
  const passwords = { hash: jest.fn().mockResolvedValue('$2b$12$fake.bcrypt.hash.value.for.tests') };
  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') };

  const service = new AdminStaffService(
    users as never,
    userRoles as never,
    sessions as never,
    passwords as never,
    auditLog as never
  );
  return { service, users, userRoles, sessions, passwords, auditLog };
}

const GOOD_PASSWORD = 'Monsoon#Harbour47';

describe('AdminStaffService — creating a staff account', () => {
  it('hashes the password and never puts the plaintext anywhere it could escape', async () => {
    const h = harness();
    const view = await h.service.createStaff(superAdminContext(), {
      username: 'a.kumar',
      displayName: 'A Kumar',
      password: GOOD_PASSWORD,
    });

    expect(h.passwords.hash).toHaveBeenCalledWith(GOOD_PASSWORD);
    expect(h.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: '$2b$12$fake.bcrypt.hash.value.for.tests' })
    );

    // Not in the returned view...
    expect(JSON.stringify(view)).not.toContain(GOOD_PASSWORD);
    expect(Object.keys(view)).not.toContain('passwordHash');
    expect(Object.keys(view)).not.toContain('password_hash');
    expect(Object.keys(view)).not.toContain('totpSecret');
    // ...and not in any audit payload.
    for (const call of h.auditLog.logEvent.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(GOOD_PASSWORD);
    }
  });

  it('records who created the account, for the created_by trail', async () => {
    const h = harness();
    const actor = superAdminContext('abcdefab-1111-7111-8111-111111111111');
    await h.service.createStaff(actor, {
      username: 'a.kumar',
      displayName: 'A Kumar',
      password: GOOD_PASSWORD,
    });
    expect(h.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'abcdefab-1111-7111-8111-111111111111' })
    );
  });

  it('defaults to ACTIVE but honours an explicit status', async () => {
    const h = harness();
    await h.service.createStaff(superAdminContext(), {
      username: 'a.kumar',
      displayName: 'A Kumar',
      password: GOOD_PASSWORD,
    });
    expect(h.users.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));

    const h2 = harness();
    await h2.service.createStaff(superAdminContext(), {
      username: 'b.rao',
      displayName: 'B Rao',
      password: GOOD_PASSWORD,
      status: 'SUSPENDED',
    });
    expect(h2.users.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUSPENDED' }));
  });

  it('refuses a password containing the username, which every policy regex passes', async () => {
    const h = harness();
    // Satisfies length and all four character classes, and is the first thing
    // anybody would guess for this account.
    await expect(
      h.service.createStaff(superAdminContext(), {
        username: 'a.kumar',
        displayName: 'A Kumar',
        password: 'A.Kumar#2026xy',
      })
    ).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });

    expect(h.users.create).not.toHaveBeenCalled();
    expect(h.passwords.hash).not.toHaveBeenCalled();
  });

  it('turns a username collision into USERNAME_TAKEN rather than a 500', async () => {
    const h = harness();
    h.users.create.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    await expect(
      h.service.createStaff(superAdminContext(), {
        username: 'a.kumar',
        displayName: 'A Kumar',
        password: GOOD_PASSWORD,
      })
    ).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('lets an unrelated database error through instead of mislabelling it', async () => {
    const h = harness();
    h.users.create.mockRejectedValue(Object.assign(new Error('deadlock'), { code: '40P01' }));
    await expect(
      h.service.createStaff(superAdminContext(), {
        username: 'a.kumar',
        displayName: 'A Kumar',
        password: GOOD_PASSWORD,
      })
    ).rejects.not.toBeInstanceOf(StaffAdminError);
  });

  it('refuses a role the database does not have — there is no RIK_STAFF', async () => {
    const h = harness();
    h.userRoles.roleExists.mockResolvedValue(false);

    await expect(
      h.service.createStaff(superAdminContext(), {
        username: 'a.kumar',
        displayName: 'A Kumar',
        password: GOOD_PASSWORD,
        role: 'RIK_STAFF',
      })
    ).rejects.toMatchObject({ code: 'ROLE_UNKNOWN', detail: { role: 'RIK_STAFF' } });

    expect(h.users.create).not.toHaveBeenCalled();
  });

  it('grants the role in the same operation when one is supplied', async () => {
    const h = harness();
    await h.service.createStaff(superAdminContext(), {
      username: 'a.kumar',
      displayName: 'A Kumar',
      password: GOOD_PASSWORD,
      role: 'RIK_PICKUP_STAFF',
    });
    expect(h.userRoles.grant).toHaveBeenCalledWith(
      expect.objectContaining({ roleName: 'RIK_PICKUP_STAFF' })
    );
  });

  it('refuses a CUSTOMER principal outright, whatever the route allowed', async () => {
    const h = harness();
    const customer: AuthContext = {
      principalType: 'CUSTOMER',
      principalId: 'cccccccc-1111-7111-8111-111111111111',
      roles: new Set(),
      permissions: new Set(),
    };
    await expect(
      h.service.createStaff(customer, {
        username: 'a.kumar',
        displayName: 'A Kumar',
        password: GOOD_PASSWORD,
      })
    ).rejects.toMatchObject({ code: 'NOT_STAFF_PRINCIPAL' });
  });
});

describe('AdminStaffService — suspending and reactivating', () => {
  it('suspends an ordinary account and ends its live sessions', async () => {
    const h = harness();
    const view = await h.service.setStatus(superAdminContext(), account().id, {
      status: 'SUSPENDED',
      reason: 'Left the facility',
    });

    expect(view.status).toBe('SUSPENDED');
    expect(h.sessions.revokeAllForPrincipal).toHaveBeenCalledWith('STAFF', account().id);
    expect(h.auditLog.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STAFF_STATUS_CHANGED' })
    );
  });

  it('does not revoke sessions when reactivating', async () => {
    const h = harness();
    h.users.findAccountById.mockResolvedValue(account({ status: 'SUSPENDED' }));
    await h.service.setStatus(superAdminContext(), account().id, {
      status: 'ACTIVE',
      reason: 'Returned from leave',
    });
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });

  it('refuses to change your own status, so nobody locks themselves out', async () => {
    const h = harness();
    const selfId = 'abcdefab-2222-7222-8222-222222222222';
    await expect(
      h.service.setStatus(superAdminContext(selfId), selfId, {
        status: 'SUSPENDED',
        reason: 'Mis-click on my own row',
      })
    ).rejects.toMatchObject({ code: 'SELF_STATUS_CHANGE' });

    expect(h.users.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses to suspend the LAST ACTIVE Super Admin', async () => {
    const h = harness();
    h.userRoles.resolveForUser.mockResolvedValue({ roles: ['SUPER_ADMIN'], permissions: [] });
    h.users.countActiveWithRole.mockResolvedValue(1);

    await expect(
      h.service.setStatus(superAdminContext(), account().id, {
        status: 'SUSPENDED',
        reason: 'Tidying the staff list',
      })
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_SUPER_ADMIN' });

    expect(h.users.updateStatus).not.toHaveBeenCalled();
    expect(h.sessions.revokeAllForPrincipal).not.toHaveBeenCalled();
  });

  it('allows suspending a Super Admin while another active one remains', async () => {
    const h = harness();
    h.userRoles.resolveForUser.mockResolvedValue({ roles: ['SUPER_ADMIN'], permissions: [] });
    h.users.countActiveWithRole.mockResolvedValue(2);

    const view = await h.service.setStatus(superAdminContext(), account().id, {
      status: 'SUSPENDED',
      reason: 'Handover complete',
    });
    expect(view.status).toBe('SUSPENDED');
  });

  it('does not block suspending an ALREADY suspended Super Admin', async () => {
    // One that is already suspended is not holding the installation up, so the
    // last-active rule must not fire on it and leave a row unmanageable.
    const h = harness();
    h.users.findAccountById.mockResolvedValue(account({ status: 'SUSPENDED' }));
    h.userRoles.resolveForUser.mockResolvedValue({ roles: ['SUPER_ADMIN'], permissions: [] });
    h.users.countActiveWithRole.mockResolvedValue(0);

    await expect(
      h.service.setStatus(superAdminContext(), account().id, {
        status: 'SUSPENDED',
        reason: 'Confirming the suspension',
      })
    ).resolves.toMatchObject({ status: 'SUSPENDED' });
  });

  it('reports a missing account as STAFF_NOT_FOUND', async () => {
    const h = harness();
    h.users.findAccountById.mockResolvedValue(null);
    await expect(
      h.service.setStatus(superAdminContext(), account().id, { status: 'SUSPENDED', reason: 'Gone' })
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });
});

describe('AdminStaffService — roles', () => {
  it('grants an existing role and audits it', async () => {
    const h = harness();
    await h.service.assignRole(superAdminContext(), account().id, 'PIF_CASHIER');
    expect(h.userRoles.grant).toHaveBeenCalledWith(
      expect.objectContaining({ userId: account().id, roleName: 'PIF_CASHIER' })
    );
    expect(h.auditLog.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STAFF_ROLE_GRANTED' })
    );
  });

  it('does not audit a repeat grant that changed nothing', async () => {
    const h = harness();
    h.userRoles.grant.mockResolvedValue(false);
    await h.service.assignRole(superAdminContext(), account().id, 'PIF_CASHIER');
    expect(h.auditLog.logEvent).not.toHaveBeenCalled();
  });

  it('refuses a role that is not in shared.roles', async () => {
    const h = harness();
    h.userRoles.roleExists.mockResolvedValue(false);
    await expect(
      h.service.assignRole(superAdminContext(), account().id, 'RIK_STAFF')
    ).rejects.toMatchObject({ code: 'ROLE_UNKNOWN' });
    expect(h.userRoles.grant).not.toHaveBeenCalled();
  });

  it('refuses to remove your own Super Admin role', async () => {
    const h = harness();
    const selfId = 'abcdefab-3333-7333-8333-333333333333';
    h.users.findAccountById.mockResolvedValue(account({ id: selfId }));

    await expect(
      h.service.revokeRole(superAdminContext(selfId), selfId, 'SUPER_ADMIN')
    ).rejects.toMatchObject({ code: 'SELF_ROLE_REVOKE' });
    expect(h.userRoles.revoke).not.toHaveBeenCalled();
  });

  it('refuses to take Super Admin from the last active holder', async () => {
    const h = harness();
    h.userRoles.resolveForUser.mockResolvedValue({ roles: ['SUPER_ADMIN'], permissions: [] });
    h.users.countActiveWithRole.mockResolvedValue(1);

    await expect(
      h.service.revokeRole(superAdminContext(), account().id, 'SUPER_ADMIN')
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_SUPER_ADMIN' });
    expect(h.userRoles.revoke).not.toHaveBeenCalled();
  });

  it('allows revoking a non-Super-Admin role without any count check', async () => {
    const h = harness();
    h.users.countActiveWithRole.mockResolvedValue(1);
    await h.service.revokeRole(superAdminContext(), account().id, 'RIK_ADMIN');
    expect(h.userRoles.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ roleName: 'RIK_ADMIN' })
    );
    expect(h.users.countActiveWithRole).not.toHaveBeenCalled();
  });
});

describe('AdminStaffService — password reset', () => {
  it('hashes the new password, ends the sessions, and returns no credential', async () => {
    const h = harness();
    const result = await h.service.resetPassword(superAdminContext(), account().id, {
      newPassword: GOOD_PASSWORD,
      reason: 'Forgotten password reported by phone',
    });

    expect(h.passwords.hash).toHaveBeenCalledWith(GOOD_PASSWORD);
    expect(h.users.updatePasswordHash).toHaveBeenCalledWith(
      account().id,
      '$2b$12$fake.bcrypt.hash.value.for.tests'
    );
    expect(h.sessions.revokeAllForPrincipal).toHaveBeenCalledWith('STAFF', account().id);

    expect(result).toEqual({ userId: account().id, revokedSessions: 2 });
    expect(JSON.stringify(result)).not.toContain(GOOD_PASSWORD);
  });

  it('keeps the password out of the audit row', async () => {
    const h = harness();
    await h.service.resetPassword(superAdminContext(), account().id, {
      newPassword: GOOD_PASSWORD,
      reason: 'Forgotten password reported by phone',
    });

    const [payload] = h.auditLog.logEvent.mock.calls[0] as [Record<string, unknown>];
    expect(payload.action).toBe('STAFF_PASSWORD_RESET');
    expect(JSON.stringify(payload)).not.toContain(GOOD_PASSWORD);
  });

  it('applies the same policy as creation — no username inside the password', async () => {
    const h = harness();
    h.users.findAccountById.mockResolvedValue(account({ username: 'b.rao' }));
    await expect(
      h.service.resetPassword(superAdminContext(), account().id, {
        newPassword: 'B.Rao#Secure99',
        reason: 'Forgotten password',
      })
    ).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
    expect(h.users.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('reports a missing account rather than hashing into nowhere', async () => {
    const h = harness();
    h.users.findAccountById.mockResolvedValue(null);
    await expect(
      h.service.resetPassword(superAdminContext(), account().id, {
        newPassword: GOOD_PASSWORD,
        reason: 'Forgotten password',
      })
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });
});

describe('AdminStaffService — reads', () => {
  it('returns the list with its total and the roles attached', async () => {
    const h = harness();
    const page = await h.service.listStaff({ q: 'kumar', limit: 25, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.roles).toEqual(['RIK_ADMIN']);
    expect(h.users.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'kumar', limit: 25, offset: 0 })
    );
  });

  it('passes the role and status filters straight through to the query', async () => {
    const h = harness();
    await h.service.listStaff({ role: 'PIF_CASHIER', status: 'SUSPENDED' });
    expect(h.users.list).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PIF_CASHIER', status: 'SUSPENDED' })
    );
    expect(h.users.countMatching).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PIF_CASHIER', status: 'SUSPENDED' })
    );
  });

  it('exposes no hash or secret on a detail read', async () => {
    const h = harness();
    const detail = await h.service.getStaff(account().id);
    expect(detail.permissions).toEqual(['rik.order.manage']);
    const keys = Object.keys(detail);
    expect(keys).not.toContain('passwordHash');
    expect(keys).not.toContain('password_hash');
    expect(keys).not.toContain('totpSecret');
    expect(keys).not.toContain('totp_secret');
  });
});
