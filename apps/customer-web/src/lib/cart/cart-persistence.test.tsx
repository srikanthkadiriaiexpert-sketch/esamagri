import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RikCartProvider, useRikCart } from './RikCartContext';
import { PifCartProvider, usePifCart } from './PifCartContext';
import type { PifProduct, RikProduct } from '../api/types';

/**
 * A BASKET SURVIVES A RELOAD, AND BELONGS TO ONE PERSON
 * (LAUNCH PREPARATION).
 *
 * WHY THIS MATTERS ENOUGH TO TEST. This is a phone app for a grocery shop.
 * A shopper takes a call, the browser reclaims the tab, the PWA is reopened
 * from the home screen — before this, each of those silently threw away a
 * full basket, and the shopper's only clue was an empty cart screen.
 *
 * WHAT MUST REMAIN TRUE WHILE IT SURVIVES, and each of these is a test
 * below rather than a comment:
 *
 *   1. A reload restores the same basket.
 *   2. A DIFFERENT customer on the same device gets their OWN basket, never
 *      the previous one's. This is the rule that keeps a shared quarters
 *      tablet from showing one family's shopping to the next.
 *   3. Signed out, nothing is stored and nothing is restored.
 *   4. RIK and PIF stay two separate baskets in storage, as they are in
 *      memory.
 *   5. Placing an order clears the stored copy too.
 *   6. Storage that is unavailable, blocked, corrupt or tampered with leaves
 *      a working, empty cart — never a crash and never half-trusted data.
 */

const rikItem: RikProduct = {
  id: 'rik-dal',
  name: 'RIK Toor Dal',
  unit: 'kg',
  categoryId: 'c',
  available: true,
};

const pifItem: PifProduct = {
  id: 'pif-sugar',
  name: 'PIF Sugar',
  unit: 'kg',
  categoryId: 'c',
  available: true,
  price: { amountMinor: 4600, currency: 'INR' },
};

function Probe() {
  const rik = useRikCart();
  const pif = usePifCart();
  return (
    <div>
      <button type="button" onClick={() => rik.addOne(rikItem)}>
        add to rik
      </button>
      <button type="button" onClick={() => pif.addOne(pifItem)}>
        add to pif
      </button>
      <button type="button" onClick={() => pif.clear()}>
        clear pif
      </button>
      <span data-testid="rik-count">{rik.itemCount}</span>
      <span data-testid="pif-count">{pif.itemCount}</span>
      <span data-testid="pif-ids">{pif.lines.map((l) => l.product.id).join(',')}</span>
    </div>
  );
}

/** One "visit": a fresh mount, as a page load is. */
function visit(ownerKey: string | null) {
  return render(
    <RikCartProvider ownerKey={ownerKey}>
      <PifCartProvider ownerKey={ownerKey}>
        <Probe />
      </PifCartProvider>
    </RikCartProvider>
  );
}

const CUSTOMER_A = '0199a000-aaaa-7000-8000-000000000001';
const CUSTOMER_B = '0199b000-bbbb-7000-8000-000000000002';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a signed-in shopper’s basket survives a reload', () => {
  it('restores the same lines on the next visit', async () => {
    const first = visit(CUSTOMER_A);
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    expect(screen.getByTestId('pif-count')).toHaveTextContent('2');
    first.unmount();

    visit(CUSTOMER_A);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('2');
    expect(screen.getByTestId('pif-ids')).toHaveTextContent('pif-sugar');
  });

  it('keeps the two modules in two separate places', async () => {
    const first = visit(CUSTOMER_A);
    await userEvent.click(screen.getByRole('button', { name: 'add to rik' }));
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    first.unmount();

    const keys = Object.keys(window.localStorage);
    expect(keys.some((key) => key.includes('.pif.'))).toBe(true);
    expect(keys.some((key) => key.includes('.rik.'))).toBe(true);

    visit(CUSTOMER_A);
    expect(screen.getByTestId('rik-count')).toHaveTextContent('1');
    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
  });

  it('forgets the basket once the order has been placed', async () => {
    const first = visit(CUSTOMER_A);
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    await userEvent.click(screen.getByRole('button', { name: 'clear pif' }));
    first.unmount();

    visit(CUSTOMER_A);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
  });
});

describe('a basket belongs to one customer', () => {
  it('does NOT show customer A’s basket to customer B on the same device', async () => {
    const asA = visit(CUSTOMER_A);
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
    asA.unmount();

    visit(CUSTOMER_B);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
    expect(screen.getByTestId('pif-ids')).toHaveTextContent('');
  });

  it('gives each customer their own basket back', async () => {
    const asA = visit(CUSTOMER_A);
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    asA.unmount();

    const asB = visit(CUSTOMER_B);
    await userEvent.click(screen.getByRole('button', { name: 'add to rik' }));
    asB.unmount();

    visit(CUSTOMER_A);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
    expect(screen.getByTestId('rik-count')).toHaveTextContent('0');
  });

  it('stores nothing at all when nobody is signed in', async () => {
    const anonymous = visit(null);
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
    expect(Object.keys(window.localStorage)).toHaveLength(0);
    anonymous.unmount();

    visit(null);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
  });
});

describe('storage is never trusted and never required', () => {
  it('shops normally when reading storage throws (private browsing, blocked site data)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    visit(CUSTOMER_A);
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
  });

  it('ignores a stored value that is not JSON', () => {
    window.localStorage.setItem(`esamagri.cart.pif.${CUSTOMER_A}`, 'not json at all');
    visit(CUSTOMER_A);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
  });

  it('ignores a stored basket whose lines are the wrong shape', () => {
    window.localStorage.setItem(
      `esamagri.cart.pif.${CUSTOMER_A}`,
      JSON.stringify({ v: 1, lines: [{ product: { id: 42 }, quantity: 'lots' }] })
    );
    visit(CUSTOMER_A);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
  });

  it('refuses a tampered negative or fractional quantity rather than honouring it', () => {
    window.localStorage.setItem(
      `esamagri.cart.pif.${CUSTOMER_A}`,
      JSON.stringify({ v: 1, lines: [{ product: pifItem, quantity: -5 }] })
    );
    visit(CUSTOMER_A);
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
  });

  it('caps an absurdly long stored basket', () => {
    const lines = Array.from({ length: 500 }, (_, i) => ({
      product: { ...pifItem, id: `pif-${i}` },
      quantity: 1,
    }));
    window.localStorage.setItem(`esamagri.cart.pif.${CUSTOMER_A}`, JSON.stringify({ v: 1, lines }));
    visit(CUSTOMER_A);
    expect(Number(screen.getByTestId('pif-count').textContent)).toBeLessThanOrEqual(100);
  });
});
