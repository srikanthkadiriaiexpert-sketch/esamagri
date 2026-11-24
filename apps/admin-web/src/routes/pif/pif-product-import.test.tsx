import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PifProductImportPage } from './PifProductImportPage';
import { ApiError } from '../../lib/api/client';
import type { ImportBatch, ImportPreview, ImportRow } from '../../lib/api/pif-admin-api';

/**
 * The bulk product import screen (LAUNCH PREPARATION).
 *
 * WHAT THESE TESTS ARE FOR. That the screen tells the truth about a file
 * before it is applied, and that the sequence cannot be short-circuited:
 *
 *   * a fresh preview says plainly that nothing has been written yet;
 *   * every problem the server reported is shown, per row, in words;
 *   * a category or GST rate the file names but the portal does not have is
 *     listed by name, because that is the operator's next action;
 *   * a column the import ignores — above all a Stock column — is shown
 *     with its reason rather than silently dropped;
 *   * Apply is offered exactly once, is disabled when there is nothing
 *     applicable, and disappears once the batch has been decided.
 *
 * The screen computes nothing: counts, verdicts and problems all come from
 * the server and are displayed.
 */

const api = vi.hoisted(() => ({
  fetchImportBatches: vi.fn(),
  fetchImportRows: vi.fn(),
  previewImport: vi.fn(),
  applyImport: vi.fn(),
  discardImport: vi.fn(),
  downloadImportTemplate: vi.fn(),
}));

vi.mock('../../lib/api/pif-admin-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/pif-admin-api')>(
    '../../lib/api/pif-admin-api'
  );
  // The label maps and `rupees` are exercised for real; only network calls
  // are replaced.
  return { ...actual, ...api };
});

const batch = (overrides: Partial<ImportBatch> = {}): ImportBatch => ({
  id: 'batch-1',
  filename: 'september-catalogue.xlsx',
  format: 'XLSX',
  bytes: 24_000,
  status: 'PREVIEW',
  totalRows: 4,
  createRows: 2,
  updateRows: 1,
  invalidRows: 1,
  appliedRows: 0,
  failureReason: null,
  uploadedBy: 'Priya (PIF_ADMIN)',
  uploadedAt: '2026-10-10T04:30:00.000Z',
  decidedBy: null,
  decidedAt: null,
  ...overrides,
});

const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  id: `row-${overrides.rowNo ?? 2}`,
  rowNo: 2,
  verdict: 'CREATE',
  sku: 'TD-1KG',
  name: 'Toor Dal 1 kg',
  productId: null,
  problems: [],
  appliedAt: null,
  sellingPrice: 142.5,
  unit: 'kg',
  available: true,
  active: true,
  ...overrides,
});

const preview = (overrides: Partial<ImportPreview> = {}): ImportPreview => ({
  batch: batch(),
  missingCategories: [],
  unknownTaxRates: [],
  ignoredColumns: [],
  unknownColumns: [],
  columnsUsed: ['sku', 'name', 'sellingPrice'],
  ...overrides,
});

const rows: ImportRow[] = [
  row({ rowNo: 2 }),
  row({ rowNo: 3, sku: 'SG-500G', name: 'Sugar 500 g', sellingPrice: 27 }),
  row({ rowNo: 4, sku: 'ATTA-5KG', name: 'Atta 5 kg', verdict: 'UPDATE', sellingPrice: 225 }),
  row({
    rowNo: 5,
    sku: 'BAD-1',
    name: 'Mystery item',
    verdict: 'INVALID',
    sellingPrice: null,
    problems: ['No active tax rate of 17% is configured.', 'No unit.'],
  }),
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <PifProductImportPage />
    </MemoryRouter>
  );

