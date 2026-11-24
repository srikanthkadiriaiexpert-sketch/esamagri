import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationGuard, type AuthorizedRequest } from './authorization.guard';
import { AuthorizationService } from '../services/authorization.service';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../auth-context';

function contextFor(request: Partial<AuthorizedRequest>, params: Record<string, string> = {}): ExecutionContext {
  // getRequest() must return the SAME object reference on every call
  // (both getHandler-style checks in the guard and the assertions
  // below need to observe the guard's mutation of request.authContext)
  // — merge params into `request` in place rather than spreading a
  // fresh object each call.
  Object.assign(request, { params });
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (() => undefined) as never,
    getClass: () => class DemoController {},
  } as unknown as ExecutionContext;
}

describe('AuthorizationGuard', () => {
  let reflector: Reflector;
  let authorization: jest.Mocked<Pick<AuthorizationService, 'resolveContext' | 'hasAllPermissions'>>;
  let auditLog: jest.Mocked<Pick<AuditLogRepository, 'logEvent'>>;
  let guard: AuthorizationGuard;

  const staffContext: AuthContext = {
    principalType: 'STAFF',
    principalId: 'staff-1',
    roles: new Set(['RIK_ADMIN']),
    permissions: new Set(['rik.product.manage']),
  };
  const customerContext: AuthContext = {
    principalType: 'CUSTOMER',
    principalId: 'cust-1',
    roles: new Set(),
    permissions: new Set(),
  };

  beforeEach(() => {
    reflector = new Reflector();
    authorization = { resolveContext: jest.fn(), hasAllPermissions: jest.fn() } as never;
    auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') } as never;
    guard = new AuthorizationGuard(reflector, authorization as unknown as AuthorizationService, auditLog as unknown as AuditLogRepository);
  });

  it('allows a @Public() route through without resolving any context', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true); // isPublic
    const ctx = contextFor({ principal: { principalType: 'CUSTOMER', principalId: 'x' } } as never);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.resolveContext).not.toHaveBeenCalled();
  });

  it('attaches the resolved AuthContext to the request for a route with no requirements', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined as never); // no metadata anywhere
    authorization.resolveContext.mockResolvedValue(staffContext);
    const request = { principal: { principalType: 'STAFF', principalId: 'staff-1' } } as unknown as AuthorizedRequest;
    const ctx = contextFor(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.authContext).toBe(staffContext);
  });

  describe('@RequireCustomer', () => {
    it('rejects a STAFF principal with 403 and logs an audit event', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'requireCustomer' ? true : undefined) as never);
      authorization.resolveContext.mockResolvedValue(staffContext);
      const ctx = contextFor({ principal: { principalType: 'STAFF', principalId: 'staff-1' } } as never);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(auditLog.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTHORIZATION_DENIED', actorId: 'staff-1' })
      );
    });

    it('allows a CUSTOMER principal through', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'requireCustomer' ? true : undefined) as never);
      authorization.resolveContext.mockResolvedValue(customerContext);
      const ctx = contextFor({ principal: { principalType: 'CUSTOMER', principalId: 'cust-1' } } as never);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(auditLog.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('@OwnResourceParam', () => {
    it('rejects when the route param does not match the customer principal id (horizontal escalation)', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'ownResourceParam' ? 'customerId' : undefined) as never);
      authorization.resolveContext.mockResolvedValue(customerContext);
      const ctx = contextFor({ principal: { principalType: 'CUSTOMER', principalId: 'cust-1' } } as never, {
        customerId: 'someone-elses-id',
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('allows when the route param matches the customer principal id', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'ownResourceParam' ? 'customerId' : undefined) as never);
      authorization.resolveContext.mockResolvedValue(customerContext);
      const ctx = contextFor({ principal: { principalType: 'CUSTOMER', principalId: 'cust-1' } } as never, {
        customerId: 'cust-1',
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects a STAFF principal even if the param happens to match some id (own-resource is customer-only)', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'ownResourceParam' ? 'customerId' : undefined) as never);
      authorization.resolveContext.mockResolvedValue(staffContext);
      const ctx = contextFor({ principal: { principalType: 'STAFF', principalId: 'staff-1' } } as never, {
        customerId: 'staff-1',
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('@RequirePermissions', () => {
    it('rejects when the resolved context is missing a required permission', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'requirePermissions' ? ['pif.product.manage'] : undefined) as never);
      authorization.resolveContext.mockResolvedValue(staffContext); // RIK_ADMIN, no pif permissions
      authorization.hasAllPermissions.mockReturnValue(false);
      const ctx = contextFor({ principal: { principalType: 'STAFF', principalId: 'staff-1' } } as never);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(auditLog.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTHORIZATION_DENIED', after: expect.objectContaining({ reason: 'missing_required_permission' }) })
      );
    });

    it('allows when the resolved context has every required permission', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'requirePermissions' ? ['rik.product.manage'] : undefined) as never);
      authorization.resolveContext.mockResolvedValue(staffContext);
      authorization.hasAllPermissions.mockReturnValue(true);
      const ctx = contextFor({ principal: { principalType: 'STAFF', principalId: 'staff-1' } } as never);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('the 403 response body never names the specific missing permission', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) => (key === 'requirePermissions' ? ['shared.role.grant'] : undefined) as never);
      authorization.resolveContext.mockResolvedValue(staffContext);
      authorization.hasAllPermissions.mockReturnValue(false);
      const ctx = contextFor({ principal: { principalType: 'STAFF', principalId: 'staff-1' } } as never);

      let caught: ForbiddenException | undefined;
      try {
        await guard.canActivate(ctx);
      } catch (err) {
        caught = err as ForbiddenException;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(JSON.stringify(caught?.getResponse())).not.toContain('shared.role.grant');
    });
  });
});
