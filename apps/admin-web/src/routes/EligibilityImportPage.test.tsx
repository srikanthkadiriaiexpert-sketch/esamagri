import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EligibilityImportPage } from './EligibilityImportPage';
import type {
  EntitlementPeriodOption,
  ImportBatch,
  ImportBatchSummary,
  ImportPreviewRow,
  OfficerEligibility,
  RowOutcome,
} from '../lib/api/rik-eligibility-api';
import type { Officer, OfficerListResponse } from '../lib/api/rik-officers-api';
import { ApiError } from '../lib/api/client';

const fetchPeriods = vi.fn<[AbortSignal?], Promise<{ items: EntitlementPeriodOption[] }>>();
const fetchBatches = vi.fn<[number?, AbortSignal?], Promise<{ items: ImportBatchSummary[] }>>();
const fetchBatch = vi.fn<[string, AbortSignal?], Promise<ImportBatch>>();
const uploadEligibility = vi.fn<[string, File], Promise<ImportBatch>>();
const confirmBatch = vi.fn<[string], Promise<ImportBatch>>();
const discardBatch = vi.fn<[string], Promise<ImportBatch>>();
const fetchOfficerEligibility = vi.fn<[string, AbortSignal?], Promise<OfficerEligibility>>();
const adjustOfficerEligibility = vi.fn();
const fetchOfficers = vi.fn<[{ q?: string }?, AbortSignal?], Promise<OfficerListResponse>>();

vi.mock('../lib/api/rik-eligibility-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-eligibility-api')>(
    '../lib/api/rik-eligibility-api'
  );
  return {
    ...actual,
    fetchPeriods: (...a: [AbortSignal?]) => fetchPeriods(...a),
    fetchBatches: (...a: [number?, AbortSignal?]) => fetchBatches(...a),
    fetchBatch: (...a: [string, AbortSignal?]) => fetchBatch(...a),
    uploadEligibility: (...a: [string, File]) => uploadEligibility(...a),
    confirmBatch: (...a: [string]) => confirmBatch(...a),
    discardBatch: (...a: [string]) => discardBatch(...a),
    fetchOfficerEligibility: (...a: [string, AbortSignal?]) => fetchOfficerEligibility(...a),
    adjustOfficerEligibility: (...a: unknown[]) => adjustOfficerEligibility(...a),
  };
});

vi.mock('../lib/api/rik-officers-api', () => ({
  fetchOfficers: (...a: [{ q?: string }?, AbortSignal?]) => fetchOfficers(...a),
}));

const PERIOD = '01a11a22-0000-7000-8000-00000000aaaa';
const OTHER_PERIOD = '01a11a22-0000-7000-8000-00000000bbbb';

const period = (): EntitlementPeriodOption => ({
  periodId: PERIOD,
  name: 'October 2026',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  status: 'ACTIVE',
});

let rowSeq = 0;
const row = (overrides: Partial<ImportPreviewRow> & { outcome: RowOutcome }): ImportPreviewRow => {
  rowSeq += 1;
  return {
    rowId: `row-${rowSeq}`,
    sheetRow: rowSeq + 1,
    excelName: 'A. Singh',
    excelMobile: '9876543210',
    excelEligibleDays: '20',
    normalisedMobile: '9876543210',
    officerId: '01a11a22-0000-7000-8000-000000000001',
    rikId: 'RIK-O-000125',
    systemName: 'A. Singh',
    systemOfficialName: 'A. Singh',
    previousEligibleDays: 18,
    importedEligibleDays: 20,
    delta: 2,
    exceptionReason: null,
    ...overrides,
  };
};

const batch = (overrides: Partial<ImportBatch> = {}): ImportBatch => ({
  batchId: 'batch-1',
  batchRef: 'ELIG-2026-000001',
  periodId: PERIOD,
  periodName: 'October 2026',
  fileName: 'eligibility-october.xlsx',
  fileHash: 'a'.repeat(64),
  status: 'PENDING_REVIEW',
  totals: { rows: 1, changed: 1, noChange: 0, exceptions: 0, applied: 0 },
  uploadedAt: '2026-10-08T10:00:00.000Z',
  decidedAt: null,
  rows: [row({ outcome: 'MATCHED_CHANGED' })],
  ...overrides,
});

