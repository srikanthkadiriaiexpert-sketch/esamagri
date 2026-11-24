import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { IssueSchedulesPage } from './IssueSchedulesPage';
import type { IssueScheduleListResponse } from '../lib/api/admin-api';
import { ApiError } from '../lib/api/client';

const fetchIssueSchedules = vi.fn<[], Promise<IssueScheduleListResponse>>();

vi.mock('../lib/api/admin-api', () => ({
  fetchIssueSchedules: (...args: []) => fetchIssueSchedules(...args),
}));

beforeEach(() => {
  fetchIssueSchedules.mockReset();
});

describe('IssueSchedulesPage (STEP 10 Section 8)', () => {
  it('shows an honest empty state and invents no issue day or window', async () => {
    fetchIssueSchedules.mockResolvedValue({ items: [], canCreate: false });
    render(<IssueSchedulesPage />);
    expect(await screen.findByText(/no issue schedules recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/issue days and windows are confirmed/i)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\b\d{1,2}\s?(am|pm)\b/i);
  });

  it('offers no creation control, because the decision behind a schedule is unresolved', async () => {
    fetchIssueSchedules.mockResolvedValue({ items: [], canCreate: false });
    render(<IssueSchedulesPage />);
    await screen.findByText(/no issue schedules recorded/i);
    expect(screen.queryByRole('button', { name: /new|create|add/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('renders recorded schedules exactly as the database holds them', async () => {
    fetchIssueSchedules.mockResolvedValue({
      canCreate: false,
      items: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          scheduleDate: '2026-09-20',
          categoryId: null,
          productId: null,
          status: 'PLANNED',
          startTime: null,
          endTime: null,
          notes: null,
          isPublished: false,
        },
      ],
    });
    render(<IssueSchedulesPage />);
    const row = await screen.findByRole('row', { name: /2026-09-20/ });
    expect(within(row).getByText('PLANNED')).toBeInTheDocument();
    expect(within(row).getByText('All items')).toBeInTheDocument();
    // No window recorded, so the cell says so rather than guessing one.
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('No')).toBeInTheDocument();
  });

  it('shows the unauthorized state for a role without rik.issue_schedule.manage', async () => {
    fetchIssueSchedules.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    render(<IssueSchedulesPage />);
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
  });
});
