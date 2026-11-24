import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { announcementDateLabel } from '../design-system/AnnouncementCard';
import type { Announcement } from '../lib/api/types';

/**
 * READING A NOTICE IN FULL FROM THE HOME SCREEN.
 *
 * The notifications screen was fixed first; the home screen's announcement
 * section had the identical defect and is fixed here. <AnnouncementCard> is a
 * full-width <button>, but its `onClick` is optional and this screen never
 * passed one, so a tap resolved to a no-op and the one-line preview was all a
 * customer could read.
 *
 * KEPT SEPARATE FROM HomePage.test.tsx ON PURPOSE. That suite mocks
 * `apiRequest` to reject with NotImplementedError, which is what makes it a
 * test of the home screen rather than of the announcements route — and it
 * asserts the approved layout, the module cards and the header. Changing its
 * mock to make announcements appear would have altered the conditions every
 * one of those assertions runs under. This file supplies its own mock and
 * leaves that one exactly as it was.
 */

const navigate = vi.fn();
const openDrawer = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate, useOutletContext: () => ({ openDrawer }) };
});

const announcements = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client');
  return { ...actual, ...announcements };
});

/** Long enough that no single line could hold it, with real paragraph breaks. */
const LONG_BODY = [
  'The Dry issue counter will move to the east wing from Monday while the main hall floor is relaid.',
  'Entry is through the gate nearest the parade ground. The counter keeps its usual hours, 0900 to 1300, and the same three queues: one for Blocks A to F, one for Blocks G to M, and one for Blocks N onwards.',
  'Entitlements are unchanged. Nothing has been added to or removed from any officer’s scale, and the quantities printed on your card are the quantities you will receive at the new counter.',
  'The main hall reopens at the start of next month. This notice will be withdrawn then.',
].join('\n\n');

const URGENT_NOTICE: Announcement = {
  id: 'ann-home-1',
  title: 'Dry issue counter moves to the east wing',
  message: LONG_BODY,
  priority: 'URGENT',
  audience: 'RIK',
  publishedAt: '2026-11-04T05:00:00.000Z',
  dismissible: false,
};

const NORMAL_NOTICE: Announcement = {
  id: 'ann-home-2',
  title: 'Fresh Mart stocks new seasonal fruit',
  message: 'Sweet lime and guava are on the Fresh Mart shelves from this week while the season lasts.',
  priority: 'NORMAL',
  audience: 'PIF',
  publishedAt: '2026-11-02T06:00:00.000Z',
  dismissible: false,
};

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

const panel = () => screen.queryByRole('dialog');
const card = (a: Announcement) => screen.getByRole('button', { name: new RegExp(a.title, 'i') });

beforeEach(() => {
  navigate.mockReset();
  openDrawer.mockReset();
  announcements.apiRequest.mockReset();
  announcements.apiRequest.mockResolvedValue([URGENT_NOTICE, NORMAL_NOTICE]);
});

