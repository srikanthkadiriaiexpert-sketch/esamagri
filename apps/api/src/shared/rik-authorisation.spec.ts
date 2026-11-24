import { isRikAuthorised } from './repositories/customers.repository';
import { AuthorizationService } from '../auth/services/authorization.service';
import type { CustomerRikAuthorisation } from './repositories/customers.repository';
import type { AuthContext } from '../auth/auth-context';

/**
 * The gate and the interface must agree about who may use RIK.
 *
 * Two places answer that question. AuthorizationGuard calls
 * `AuthorizationService.rikCustomerDenialReason`, which REFUSES a request. The
 * customer profile calls `isRikAuthorised`, which tells the Customer App
 * whether to OFFER the RIK module.
 *
 * If they disagree one of two things happens, and the second is the dangerous
 * one. Either the app shows a module whose every request is refused — visibly
 * broken, annoying, obvious. Or the app HIDES the module from a resident who
 * is entitled to it, which produces no error anywhere, logs nothing, and would
 * be discovered only when an officer complains that their ration vanished.
 *
 * So this spec enumerates every shape the authorisation facts can take and
 * asserts the two answers match. It is deliberately exhaustive rather than
 * representative: the whole value is in there being no case it skips.
 */

const CUSTOMER_ID = '11111111-1111-7111-8111-111111111111';

function customerContext(): AuthContext {
  return {
    principalType: 'CUSTOMER',
    principalId: CUSTOMER_ID,
    roles: new Set(),
    permissions: new Set(),
  };
}

function serviceFor(authorisation: CustomerRikAuthorisation | null): AuthorizationService {
  return new AuthorizationService(
    { resolveForUser: jest.fn() } as never,
    { findRikAuthorisation: jest.fn().mockResolvedValue(authorisation) } as never
  );
}

/** Every combination of the two facts, plus the missing-row case. */
const CASES: { label: string; authorisation: CustomerRikAuthorisation | null }[] = [
  {
    label: 'an approved, active officer',
    authorisation: { customerId: CUSTOMER_ID, rikId: 'RIK-O-000042', isActive: true },
  },
  {
    label: 'an approved but DEACTIVATED officer',
    authorisation: { customerId: CUSTOMER_ID, rikId: 'RIK-O-000042', isActive: false },
  },
  {
    label: 'an active PIF-only resident',
    authorisation: { customerId: CUSTOMER_ID, rikId: null, isActive: true },
  },
  {
    label: 'a deactivated PIF-only resident',
    authorisation: { customerId: CUSTOMER_ID, rikId: null, isActive: false },
  },
  {
    label: 'no customer row at all',
    authorisation: null,
  },
];

describe('isRikAuthorised — the predicate in isolation', () => {
  it('admits only an active customer holding a RIK ID', () => {
    expect(
      isRikAuthorised({ customerId: CUSTOMER_ID, rikId: 'RIK-O-000042', isActive: true })
    ).toBe(true);
  });

  it.each(CASES.filter((c) => c.label !== 'an approved, active officer'))(
    'refuses $label',
    ({ authorisation }) => {
      expect(isRikAuthorised(authorisation)).toBe(false);
    }
  );

  it('treats an empty-string RIK ID as present, because the column CHECK forbids one', () => {
    // shared_customers_rik_id_chk enforces '^RIK-O-[0-9]{6,}$', so an empty
    // string cannot be stored. Pinned so nobody "hardens" this into a truthiness
    // check and quietly changes what NULL means.
    expect(isRikAuthorised({ customerId: CUSTOMER_ID, rikId: '', isActive: true })).toBe(true);
  });
});

describe('the gate and the interface agree, case for case', () => {
  it.each(CASES)('$label', async ({ authorisation }) => {
    const reason = await serviceFor(authorisation).rikCustomerDenialReason(customerContext());
    const offeredByUi = isRikAuthorised(authorisation);

    // Admitted by the gate exactly when the module would be offered.
    expect(reason === null).toBe(offeredByUi);
  });

  it('never offers the module to a caller the gate would refuse', async () => {
    for (const { authorisation } of CASES) {
      const reason = await serviceFor(authorisation).rikCustomerDenialReason(customerContext());
      if (isRikAuthorised(authorisation)) {
        expect(reason).toBeNull();
      } else {
        expect(reason).not.toBeNull();
      }
    }
  });
});

describe('a STAFF principal is outside this question entirely', () => {
  it('is refused by the gate whatever the customer facts say', async () => {
    const service = serviceFor({
      customerId: CUSTOMER_ID,
      rikId: 'RIK-O-000042',
      isActive: true,
    });
    const reason = await service.rikCustomerDenialReason({
      principalType: 'STAFF',
      principalId: '99999999-9999-7999-8999-999999999999',
      roles: new Set(['SUPER_ADMIN']),
      permissions: new Set(['rik.entitlement.allocate']),
    });
    expect(reason).toBe('not_a_customer_principal');
  });
});
