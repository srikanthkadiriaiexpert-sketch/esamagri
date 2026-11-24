import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@esamagri/shared-types';

export const REQUIRE_ANY_PERMISSION_KEY = 'requireAnyPermission';

/**
 * Declares that a route may be reached by a STAFF principal holding AT LEAST
 * ONE of the given permission codes (PHASE F).
 *
 * WHY THIS EXISTS, next to `RequirePermissions`. That decorator means ALL of
 * the codes, which is the right default and is what every RIK route uses.
 * But a PIF order is worked by several hands with deliberately different
 * authority — the order desk accepts and cancels (`pif.order.manage`), the
 * packer picks (`pif.order.prepare`), the delivery staff member records the
 * handover (`pif.order.mark_delivered`) — and all three must be able to OPEN
 * the order they are working on. Expressed with `RequirePermissions` that
 * would mean granting one role the others' authority, which is exactly what
 * must not happen.
 *
 * So this gates the DOOR on "any of these", and the service then decides,
 * per action, which permission that specific action needs. Both checks are
 * server-side and both read the live grant.
 *
 * It WIDENS nothing by itself: a principal holding none of the codes is
 * still refused, and if a route carries both decorators, both conditions
 * must hold. No existing route's authorization changes.
 */
export const RequireAnyPermission = (...codes: PermissionCode[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ANY_PERMISSION_KEY, codes);
