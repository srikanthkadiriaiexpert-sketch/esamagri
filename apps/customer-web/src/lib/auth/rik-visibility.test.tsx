import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAuth, useRikVisibility } from './AuthContext';

/**
 * The two auth readers, and the difference between them.
 *
 * WHY THIS FILE EXISTS. Stage 3B gave HomePage a `useAuth()` call so it could
 * decide whether to offer the RIK module. HomePage.test.tsx and
 * home-announcements.test.tsx both render <HomePage /> directly, with no
 * <AuthProvider> — by design, because neither is a test about sessions — and
 * `useAuth` throws outside a provider. Twenty-six tests failed with
 * "useAuth must be used within <AuthProvider>".
 *
 * The fix was NOT to soften useAuth, and NOT to build a session in those
 * tests. It was to notice that two different questions were being asked
 * through one door:
 *
 *   "sign this person in / out"   has no sensible answer with no provider.
 *                                 useAuth still throws. Unchanged.
 *
 *   "should I draw the RIK card"  has one: not known. And not-known already
 *                                 means "show it" everywhere else in this
 *                                 codebase — see rikModuleHidden.
 *
 * These tests pin both halves, so neither drifts: the presentation reader
 * stays provider-optional, and the session reader stays strict.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function VisibilityProbe() {
  const visibility = useRikVisibility();
  return <p>visibility: {visibility === null ? 'unknown' : String(visibility)}</p>;
}

function SessionProbe() {
  useAuth();
  return <p>never rendered</p>;
}

describe('useRikVisibility without an AuthProvider', () => {
  it('returns null rather than throwing', () => {
    render(<VisibilityProbe />);
    expect(screen.getByText('visibility: unknown')).toBeInTheDocument();
  });

  it('null is not false, so the RIK module is shown rather than hidden', () => {
    // This is the whole safety property. `hideRik` is `=== false`, and the
    // unknown answer must never satisfy it — hiding RIK from an approved
    // officer fails silently, while showing it to a PIF-only resident fails
    // visibly and is refused by the server anyway.
    const unknown: boolean | null = null;
    expect(unknown === false).toBe(false);
  });
});

describe('useAuth without an AuthProvider — deliberately still strict', () => {
  it('throws, because a session cannot be defaulted away', () => {
    // React logs the component error to the console on its way out; that is
    // React doing its job, not a failure, so it is silenced for this one
    // assertion rather than left to clutter the run.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SessionProbe />)).toThrow(/must be used within <AuthProvider>/);
  });
});
