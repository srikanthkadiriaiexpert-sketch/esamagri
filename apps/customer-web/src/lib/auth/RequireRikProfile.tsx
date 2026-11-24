import type { ReactNode } from 'react';
import { useRikVisibility } from './AuthContext';
import { EmptyState } from '../../design-system/StateViews';

/**
 * Route wrapper for the RIK module.
 *
 * THIS IS NOT SECURITY, AND SAYING SO IS NOT A DISCLAIMER. The server refuses
 * every RIK endpoint for a customer without an approved, active RIK profile —
 * `@RequireRikCustomer()` on RikController, enforced by AuthorizationGuard.
 * This component exists so that a PIF-only resident who taps a stale link, or
 * uses the browser's back button into `/rik`, gets one clear sentence instead
 * of a screen of empty panels and failed requests. Delete it and nothing
 * becomes insecure; it just becomes unpleasant.
 *
 * WHY IT DOES NOT REDIRECT. A redirect to Home would leave the person
 * wondering whether they mistyped something. An explanation on the screen they
 * asked for tells them what is actually true: this part of the app is for
 * residents the facility has approved for rations.
 *
 * WHY IT RENDERS CHILDREN WHILE THE ANSWER IS UNKNOWN. `rikAuthorised` is null
 * until the profile call resolves, and treating null as "no" would flash this
 * message at every officer on every cold load. An officer briefly seeing their
 * own ration screen is correct; a PIF-only resident briefly seeing it gets
 * empty panels for a moment and then this message — and the server refused
 * every request behind it either way.
 */
export function RequireRikProfile({ children }: { children: ReactNode }) {
  // Provider-optional for the same reason HomePage is: a test that mounts a
  // RIK screen directly should not have to build a session to do it.
  if (useRikVisibility() === false) {
    return (
      <EmptyState
        title="Rations are not available on your account"
        description="RIK rations are issued to residents the facility has approved. If you believe you should have access, please contact the facility office — they can add your RIK profile to this same account, and your orders and history will be kept."
      />
    );
  }

  return <>{children}</>;
}
