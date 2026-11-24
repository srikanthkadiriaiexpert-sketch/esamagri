import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EligibilityImportPage } from './EligibilityImportPage';
import type {
  EligibilityUploadStatus,
  EntitlementPeriodOption,
  ImportBatch,
  ImportBatchSummary,
} from '../lib/api/rik-eligibility-api';

/**
 * The FRESH and DRY buttons (STEP 16 / migration 0066).
 *
 * WHY THIS IS A SEPARATE FILE. EligibilityImportPage.test.tsx asserts the
 * behaviour this screen already had, and it is untouched — not one of its
 * assertions was weakened or renumbered to accommodate this change. These are
 * the NEW assertions, and keeping them apart makes it obvious which is which
 * if either ever fails.
 *
 * THE ASSERTION THAT MATTERS MOST is the third one: the ration type the
 * administrator chose must reach the server. A screen that showed two buttons
 * and then uploaded without saying which was pressed would apply every dry
 * sheet to the fresh figure, and nothing in the file would contradict it.
 *
 * WHAT THESE TESTS DO NOT ASSERT. Nothing about entitlement quantities, pools,
 * scales, conversions, bread or oats. Under this phase the two figures are
 * stored and displayed only — the entitlement engine was not modified — so an
 * assertion here about a calculated quantity would be a claim that it was.
 */

const fetchPeriods = vi.fn<[AbortSignal?], Promise<{ items: EntitlementPeriodOption[] }>>();
const fetchBatches = vi.fn<[number?, AbortSignal?], Promise<{ items: ImportBatchSummary[] }>>();
const fetchBatch = vi.fn<[string, AbortSignal?], Promise<ImportBatch>>();
const uploadEligibility = vi.fn();
const confirmBatch = vi.fn<[string], Promise<ImportBatch>>();
const discardBatch = vi.fn<[string], Promise<ImportBatch>>();
const fetchEligibilityStatus =
  vi.fn<[string, AbortSignal?], Promise<{ items: EligibilityUploadStatus[] }>>();
const fetchOfficerEligibility = vi.fn();
const adjustOfficerEligibility = vi.fn();
const fetchOfficers = vi.fn();

vi.mock('../lib/api/rik-eligibility-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-eligibility-api')>(
    '../lib/api/rik-eligibility-api'
  );
  return {
    ...actual,
    fetchPeriods: (...a: [AbortSignal?]) => fetchPeriods(...a),
    fetchBatches: (...a: [number?, AbortSignal?]) => fetchBatches(...a),
    fetchBatch: (...a: [string, AbortSignal?]) => fetchBatch(...a),
    uploadEligibility: (...a: unknown[]) => uploadEligibility(...a),
    confirmBatch: (...a: [string]) => confirmBatch(...a),
    discardBatch: (...a: [string]) => discardBatch(...a),
    fetchEligibilityStatus: (...a: [string, AbortSignal?]) => fetchEligibilityStatus(...a),
    fetchOfficerEligibility: (...a: unknown[]) => fetchOfficerEligibility(...a),
    adjustOfficerEligibility: (...a: unknown[]) => adjustOfficerEligibility(...a),
  };
});

vi.mock('../lib/api/rik-officers-api', () => ({
  fetchOfficers: (...a: unknown[]) => fetchOfficers(...a),
}));

const PERIOD = '01a11a22-0000-7000-8000-00000000aaaa';

const period = (): EntitlementPeriodOption => ({
  periodId: PERIOD,
  name: 'November 2026',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  status: 'ACTIVE',
});

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  batchId: 'batch-1',
  batchRef: 'ELIG-2026-000001',
  periodId: PERIOD,
  periodName: 'November 2026',
  rationType: 'FRESH',
  fileName: 'eligibility-november.xlsx',
  fileHash: 'a'.repeat(64),
  status: 'PENDING_REVIEW',
  totals: { rows: 1, changed: 1, noChange: 0, exceptions: 0, applied: 0 },
  uploadedAt: '2026-11-12T10:42:00.000Z',
  decidedAt: null,
  rows: [],
  ...over,
});

