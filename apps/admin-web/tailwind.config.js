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
          green: '#026A2E',
          greenDark: '#014D22',
          greenLight: '#EBFBF1',
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
          DEFAULT: '#026A2E',
          dark: '#014D22',
          light: '#EBFBF1',
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
        // Minimum accessible touch target, so h-touch / w-touch /
        // min-h-touch / min-w-touch all resolve from one token.
        touch: '44px',
        18: '4.5rem',
        22: '5.5rem',
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
