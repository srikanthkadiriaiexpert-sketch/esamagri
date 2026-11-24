import { SetMetadata } from '@nestjs/common';

export const REQUIRE_RIK_CUSTOMER_KEY = 'requireRikCustomer';

/**
 * Declares that a route may only be reached by a customer with an APPROVED,
 * ACTIVE RIK profile — that is, a `shared.customers` row whose `rik_id` is not
 * null and whose `is_active` is true.
 *
 * WHY THIS EXISTS. Until now every customer-facing RIK route was gated by
 * `@RequireCustomer()` alone, which asks one question: "are you a customer?"
 * That was correct while the ONLY way a customer row could exist was RIK
 * officer registration — every customer was an officer by construction. PIF
 * self-registration ends that invariant, and without this decorator the first
 * resident to register would reach the ration catalogue, the entitlement
 * calculation and the issue vouchers.
 *
 * WHAT IT IS NOT. It is not a permission and not a role. Customers hold
 * neither — `shared.user_roles`' foreign key is to `shared.users` only, so a
 * customer has no row there and `AuthContext` gives every customer an empty
 * role and permission set (see that file's doc). RIK authorisation for a
 * customer is a PROPERTY OF THEIR OWN RECORD, resolved live from
 * shared.customers on each request, in the same spirit as the ownership-based
 * `@OwnResourceParam` check rather than the permission-code checks. No new
 * role, permission, table or identity was invented for it.
 *
 * A STAFF PRINCIPAL IS REFUSED, of any role, SUPER_ADMIN included — exactly as
 * `@RequireCustomer()` refuses one. Staff reach RIK through the permission-
 * gated `admin/rik/...` controllers, which this decorator does not touch.
 *
 * It SUBSUMES `@RequireCustomer()`, but the existing `@RequireCustomer()`
 * decorators have deliberately been left in place where they are: removing
 * working authorisation in the same change that adds more is how a gap gets
 * introduced. Both run, and the stricter one decides.
 *
 * APPLY IT AT CLASS LEVEL. A per-route decorator is one forgotten line away
 * from an unprotected route; a class-level one covers every route a controller
 * will ever gain. AuthorizationGuard resolves it with
 * `getAllAndOverride([handler, class])`, so the class-level declaration
 * applies to every handler.
 *
 * NOTE ON WHEN IT BECOMES LOAD-BEARING. Before migration 0065, `rik_id` is
 * `NOT NULL`, so every existing customer satisfies this check and behaviour is
 * unchanged. It starts refusing people the moment the column can hold NULL —
 * which is precisely when it needs to.
 */
export const RequireRikCustomer = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_RIK_CUSTOMER_KEY, true);
