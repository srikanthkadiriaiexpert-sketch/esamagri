import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationsPage } from './NotificationsPage';
import { announcementDateLabel } from '../../design-system/AnnouncementCard';
import type { Announcement } from '../../lib/api/types';

/**
 * READING A NOTICE IN FULL — the defect this suite guards.
 *
 * Reported from the running staging app: the notifications feed showed a
 * title, a date and a one-line preview, and tapping the card did nothing at
 * all. The card was not broken; nothing was listening. <AnnouncementCard>
 * has always rendered as a full-width <button>, but its `onClick` is
 * optional and this screen never passed one, so every tap called
 * `onClick?.(...)` on `undefined` and the rest of the notice stayed unread.
 *
 * WHAT THESE TESTS PROTECT, beyond "a panel opens":
 *
 *   THE WHOLE BODY, NOT A LONGER PREVIEW. One announcement below is
 *   deliberately over 1,200 characters across several paragraphs, and the
 *   test asserts the LAST sentence is on screen — a line clamp or a "read
 *   more" would pass a naive assertion and fail this one.
 *
 *   NO SECOND REQUEST. `GET /announcements` already returns the complete
 *   body, so opening a notice must not call the API again. The mock counts
 *   calls, because a detail fetch by id is exactly the change that would
 *   quietly reopen the audience question the server has already settled.
 *
 *   THE RIGHT NOTICE EVERY TIME. Opening the second announcement after the
 *   first must show the second one's words and not the first one's — the
 *   failure mode of a panel that caches what it was first given.
 */

const announcements = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('../../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, ...announcements };
});

/** A body long enough that no single line could hold it, with real paragraphs. */
const LONG_BODY = [
  'The Fresh issue for November will run on a revised schedule because the cold-storage unit at the facility is being serviced.',
  'Officers whose quarters fall in Blocks A to F should collect on Monday and Tuesday between 0900 and 1300. Blocks G to M should collect on Wednesday and Thursday at the same hours. Blocks N onwards should collect on Friday.',
  'Milk coupons already issued for this period remain valid and do not need to be exchanged. Entitlements are unaffected: nothing has been added to or taken from any officer’s scale, and the quantities on your card are the quantities you will receive.',
  'If you cannot attend on your allotted day, the order desk will hold your issue until the following working day. Please do not send a representative without the authorisation slip.',
  'This notice supersedes the schedule circulated last week.',
].join('\n\n');

const NOTICE_ONE: Announcement = {
  id: 'ann-1',
  title: 'Revised Fresh issue schedule for November',
  message: LONG_BODY,
  priority: 'URGENT',
  audience: 'RIK',
  publishedAt: '2026-11-03T04:30:00.000Z',
  dismissible: false,
};

const NOTICE_TWO: Announcement = {
  id: 'ann-2',
  title: 'Grocers shop closed on Sunday',
  message: 'The Grocers shop will stay closed this Sunday for stock-taking. Home delivery resumes on Monday morning.',
  priority: 'NORMAL',
  audience: 'PIF',
  publishedAt: '2026-11-01T09:00:00.000Z',
  dismissible: false,
};

function renderNotifications() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>
  );
}

/** The panel Sheet renders, identified the way a screen reader finds it. */
const panel = () => screen.queryByRole('dialog');

beforeEach(() => {
  announcements.apiRequest.mockReset();
  announcements.apiRequest.mockResolvedValue([NOTICE_ONE, NOTICE_TWO]);
});

