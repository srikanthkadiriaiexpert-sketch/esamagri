import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStaffAuth } from './StaffAuthContext';
import { LoadingState } from '../../design-system/States';

/**
 * Gate for every non-public admin route.
 *
 * This is a routing convenience, NOT the security boundary. It exists so
 * an unauthenticated visitor lands on sign-in instead of watching a
 * shell render empty panels. The actual protection is server-side: each
 * admin endpoint passes JwtAuthGuard then AuthorizationGuard, so a
 * staff member who bypasses this component entirely still receives 401
 * or 403 for anything their role does not cover.
 *
 * While the one silent refresh on mount is in flight the status is
 * 'loading' — redirecting then would sign out anyone who simply
 * reloaded the page, since the access token is deliberately memory-only.
 */
export function RequireStaffAuth({ children }: { children: ReactNode }) {
  const { status } = useStaffAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <LoadingState label="Restoring your session…" />
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
