import { SetMetadata } from '@nestjs/common';

export const OWN_RESOURCE_PARAM_KEY = 'ownResourceParam';

/**
 * Declares that the named route param must equal the authenticated
 * CUSTOMER principal's own id — the horizontal-privilege-escalation
 * guard for the "GET /customers/:customerId/..." pattern (STEP 7
 * kickoff Section 15: a request for /customers/123 must not be
 * satisfiable by changing the URL to /customers/124). Enforced by
 * AuthorizationGuard, always alongside @RequireCustomer() — a
 * mismatch is 403, the same generic error shape regardless of whether
 * the OTHER id even exists, so this can never be used to probe which
 * customer ids are valid.
 */
export const OwnResourceParam = (paramName: string): MethodDecorator & ClassDecorator =>
  SetMetadata(OWN_RESOURCE_PARAM_KEY, paramName);
