import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StaffSession } from '../lib/api/admin-api';
import { pifAdmin, pifCashier, rikAdmin } from '../test/staff-session';
import type { PifOrderSummary } from '../lib/api/pif-admin-api';

/**
 * THE PIF INCOMING-ORDER ALERT, now sounding the CLIENT'S OWN MP3.
 *
 * WHAT CHANGED AND WHAT DID NOT. The sound is no longer a generated tone: it
 * is the MP3 configured in PIF Notification Settings, fetched from the API.
 * Everything around it is unchanged and is asserted here to prove it:
 * fifteen-second polling, one timer, repeat until Received, independent
 * acknowledgement per order, the connection warning, and the browser's
 * requirement that a human click before any audio plays.
 *
 * WHY Audio IS REPLACED HERE. jsdom implements no media pipeline —
 * HTMLMediaElement.play() is not implemented and throws — so a stand-in
 * records what was asked of it. That lets these tests assert the two things
 * that actually matter and cannot be seen by ear: that the element is pointed
 * at the CONFIGURED URL, and that two alerts never overlap.
 *
 * WHAT IS NOT ASSERTED: that the bytes are audible. No test can hear. The
 * manual check is to press Enable sound and listen.
 */

const api = {
  fetchOrders: vi.fn(),
  acknowledgeOrder: vi.fn(),
  alertSoundUrl: vi.fn(() => 'http://api.test/pif/alert-sound'),
  rupees: (n: number) => `₹${n.toFixed(2)}`,
  ORDER_ACK_NOTE: '[ACK] Incoming-order alert acknowledged',
};

vi.mock('../lib/api/pif-admin-api', () => api);

let session: StaffSession = pifAdmin();
vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ session, status: 'authenticated' }),
}));

/** Every element the component built, in order, with what it was told to do. */
interface Built {
  src: string;
  plays: number;
  paused: number;
}
let built: Built[] = [];
/** Flipped by a test to make the browser refuse playback. */
let refusePlayback = false;
/**
 * Flipped by a test to make playback STALL: play() is entered and never
 * settles, which is the one real way a sound can still be going when the next
 * tick arrives. It is how the no-overlap guard is exercised.
 */
let stallPlayback = false;

class StandInAudio {
  src: string;
  preload = '';
  currentTime = 0;
  duration = 1.5;
  private readonly record: Built;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(src: string) {
    this.src = src;
    this.record = { src, plays: 0, paused: 0 };
    built.push(this.record);
  }

  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  play(): Promise<void> {
    if (refusePlayback) return Promise.reject(new Error('NotAllowedError'));
    this.record.plays += 1;
    // A stalled element never resolves and never fires `ended`, exactly as a
    // media pipeline that has hung does.
    if (stallPlayback) return new Promise<void>(() => {});
    return Promise.resolve();
  }

  pause(): void {
    this.record.paused += 1;
  }

  /** What the browser would fire when the sound finishes. */
  finish(): void {
    this.listeners.get('ended')?.forEach((fn) => fn());
  }
}

vi.stubGlobal('Audio', StandInAudio);

// Imported after the mocks so the modules under test pick them up.
const { PifOrderAlerts } = await import('./PifOrderAlerts');
const { ALERT_INTERVAL_MS } = await import('../lib/orders/usePifOrderAlerts');

function order(over: Partial<PifOrderSummary> = {}): PifOrderSummary {
  return {
    id: 'order-1',
    orderNumber: 'PIF-20261105-0003',
    status: 'PLACED',
    total: 828.8,
    itemCount: 4,
    customerName: 'Mrs Rao',
    placedAt: '2026-11-05T08:00:00.000Z',
    business: 'grocers',
    acknowledged: false,
    ...over,
  } as PifOrderSummary;
}

const page = (items: PifOrderSummary[]) => ({ items, total: items.length, page: 1, pageSize: 50 });

