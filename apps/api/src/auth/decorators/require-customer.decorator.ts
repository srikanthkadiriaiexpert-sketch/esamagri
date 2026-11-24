import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CUSTOMER_KEY = 'requireCustomer';

/**
 * Declares that a route may only be reached by a CUSTOMER principal —
 * a STAFF principal (of any role, including SUPER_ADMIN) is 403 here,
 * never 401. Enforced by AuthorizationGuard. Typically paired with
 * @OwnResourceParam for the "customer can only see their own
 * resource" pattern (STEP 7 kickoff Section 7/15).
 */
export const RequireCustomer = (): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_CUSTOMER_KEY, true);
