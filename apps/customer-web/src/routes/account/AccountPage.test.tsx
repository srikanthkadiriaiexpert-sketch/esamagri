import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountPage } from './AccountPage';
import { ApiError } from '../../lib/api/client';
import type { CustomerProfile } from '../../lib/api/customer-api';

const navigate = vi.fn();
const logout = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../lib/auth/AuthContext', () => ({
  useAuth: () => ({ logout, principal: { principalType: 'CUSTOMER', principalId: 'c1' }, status: 'authenticated' }),
}));

const fetchMyProfile = vi.fn();
vi.mock('../../lib/api/customer-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/customer-api')>('../../lib/api/customer-api');
  return { ...actual, fetchMyProfile: (...args: unknown[]) => fetchMyProfile(...args) };
});

const PROFILE: CustomerProfile = {
  customerId: 'c1',
  name: 'Asha Kumar',
  mobileNumber: '+919876543210',
  residence: { label: null, quarterBlock: 'Block 4', quarterNumber: 'Qtr 12', landmark: null },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <AccountPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigate.mockReset();
  logout.mockClear();
  fetchMyProfile.mockReset();
});

describe('AccountPage (STEP 9)', () => {
  it('shows a loading state before the profile arrives', () => {
    fetchMyProfile.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the real profile: name, mobile number and quarter/residence', async () => {
    fetchMyProfile.mockResolvedValue(PROFILE);
    renderPage();

    expect(await screen.findByText('Asha Kumar')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByText('Block 4 · Qtr 12')).toBeInTheDocument();
  });

  it('shows only the approved fields — no defence-specific information', async () => {
    fetchMyProfile.mockResolvedValue(PROFILE);
    const { container } = renderPage();
    await screen.findByText('Asha Kumar');

    const text = container.textContent?.toLowerCase() ?? '';
    for (const forbidden of ['aadhaar', 'pan ', 'service number', 'rank', 'unit', 'family']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('offers to complete the profile when no residence is recorded', async () => {
    fetchMyProfile.mockResolvedValue({ ...PROFILE, residence: null });
    renderPage();
    expect(await screen.findByText('Not added yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete your profile/i })).toBeInTheDocument();
  });

  it('keeps My RIK Orders and My PIF Orders as separate entry points', async () => {
    fetchMyProfile.mockResolvedValue(PROFILE);
    renderPage();
    const rik = await screen.findByRole('button', { name: /my rik orders/i });
    const pif = screen.getByRole('button', { name: /my pif orders/i });
    expect(rik).toBeInTheDocument();
    expect(pif).toBeInTheDocument();

    await userEvent.click(rik);
    expect(navigate).toHaveBeenCalledWith('/rik/orders');
    await userEvent.click(pif);
    expect(navigate).toHaveBeenCalledWith('/pif/orders');
  });

  it('surfaces an expired session distinctly from a generic failure', async () => {
    fetchMyProfile.mockRejectedValue(new ApiError(401, { code: 'UNAUTHENTICATED', message: 'nope', correlationId: 'x' }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/session/i);
  });

  it('shows a retryable error state on a server failure', async () => {
    fetchMyProfile.mockRejectedValue(new ApiError(500, { code: 'INTERNAL_ERROR', message: 'boom', correlationId: 'x' }));
    renderPage();
    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(fetchMyProfile).toHaveBeenCalledTimes(1);
    await userEvent.click(retry);
    await waitFor(() => expect(fetchMyProfile).toHaveBeenCalledTimes(2));
  });

  it('never shows raw server error detail to the customer', async () => {
    fetchMyProfile.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'select * from shared.customers failed at pg_', correlationId: 'x' })
    );
    const { container } = renderPage();
    await screen.findByRole('alert');
    const text = container.textContent?.toLowerCase() ?? '';
    expect(text).not.toContain('select *');
    expect(text).not.toContain('pg_');
  });

  it('logs out only after explicit confirmation', async () => {
    fetchMyProfile.mockResolvedValue(PROFILE);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /log out/i }));
    expect(logout).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^log out$/i }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('/auth/login', { replace: true });
  });
});