describe('the notifications feed', () => {
  it('lists each notice with its title, date and a preview', async () => {
    renderNotifications();
    expect(await screen.findByText(NOTICE_ONE.title)).toBeInTheDocument();
    expect(screen.getByText(NOTICE_TWO.title)).toBeInTheDocument();
    expect(screen.getByText(announcementDateLabel(NOTICE_ONE.publishedAt))).toBeInTheDocument();
    expect(screen.getByText(announcementDateLabel(NOTICE_TWO.publishedAt))).toBeInTheDocument();
    // Nothing is open until something is tapped.
    expect(panel()).not.toBeInTheDocument();
  });

  it('opens the WHOLE notice when the card is tapped', async () => {
    renderNotifications();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(NOTICE_ONE.title, 'i') }));

    const open = await screen.findByRole('dialog');
    expect(within(open).getByRole('heading', { name: NOTICE_ONE.title })).toBeInTheDocument();
    // The SAME date the card showed — one formatter, so they cannot drift.
    expect(
      within(open).getByText(`Published ${announcementDateLabel(NOTICE_ONE.publishedAt)}`)
    ).toBeInTheDocument();

    // The FIRST sentence, the MIDDLE of the body, and — the assertion that
    // actually proves nothing is clipped — the LAST sentence.
    expect(within(open).getByText(/cold-storage unit at the facility is being serviced/)).toBeInTheDocument();
    expect(within(open).getByText(/Blocks N onwards should collect on Friday/)).toBeInTheDocument();
    expect(within(open).getByText(/supersedes the schedule circulated last week/)).toBeInTheDocument();
  });

  it('asks the server NOTHING extra to show the full text', async () => {
    renderNotifications();
    await screen.findByText(NOTICE_ONE.title);
    expect(announcements.apiRequest).toHaveBeenCalledTimes(1);
    expect(announcements.apiRequest).toHaveBeenCalledWith('/announcements');

    await userEvent.click(screen.getByRole('button', { name: new RegExp(NOTICE_ONE.title, 'i') }));
    await screen.findByRole('dialog');

    // Still one call. The complete body arrived with the list, so opening a
    // notice fetches nothing — and cannot reach an announcement the server
    // did not already decide this customer may see.
    expect(announcements.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps the writer’s paragraphs instead of one wall of text', async () => {
    renderNotifications();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(NOTICE_ONE.title, 'i') }));
    const open = await screen.findByRole('dialog');

    // The body is printed as typed: the newlines survive in the DOM, and the
    // element is styled to honour them rather than collapse them.
    const body = within(open).getByText(/supersedes the schedule circulated last week/);
    expect(body.textContent).toContain('\n\n');
    expect(body.className).toContain('whitespace-pre-line');
  });

  it('closes on the Close button, and the feed is still there', async () => {
    renderNotifications();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(NOTICE_ONE.title, 'i') }));
    await screen.findByRole('dialog');

    // Sheet offers two ways out with the same name — the backdrop and the X
    // in the header. The last is the visible button; either must close.
    const closers = screen.getAllByRole('button', { name: /close/i });
    expect(closers.length).toBeGreaterThan(1);
    await userEvent.click(closers[closers.length - 1]!);

    await waitFor(() => expect(panel()).not.toBeInTheDocument());
    // Closing returns the reader to the feed, not to a blank screen.
    expect(screen.getByText(NOTICE_ONE.title)).toBeInTheDocument();
    expect(screen.getByText(NOTICE_TWO.title)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderNotifications();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(NOTICE_ONE.title, 'i') }));
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });

  it('opens each notice’s OWN content, one after another', async () => {
    renderNotifications();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(NOTICE_ONE.title, 'i') }));
    let open = await screen.findByRole('dialog');
    expect(within(open).getByText(/Blocks N onwards/)).toBeInTheDocument();
    expect(within(open).queryByText(/closed this Sunday for stock-taking/)).not.toBeInTheDocument();

    const firstClosers = screen.getAllByRole('button', { name: /close/i });
    await userEvent.click(firstClosers[firstClosers.length - 1]!);
    await waitFor(() => expect(panel()).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: new RegExp(NOTICE_TWO.title, 'i') }));
    open = await screen.findByRole('dialog');
    expect(within(open).getByRole('heading', { name: NOTICE_TWO.title })).toBeInTheDocument();
    expect(within(open).getByText(/closed this Sunday for stock-taking/)).toBeInTheDocument();
    // The previous notice's words are gone, not cached behind the new title.
    expect(within(open).queryByText(/Blocks N onwards/)).not.toBeInTheDocument();
  });

  it('shows only what the server sent — the screen invents no notice', async () => {
    // One audience's worth of notices, which is what the server returns for
    // this customer. The feed renders that list and nothing else; there is no
    // client-side filter to get wrong and no way to ask for another.
    announcements.apiRequest.mockResolvedValue([NOTICE_TWO]);
    renderNotifications();

    expect(await screen.findByText(NOTICE_TWO.title)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE_ONE.title)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: new RegExp(NOTICE_TWO.title, 'i') }));
    const open = await screen.findByRole('dialog');
    expect(within(open).getByText(/closed this Sunday for stock-taking/)).toBeInTheDocument();
    expect(announcements.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when there is nothing to show', async () => {
    announcements.apiRequest.mockResolvedValue([]);
    renderNotifications();
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
    expect(panel()).not.toBeInTheDocument();
  });
});