beforeEach(() => {
  built = [];
  refusePlayback = false;
  stallPlayback = false;
  session = pifAdmin();
  api.fetchOrders.mockReset();
  api.acknowledgeOrder.mockReset();
  api.fetchOrders.mockResolvedValue(page([]));
  api.acknowledgeOrder.mockResolvedValue({ orderId: 'order-1', eventId: 'event-1' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ===================================================================
describe('the sound controls', () => {
  it('are on screen with nothing pending, so a shift can enable sound before the first order', async () => {
    render(<PifOrderAlerts />);
    expect(await screen.findByRole('button', { name: /enable sound/i })).toBeInTheDocument();
    expect(screen.getByText(/order sound off/i)).toBeInTheDocument();
  });

  it('point the player at the CONFIGURED sound, not a generated tone', async () => {
    const user = userEvent.setup();
    render(<PifOrderAlerts />);
    await user.click(await screen.findByRole('button', { name: /enable sound/i }));

    await waitFor(() => expect(built).toHaveLength(1));
    expect(built[0]!.src).toBe('http://api.test/pif/alert-sound');
    expect(api.alertSoundUrl).toHaveBeenCalled();
  });

  it('report sound as on only after a tone actually played', async () => {
    const user = userEvent.setup();
    render(<PifOrderAlerts />);
    await user.click(await screen.findByRole('button', { name: /enable sound/i }));

    expect(await screen.findByText(/order sound on/i)).toBeInTheDocument();
    expect(built[0]!.plays).toBe(1);
    expect(screen.getByRole('button', { name: /test sound/i })).toBeInTheDocument();
  });

  it('say so plainly when the browser refuses, and never claim sound is on', async () => {
    const user = userEvent.setup();
    refusePlayback = true;
    render(<PifOrderAlerts />);
    await user.click(await screen.findByRole('button', { name: /enable sound/i }));

    expect(await screen.findByText(/sound is blocked by this browser/i)).toBeInTheDocument();
    expect(screen.queryByText(/order sound on/i)).not.toBeInTheDocument();
    expect(screen.getByText(/watch the screen/i)).toBeInTheDocument();
  });

  it('requires a real click — nothing plays on its own', async () => {
    render(<PifOrderAlerts />);
    await screen.findByRole('button', { name: /enable sound/i });
    expect(built).toHaveLength(0);
  });
});

// ===================================================================
describe('the alert itself', () => {
  it('shows a pending order with its shop, time and total', async () => {
    api.fetchOrders.mockResolvedValue(page([order()]));
    render(<PifOrderAlerts />);

    expect(await screen.findByText('PIF-20261105-0003')).toBeInTheDocument();
    expect(screen.getByText('1 new order')).toBeInTheDocument();
    expect(screen.getByText(/Grocers/)).toBeInTheDocument();
    expect(screen.getByText(/828\.80/)).toBeInTheDocument();
  });

  it('asks the server only for PLACED orders, which is what "new" means', async () => {
    render(<PifOrderAlerts />);
    await waitFor(() => expect(api.fetchOrders).toHaveBeenCalled());
    expect(api.fetchOrders.mock.calls[0]![0]).toMatchObject({ status: 'PLACED' });
  });

  it('leaves an acknowledged order out, because the server already said so', async () => {
    api.fetchOrders.mockResolvedValue(page([order({ acknowledged: true })]));
    render(<PifOrderAlerts />);
    await waitFor(() => expect(api.fetchOrders).toHaveBeenCalled());
    expect(screen.queryByText('PIF-20261105-0003')).not.toBeInTheDocument();
  });

  it('keeps the alerts and warns when the server cannot be reached', async () => {
    api.fetchOrders.mockRejectedValue(new Error('offline'));
    render(<PifOrderAlerts />);
    expect(await screen.findByText(/not reaching the server/i)).toBeInTheDocument();
  });
});

// ===================================================================
describe('acknowledgement, unchanged', () => {
  it('records Received for the order it was pressed on, and removes only that one', async () => {
    const user = userEvent.setup();
    api.fetchOrders.mockResolvedValue(
      page([order(), order({ id: 'order-2', orderNumber: 'PIF-20261105-0004' })])
    );
    render(<PifOrderAlerts />);
    await screen.findByText('PIF-20261105-0003');
    expect(screen.getByText('2 new orders')).toBeInTheDocument();

    const first = screen.getByText('PIF-20261105-0003').closest('li')!;
    await user.click(within_(first, /received/i));

    await waitFor(() => expect(api.acknowledgeOrder).toHaveBeenCalledTimes(1));
    expect(api.acknowledgeOrder).toHaveBeenCalledWith('order-1');
    // The other order is still waiting, which is the whole point.
    await waitFor(() => expect(screen.queryByText('PIF-20261105-0003')).not.toBeInTheDocument());
    expect(screen.getByText('PIF-20261105-0004')).toBeInTheDocument();
  });

  it('offers a disabled Received to staff holding no PIF order permission, and says why', async () => {
    session = rikAdmin();
    api.fetchOrders.mockResolvedValue(page([order()]));
    render(<PifOrderAlerts />);
    await screen.findByText('PIF-20261105-0003');

    expect(screen.getByRole('button', { name: /^received$/i })).toBeDisabled();
    expect(screen.getByText(/no PIF order permission/i)).toBeInTheDocument();
  });

  it('lets a cashier acknowledge, because pif.order.prepare is enough', async () => {
    session = pifCashier();
    api.fetchOrders.mockResolvedValue(page([order()]));
    render(<PifOrderAlerts />);
    await screen.findByText('PIF-20261105-0003');
    expect(screen.getByRole('button', { name: /^received$/i })).toBeEnabled();
  });
});

// ===================================================================
describe('the fifteen-second repeat', () => {
  it('polls again and sounds again while an order is still pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    api.fetchOrders.mockResolvedValue(page([order()]));

    render(<PifOrderAlerts />);
    await screen.findByText('PIF-20261105-0003');
    await user.click(screen.getByRole('button', { name: /enable sound/i }));
    const afterEnabling = built[0]!.plays;

    const callsBefore = api.fetchOrders.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ALERT_INTERVAL_MS + 50);

    expect(api.fetchOrders.mock.calls.length).toBeGreaterThan(callsBefore);
    await waitFor(() => expect(built[0]!.plays).toBeGreaterThan(afterEnabling));
  });

  it('uses exactly fifteen seconds, from one timer', () => {
    expect(ALERT_INTERVAL_MS).toBe(15_000);
  });

  it('never overlaps two sounds: a tick while one is still playing is skipped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    api.fetchOrders.mockResolvedValue(page([order()]));
    stallPlayback = true;

    render(<PifOrderAlerts />);
    await screen.findByText('PIF-20261105-0003');
    await user.click(screen.getByRole('button', { name: /enable sound/i }));
    // One play started, and it has neither finished nor been given up on.
    await waitFor(() => expect(built[0]!.plays).toBe(1));

    await vi.advanceTimersByTimeAsync(ALERT_INTERVAL_MS * 2 + 100);

    // The ticks happened — the queue was re-read, so the SCREEN stayed
    // current — but nothing was played over the sound still going.
    expect(api.fetchOrders.mock.calls.length).toBeGreaterThan(2);
    expect(built[0]!.plays).toBe(1);
    // And only one element was ever built, so there is no second player
    // sounding in parallel either.
    expect(built).toHaveLength(1);
  });

  it('is silent while nothing is pending, however long it runs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<PifOrderAlerts />);
    await user.click(await screen.findByRole('button', { name: /enable sound/i }));
    const afterEnabling = built[0]!.plays;

    await vi.advanceTimersByTimeAsync(ALERT_INTERVAL_MS * 3);
    expect(built[0]!.plays).toBe(afterEnabling);
  });
});

/** The enabled Received button inside one order's row. */
function within_(row: HTMLElement, name: RegExp): HTMLElement {
  const buttons = Array.from(row.querySelectorAll('button')).filter((b) => name.test(b.textContent ?? ''));
  return buttons[0]!;
}
