import { ForbiddenException } from '@nestjs/common';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationService } from '../services/authorization.service';
import { REQUIRE_RIK_CUSTOMER_KEY } from '../decorators/require-rik-customer.decorator';
import { REQUIRE_CUSTOMER_KEY } from '../decorators/require-customer.decorator';
import type { AuthContext } from '../auth-context';

/**
 * Backend RIK access protection, end to end through the real guard and the
 * real AuthorizationService.
 *
 * WHY THIS IS A SEPARATE SPEC. authorization.guard.spec.ts already covers the
 * permission, customer and ownership rules with its own harness, and this adds
 * a dependency it does not have. A new file leaves that suite untouched rather
 * than widening its mocks and risking a regression in checks that already
 * work.
 *
 * The AuthorizationService here is REAL — only the repository beneath it is a
 * fake. That matters: if the service and the guard disagreed about what
 * `rikCustomerDenialReason` returning null means, a mocked service would hide
 * it and this would not.
 */

const CUSTOMER_ID = '11111111-1111-7111-8111-111111111111';
const STAFF_ID = '99999999-9999-7999-8999-999999999999';

function customerContext(id = CUSTOMER_ID): AuthContext {
  return {
    principalType: 'CUSTOMER',
    principalId: id,
    roles: new Set(),
    permissions: new Set(),
  };
}

function staffContext(roles: string[] = ['SUPER_ADMIN']): AuthContext {
  return {
    principalType: 'STAFF',
    principalId: STAFF_ID,
    roles: new Set(roles),
    permissions: new Set(['shared.user.manage', 'rik.entitlement.allocate']),
  };
}

/** Stands in for a route that carries @RequireRikCustomer() at class level. */
function reflectorFor(keys: Record<string, unknown>) {
  return {
    getAllAndOverride: jest.fn((key: string) => keys[key]),
  };
}

function executionContext(authContext: AuthContext | null) {
  const request: Record<string, unknown> = {
    principal:
      authContext === null
        ? undefined
        : { principalType: authContext.principalType, principalId: authContext.principalId },
    params: {},
  };
  if (authContext !== null) request.authContext = authContext;
  return {
    getHandler: () => function ration() {},
    getClass: () => class RikController {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

interface Harness {
  guard: AuthorizationGuard;
  customers: { findRikAuthorisation: jest.Mock };
  auditLog: { logEvent: jest.Mock };
  reasons: () => string[];
}

function harness(
  authorisation: { rikId: string | null; isActive: boolean } | null,
  keys: Record<string, unknown> = { [REQUIRE_RIK_CUSTOMER_KEY]: true }
): Harness {
  const customers = {
    findRikAuthorisation: jest
      .fn()
      .mockResolvedValue(
        authorisation === null ? null : { customerId: CUSTOMER_ID, ...authorisation }
      ),
  };
  const userRoles = {
    resolveForUser: jest.fn().mockResolvedValue({ roles: [], permissions: [] }),
  };
  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') };
  const authorization = new AuthorizationService(userRoles as never, customers as never);
  const guard = new AuthorizationGuard(
    reflectorFor(keys) as never,
    authorization,
    auditLog as never
  );
  return {
    guard,
    customers,
    auditLog,
    reasons: () => auditLog.logEvent.mock.calls.map((c) => c[0].after?.reason),
  };
}

// ---------------------------------------------------------------------------

describe('RIK customer protection — a PIF-only customer is refused', () => {
  it('refuses a customer whose rik_id is NULL', async () => {
    const h = harness({ rikId: null, isActive: true });
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records WHY in the audit log, naming the resident and the route', async () => {
    const h = harness({ rikId: null, isActive: true });
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).rejects.toThrow();

    expect(h.reasons()).toContain('customer_not_rik_authorised');
    expect(h.auditLog.logEvent.mock.calls[0][0]).toMatchObject({
      actorId: CUSTOMER_ID,
      actorRole: 'CUSTOMER',
      action: 'AUTHORIZATION_DENIED',
      entityType: 'http_route',
    });
  });

  it('tells the caller nothing about why — no RIK ID, no reason, no structure', async () => {
    const h = harness({ rikId: null, isActive: true });
    try {
      await h.guard.canActivate(executionContext(customerContext()) as never);
      throw new Error('should have been refused');
    } catch (err) {
      const body = JSON.stringify((err as ForbiddenException).getResponse()).toLowerCase();
      expect(body).not.toContain('rik_id');
      expect(body).not.toContain('rik id');
      expect(body).not.toContain('not_rik_authorised');
      expect(body).toContain('do not have permission');
    }
  });
});

describe('RIK customer protection — an approved RIK customer is admitted', () => {
  it('admits a customer with a RIK ID who is active', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).resolves.toBe(true);
    expect(h.auditLog.logEvent).not.toHaveBeenCalled();
  });

  it('looks the authorisation up for THIS customer, not any other', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await h.guard.canActivate(executionContext(customerContext()) as never);
    expect(h.customers.findRikAuthorisation).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it('resolves it live on every request, never from the token', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await h.guard.canActivate(executionContext(customerContext()) as never);
    await h.guard.canActivate(executionContext(customerContext()) as never);
    expect(h.customers.findRikAuthorisation).toHaveBeenCalledTimes(2);
  });
});

