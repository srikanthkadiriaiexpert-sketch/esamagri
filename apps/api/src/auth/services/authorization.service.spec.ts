import { AuthorizationService } from './authorization.service';
import { UserRolesRepository } from '../../shared/repositories/user-roles.repository';
import type { AuthContext } from '../auth-context';

function contextFor(principalType: 'STAFF' | 'CUSTOMER', roles: string[] = [], permissions: string[] = []): AuthContext {
  return { principalType, principalId: 'p-1', roles: new Set(roles), permissions: new Set(permissions) };
}

describe('AuthorizationService', () => {
  let userRoles: jest.Mocked<UserRolesRepository>;
  let service: AuthorizationService;

  beforeEach(() => {
    userRoles = { resolveForUser: jest.fn() } as never;
    // CustomersRepository was added for rikCustomerDenialReason(); these
    // tests exercise the role/permission half, which never reaches it.
    service = new AuthorizationService(userRoles, {
      findRikAuthorisation: jest.fn().mockResolvedValue(null),
    } as never);
  });

  describe('resolveContext', () => {
    it('a CUSTOMER principal resolves to empty roles/permissions without querying the database', async () => {
      const context = await service.resolveContext({ principalType: 'CUSTOMER', principalId: 'cust-1' });
      expect(context).toEqual({ principalType: 'CUSTOMER', principalId: 'cust-1', roles: new Set(), permissions: new Set() });
      expect(userRoles.resolveForUser).not.toHaveBeenCalled();
    });

    it('a STAFF principal resolves via UserRolesRepository', async () => {
      userRoles.resolveForUser.mockResolvedValue({ roles: ['RIK_ADMIN'], permissions: ['rik.product.manage'] });
      const context = await service.resolveContext({ principalType: 'STAFF', principalId: 'staff-1' });
      expect(userRoles.resolveForUser).toHaveBeenCalledWith('staff-1');
      expect(context.roles.has('RIK_ADMIN')).toBe(true);
      expect(context.permissions.has('rik.product.manage')).toBe(true);
    });

    it('a STAFF principal with zero role grants resolves to empty sets, not an error', async () => {
      userRoles.resolveForUser.mockResolvedValue({ roles: [], permissions: [] });
      const context = await service.resolveContext({ principalType: 'STAFF', principalId: 'staff-2' });
      expect(context.roles.size).toBe(0);
      expect(context.permissions.size).toBe(0);
    });
  });

  describe('hasPermission / hasAllPermissions', () => {
    it('a CUSTOMER context never has any permission, even one that happens to be in its (always-empty) set', () => {
      const context = contextFor('CUSTOMER');
      expect(service.hasPermission(context, 'shared.user.manage')).toBe(false);
    });

    it('a STAFF context has exactly the permissions it was resolved with', () => {
      const context = contextFor('STAFF', ['PIF_CASHIER'], ['pif.pos.open_bill', 'pif.pos.finalize_bill']);
      expect(service.hasPermission(context, 'pif.pos.open_bill')).toBe(true);
      expect(service.hasPermission(context, 'pif.product.manage')).toBe(false);
    });

    it('hasAllPermissions requires every listed code (AND, not ANY)', () => {
      const context = contextFor('STAFF', ['PIF_CASHIER'], ['pif.pos.open_bill', 'pif.pos.finalize_bill']);
      expect(service.hasAllPermissions(context, ['pif.pos.open_bill', 'pif.pos.finalize_bill'])).toBe(true);
      expect(service.hasAllPermissions(context, ['pif.pos.open_bill', 'pif.pos.return'])).toBe(false);
    });
  });

  describe('moduleScopes / canActOnModule', () => {
    it('a CUSTOMER has no module scope at all', () => {
      const context = contextFor('CUSTOMER');
      expect(service.moduleScopes(context).size).toBe(0);
      expect(service.canActOnModule(context, 'rik')).toBe(false);
      expect(service.canActOnModule(context, 'pif')).toBe(false);
    });

    it('RIK_ADMIN is scoped to rik only', () => {
      const context = contextFor('STAFF', ['RIK_ADMIN']);
      expect(service.canActOnModule(context, 'rik')).toBe(true);
      expect(service.canActOnModule(context, 'pif')).toBe(false);
    });

    it('PIF_ADMIN is scoped to pif only', () => {
      const context = contextFor('STAFF', ['PIF_ADMIN']);
      expect(service.canActOnModule(context, 'pif')).toBe(true);
      expect(service.canActOnModule(context, 'rik')).toBe(false);
    });

    it('SUPER_ADMIN has ANY scope and passes every module check', () => {
      const context = contextFor('STAFF', ['SUPER_ADMIN']);
      expect(service.canActOnModule(context, 'rik')).toBe(true);
      expect(service.canActOnModule(context, 'pif')).toBe(true);
      expect(service.canActOnModule(context, 'shared')).toBe(true);
    });

    it('a STAFF context with an unresolvable/unknown role name contributes no scope (never throws)', () => {
      const context = contextFor('STAFF', ['SOME_FUTURE_ROLE_NOT_YET_KNOWN']);
      expect(() => service.moduleScopes(context)).not.toThrow();
      expect(service.moduleScopes(context).size).toBe(0);
    });
  });
});
