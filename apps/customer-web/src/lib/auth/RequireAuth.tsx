import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { LoadingState } from '../../design-system/StateViews';

/**
 * Route guard for the customer app shell. The backend (STEP 6/7) is
 * always the real authority — this only decides which screen to show;
 * it never grants access to data the API wouldn't otherwise return.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingState label="Checking your session…" />;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/auth/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