const officer = (): Officer => ({
  officerId: '01a11a22-0000-7000-8000-000000000001',
  rikId: 'RIK-O-000125',
  name: 'A. Singh',
  officialName: 'Lt Cdr A. Singh',
  mobileNumber: '9876543210',
  dietaryPreference: 'NV',
  residence: { quarterBlock: 'B', quarterNumber: '102', landmark: null },
  status: 'ACTIVE',
  createdAt: '2026-10-01T10:00:00.000Z',
});

const workbook = () =>
  new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'eligibility-october.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

beforeEach(() => {
  rowSeq = 0;
  for (const m of [
    fetchPeriods,
    fetchBatches,
    fetchBatch,
    uploadEligibility,
    confirmBatch,
    discardBatch,
    fetchOfficerEligibility,
    adjustOfficerEligibility,
    fetchOfficers,
  ]) {
    m.mockReset();
  }
  fetchPeriods.mockResolvedValue({ items: [period()] });
  fetchBatches.mockResolvedValue({ items: [] });
});

/**
 * STEP 15B Phase B — the eligibility import screen.
 *
 * The assertions that matter are about the WORKFLOW and about ABSENCE:
 * uploading must not apply anything, the preview must show every column a
 * reviewer needs, exceptions must be visible and unapplied, and the screen
 * must offer no way to edit an officer's figure without a reason.
 */
