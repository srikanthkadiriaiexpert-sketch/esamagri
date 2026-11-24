import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginTransaction,
  endTransaction,
  resetUpdateStateForTests,
  setUpdateReady,
  useTransactionGuard,
  useUpdatePrompt,
} from './update-state';
import { UpdateAvailableBar } from '../../design-system/UpdateAvailableBar';

/**
 * THE UPDATE PROMPT, AND THE ONE MOMENT IT MUST STAY QUIET.
 *
 * The prompt exists because a service worker serves the app from its own
 * precache: a deployed update does not reach a returning customer until
 * something reloads the page, and with registerType 'autoUpdate' and the
 * plugin's bare registration, nothing ever did. Every returning customer got
 * one stale visit per deployment, and on an installed mobile app — no address
 * bar, no hard refresh — that visit was not recoverable by the customer.
 *
 * THE LOAD-BEARING TEST IS THE THIRD ONE. PifCheckoutPage builds its
 * idempotency key with useMemo(..., []), once per MOUNT, so the key does not
 * survive a reload. Offering a reload between `await placeOrder(...)` and
 * `cart.clear()` could therefore place the same COD order twice. The customer
 * chooses the moment, but they must not be offered that choice mid-commit.
 */

/** Keeps a transaction open for as long as it is mounted. */
function OpenTransaction() {
  useTransactionGuard(true);
  return null;
}

beforeEach(() => {
  // Runs after testing-library's afterEach cleanup, so nothing is still
  // subscribed when the listener set is cleared.
  resetUpdateStateForTests();
});

describe('useUpdatePrompt — when the offer appears', () => {
  it('is not visible before any update is reported', () => {
    const { result } = renderHook(() => useUpdatePrompt());
    expect(result.current.visible).toBe(false);
  });

  it('becomes visible once the service worker reports a waiting update', () => {
    const { result } = renderHook(() => useUpdatePrompt());
    act(() => {
      setUpdateReady(() => undefined);
    });
    expect(result.current.visible).toBe(true);
  });

  it('STAYS HIDDEN while a transaction is in flight', () => {
    // The assertion this file exists for.
    const { result } = renderHook(() => useUpdatePrompt());
    act(() => {
      beginTransaction();
      setUpdateReady(() => undefined);
    });
    expect(result.current.visible).toBe(false);
  });

  it('appears once the transaction finishes', () => {
    const { result } = renderHook(() => useUpdatePrompt());
    act(() => {
      beginTransaction();
      setUpdateReady(() => undefined);
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      endTransaction();
    });
    expect(result.current.visible).toBe(true);
  });

  it('counts depth: two overlapping transactions need two releases', () => {
    // A boolean would re-open the offer when the first of two finished.
    const { result } = renderHook(() => useUpdatePrompt());
    act(() => {
      beginTransaction();
      beginTransaction();
      setUpdateReady(() => undefined);
    });

    act(() => {
      endTransaction();
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      endTransaction();
    });
    expect(result.current.visible).toBe(true);
  });
});

describe('useTransactionGuard', () => {
  it('releases the guard when the screen unmounts mid-transaction', () => {
    // Otherwise navigating away during a submit would suppress the offer for
    // the rest of the session.
    const prompt = renderHook(() => useUpdatePrompt());
    const guard = render(<OpenTransaction />);

    act(() => {
      setUpdateReady(() => undefined);
    });
    expect(prompt.result.current.visible).toBe(false);

    act(() => {
      guard.unmount();
    });
    expect(prompt.result.current.visible).toBe(true);
  });
});

describe('taking or deferring the update', () => {
  it('apply() invokes the registered updater exactly once', () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useUpdatePrompt());
    act(() => {
      setUpdateReady(apply);
    });

    act(() => {
      result.current.apply();
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('dismiss() hides it for this page session, and a later report shows it again', () => {
    const { result } = renderHook(() => useUpdatePrompt());
    act(() => {
      setUpdateReady(() => undefined);
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.visible).toBe(false);

    // The worker is still waiting, so the next page load offers it again.
    act(() => {
      setUpdateReady(() => undefined);
    });
    expect(result.current.visible).toBe(true);
  });
});

describe('UpdateAvailableBar', () => {
  it('renders nothing until an update is waiting', () => {
    render(<UpdateAvailableBar />);
    expect(screen.queryByText('A new version is available')).toBeNull();
  });

  it('offers Reload, and taking it applies the update', async () => {
    const apply = vi.fn();
    render(<UpdateAvailableBar />);
    act(() => {
      setUpdateReady(apply);
    });

    expect(screen.getByText('A new version is available')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Reload' }).click();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('hides itself when the customer chooses Not now', () => {
    render(<UpdateAvailableBar />);
    act(() => {
      setUpdateReady(() => undefined);
    });
    expect(screen.getByText('A new version is available')).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Not now' }).click();
    });
    expect(screen.queryByText('A new version is available')).toBeNull();
  });
});
