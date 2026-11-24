import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// e Samagri customer-web — Vite config (Phase 3B STEP 8 — final
// approved logo + PWA foundation).
//
// Icons are generated from the FINAL approved client-supplied logo
// (see public/brand/README.md for exactly what operation was applied
// — a mechanical fit-to-square, never a redraw; an earlier, since
// superseded logo version was fully reverted before this one was
// introduced). Theme/background colors come from the same brand
// tokens as tailwind.config.js, sampled from the final logo/UI
// reference, not a placeholder guess.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate'.
      //
      // With 'autoUpdate' the generated registerSW.js was the bare
      // registration — no onNeedRefresh, no reload. A new worker would
      // skipWaiting() and clientsClaim(), but THE PAGE ON SCREEN KEPT RUNNING
      // THE OLD JAVASCRIPT, so every returning customer got one stale visit
      // per deployment and nothing ever reloaded them out of it. On an
      // installed mobile app there is no hard-refresh affordance at all, so
      // that stale visit was not recoverable by the customer.
      //
      // 'prompt' hands the decision to the app: src/main.tsx registers through
      // virtual:pwa-register and surfaces onNeedRefresh as a one-tap
      // notification, suppressed while a checkout is in flight.
      registerType: 'prompt',
      // The app registers the worker itself, so the plugin must not also
      // inject its own script tag. Explicit rather than relying on 'auto'
      // detecting the virtual import.
      injectRegister: null,
      includeAssets: ['brand/e-samagri-logo.jpg'],
      manifest: {
        name: 'e Samagri',
        short_name: 'e Samagri',
        description: 'Essentials for a Brighter Tomorrow. Community grocery and everyday essentials, ordered from home.',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#10282C',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the shell (HTML/JS/CSS/icons). Never precache or
        // runtime-cache API responses — session, cart, order and OTP
        // traffic must always hit the network fresh (STEP 8 Section 24:
        // no indiscriminate caching of sensitive authenticated data).
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // Listen on every interface, not just the loopback. Without this the
    // dev server answers http://localhost:5173 and nothing else, so a
    // phone or kiosk on the same network cannot reach it at all.
    host: true,
    proxy: {
      // SAME-ORIGIN API ACCESS.
      //
      // The browser calls /api/... on whatever host it loaded the app
      // from, and this forwards to the API. Two things follow, and both
      // are the point:
      //
      //   * No CORS. The request never leaves the app's own origin, so
      //     the API's allowlist does not have to name every address the
      //     app might be opened at — which is what broke LAN access,
      //     since a DHCP lease is not something an allowlist can
      //     usefully anticipate.
      //   * The refresh cookie is set on the host the person actually
      //     typed. http://localhost:5173 and http://<lan-ip>:5173 each
      //     get their own working session from one unchanged build.
      //
      // 127.0.0.1 rather than localhost: on Windows localhost resolves
      // ::1 first, and the API listens on IPv4, so the IPv6 attempt is
      // refused before the IPv4 one is tried.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),

        // THE REFRESH COOKIE'S PATH HAS TO BE REWRITTEN TOO, and leaving
        // this out is what silently broke every session.
        //
        // The API sets the refresh cookie with `Path=/auth` — correct,
        // and deliberately narrow, so the long-lived credential is sent
        // only to the routes that rotate it. It was right when the
        // browser called the API directly at :3000/auth/refresh.
        //
        // It stopped being right the moment the app started calling
        // /api/auth/refresh through this proxy. A browser sends a cookie
        // only when the REQUEST path begins with the cookie's Path, and
        // `/api/auth/refresh` does not begin with `/auth`. So the cookie
        // was stored and then never sent again — by the browser, exactly
        // as the specification says — and /auth/refresh answered 401
        // every time.
        //
        // WHY THAT LOOKED LIKE SOMETHING ELSE ENTIRELY. Signing in still
        // appeared to work, because the access token comes back in the
        // response BODY and lives in memory. The session only collapsed
        // when something first needed a refresh — which is why it
        // presented as "logged out after a short while" and "logged out
        // when I open RIK", rather than as a failure to sign in.
        //
        // The path is rewritten here, where the mismatch is created,
        // rather than widening the cookie in the API. Nothing about the
        // API, the cookie's httpOnly/sameSite protections or its
        // narrowness changes: it is simply relabelled to the path this
        // dev server actually serves it under. `server.proxy` applies to
        // `vite dev` only, so no deployment is affected.
        cookiePathRewrite: { '/auth': '/api/auth' },
      },
    },
  },
});
