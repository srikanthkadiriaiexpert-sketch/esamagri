import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CategoriesChooserPage } from './CategoriesChooserPage';
import type { CategorySummary } from '../lib/api/catalog-api';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const fetchCategories = vi.fn();
vi.mock('../lib/api/catalog-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/catalog-api')>('../lib/api/catalog-api');
  return { ...actual, fetchCategories: (...args: unknown[]) => fetchCategories(...args) };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CategoriesChooserPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigate.mockReset();
  fetchCategories.mockReset();
});

describe('CategoriesChooserPage (STEP 9 — category foundation)', () => {
  it('offers category navigation for BOTH modules', async () => {
    fetchCategories.mockResolvedValue([]);
    renderPage();
    expect(screen.getByRole('tab', { name: 'RIK' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PIF' })).toBeInTheDocument();
  });

  it('asks the server for the selected module only — never a merged list', async () => {
    fetchCategories.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(fetchCategories).toHaveBeenCalledWith('rik'));

    await userEvent.click(screen.getByRole('tab', { name: 'PIF' }));
    await waitFor(() => expect(fetchCategories).toHaveBeenCalledWith('pif'));

    // Each call is for exactly one module; the two are never combined.
    for (const call of fetchCategories.mock.calls) {
      expect(['rik', 'pif']).toContain(call[0]);
    }
  });

  it('invents no taxonomy when the catalogue module is not built yet', async () => {
    const { NotImplementedError } = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client');
    fetchCategories.mockRejectedValue(new NotImplementedError('/rik/categories'));
    const { container } = renderPage();

    expect(await screen.findByText(/categories are coming soon/i)).toBeInTheDocument();
    // None of the client's example PIF categories may appear as if real.
    const text = container.textContent ?? '';
    for (const example of ['Dairy', 'Vegetables', 'Fruits', 'Ice Cream', 'Cooking Oils']) {
      expect(text).not.toContain(example);
    }
  });

  it('renders categories supplied by the server, and routes into that module', async () => {
    const categories: CategorySummary[] = [
      { id: 'cat-1', name: 'Served By Backend' },
      { id: 'cat-2', name: 'Also From Backend' },
    ];
    fetchCategories.mockResolvedValue(categories);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /served by backend/i }));
    expect(navigate).toHaveBeenCalledWith('/rik/categories/cat-1');
  });

  it('shows an empty state when the module has no categories yet', async () => {
    fetchCategories.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no categories yet/i)).toBeInTheDocument();
  });

  it('shows a retryable error state when the request fails', async () => {
    const { ApiError } = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client');
    fetchCategories.mockRejectedValue(new ApiError(500, { code: 'INTERNAL_ERROR', message: 'x', correlationId: 'y' }));
    renderPage();

    const retry = await screen.findByRole('button', { name: /try again/i });
    const before = fetchCategories.mock.calls.length;
    await userEvent.click(retry);
    await waitFor(() => expect(fetchCategories.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows a loading state while categories are in flight', () => {
    fetchCategories.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