const upload = async (name = 'september-catalogue.xlsx') => {
  const user = userEvent.setup();
  const file = new File(['sku,name\n'], name, { type: 'text/csv' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchImportBatches.mockResolvedValue({ items: [] });
  api.fetchImportRows.mockResolvedValue({ items: rows, total: rows.length });
  api.previewImport.mockResolvedValue(preview());
});

describe('the import screen before anything is applied', () => {
  it('offers the template and the upload, in that order', async () => {
    renderPage();
    expect(await screen.findByText(/Start from the template/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download the template/i })).toBeInTheDocument();
    expect(screen.getByText(/Upload it to see what it would do/i)).toBeInTheDocument();
  });

  it('says in so many words that nothing has been written yet', async () => {
    renderPage();
    await upload();
    expect(await screen.findByText(/Nothing has been written to the shop yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Awaiting your decision/i)).toBeInTheDocument();
  });

  it('shows the server’s counts, not its own', async () => {
    renderPage();
    await upload();
    const figures = await screen.findByText('New products');
    expect(figures.parentElement).toHaveTextContent('2');
    expect(screen.getByText('Updates').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Problems').parentElement).toHaveTextContent('1');
  });

  it('lists every row with what will happen to it, and every problem in words', async () => {
    renderPage();
    await upload();
    const table = await screen.findByRole('table', { name: /Rows in the uploaded file/i });
    expect(within(table).getByText('TD-1KG')).toBeInTheDocument();
    expect(within(table).getAllByText('New product')).toHaveLength(2);
    expect(within(table).getByText(/Updates an existing product/i)).toBeInTheDocument();
    expect(within(table).getByText(/Cannot be imported/i)).toBeInTheDocument();
    expect(within(table).getByText(/No active tax rate of 17%/i)).toBeInTheDocument();
    // The price is displayed as the server gave it, in rupees.
    expect(within(table).getByText('₹142.50')).toBeInTheDocument();
  });

  it('names the categories that must be created first', async () => {
    api.previewImport.mockResolvedValue(
      preview({ missingCategories: ['Frozen Foods', 'Spices'] })
    );
    renderPage();
    await upload();
    expect(await screen.findByText(/Create these categories first/i)).toBeInTheDocument();
    expect(screen.getByText('Frozen Foods')).toBeInTheDocument();
    expect(screen.getByText('Spices')).toBeInTheDocument();
  });

  it('names the GST rates that are not configured', async () => {
    api.previewImport.mockResolvedValue(preview({ unknownTaxRates: ['17', '28'] }));
    renderPage();
    await upload();
    expect(await screen.findByText(/These GST rates are not configured: 17%, 28%/i)).toBeInTheDocument();
  });

  it('shows an ignored Stock column with the reason, rather than dropping it silently', async () => {
    api.previewImport.mockResolvedValue(
      preview({
        ignoredColumns: [
          {
            heading: 'Stock',
            reason: 'PIF keeps no stock count — use the Available column instead.',
          },
        ],
        unknownColumns: ['Shelf Position'],
      })
    );
    renderPage();
    await upload();
    expect(await screen.findByText(/Columns in your file that were not imported/i)).toBeInTheDocument();
    expect(screen.getByText('Stock')).toBeInTheDocument();
    expect(screen.getByText(/keeps no stock count/i)).toBeInTheDocument();
    expect(screen.getByText(/Headings not recognised and ignored: Shelf Position/i)).toBeInTheDocument();
  });

  it('never offers a stock or quantity-on-hand field', async () => {
    renderPage();
    await upload();
    await screen.findByRole('table', { name: /Rows in the uploaded file/i });
    expect(screen.queryByLabelText(/stock/i)).toBeNull();
    expect(screen.queryByText(/quantity on hand/i)).toBeNull();
  });
});

describe('applying and discarding', () => {
  it('applies the file once and reports what was written', async () => {
    api.applyImport.mockResolvedValue({
      batch: batch({ status: 'APPLIED', appliedRows: 3, decidedBy: 'Priya (PIF_ADMIN)' }),
    });
    renderPage();
    const user = await upload();

    const apply = await screen.findByRole('button', { name: /Apply 3 rows/i });
    await user.click(apply);

    expect(api.applyImport).toHaveBeenCalledWith('batch-1');
    expect(await screen.findByText(/3 products written to the catalogue/i)).toBeInTheDocument();
    // Applied is terminal: the buttons are no longer offered.
    expect(screen.getByRole('button', { name: /Apply 3 rows/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Throw this file away/i })).toBeDisabled();
  });

  it('will not offer to apply a file in which every row has a problem', async () => {
    api.previewImport.mockResolvedValue({
      ...preview(),
      batch: batch({ createRows: 0, updateRows: 0, invalidRows: 4 }),
    });
    renderPage();
    await upload();
    expect(await screen.findByRole('button', { name: /Apply 0 rows/i })).toBeDisabled();
  });

  it('throws a file away without writing anything', async () => {
    api.discardImport.mockResolvedValue({ batch: batch({ status: 'DISCARDED' }) });
    renderPage();
    const user = await upload();
    await user.click(await screen.findByRole('button', { name: /Throw this file away/i }));
    expect(api.applyImport).not.toHaveBeenCalled();
    expect(await screen.findByText(/Nothing was written to the catalogue/i)).toBeInTheDocument();
  });

  it('shows the server’s refusal in the facility’s words when applying fails', async () => {
    // A real ApiError, so the screen's own error rendering is what is being
    // tested rather than a convenient stand-in.
    api.applyImport.mockRejectedValue(
      new ApiError(409, {
        code: 'VALIDATION_FAILED',
        message: 'That import was already applied.',
        correlationId: 'c0ffee00-0000-4000-8000-000000000000',
      })
    );
    renderPage();
    const user = await upload();
    await user.click(await screen.findByRole('button', { name: /Apply 3 rows/i }));
    expect(await screen.findByText(/already applied/i)).toBeInTheDocument();
  });

  it('reports a part-way failure with how far it got', async () => {
    api.previewImport.mockResolvedValue({
      ...preview(),
      batch: batch({
        status: 'FAILED',
        appliedRows: 2,
        failureReason: 'The catalogue changed since this file was previewed.',
      }),
    });
    renderPage();
    await upload();
    expect(await screen.findByText(/The catalogue changed since this file was previewed/i)).toBeInTheDocument();
    expect(screen.getByText('Written so far').parentElement).toHaveTextContent('2');
  });

  it('asks the server for only the problem rows when that filter is chosen', async () => {
    renderPage();
    const user = await upload();
    await screen.findByRole('table', { name: /Rows in the uploaded file/i });
    await user.selectOptions(screen.getByLabelText(/Which rows to show/i), 'INVALID');
    expect(api.fetchImportRows).toHaveBeenLastCalledWith(
      'batch-1',
      expect.objectContaining({ verdict: 'INVALID' })
    );
  });
});

describe('the record of past imports', () => {
  it('lists them with who uploaded each one and what became of it', async () => {
    api.fetchImportBatches.mockResolvedValue({
      items: [
        batch({ id: 'b-1', status: 'APPLIED', appliedRows: 120, decidedBy: 'Priya (PIF_ADMIN)' }),
        batch({ id: 'b-2', filename: 'old.csv', format: 'CSV', status: 'DISCARDED' }),
      ],
    });
    renderPage();
    const table = await screen.findByRole('table', { name: /Recent product imports/i });
    expect(within(table).getByText('september-catalogue.xlsx')).toBeInTheDocument();
    expect(within(table).getByText('old.csv')).toBeInTheDocument();
    expect(within(table).getByText('Applied')).toBeInTheDocument();
    expect(within(table).getByText('Discarded')).toBeInTheDocument();
    expect(within(table).getByText(/120 written/)).toBeInTheDocument();
  });

  it('says so plainly when there have been none', async () => {
    renderPage();
    expect(await screen.findByText(/No imports yet/i)).toBeInTheDocument();
  });

  it('states that an import never deletes or withdraws anything', async () => {
    renderPage();
    expect(
      await screen.findByText(/never deletes one, never takes one off\s+sale/i)
    ).toBeInTheDocument();
  });
});
