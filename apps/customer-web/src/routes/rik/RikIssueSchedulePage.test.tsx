import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RikIssueSchedulePage } from './RikIssueSchedulePage';
import { ApiError } from '../../lib/api/client';
import { formatRange } from '../../lib/api/rik-issue-schedule-api';
import type { IssueSchedule, IssueWindowView } from '../../lib/api/rik-issue-schedule-api';

/**
 * STEP 15C — the officer's view of the issue schedule.
 *
 * WHAT THESE TESTS ARE FOR. That the screen shows exactly the schedule the
 * server published — the three Fresh windows, the Dry window, their dates and
 * the days the facility will actually open — and that it offers no way to
 * change any of it.
 *
 * WHAT THEY ARE ALSO FOR, and this is the part a future edit could break:
 * the ABSENCES. No form, no button that writes, no window id, no internal
 * note, no "changed by", no revision history. The server does not send those
 * to an officer and this screen must not acquire a way to ask for them.
 *
 * NOTHING HERE ASSERTS A WEEKDAY RULE. The facility normally issues on
 * Tuesday, Wednesday and Friday, but a holiday moves a day, so the operating
 * days are dates and the screen prints the dates it was given. The fixtures
 * below are built from a date computed at run time for exactly that reason —
 * a fixture pinned to March 2027 would quietly start testing the calendar.
 *
 * The API module is mocked; the real route is exercised over HTTP against
 * PostgreSQL in apps/api's `rik-issue-windows.integration.spec.ts`.
 */

// vi.hoisted, because vi.mock is lifted above every const in this file and a
// plain `const api = …` would not yet exist when the factory runs.
const api = vi.hoisted(() => ({ fetchIssueSchedule: vi.fn() }));

vi.mock('../../lib/api/rik-issue-schedule-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/rik-issue-schedule-api')>(
    '../../lib/api/rik-issue-schedule-api'
  );
  // The date formatters are pure display and are exercised for real; only the
  // network call is replaced.
  return { ...actual, ...api };
});

/** The first of next month, derived — never a literal. */
const base = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
})();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (from: Date, n: number) =>
  iso(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + n)));

const window_ = (
  sequenceNo: 1 | 2 | 3,
  offset: number,
  overrides: Partial<IssueWindowView> = {}
): IssueWindowView => ({
  rationType: 'FRESH',
  windowCode: `FRESH_${sequenceNo}` as IssueWindowView['windowCode'],
  sequenceNo,
  label: `Fresh Issue ${sequenceNo}`,
  startDate: plusDays(base, offset),
  endDate: plusDays(base, offset + 6),
  operatingDays: [plusDays(base, offset + 1), plusDays(base, offset + 3)],
  ...overrides,
});

const dryWindow = (overrides: Partial<IssueWindowView> = {}): IssueWindowView => ({
  rationType: 'DRY',
  windowCode: 'DRY',
  sequenceNo: 1,
  label: 'Dry Issue',
  startDate: plusDays(base, 0),
  endDate: plusDays(base, 20),
  operatingDays: [plusDays(base, 2)],
  ...overrides,
});

