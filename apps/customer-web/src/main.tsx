import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { UpdateAvailableBar } from './design-system/UpdateAvailableBar';
import { setUpdateReady } from './lib/pwa/update-state';
import './index.css';

/**
 * DEVELOPMENT ONLY — clear any service worker left on this origin.
 *
 * `vite preview` used to serve this app on the same port the dev server uses.
 * It registers a worker at scope '/', and a worker belongs to the ORIGIN, not
 * to the server process — so it kept serving its precached production shell
 * after the dev server took the port over, and could never update because the
 * dev server serves no sw.js (devOptions.enabled is false).
 *
 * NEVER RUNS IN PRODUCTION. `import.meta.env.DEV` is statically false in a
 * build, so Vite eliminates this entire branch — the shipped bundle contains
 * no unregister call at all. Verify after any change with:
 *   grep -c getRegistrations apps/customer-web/dist/assets/index-*.js   -> 0
 *
 * A LIMITATION, STATED HONESTLY: while a stale worker is serving its precached
 * index.html, this file never runs — the old bundle runs instead. So this
 * cannot rescue an origin that is ALREADY poisoned; it takes effect after one
 * hard reload (or a DevTools unregister), and from then on keeps the origin
 * clean. The real cure is that demo-start.cjs no longer serves a build here.
 */
if (import.meta.env.DEV) {
  void (async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      if ('caches' in window) {
        for (const key of await caches.keys()) {
          await caches.delete(key);
        }
      }
    } catch {
      // A browser that refuses either API is not a reason to stop the app.
    }
  })();
} else {
  /**
   * PRODUCTION — register the worker and SURFACE an update instead of applying
   * one.
   *
   * `registerType: 'prompt'` means a new worker installs and WAITS. The plugin
   * then calls onNeedRefresh, and we hand that to the store so the bar can
   * appear. Nothing reloads until the customer taps Reload.
   *
   * WHY updateSW() TAKES NO ARGUMENT. Its signature is
   * `(reloadPage?: boolean) => Promise<void>`, but the parameter has been
   * unused since 0.13.2 — in this installed version it is literally
   * `_reloadPage` (node_modules/vite-plugin-pwa/dist/client/build/register.js
   * line 19). Calling it posts SKIP_WAITING to the waiting worker; THE RELOAD
   * comes from the plugin's own 'controlling' listener, which calls
   * window.location.reload() precisely because we do NOT supply onNeedReload.
   * Passing `true` would have looked like it caused the reload and would have
   * done nothing.
   */
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      setUpdateReady(() => {
        void updateSW();
      });
    },
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found — check index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
    {/* Outside <App/> on purpose: it must not depend on the router or on an
        auth session, and it must be reachable from every screen. */}
    <UpdateAvailableBar />
  </React.StrictMode>
);
