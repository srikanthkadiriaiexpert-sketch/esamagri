import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnnouncementsPage } from './AnnouncementsPage';
import type { Announcement, AnnouncementListResponse } from '../lib/api/admin-api';
import { ApiError } from '../lib/api/client';

const fetchAnnouncements = vi.fn<[], Promise<AnnouncementListResponse>>();
const createAnnouncement = vi.fn<[unknown], Promise<Announcement>>();

vi.mock('../lib/api/admin-api', () => ({
  fetchAnnouncements: (...args: []) => fetchAnnouncements(...args),
  createAnnouncement: (input: unknown) => createAnnouncement(input),
}));

function announcement(over: Partial<Announcement> = {}): Announcement {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    title: 'Yard closed on Monday',
    body: 'The yard will not issue on Monday.',
    announcementType: 'HOLIDAY_CLOSURE',
    targetAudience: 'RIK',
    priority: 'HIGH',
    startDate: '2026-09-14',
    endDate: null,
    isPublished: true,
    createdAt: '2026-09-11T04:00:00.000Z',
    updatedAt: '2026-09-11T04:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  fetchAnnouncements.mockReset();
  createAnnouncement.mockReset();
});

describe('AnnouncementsPage (STEP 10 Section 7)', () => {
  it('shows an honest empty state rather than sample notices', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['RIK'] });
    render(<AnnouncementsPage />);
    expect(await screen.findByText(/no announcements yet/i)).toBeInTheDocument();
  });

  it('renders exactly what the server returned, and nothing more', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [announcement()], manageableAudiences: ['RIK'] });
    render(<AnnouncementsPage />);
    const row = await screen.findByRole('row', { name: /yard closed on monday/i });
    expect(within(row).getByText('RIK')).toBeInTheDocument();
    expect(within(row).getByText('HIGH')).toBeInTheDocument();
    expect(within(row).getByText('Published')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + the one row
  });
});

describe('AnnouncementsPage — RIK/PIF audience isolation surfaced in the UI', () => {
  it('offers a RIK_ADMIN only the RIK audience the server said it may write', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['RIK'] });
    render(<AnnouncementsPage />);
    const select = await screen.findByLabelText(/audience/i);
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['RIK']);
    expect(options).not.toContain('PIF');
    expect(options).not.toContain('ALL');
  });

  it('offers a PIF_ADMIN only PIF — never RIK, never ALL', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['PIF'] });
    render(<AnnouncementsPage />);
    const select = await screen.findByLabelText(/audience/i);
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['PIF']);
  });

  it('offers a SUPER_ADMIN all three, including the ALL audience that reaches both services', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['ALL', 'RIK', 'PIF'] });
    render(<AnnouncementsPage />);
    const select = await screen.findByLabelText(/audience/i);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['ALL', 'RIK', 'PIF']);
  });

  it('offers no creation form at all when the server grants no writable audience', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [announcement()], manageableAudiences: [] });
    render(<AnnouncementsPage />);
    expect(await screen.findByText(/view announcements but not create them/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create announcement/i })).not.toBeInTheDocument();
  });
});

describe('AnnouncementsPage — creation', () => {
  it('sends the real fields and reloads the list from the server afterwards', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['RIK'] });
    createAnnouncement.mockResolvedValue(announcement());
    render(<AnnouncementsPage />);

    await userEvent.type(await screen.findByLabelText(/^title$/i), 'Issue day moved');
    await userEvent.type(screen.getByLabelText(/^message$/i), 'Monday issue moves to Tuesday.');
    await userEvent.click(screen.getByRole('button', { name: /create announcement/i }));

    expect(createAnnouncement).toHaveBeenCalledWith({
      title: 'Issue day moved',
      body: 'Monday issue moves to Tuesday.',
      announcementType: 'GENERAL',
      targetAudience: 'RIK',
      priority: 'NORMAL',
      isPublished: false,
    });
    expect(fetchAnnouncements).toHaveBeenCalledTimes(2);
  });

  it('refuses to submit an incomplete announcement without calling the server', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['RIK'] });
    render(<AnnouncementsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /create announcement/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a title, a message and an audience/i);
    expect(createAnnouncement).not.toHaveBeenCalled();
  });

  it('reports a server-side audience refusal honestly instead of pretending it saved', async () => {
    fetchAnnouncements.mockResolvedValue({ items: [], manageableAudiences: ['PIF'] });
    createAnnouncement.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'audience not permitted' }));
    render(<AnnouncementsPage />);

    await userEvent.type(await screen.findByLabelText(/^title$/i), 'Test');
    await userEvent.type(screen.getByLabelText(/^message$/i), 'Test body');
    await userEvent.click(screen.getByRole('button', { name: /create announcement/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot create an announcement for that audience/i);
  });

  it('shows the unauthorized state when the list itself is forbidden', async () => {
    fetchAnnouncements.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    render(<AnnouncementsPage />);
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
  });
});
