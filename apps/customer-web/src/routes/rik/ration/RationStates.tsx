import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../../../design-system/StateViews';
import type { EntitlementState } from './useEntitlement';

/**
 * The non-success states of Know Your Ration (STEP 11D §22).
 *
 * Each says what actually happened and, where the customer can do
 * something about it, what that is. None of them guesses: a customer
 * with no dietary preference recorded is NOT shown a default ration,
 * because a ration they are not entitled to is worse than no ration at
 * all.
 */
export function RationStateView({ state, onRetry }: { state: EntitlementState; onRetry: () => void }) {
  const navigate = useNavigate();

  switch (state.status) {
    case 'loading':
      return <LoadingState label="Loading your ration details…" />;

    case 'no_period':
      return (
        <EmptyState
          title="No ration period is open"
          description="Your entitlement appears here once the facility opens the next ration period. Nothing is wrong with your account."
        />
      );

    case 'no_dietary_preference':
      return (
        <EmptyState
          title="Tell us your dietary preference"
          description={`${state.message} It decides which items you are entitled to, so nothing can be shown until it is recorded.`}
          action={{ label: 'Go to your profile', onClick: () => navigate('/account/profile') }}
        />
      );

    case 'no_eligible_days':
      return (
        <EmptyState
          title="Your eligible days are not recorded yet"
          description={`${state.message} The facility records this for each period; your entitlement will appear here as soon as it does.`}
        />
      );

    case 'error':
      return <ErrorState onRetry={onRetry} description="Your ration details could not be loaded. Please try again." />;

    default:
      return null;
  }
}