const status = (
  fresh: Partial<EligibilityUploadStatus>,
  dry: Partial<EligibilityUploadStatus>
): { items: EligibilityUploadStatus[] } => ({
  items: [
    {
      rationType: 'FRESH',
      uploaded: false,
      batchId: null,
      batchRef: null,
      status: null,
      totals: null,
      uploadedAt: null,
      decidedAt: null,
      officersWithValue: 0,
      ...fresh,
    },
    {
      rationType: 'DRY',
      uploaded: false,
      batchId: null,
      batchRef: null,
      status: null,
      totals: null,
      uploadedAt: null,
      decidedAt: null,
      officersWithValue: 0,
      ...dry,
    },
  ],
});

const workbook = () =>
  new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'eligibility-november.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

beforeEach(() => {
  for (const m of [
    fetchPeriods,
    fetchBatches,
    fetchBatch,
    uploadEligibility,
    confirmBatch,
    discardBatch,
    fetchEligibilityStatus,
    fetchOfficerEligibility,
    adjustOfficerEligibility,
    fetchOfficers,
  ]) {
    m.mockReset();
  }
  fetchPeriods.mockResolvedValue({ items: [period()] });
  fetchBatches.mockResolvedValue({ items: [] });
  fetchEligibilityStatus.mockResolvedValue(status({}, {}));
});

async function chooseThePeriod() {
  render(<EligibilityImportPage />);
  const select = await screen.findByLabelText('Period');
  await userEvent.selectOptions(select, PERIOD);
}

