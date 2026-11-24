import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RikCartProvider, useRikCart } from './RikCartContext';
import { PifCartProvider, usePifCart } from './PifCartContext';
import type { RikProduct, PifProduct } from '../api/types';

/**
 * Spec CUST-SEP / STEP 9 kickoff Section 5: the RIK cart and the PIF
 * cart are strictly separate, and switching modules never carries one
 * into the other.
 *
 * These products exist only inside this test to exercise the two state
 * containers. They are not catalogue data, are not rendered by the app,
 * and assert nothing about real RIK entitlement or PIF pricing — both
 * of which remain unresolved business decisions.
 */
const rikItem: RikProduct = {
  id: 'rik-test-item',
  name: 'RIK test item',
  unit: 'unit',
  categoryId: 'c',
  available: true,
};

const pifItem: PifProduct = {
  id: 'pif-test-item',
  name: 'PIF test item',
  unit: 'unit',
  categoryId: 'c',
  available: true,
  price: { amountMinor: 100, currency: 'INR' },
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
      <span data-testid="rik-count">{rik.itemCount}</span>
      <span data-testid="pif-count">{pif.itemCount}</span>
      <span data-testid="rik-ids">{rik.lines.map((l) => l.product.id).join(',')}</span>
      <span data-testid="pif-ids">{pif.lines.map((l) => l.product.id).join(',')}</span>
    </div>
  );
}

function renderProbe() {
  return render(
    <RikCartProvider>
      <PifCartProvider>
        <Probe />
      </PifCartProvider>
    </RikCartProvider>
  );
}

describe('RIK / PIF cart separation', () => {
  it('starts with two independent, empty carts', () => {
    renderProbe();
    expect(screen.getByTestId('rik-count')).toHaveTextContent('0');
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
  });

  it('adding to the RIK cart leaves the PIF cart untouched', async () => {
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'add to rik' }));

    expect(screen.getByTestId('rik-count')).toHaveTextContent('1');
    expect(screen.getByTestId('pif-count')).toHaveTextContent('0');
    expect(screen.getByTestId('pif-ids')).toHaveTextContent('');
  });

  it('adding to the PIF cart leaves the RIK cart untouched', async () => {
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));

    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
    expect(screen.getByTestId('rik-count')).toHaveTextContent('0');
    expect(screen.getByTestId('rik-ids')).toHaveTextContent('');
  });

  it('never mixes line items between the two carts', async () => {
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'add to rik' }));
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));

    expect(screen.getByTestId('rik-ids')).toHaveTextContent('rik-test-item');
    expect(screen.getByTestId('rik-ids')).not.toHaveTextContent('pif-test-item');
    expect(screen.getByTestId('pif-ids')).toHaveTextContent('pif-test-item');
    expect(screen.getByTestId('pif-ids')).not.toHaveTextContent('rik-test-item');
  });

  it('clearing one cart does not clear the other', async () => {
    function ClearProbe() {
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
          <button type="button" onClick={() => rik.clear()}>
            clear rik
          </button>
          <span data-testid="rik-count">{rik.itemCount}</span>
          <span data-testid="pif-count">{pif.itemCount}</span>
        </div>
      );
    }
    render(
      <RikCartProvider>
        <PifCartProvider>
          <ClearProbe />
        </PifCartProvider>
      </RikCartProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'add to rik' }));
    await userEvent.click(screen.getByRole('button', { name: 'add to pif' }));
    await userEvent.click(screen.getByRole('button', { name: 'clear rik' }));

    expect(screen.getByTestId('rik-count')).toHaveTextContent('0');
    expect(screen.getByTestId('pif-count')).toHaveTextContent('1');
  });
});