const schedule = (overrides: Partial<IssueSchedule> = {}): IssueSchedule => ({
  period: {
    id: '01a11a22-0000-7000-8000-00000000aaaa',
    name: 'Next period',
    startDate: iso(base),
    endDate: plusDays(base, 27),
  },
  fresh: [window_(1, 0), window_(2, 7), window_(3, 14)],
  dry: [dryWindow()],
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <RikIssueSchedulePage />
    </MemoryRouter>
  );

beforeEach(() => {
  api.fetchIssueSchedule.mockReset();
});

describe('RikIssueSchedulePage (STEP 15C)', () => {
  it('asks the server once and shows the period it answered with', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();

    expect(await screen.findByText('Next period')).toBeInTheDocument();
    expect(api.fetchIssueSchedule).toHaveBeenCalledTimes(1);
  });

  it('shows the three Fresh windows and the Dry window, in the server’s order', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();

    await screen.findByText('Fresh Issue 1');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Fresh Issue 1', 'Fresh Issue 2', 'Fresh Issue 3', 'Dry Issue']);
  });

  it('separates Fresh from Dry under their own headings', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();

    const fresh = await screen.findByRole('region', { name: 'Fresh' });
    const dry = screen.getByRole('region', { name: 'Dry' });

    expect(within(fresh).getByText('Fresh Issue 1')).toBeInTheDocument();
    expect(within(fresh).queryByText('Dry Issue')).not.toBeInTheDocument();
    expect(within(dry).getByText('Dry Issue')).toBeInTheDocument();
    expect(within(dry).queryByText('Fresh Issue 1')).not.toBeInTheDocument();
  });

  it('shows each window’s date range', async () => {
    const data = schedule();
    api.fetchIssueSchedule.mockResolvedValue(data);
    renderPage();

    await screen.findByText('Fresh Issue 1');
    // Formatted by the real helper from the dates the server sent.
    const day = (isoDate: string) =>
      new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
    const first = data.fresh[0]!;
    expect(
      screen.getByText(`${day(first.startDate)} – ${day(first.endDate)}`)
    ).toBeInTheDocument();
  });

  it('lists every operating day it was given, and only those', async () => {
    const data = schedule();
    api.fetchIssueSchedule.mockResolvedValue(data);
    renderPage();

    const card = (await screen.findByText('Fresh Issue 1')).closest('article')!;
    const chips = within(card).getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toHaveLength(data.fresh[0]!.operatingDays.length);
  });

  it('shows a single-day window as one date rather than a range', async () => {
    const oneDay = plusDays(base, 3);
    api.fetchIssueSchedule.mockResolvedValue(
      schedule({
        fresh: [window_(1, 0, { startDate: oneDay, endDate: oneDay, operatingDays: [oneDay] })],
        dry: [],
      })
    );
    renderPage();

    await screen.findByText('Fresh Issue 1');
    const label = new Date(`${oneDay}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.queryByText(`${label} – ${label}`)).not.toBeInTheDocument();
  });

  it('shows however many Fresh windows the facility published, not three by assumption', async () => {
    api.fetchIssueSchedule.mockResolvedValue(
      schedule({ fresh: [window_(1, 0), window_(2, 7)], dry: [dryWindow()] })
    );
    renderPage();

    await screen.findByText('Fresh Issue 1');
    expect(screen.getByText('Fresh Issue 2')).toBeInTheDocument();
    expect(screen.queryByText('Fresh Issue 3')).not.toBeInTheDocument();
  });

  it('hides a group entirely when the facility published none of it', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule({ dry: [] }));
    renderPage();

    await screen.findByText('Fresh Issue 1');
    expect(screen.queryByRole('region', { name: 'Dry' })).not.toBeInTheDocument();
  });

  it('says plainly when nothing has been published yet', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule({ fresh: [], dry: [] }));
    renderPage();

    expect(await screen.findByText(/no issue dates published yet/i)).toBeInTheDocument();
  });

  it('says plainly when no ration period is open', async () => {
    api.fetchIssueSchedule.mockRejectedValue(
      new ApiError(404, {
        code: 'NOT_FOUND',
        message: 'No ration period is open.',
        details: { reason: 'NO_OPEN_PERIOD' },
      })
    );
    renderPage();

    expect(await screen.findByText(/no ration period is open/i)).toBeInTheDocument();
    // Not an error state: nothing has gone wrong.
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it('reports a real failure as a failure rather than as an empty schedule', async () => {
    api.fetchIssueSchedule.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'boom' })
    );
    renderPage();

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------ read only

  it('offers no control that could change the schedule', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();
    await screen.findByText('Fresh Issue 1');

    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: /save|edit|change|add|configure|delete|remove/i })
    ).not.toBeInTheDocument();
  });

  it('tells the officer where the schedule comes from and that this app cannot change it', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();

    expect(await screen.findByText(/set by the Base Victualling Yard/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be changed from this app/i)).toBeInTheDocument();
  });

  it('shows no administrative detail — no id, no note, no author, no revision', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();
    await screen.findByText('Fresh Issue 1');

    const body = document.body.textContent ?? '';
    expect(body).not.toContain('01a11a22-0000-7000-8000-00000000aaaa');
    expect(body).not.toMatch(/revision/i);
    expect(body).not.toMatch(/changed by|updated by|created by/i);
    expect(body).not.toMatch(/isActive|retired/i);
  });

  it('asks for nothing but the schedule — the client module has one call and it is a GET', async () => {
    const actual = await import('../../lib/api/rik-issue-schedule-api');
    const exported = Object.entries(actual).filter(([, v]) => typeof v === 'function');
    // fetchIssueSchedule plus the two pure display helpers, and nothing that writes.
    expect(exported.map(([name]) => name).sort()).toEqual([
      'fetchIssueSchedule',
      'formatIssueDay',
      'formatRange',
    ]);
  });

  // -------------------------------------------------------------- mobile

  it('lays out in a single column with phone gutters', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    const { container } = renderPage();
    await screen.findByText('Fresh Issue 1');

    const main = container.querySelector('main')!;
    expect(main.className).toContain('px-4');

    // Cards in one stacked list, not a side-scrolling table.
    expect(container.querySelector('table')).toBeNull();
    const list = screen.getAllByRole('list')[0]!;
    expect(list.className).toContain('flex-col');
  });

  it('wraps the issue-day chips instead of scrolling sideways', async () => {
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();

    const card = (await screen.findByText('Fresh Issue 1')).closest('article')!;
    const chipList = within(card).getAllByRole('list')[0]!;
    expect(chipList.className).toContain('flex-wrap');
  });
});

/**
 * MISS MUSTER — the two schedules the facility runs for officers who missed
 * their issue, shown below Dry.
 *
 * They are two separate ration types, each with one schedule, so the screen
 * gives each its own region and its own heading. The Fresh and Dry sections
 * above them are untouched by their presence or absence — which is the point
 * of the last test here: a period with no Miss Muster dates has to look
 * exactly as it did before the feature existed.
 */
describe('RikIssueSchedulePage — Miss Muster', () => {
  const missMusterFresh = (overrides: Partial<IssueWindowView> = {}): IssueWindowView => ({
    rationType: 'MISS_MUSTER_FRESH',
    windowCode: 'MISS_MUSTER_FRESH',
    sequenceNo: 1,
    label: 'Miss Muster Fresh',
    startDate: plusDays(base, 21),
    endDate: plusDays(base, 23),
    operatingDays: [plusDays(base, 22)],
    ...overrides,
  });

  const missMusterDry = (overrides: Partial<IssueWindowView> = {}): IssueWindowView => ({
    rationType: 'MISS_MUSTER_DRY',
    windowCode: 'MISS_MUSTER_DRY',
    sequenceNo: 1,
    label: 'Miss Muster Dry',
    startDate: plusDays(base, 24),
    endDate: plusDays(base, 26),
    operatingDays: [plusDays(base, 25)],
    ...overrides,
  });

  const withMissMuster = () =>
    schedule({ missMusterFresh: [missMusterFresh()], missMusterDry: [missMusterDry()] });

  it('shows both Miss Muster schedules, below Fresh and Dry', async () => {
    api.fetchIssueSchedule.mockResolvedValue(withMissMuster());
    renderPage();

    // Waiting on the SECTION, not on the text: "Miss Muster Fresh" is both
    // the section's own <h2> and its single card's <h3>, so a bare text
    // query matches twice.
    await screen.findByRole('region', { name: 'Miss Muster Fresh' });
    // Level 3 is the card heading; level 2 is the section heading. Taking
    // only level 3 gives the schedules themselves, in document order.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Fresh Issue 1',
      'Fresh Issue 2',
      'Fresh Issue 3',
      'Dry Issue',
      'Miss Muster Fresh',
      'Miss Muster Dry',
    ]);
  });

  it('gives each Miss Muster schedule its own section', async () => {
    api.fetchIssueSchedule.mockResolvedValue(withMissMuster());
    renderPage();

    const mmFresh = await screen.findByRole('region', { name: 'Miss Muster Fresh' });
    const mmDry = screen.getByRole('region', { name: 'Miss Muster Dry' });

    // The CARD heading (level 3) is the schedule; the section's own heading
    // is level 2 and carries the same words, so the level matters.
    expect(
      within(mmFresh).getByRole('heading', { level: 3, name: 'Miss Muster Fresh' })
    ).toBeInTheDocument();
    expect(
      within(mmFresh).queryByRole('heading', { level: 3, name: 'Miss Muster Dry' })
    ).not.toBeInTheDocument();
    expect(
      within(mmDry).getByRole('heading', { level: 3, name: 'Miss Muster Dry' })
    ).toBeInTheDocument();
    expect(
      within(mmDry).queryByRole('heading', { level: 3, name: 'Miss Muster Fresh' })
    ).not.toBeInTheDocument();
  });

  it('shows each Miss Muster schedule’s own dates', async () => {
    const data = withMissMuster();
    api.fetchIssueSchedule.mockResolvedValue(data);
    renderPage();

    const mmDry = await screen.findByRole('region', { name: 'Miss Muster Dry' });
    expect(
      within(mmDry).getByText(formatRange(data.missMusterDry![0]!.startDate, data.missMusterDry![0]!.endDate))
    ).toBeInTheDocument();
  });

  it('leaves Fresh and Dry exactly as they were, with or without Miss Muster', async () => {
    api.fetchIssueSchedule.mockResolvedValue(withMissMuster());
    renderPage();

    const fresh = await screen.findByRole('region', { name: 'Fresh' });
    const dry = screen.getByRole('region', { name: 'Dry' });
    expect(within(fresh).getByText('Fresh Issue 1')).toBeInTheDocument();
    expect(within(fresh).queryByText(/Miss Muster/)).not.toBeInTheDocument();
    expect(within(dry).getByText('Dry Issue')).toBeInTheDocument();
    expect(within(dry).queryByText(/Miss Muster/)).not.toBeInTheDocument();
  });

  it('renders nothing for Miss Muster when the server sends none', async () => {
    // A response from before migration 0058 omits the keys entirely; the page
    // must look exactly as it always did.
    api.fetchIssueSchedule.mockResolvedValue(schedule());
    renderPage();

    await screen.findByText('Fresh Issue 1');
    expect(screen.queryByText(/Miss Muster/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Fresh Issue 1',
      'Fresh Issue 2',
      'Fresh Issue 3',
      'Dry Issue',
    ]);
  });
});
