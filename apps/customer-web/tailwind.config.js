/** @type {import('tailwindcss').Config} */
//
// e Samagri design tokens (Phase 3B STEP 8 — final approved logo + UI
// reference).
//
// Colors are sampled programmatically from the final approved logo
// (public/brand/e-samagri-logo.jpg) and the final approved customer-app
// UI reference image (kept in the STEP 8 report, not shipped as a
// repo asset) — not guessed, not carried over from the earlier
// (superseded) logo/palette.
//
// Per the approved UI reference: RIK uses the BLUE family throughout
// (card, "Enter RIK" button, RIK-context accents) and PIF uses the
// GREEN family (the logo's own green) throughout — this is the
// opposite pairing from an earlier internal draft of this file and is
// intentional: it matches the supplied reference exactly, not an
// assumption.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          forest: '#10282C',
          forestDark: '#0A1B1E',
          green: '#087A35',
          greenDark: '#05602A',
          greenLight: '#EBFBF1',
          // Warm yellow, the PIF shop's second voice: the sticky cart bar,
          // the badges that go with it, and nothing that carries meaning on
          // its own. Approved alongside the green above.
          yellow: '#FFD83D',
          yellowDark: '#E0B800',
          yellowLight: '#FFF8DC',
          // TEAL — the one colour in this file that is NOT sampled from the
          // logo, because the logo contains no teal: it is pure green
          // (#03662F family, which is why brand.green above is #087A35).
          // The client asked in writing for "green and teal", so rather than
          // guess a teal, these three are brand.forest's OWN hue (188.6°,
          // measured from #10282C) raised to usable lightnesses. That keeps
          // the new colour inside the approved palette's geometry instead of
          // introducing a fourth, unrelated hue.
          teal: '#0F6776',
          tealDark: '#0A4C57',
          tealLight: '#E6F2F4',
          blue: '#0072E5',
          blueDark: '#0056BB',
          blueLight: '#E8F5FD',
          amber: '#F2994A',
          amberDark: '#C96F1F',
          amberLight: '#FFF3E8',
          purple: '#5B2FE0',
          purpleDark: '#421FB0',
          purpleLight: '#F1EDFE',
        },
        // RIK / PIF are referenced by module name directly in a few
        // places (module-aware components) so screens never have to
        // remember "RIK = blue" themselves.
        rik: {
          DEFAULT: '#0072E5',
          dark: '#0056BB',
          light: '#E8F5FD',
        },
        pif: {
          DEFAULT: '#087A35',
          dark: '#05602A',
          light: '#EBFBF1',
          accent: '#FFD83D',
          accentDark: '#E0B800',
        },
        semantic: {
          success: '#026A2E',
          warning: '#F2994A',
          danger: '#DE292E',
          dangerLight: '#FCEEEB',
          info: '#0072E5',
          infoLight: '#E8F5FD',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.06), 0 1px 3px 0 rgb(15 23 42 / 0.08)',
        sheet: '0 -4px 24px 0 rgb(15 23 42 / 0.16)',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        /*
         * 44px, the minimum comfortable touch target.
         *
         * This lives in `spacing` as well as in minHeight/minWidth below
         * because `h-touch` and `w-touch` read the SPACING scale, not the
         * minHeight/minWidth scales. Without this line those two classes
         * named a key that did not exist, so Tailwind emitted nothing for
         * them and every control written as `h-touch w-touch` rendered at
         * whatever its icon happened to be — 20px to 24px, measured. The
         * menu button, the notification bell, the back arrow, both cart
         * buttons and the drawer close button were all affected, on every
         * screen, while the markup read as though the rule was being
         * followed. `min-h-touch` always worked; `h-touch` never did.
         */
        touch: '44px',
      },
      maxWidth: {
        app: '480px',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      animation: {
        'slide-up': 'slide-up 200ms ease-out',
        'fade-in': 'fade-in 150ms ease-out',
        'toast-in': 'toast-in 200ms ease-out',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        'toast-in': {
          '0%': { transform: 'translateY(-12px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