describe('EligibilityImportPage (STEP 15B Phase B)', () => {
  it('requires the period to be chosen on the screen, not read from the sheet', async () => {
    render(<EligibilityImportPage />);
    const select = await screen.findByLabelText('Period');
    expect(within(select).getByRole('option', { name: /October 2026/ })).toBeInTheDocument();
    expect(screen.getByText(/sheet carries no period column/i)).toBeInTheDocument();
    // Nothing can be uploaded until a period is chosen.
    expect(screen.getByRole('button', { name: /upload and preview/i })).toBeDisabled();
  });

  it('says in so many words that uploading applies nothing', async () => {
    render(<EligibilityImportPage />);
    expect(await screen.findByText(/applies nothing/i)).toBeInTheDocument();
  });

  it('uploads with the chosen period and shows the preview without applying', async () => {
    uploadEligibility.mockResolvedValue(batch());
    render(<EligibilityImportPage />);

    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(uploadEligibility).toHaveBeenCalledTimes(1);
    expect(uploadEligibility.mock.calls[0]![0]).toBe(PERIOD);
    expect(await screen.findByText(/nothing has been applied yet/i)).toBeInTheDocument();
    expect(confirmBatch).not.toHaveBeenCalled();
    expect(screen.getByText('ELIG-2026-000001')).toBeInTheDocument();
  });

  it('shows every column a reviewer needs for a changed row', async () => {
    uploadEligibility.mockResolvedValue(batch());
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    const line = await screen.findByRole('row', { name: /RIK-O-000125/ });
    expect(within(line).getByText('RIK-O-000125')).toBeInTheDocument();
    expect(within(line).getByText('18')).toBeInTheDocument(); // previous
    expect(within(line).getByText('20')).toBeInTheDocument(); // from the sheet
    expect(within(line).getByText('+2')).toBeInTheDocument(); // delta, signed
    expect(within(line).getByText('Will change')).toBeInTheDocument();
  });

  it('shows a decrease as a negative delta rather than hiding it', async () => {
    uploadEligibility.mockResolvedValue(
      batch({
        rows: [row({ outcome: 'MATCHED_CHANGED', previousEligibleDays: 22, importedEligibleDays: 15, delta: -7, excelEligibleDays: '15' })],
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    const line = await screen.findByRole('row', { name: /RIK-O-000125/ });
    expect(within(line).getByText('-7')).toBeInTheDocument();
  });

  it('shows both names side by side on a mismatch, so it can be reviewed', async () => {
    uploadEligibility.mockResolvedValue(
      batch({
        totals: { rows: 1, changed: 0, noChange: 0, exceptions: 1, applied: 0 },
        rows: [
          row({
            outcome: 'NAME_MISMATCH',
            excelName: 'A Singh',
            systemName: 'A. Singh',
            systemOfficialName: 'Lt Cdr A. Singh',
            previousEligibleDays: null,
            importedEligibleDays: null,
            delta: null,
            exceptionReason: 'The name does not match the record for this mobile number.',
          }),
        ],
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(await screen.findByText(/Sheet says “A Singh”, record says “Lt Cdr A. Singh”/)).toBeInTheDocument();
    expect(screen.getByText('Name differs')).toBeInTheDocument();
  });

  it('keeps the raw text of a refused value, so the reason is specific', async () => {
    uploadEligibility.mockResolvedValue(
      batch({
        totals: { rows: 1, changed: 0, noChange: 0, exceptions: 1, applied: 0 },
        rows: [
          row({
            outcome: 'INVALID_ELIGIBLE_DAYS',
            excelEligibleDays: '7.5',
            importedEligibleDays: null,
            previousEligibleDays: null,
            delta: null,
            exceptionReason: 'Eligible days must be a whole number; the sheet says 7.5.',
          }),
        ],
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(await screen.findByText('7.5')).toBeInTheDocument();
    expect(screen.getByText(/whole number; the sheet says 7.5/)).toBeInTheDocument();
  });

  it('offers no way to apply a sheet that changes nothing', async () => {
    uploadEligibility.mockResolvedValue(
      batch({
        totals: { rows: 1, changed: 0, noChange: 1, exceptions: 0, applied: 0 },
        rows: [row({ outcome: 'MATCHED_NO_CHANGE', importedEligibleDays: 18, delta: 0, excelEligibleDays: '18' })],
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(await screen.findByText(/changes nothing, so there is nothing to apply/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm and apply/i })).toBeDisabled();
  });

  it('applies only on confirm, and then reports what moved', async () => {
    uploadEligibility.mockResolvedValue(batch());
    confirmBatch.mockResolvedValue(
      batch({
        status: 'APPLIED',
        totals: { rows: 1, changed: 1, noChange: 0, exceptions: 0, applied: 1 },
        decidedAt: '2026-10-08T10:05:00.000Z',
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));
    await userEvent.click(await screen.findByRole('button', { name: /confirm and apply 1 change/i }));

    expect(confirmBatch).toHaveBeenCalledWith('batch-1');
    expect(await screen.findByText(/ELIG-2026-000001 applied\. 1 officer changed/)).toBeInTheDocument();
    // An applied batch offers neither button again.
    expect(screen.queryByRole('button', { name: /confirm and apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard this sheet/i })).not.toBeInTheDocument();
  });

  it('discards without applying', async () => {
    uploadEligibility.mockResolvedValue(batch());
    discardBatch.mockResolvedValue(batch({ status: 'DISCARDED', decidedAt: '2026-10-08T10:05:00.000Z' }));
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));
    await userEvent.click(await screen.findByRole('button', { name: /discard this sheet/i }));

    expect(discardBatch).toHaveBeenCalledWith('batch-1');
    expect(confirmBatch).not.toHaveBeenCalled();
    expect(await screen.findByText(/discarded\. Nothing was applied/i)).toBeInTheDocument();
  });

  it('reports the server’s own refusal of a bad workbook', async () => {
    uploadEligibility.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'The first row must name the columns Name, Mobile Number and Eligible Days. Missing: eligibleDays.',
        details: { reason: 'MISSING_HEADER', field: 'file' },
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(await screen.findByText(/Missing: eligibleDays/)).toBeInTheDocument();
  });

  it('lists every previous import, so a repeated upload is visible as its own batch', async () => {
    fetchBatches.mockResolvedValue({
      items: [
        {
          ...batch({ batchId: 'b2', batchRef: 'ELIG-2026-000002', fileName: 'eligibility-corrected.xlsx' }),
          rows: undefined,
        } as unknown as ImportBatchSummary,
        {
          ...batch({
            batchId: 'b1',
            status: 'APPLIED',
            totals: { rows: 3, changed: 2, noChange: 1, exceptions: 0, applied: 2 },
          }),
          rows: undefined,
        } as unknown as ImportBatchSummary,
      ],
    });
    render(<EligibilityImportPage />);

    expect(await screen.findByText('ELIG-2026-000002')).toBeInTheDocument();
    expect(screen.getByText('ELIG-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText(/never overwrites the first one silently/i)).toBeInTheDocument();
  });

  it('reopens a stored batch for review', async () => {
    fetchBatches.mockResolvedValue([batch()].map((b) => ({ ...b })) as unknown as { items: ImportBatchSummary[] });
    fetchBatches.mockResolvedValue({ items: [batch() as unknown as ImportBatchSummary] });
    fetchBatch.mockResolvedValue(batch());
    render(<EligibilityImportPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^review$/i }));
    expect(fetchBatch).toHaveBeenCalledWith('batch-1');
    expect(await screen.findByText(/nothing has been applied yet/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------- absence

  it('offers no way to edit a figure inside the preview', async () => {
    uploadEligibility.mockResolvedValue(batch());
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));
    await screen.findByText(/nothing has been applied yet/i);

    // The only inputs on the page are the period, the file and the search box
    // in the (closed) adjustment panel. No editable cell exists in the table.
    const table = screen.getByRole('table', { name: /preview of ELIG-2026-000001/i });
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(table).queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('never offers to create an officer for an unknown mobile number', async () => {
    uploadEligibility.mockResolvedValue(
      batch({
        totals: { rows: 1, changed: 0, noChange: 0, exceptions: 1, applied: 0 },
        rows: [
          row({
            outcome: 'UNMATCHED_MOBILE_NOT_FOUND',
            officerId: null,
            rikId: null,
            systemName: null,
            systemOfficialName: null,
            previousEligibleDays: null,
            importedEligibleDays: null,
            delta: null,
            exceptionReason: 'No officer holds this mobile number.',
          }),
        ],
      })
    );
    render(<EligibilityImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
    await userEvent.upload(screen.getByLabelText('Eligibility workbook'), workbook());
    await userEvent.click(screen.getByRole('button', { name: /upload and preview/i }));

    expect(await screen.findByText('Mobile not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create|register|add officer/i })).not.toBeInTheDocument();
  });

  // ------------------------------------------------------ the exception path

  it('records a manual adjustment only with a reason, and shows the history', async () => {
    fetchOfficers.mockResolvedValue({ items: [officer()], total: 1, limit: 25, offset: 0 });
    fetchOfficerEligibility.mockResolvedValue({
      periods: [
        { periodId: PERIOD, periodName: 'October 2026', eligibleDays: 18, updatedAt: '2026-10-08T10:00:00.000Z' },
      ],
      history: [
        {
          adjustmentId: 'adj-1',
          periodId: PERIOD,
          periodName: 'October 2026',
          previousEligibleDays: 0,
          delta: 18,
          newEligibleDays: 18,
          reason: 'Eligibility import ELIG-2026-000001',
          source: 'IMPORT',
          batchRef: 'ELIG-2026-000001',
          staffId: 'staff-1',
          staffName: 'Test RIK_ADMIN',
          createdAt: '2026-10-08T10:00:00.000Z',
        },
      ],
    });
    adjustOfficerEligibility.mockResolvedValue({
      previousEligibleDays: 18,
      delta: 2,
      newEligibleDays: 20,
      adjustmentId: 'adj-2',
    });

    render(<EligibilityImportPage />);
    await userEvent.click(await screen.findByRole('button', { name: /adjust one officer/i }));
    await userEvent.type(screen.getByLabelText('Find the officer'), 'RIK-O-000125');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /RIK-O-000125/ }));

    // The history states where the current figure came from.
    expect(await screen.findByText('Eligibility import ELIG-2026-000001')).toBeInTheDocument();
    expect(screen.getByText(/October 2026: 18 days/)).toBeInTheDocument();

    const record = screen.getByRole('button', { name: /record the adjustment/i });
    expect(record).toBeDisabled(); // nothing typed yet — a reason is required

    await userEvent.selectOptions(screen.getByLabelText('Adjustment period'), PERIOD);
    await userEvent.type(screen.getByLabelText('Eligible days'), '20');
    expect(screen.getByRole('button', { name: /record the adjustment/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Reason'), 'Fresh Week 1 carry-forward');
    await userEvent.click(screen.getByRole('button', { name: /record the adjustment/i }));

    expect(adjustOfficerEligibility).toHaveBeenCalledWith('01a11a22-0000-7000-8000-000000000001', {
      periodId: PERIOD,
      eligibleDays: 20,
      reason: 'Fresh Week 1 carry-forward',
    });
    expect(await screen.findByText(/RIK-O-000125: 18 → 20 \(\+2\)/)).toBeInTheDocument();
  });

  it('passes a refused value to the server rather than correcting it', async () => {
    fetchOfficers.mockResolvedValue({ items: [officer()], total: 1, limit: 25, offset: 0 });
    fetchOfficerEligibility.mockResolvedValue({ periods: [], history: [] });
    adjustOfficerEligibility.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'Eligible days must be a whole number between 0 and 366.',
        details: { reason: 'INVALID_ELIGIBLE_DAYS', field: 'eligibleDays' },
      })
    );

    render(<EligibilityImportPage />);
    await userEvent.click(await screen.findByRole('button', { name: /adjust one officer/i }));
    await userEvent.type(screen.getByLabelText('Find the officer'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /RIK-O-000125/ }));

    await userEvent.selectOptions(screen.getByLabelText('Adjustment period'), PERIOD);
    await userEvent.type(screen.getByLabelText('Eligible days'), '7.5');
    await userEvent.type(screen.getByLabelText('Reason'), 'Telephoned correction');
    await userEvent.click(screen.getByRole('button', { name: /record the adjustment/i }));

    expect(adjustOfficerEligibility).toHaveBeenCalledWith(
      '01a11a22-0000-7000-8000-000000000001',
      expect.objectContaining({ eligibleDays: 7.5 })
    );
    expect(await screen.findByText(/whole number between 0 and 366/)).toBeInTheDocument();
  });

  it('says plainly that an import never creates an officer', async () => {
    fetchOfficers.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    render(<EligibilityImportPage />);
    await userEvent.click(await screen.findByRole('button', { name: /adjust one officer/i }));
    await userEvent.type(screen.getByLabelText('Find the officer'), '9000000000');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText(/An import never creates one/i)).toBeInTheDocument();
  });

  it('shows an honest empty state when no period exists at all', async () => {
    fetchPeriods.mockResolvedValue({ items: [] });
    render(<EligibilityImportPage />);
    expect(await screen.findByText(/no entitlement period exists yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Eligibility workbook')).not.toBeInTheDocument();
  });

  it('reports a failure to load the periods rather than showing a blank form', async () => {
    fetchPeriods.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    render(<EligibilityImportPage />);
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Eligibility workbook')).not.toBeInTheDocument();
  });

  it('does not offer the other period’s sheet as a default — the choice is explicit', async () => {
    fetchPeriods.mockResolvedValue({
      items: [period(), { ...period(), periodId: OTHER_PERIOD, name: 'November 2026' }],
    });
    render(<EligibilityImportPage />);
    const select = (await screen.findByLabelText('Period')) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getByRole('option', { name: /choose a period/i })).toBeInTheDocument();
  });
});
