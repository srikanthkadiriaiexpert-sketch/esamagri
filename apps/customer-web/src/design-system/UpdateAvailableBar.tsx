import { Button } from './Button';
import { useUpdatePrompt } from '../lib/pwa/update-state';

/**
 * "A new version is available." — one tap to take it.
 *
 * WHY A CUSTOMER EVER SEES THIS. A service worker serves the app from its own
 * precache, so a deployed update does not reach a returning customer until
 * something reloads the page. Nothing used to: registerType was 'autoUpdate'
 * with the plugin's bare registration, so a new worker claimed the page while
 * the page kept running the OLD JavaScript. On a phone — and especially an
 * installed app, where there is no address bar and no hard refresh — a stale
 * shell was not something a resident could clear.
 *
 * WHEN IT IS NOT SHOWN. While a checkout or ration confirmation is in flight.
 * See lib/pwa/update-state.ts for why that matters more than it looks.
 *
 * Deliberately NOT a toast: a toast disappears, and a customer who misses it
 * stays on an old version. This stays until it is used or dismissed, and
 * "Not now" hides it only for this page session — the next load offers it
 * again while the update is still waiting.
 */
export function UpdateAvailableBar() {
  const { visible, apply, dismiss } = useUpdatePrompt();

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-brand-green/30 bg-brand-greenLight p-3.5 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-greenDark">A new version is available</p>
          <p className="text-xs text-brand-greenDark/80">Reload to get the latest e Samagri.</p>
        </div>
        <Button accent="green" size="md" onClick={apply}>
          Reload
        </Button>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-brand-greenDark/70 hover:text-brand-greenDark"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
