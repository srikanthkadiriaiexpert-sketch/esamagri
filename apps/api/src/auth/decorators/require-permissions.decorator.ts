import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@esamagri/shared-types';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';

/**
 * Declares that a route may only be reached by a STAFF principal whose
 * DB-resolved permission set (AuthorizationService, backed by
 * shared.user_roles/role_permissions/permissions) includes ALL of the
 * given codes. Enforced by AuthorizationGuard, which always runs
 * after JwtAuthGuard — missing/invalid/expired auth is still 401
 * (JwtAuthGuard's job alone); authenticated but missing a required
 * permission is 403 here.
 *
 * Codes are always @esamagri/shared-types `PermissionCode` values —
 * the same compile-time-checked, DB-mirrored set the rest of the app
 * uses — so a typo here is a compile error, never a silently
 * always-403 (or worse, always-open) route.
 */
export const RequirePermissions = (...codes: PermissionCode[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);