describe('the home screen’s announcements open in full', () => {
  it('lists the notices, with nothing open until one is tapped', async () => {
    renderHome();
    expect(await screen.findByText(URGENT_NOTICE.title)).toBeInTheDocument();
    expect(screen.getByText(NORMAL_NOTICE.title)).toBeInTheDocument();
    expect(panel()).not.toBeInTheDocument();
  });

  it('opens the complete notice — title, date, priority and the WHOLE body', async () => {
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(URGENT_NOTICE.title, 'i') }));

    const open = await screen.findByRole('dialog');
    // The complete title, as a heading rather than a clipped line.
    expect(within(open).getByRole('heading', { name: URGENT_NOTICE.title })).toBeInTheDocument();
    // The publication date, in the same words the card used.
    expect(
      within(open).getByText(`Published ${announcementDateLabel(URGENT_NOTICE.publishedAt)}`)
    ).toBeInTheDocument();
    // The priority, carried through to the detail view.
    expect(within(open).getByText('URGENT')).toBeInTheDocument();

    // The body: first sentence, middle, and — the assertion that actually
    // proves nothing is clipped — the last sentence.
    expect(within(open).getByText(/counter will move to the east wing/)).toBeInTheDocument();
    expect(within(open).getByText(/one for Blocks N onwards/)).toBeInTheDocument();
    expect(within(open).getByText(/This notice will be withdrawn then/)).toBeInTheDocument();
  });

  it('asks the server nothing extra, and does not navigate away from Home', async () => {
    renderHome();
    await screen.findByText(URGENT_NOTICE.title);
    const callsBefore = announcements.apiRequest.mock.calls.length;

    await userEvent.click(card(URGENT_NOTICE));
    await screen.findByRole('dialog');

    // The full body arrived with the list, so opening a notice fetches
    // nothing — and cannot reach one the server did not already send.
    expect(announcements.apiRequest.mock.calls.length).toBe(callsBefore);
    // Reading a notice is not a route change: the reader is still on Home.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('returns to the Home page on Close, with the page intact', async () => {
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(URGENT_NOTICE.title, 'i') }));
    await screen.findByRole('dialog');

    // Sheet offers two ways out with the same name — the backdrop and the X
    // in its header. The last is the visible button.
    const closers = screen.getAllByRole('button', { name: /close/i });
    expect(closers.length).toBeGreaterThan(1);
    await userEvent.click(closers[closers.length - 1]!);
    await waitFor(() => expect(panel()).not.toBeInTheDocument());

    // Home is still Home: the module entries and the feed are all there.
    expect(screen.getByRole('button', { name: /enter rik/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter pif/i })).toBeInTheDocument();
    expect(screen.getByText(URGENT_NOTICE.title)).toBeInTheDocument();
    expect(screen.getByText(NORMAL_NOTICE.title)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('returns to the Home page on Escape', async () => {
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(URGENT_NOTICE.title, 'i') }));
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /enter rik/i })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens each notice’s OWN content, one after another', async () => {
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(URGENT_NOTICE.title, 'i') }));
    let open = await screen.findByRole('dialog');
    expect(within(open).getByText(/one for Blocks N onwards/)).toBeInTheDocument();
    expect(within(open).queryByText(/Sweet lime and guava/)).not.toBeInTheDocument();

    const closers = screen.getAllByRole('button', { name: /close/i });
    await userEvent.click(closers[closers.length - 1]!);
    await waitFor(() => expect(panel()).not.toBeInTheDocument());

    await userEvent.click(card(NORMAL_NOTICE));
    open = await screen.findByRole('dialog');
    expect(within(open).getByRole('heading', { name: NORMAL_NOTICE.title })).toBeInTheDocument();
    expect(within(open).getByText(/Sweet lime and guava/)).toBeInTheDocument();
    // The previous notice is gone, not cached behind the new title.
    expect(within(open).queryByText(/one for Blocks N onwards/)).not.toBeInTheDocument();
    // A NORMAL notice carries no urgency pill.
    expect(within(open).queryByText('URGENT')).not.toBeInTheDocument();
  });

  it('keeps the writer’s paragraphs rather than one wall of text', async () => {
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(URGENT_NOTICE.title, 'i') }));
    const open = await screen.findByRole('dialog');

    const body = within(open).getByText(/This notice will be withdrawn then/);
    expect(body.textContent).toContain('\n\n');
    expect(body.className).toContain('whitespace-pre-line');
  });

  it('shows only what the server sent', async () => {
    announcements.apiRequest.mockResolvedValue([NORMAL_NOTICE]);
    renderHome();

    expect(await screen.findByText(NORMAL_NOTICE.title)).toBeInTheDocument();
    expect(screen.queryByText(URGENT_NOTICE.title)).not.toBeInTheDocument();

    await userEvent.click(card(NORMAL_NOTICE));
    const open = await screen.findByRole('dialog');
    expect(within(open).getByText(/Sweet lime and guava/)).toBeInTheDocument();
  });
});