describe('RIK customer protection — a deactivated officer loses access', () => {
  it('refuses a customer with a RIK ID whose account is inactive', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: false });
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.reasons()).toContain('customer_inactive');
  });

  it('distinguishes an inactive officer from a PIF-only resident in the audit', async () => {
    const inactive = harness({ rikId: 'RIK-O-000042', isActive: false });
    await expect(
      inactive.guard.canActivate(executionContext(customerContext()) as never)
    ).rejects.toThrow();

    const pifOnly = harness({ rikId: null, isActive: true });
    await expect(
      pifOnly.guard.canActivate(executionContext(customerContext()) as never)
    ).rejects.toThrow();

    expect(inactive.reasons()).not.toEqual(pifOnly.reasons());
  });
});

describe('RIK customer protection — a vanished customer record', () => {
  it('refuses a token whose customer row no longer exists or was soft-deleted', async () => {
    const h = harness(null);
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.reasons()).toContain('customer_record_missing');
  });
});

describe('RIK customer protection — staff do not get in this way', () => {
  it('refuses a SUPER_ADMIN staff principal', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await expect(
      h.guard.canActivate(executionContext(staffContext(['SUPER_ADMIN'])) as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.reasons()).toContain('not_a_customer_principal');
  });

  it('refuses a RIK_ADMIN staff principal', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await expect(
      h.guard.canActivate(executionContext(staffContext(['RIK_ADMIN'])) as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never queries shared.customers for a staff principal', async () => {
    // A staff id is not a customer id. Looking one up would be meaningless at
    // best and a confused identity at worst.
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await expect(
      h.guard.canActivate(executionContext(staffContext()) as never)
    ).rejects.toThrow();
    expect(h.customers.findRikAuthorisation).not.toHaveBeenCalled();
  });
});

describe('RIK customer protection — an unauthenticated caller', () => {
  /**
   * JwtAuthGuard runs first and throws 401 before this guard is reached, so an
   * unauthenticated request never gets here. What is asserted is the thing
   * that would matter if the order were ever changed: this guard does not
   * admit a request with no principal.
   */
  it('does not admit a request that arrived with no principal', async () => {
    const h = harness({ rikId: 'RIK-O-000042', isActive: true });
    await expect(
      h.guard.canActivate(executionContext(null) as never)
    ).rejects.toThrow();
  });
});

describe('RIK customer protection — routes that do not declare it', () => {
  it('leaves a route without the decorator alone', async () => {
    const h = harness({ rikId: null, isActive: true }, {});
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).resolves.toBe(true);
    expect(h.customers.findRikAuthorisation).not.toHaveBeenCalled();
  });

  it('does not query shared.customers on a PIF route, so PIF pays nothing', async () => {
    // PIF's routes carry @RequireCustomer() only. A PIF-only resident must
    // reach them, and must not pay for a RIK lookup to do so.
    const h = harness({ rikId: null, isActive: true }, { [REQUIRE_CUSTOMER_KEY]: true });
    await expect(
      h.guard.canActivate(executionContext(customerContext()) as never)
    ).resolves.toBe(true);
    expect(h.customers.findRikAuthorisation).not.toHaveBeenCalled();
  });
});