describe('the two buttons', () => {
  it('offers FRESH and DRY, with each limit stated', async () => {
    await chooseThePeriod();

    expect(screen.getByLabelText('Fresh eligibility')).toBeInTheDocument();
    expect(screen.getByLabelText('Dry eligibility')).toBeInTheDocument();
    // The limits belong on the buttons: a staff member must not have to
    // discover 30 and 60 by having an upload refused.
    expect(screen.getByText('maximum 30 days')).toBeInTheDocument();
    expect(screen.getByText('maximum 60 days')).toBeInTheDocument();
  });

  it('marks the selected type in words, not by colour alone', async () => {
    await chooseThePeriod();

    // Fresh is pre-selected, and SAYS SO. Colour alone fails anyone reading a
    // monochrome screen, and confirming a dry sheet as fresh moves the wrong
    // figure for every officer in the file.
    expect(screen.getByLabelText('Fresh eligibility')).toBeChecked();
    expect(screen.getByText('Selected')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Dry eligibility'));

    expect(screen.getByLabelText('Dry eligibility')).toBeChecked();
    expect(screen.getByLabelText('Fresh eligibility')).not.toBeChecked();
    // Still exactly one "Selected" marker — never two.
    expect(screen.getAllByText('Selected')).toHaveLength(1);
  });

  it('SENDS THE CHOSEN TYPE TO THE SERVER — the assertion that matters', async () => {
    uploadEligibility.mockResolvedValue(batch({ rationType: 'DRY' }));
    await chooseThePeriod();

    await userEvent.click(screen.getByLabelText('Dry eligibility'));
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(uploadEligibility).toHaveBeenCalledTimes(1);
    const call = uploadEligibility.mock.calls[0]!;
    expect(call[0]).toBe(PERIOD);
    expect(call[2]).toBe('DRY');
  });

  it('sends FRESH when fresh is the selection', async () => {
    uploadEligibility.mockResolvedValue(batch());
    await chooseThePeriod();

    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(uploadEligibility.mock.calls[0]![2]).toBe('FRESH');
  });

  it('names the type on the submit button, so the press is deliberate', async () => {
    await chooseThePeriod();
    expect(screen.getByRole('button', { name: /upload and preview fresh eligibility/i })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Dry eligibility'));
    expect(screen.getByRole('button', { name: /upload and preview dry eligibility/i })).toBeInTheDocument();
  });
});

describe('the preview restates which figure it will move', () => {
  it('badges the preview with the ration type', async () => {
    uploadEligibility.mockResolvedValue(batch({ rationType: 'DRY' }));
    await chooseThePeriod();

    await userEvent.click(screen.getByLabelText('Dry eligibility'));
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    // A reviewer reaching the Confirm button must be able to see which of the
    // two figures is about to move, without scrolling back up to the form.
    //
    // SCOPED TO THE PREVIEW HEADING, on purpose. By the time this runs, FIVE
    // elements legitimately contain "dry eligibility" — the type hint, the
    // status warning, the submit button, the success notice and this badge —
    // because the screen names the figure repeatedly so that a dry sheet
    // cannot be confirmed as a fresh one. A document-wide findByText is
    // therefore ambiguous, and worse, it would have been satisfied by the
    // submit button alone: it could have passed with no badge at all.
    const heading = await screen.findByRole('heading', { name: /ELIG-2026-000001/ });
    expect(heading).toHaveTextContent(/dry eligibility/i);
  });
});

describe('upload status — a missing sheet is stated, never implied', () => {
  it('says "Not uploaded" for a type with no sheet, and warns', async () => {
    fetchEligibilityStatus.mockResolvedValue(
      status(
        {
          uploaded: true,
          batchId: 'batch-1',
          batchRef: 'ELIG-2026-000001',
          status: 'APPLIED',
          totals: { rows: 41, changed: 39, noChange: 0, exceptions: 2, applied: 39 },
          uploadedAt: '2026-11-12T10:42:00.000Z',
          officersWithValue: 39,
        },
        {}
      )
    );
    await chooseThePeriod();

    expect(await screen.findByText(/upload status for this period/i)).toBeInTheDocument();
    expect(screen.getByText('Not uploaded')).toBeInTheDocument();
    expect(screen.getByText('ELIG-2026-000001')).toBeInTheDocument();
    expect(screen.getByText(/39 officers with a figure/)).toBeInTheDocument();

    // THE WARNING, and the sentence that keeps a missing sheet from being read
    // as an approved zero.
    expect(
      screen.getByText(/Dry eligibility has not been uploaded for this period/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/never zero days/i)).toBeInTheDocument();
  });

  it('warns about both when neither has been uploaded', async () => {
    await chooseThePeriod();
    expect(
      await screen.findByText(/Fresh and Dry eligibility has not been uploaded/i)
    ).toBeInTheDocument();
  });

  it('warns about neither once both are uploaded', async () => {
    const done = {
      uploaded: true,
      batchId: 'b',
      batchRef: 'ELIG-2026-000002',
      status: 'APPLIED' as const,
      totals: { rows: 2, changed: 2, noChange: 0, exceptions: 0, applied: 2 },
      uploadedAt: '2026-11-12T11:00:00.000Z',
      officersWithValue: 2,
    };
    fetchEligibilityStatus.mockResolvedValue(status(done, done));
    await chooseThePeriod();

    await screen.findByText(/upload status for this period/i);
    expect(screen.queryByText(/has not been uploaded for this period/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Not uploaded')).not.toBeInTheDocument();
  });

  it('tells staff the Fresh and Dry figures are what the calculation now uses', async () => {
    await chooseThePeriod();
    // The engine change was approved and applied: quantities are calculated
    // from these two figures. The screen must say so, and must no longer carry
    // the earlier sentence that said the opposite.
    expect(
      await screen.findByText(/what entitlement quantities are now calculated from/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/still calculated from the existing single eligibility figure/i)
    ).not.toBeInTheDocument();
  });

  it('never blocks the upload form when the status read fails', async () => {
    // The panel is an aid, not a gate. A failed status read must not stop an
    // administrator uploading a sheet, and must not make the form look broken.
    fetchEligibilityStatus.mockRejectedValue(new Error('status unavailable'));
    await chooseThePeriod();

    expect(screen.getByLabelText('Fresh eligibility')).toBeInTheDocument();
    expect(screen.getByLabelText('Eligibility workbook')).toBeInTheDocument();
    expect(screen.queryByText(/upload status for this period/i)).not.toBeInTheDocument();
  });

  it('asks for no status until a period is chosen', async () => {
    render(<EligibilityImportPage />);
    await screen.findByLabelText('Period');
    expect(fetchEligibilityStatus).not.toHaveBeenCalled();
  });
});

describe('the previous-imports list says which figure each batch moved', () => {
  it('shows the type per batch, and Legacy for a pre-0066 batch', async () => {
    fetchBatches.mockResolvedValue({
      items: [
        { ...batch(), rationType: 'DRY', batchRef: 'ELIG-2026-000002', batchId: 'b2' },
        { ...batch(), rationType: null, batchRef: 'ELIG-2026-000001', batchId: 'b1' },
      ],
    });
    render(<EligibilityImportPage />);

    const dryRow = await screen.findByRole('row', { name: /ELIG-2026-000002/ });
    expect(within(dryRow).getByText('Dry')).toBeInTheDocument();

    const legacyRow = screen.getByRole('row', { name: /ELIG-2026-000001/ });
    expect(within(legacyRow).getByText('Legacy')).toBeInTheDocument();
  });
});
