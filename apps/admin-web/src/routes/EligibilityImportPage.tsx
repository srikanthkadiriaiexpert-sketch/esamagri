import { useCallback, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useResource } from '../lib/api/resource';
import {
  OUTCOME_LABELS,
  RATION_TYPES,
  RATION_TYPE_LABELS,
  RATION_TYPE_MAX_DAYS,
  VERIFICATION_STATUS_LABELS,
  adjustOfficerEligibility,
  confirmBatch,
  discardBatch,
  fetchBatch,
  fetchBatches,
  fetchEligibilityGaps,
  fetchEligibilityStatus,
  fetchOfficerEligibility,
  fetchPeriods,
  isException,
  officerGapLabel,
  uploadEligibility,
  type EligibilityGapPage,
  type EligibilityRationType,
  type ImportBatch,
  type ImportPreviewRow,
  type ImportStatus,
  type OfficerEligibilityGap,
} from '../lib/api/rik-eligibility-api';
import { fetchOfficers, type Officer } from '../lib/api/rik-officers-api';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
import {
  AddPanel,
  ConfigError,
  ConfigNotice,
  ConfigTable,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  SelectInput,
  Td,
  TextInput,
  Th,
} from '../design-system/ConfigUI';

/**
 * Eligibility — RIK administration (STEP 15B Phase B).
 *
 * Eligible days are the FACILITY's figure, not the officer's. They arrive as
 * a spreadsheet of three columns — name, mobile number, eligible days — and
 * this screen is the only way they enter e-Samagri.
 *
 * THE WORKFLOW IS THE SAFETY, AND IT IS VISIBLE
 *
 *   upload → validate → map → PREVIEW → confirm → apply → audit
 *
 * Upload and confirm are two separate actions on two separate requests. The
 * preview below is a statement of what WOULD happen; until Confirm is
 * pressed, not one officer's eligible days have moved, and the screen says so
 * in those words. A reviewer therefore sees every exception BEFORE anything
 * is applied, which is the entire point of the exercise.
 *
 * WHAT THIS SCREEN DOES NOT DO
 *
 *   It does not choose the period from the file. The sheet has no period
 *   column on purpose; the administrator picks the period here, so a
 *   spreadsheet cannot quietly target a month nobody selected.
 *
 *   It does not create officers. An unrecognised mobile number is an
 *   exception to be looked at, never a new record — a typo would otherwise
 *   become a person.
 *
 *   It does not match loosely. A name is compared after trimming and
 *   collapsing spaces, ignoring case, and that is all; anything else is a
 *   NAME_MISMATCH for a human to settle. There is no fuzzy matching anywhere
 *   in this path.
 *
 *   It does not edit a figure in the preview. The sheet is the facility's
 *   statement of fact; correcting it here would make the screen the source of
 *   truth. The exception path for a single officer is the panel at the foot of
 *   the page, and it demands a reason.
 *
 *   It does not overwrite. A second upload for the same period is a second
 *   tracked batch with its own reference, and the previous figures stay
 *   visible in each officer's history.
 */
export function EligibilityImportPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const periods = useResource(() => fetchPeriods(), []);
  const batches = useResource(() => fetchBatches(25), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const openBatch = async (batchId: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setBatch(await fetchBatch(batchId));
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (action: 'confirm' | 'discard') => {
    if (!batch) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const next = action === 'confirm' ? await confirmBatch(batch.batchId) : await discardBatch(batch.batchId);
      setBatch(next);
      // A batch from before migration 0066 carries no ration type, and the
      // sentence falls back to exactly the wording it had then rather than
      // saying "for undefined eligibility".
      const figure = next.rationType ? ` for ${RATION_TYPE_LABELS[next.rationType].toLowerCase()} eligibility` : '';
      setNotice(
        action === 'confirm'
          ? `${next.batchRef} applied. ${next.totals.applied} officer${
              next.totals.applied === 1 ? '' : 's'
            } changed${figure}; every change is recorded with its previous value.`
          : `${next.batchRef} discarded. Nothing was applied.`
      );
      reload();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Eligibility</h1>
        <p className="mt-1 text-sm text-slate-600">
          Eligible days come from the facility's spreadsheet — name, mobile number and eligible days. Choose the
          period here, upload the sheet, read the preview, then confirm. Nothing changes until you confirm.
        </p>
      </div>

      {periods.status === 'loading' ? <LoadingState label="Loading periods…" /> : null}
      {periods.status === 'error' ? <FailureState error={periods.error} onRetry={reload} /> : null}
      {periods.status === 'not_implemented' ? (
        <EmptyState title="Eligibility import is not available yet." />
      ) : null}

      {periods.status === 'success' ? (
        periods.data.items.length === 0 ? (
          <EmptyState
            title="No entitlement period exists yet"
            description="An eligibility sheet applies to a period, so a period has to exist before one can be imported."
          />
        ) : (
          <UploadPanel
            periods={periods.data.items}
            // The status panel re-reads whenever a batch is applied or
            // discarded, so "Dry: not uploaded" turns into "Dry: uploaded"
            // without the administrator reloading the page.
            statusKey={reloadKey}
            onUploaded={(uploaded) => {
              setBatch(uploaded);
              const figure = uploaded.rationType
                ? ` as ${RATION_TYPE_LABELS[uploaded.rationType].toLowerCase()} eligibility`
                : '';
              setNotice(
                `${uploaded.batchRef} read${figure}: ${uploaded.totals.rows} row${
                  uploaded.totals.rows === 1 ? '' : 's'
                }. Nothing has been applied — review the preview below and confirm.`
              );
              reload();
            }}
          />
        )
      ) : null}

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={error} />

      {batch ? (
        <BatchPreview batch={batch} busy={busy} onDecide={(action) => void decide(action)} />
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-slate-900">Previous imports</h2>
        <p className="text-sm text-slate-600">
          Every upload is kept, including a corrected sheet for a period already imported. A repeated import is a
          new batch with its own reference — it never overwrites the first one silently.
        </p>

        {batches.status === 'loading' ? <LoadingState label="Loading imports…" /> : null}
        {batches.status === 'error' ? <FailureState error={batches.error} onRetry={reload} /> : null}
        {batches.status === 'success' ? (
          batches.data.items.length === 0 ? (
            <EmptyState
              title="No eligibility sheet has been imported yet"
              description="Upload the facility's spreadsheet above to see what it would change."
            />
          ) : (
            <ConfigTable
              caption="Eligibility import batches"
              head={
                <>
                  <Th>Reference</Th>
                  <Th>Period</Th>
                  <Th>Figure</Th>
                  <Th>File</Th>
                  <Th>Rows</Th>
                  <Th>Changed</Th>
                  <Th>Exceptions</Th>
                  <Th>Status</Th>
                  <Th>Uploaded</Th>
                  <Th>Action</Th>
                </>
              }
            >
              {batches.data.items.map((b) => (
                <tr key={b.batchId} className="border-b border-slate-100 last:border-0">
                  <Td>
                    <span className="font-mono text-sm font-bold text-slate-900">{b.batchRef}</span>
                  </Td>
                  <Td>{b.periodName}</Td>
                  <Td>
                    {/* 'Legacy' for a batch uploaded before migration 0066. */}
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      {b.rationType ? RATION_TYPE_LABELS[b.rationType] : 'Legacy'}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-600">{b.fileName}</span>
                  </Td>
                  <Td numeric>{b.totals.rows}</Td>
                  <Td numeric>{b.status === 'APPLIED' ? b.totals.applied : b.totals.changed}</Td>
                  <Td numeric>{b.totals.exceptions}</Td>
                  <Td>
                    <StatusBadge status={b.status} />
                  </Td>
                  <Td>
                    <span className="text-xs tabular-nums text-slate-600">{b.uploadedAt.slice(0, 10)}</span>
                  </Td>
                  <Td>
                    <SecondaryButton disabled={busy} onClick={() => void openBatch(b.batchId)}>
                      {b.status === 'PENDING_REVIEW' ? 'Review' : 'View'}
                    </SecondaryButton>
                  </Td>
                </tr>
              ))}
            </ConfigTable>
          )
        ) : null}
      </section>

      <OfficerAdjustmentPanel
        periods={periods.status === 'success' ? periods.data.items : []}
        onAdjusted={reload}
      />
    </div>
  );
}

// ------------------------------------------------------------------ upload

function UploadPanel({
  periods,
  onUploaded,
  statusKey,
}: {
  periods: ReadonlyArray<{ periodId: string; name: string; startDate: string; endDate: string }>;
  onUploaded: (batch: ImportBatch) => void;
  /** Bumped by the page after a confirm, so the status panel re-reads. */
  statusKey: number;
}) {
  const [periodId, setPeriodId] = useState('');
  /**
   * Which figure this sheet applies to.
   *
   * FRESH is PRE-SELECTED, and the selection is stated on the button in words
   * rather than left to colour alone. This is a default for the QUESTION, not
   * for anybody's eligibility: no officer's days are defaulted anywhere, and
   * the sheet is applied only to the figure named here and confirmed again in
   * the preview header.
   */
  const [rationType, setRationType] = useState<EligibilityRationType>('FRESH');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files && event.target.files.length > 0 ? event.target.files[0]! : null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || periodId === '') return;
    setError(null);
    setBusy(true);
    try {
      onUploaded(await uploadEligibility(periodId, file, rationType));
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-bold text-slate-900">Upload an eligibility sheet</h2>

      <FieldLabel label="Period" hint="The sheet carries no period column — this is the period it applies to.">
        <SelectInput
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          required
          aria-label="Period"
        >
          <option value="">Choose a period…</option>
          {periods.map((p) => (
            <option key={p.periodId} value={p.periodId}>
              {p.name} ({p.startDate} → {p.endDate})
            </option>
          ))}
        </SelectInput>
      </FieldLabel>

      <RationTypeChoice value={rationType} onChange={setRationType} />

      {periodId === '' ? null : <EligibilityStatusPanel periodId={periodId} reloadKey={statusKey} />}

      <FieldLabel
        label="Eligibility workbook"
        hint="A .xlsx file with Name, Mobile Number and Eligible Days. Macro-enabled workbooks are not accepted."
      >
        {/*
          No `required` attribute: the Upload button stays disabled until a
          file is actually chosen, which states the same requirement without
          relying on native file-input validation — and the server validates
          the bytes regardless, which is the check that counts.
        */}
        <input
          type="file"
          accept=".xlsx"
          onChange={onFile}
          aria-label="Eligibility workbook"
          className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700"
        />
      </FieldLabel>

      <ConfigError error={error} />

      <p className="text-xs text-slate-500">
        Uploading reads the sheet and shows what it would change. It applies nothing.
      </p>

      <div>
        <PrimaryButton disabled={busy || !file || periodId === ''}>
          {busy
            ? 'Reading the sheet…'
            : `Upload and preview ${RATION_TYPE_LABELS[rationType].toLowerCase()} eligibility`}
        </PrimaryButton>
      </div>
    </form>
  );
}

/**
 * The FRESH and DRY buttons.
 *
 * Radio inputs, not <button>s. The choice is one of two mutually exclusive
 * values that travels with the form, which is exactly what a radio group is;
 * building it from buttons would mean reimplementing arrow-key navigation and
 * the grouping a screen reader announces, and getting one of them wrong.
 *
 * The selected one is marked THREE ways — the border, the filled dot, and the
 * word "Selected" — because a staff member who confirms a Dry sheet believing
 * it is Fresh has moved the wrong figure for every officer in the file, and
 * colour alone fails anyone reading a monochrome screen or a printout.
 */
function RationTypeChoice({
  value,
  onChange,
  name = 'rationType',
  hint = 'The sheet does not say whether it is fresh or dry eligibility — you do. The figures are kept separately, and uploading one never changes the other.',
}: {
  value: EligibilityRationType;
  onChange: (next: EligibilityRationType) => void;
  /** Distinct per instance, so two groups on one screen never share state. */
  name?: string;
  hint?: string;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">Eligibility type</legend>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {RATION_TYPES.map((type) => {
          const selected = value === type;
          return (
            <label
              key={type}
              className={`flex min-h-touch flex-1 cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 ${
                selected
                  ? 'border-brand-blue bg-brand-blue/5'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={type}
                checked={selected}
                onChange={() => onChange(type)}
                aria-label={`${RATION_TYPE_LABELS[type]} eligibility`}
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold uppercase tracking-wide text-slate-900">
                  {RATION_TYPE_LABELS[type]}
                </span>
                <span className="text-xs text-slate-500">
                  maximum {RATION_TYPE_MAX_DAYS[type]} days
                </span>
              </span>
              {selected ? (
                <span className="ml-auto text-xs font-bold uppercase text-brand-blue">Selected</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The three figures a single-officer correction can move.
 *
 * `LEGACY_FIGURE` is a UI-only sentinel. It never reaches the server: the
 * request simply OMITS `rationType`, which is how the server is told to use
 * the legacy figure. Modelling it as a sentinel rather than as `undefined` in
 * component state is deliberate — `undefined` in a radio group is indistin-
 * guishable from "nothing chosen yet", and this choice always has an answer.
 */
const LEGACY_FIGURE = 'LEGACY' as const;
type AdjustmentFigure = typeof LEGACY_FIGURE | EligibilityRationType;

/**
 * Which of an officer's three figures a correction moves.
 *
 * SEPARATE FROM `RationTypeChoice` ON PURPOSE. The upload must offer exactly
 * two choices — a sheet is always Fresh or Dry — and generalising one control
 * to serve both would put the upload's correctness at the mercy of a change
 * made for this panel. The two also read differently: the legacy option has no
 * day maximum to state, because the legacy column still permits up to 366.
 *
 * The labels are distinct from the upload's, so that a query for "Fresh
 * eligibility" can never match the wrong panel when both are open.
 */
function AdjustmentFigureChoice({
  value,
  onChange,
}: {
  value: AdjustmentFigure;
  onChange: (next: AdjustmentFigure) => void;
}) {
  const options: ReadonlyArray<{
    value: AdjustmentFigure;
    label: string;
    detail: string;
    aria: string;
  }> = [
    {
      value: LEGACY_FIGURE,
      label: 'Current entitlement figure',
      detail: 'This is the figure your entitlement is calculated from.',
      aria: 'Adjust the current entitlement figure',
    },
    {
      value: 'FRESH',
      label: 'Fresh eligibility',
      detail: `maximum ${RATION_TYPE_MAX_DAYS.FRESH} days`,
      aria: 'Adjust fresh eligibility',
    },
    {
      value: 'DRY',
      label: 'Dry eligibility',
      detail: `maximum ${RATION_TYPE_MAX_DAYS.DRY} days`,
      aria: 'Adjust dry eligibility',
    },
  ];

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">Which figure to correct</legend>
      <p className="mb-2 text-xs text-slate-500">
        An officer holds three figures for a period. This correction moves only the one chosen
        here; the other two are untouched.
      </p>
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={`flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 ${
                selected
                  ? 'border-brand-blue bg-brand-blue/5'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="adjustmentFigure"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                aria-label={option.aria}
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold text-slate-900">{option.label}</span>
                <span className="text-xs text-slate-500">{option.detail}</span>
              </span>
              {selected ? (
                <span className="ml-auto text-xs font-bold uppercase text-brand-blue">Selected</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Whether this period's two sheets have been published.
 *
 * A type with nothing uploaded is SAID so, in words, with a line explaining
 * what that means for officers. The alternative — showing nothing — reads as
 * "finished" or as a loading failure, and a period whose Dry sheet never
 * arrived has to be impossible to miss.
 *
 * Renders nothing at all while loading or on failure. This panel is an aid,
 * never a gate: a status read that fails must not stop an administrator
 * uploading a sheet, and must not make the upload form look broken.
 */
function EligibilityStatusPanel({ periodId, reloadKey }: { periodId: string; reloadKey: number }) {
  const status = useResource(() => fetchEligibilityStatus(periodId), [periodId, reloadKey]);
  if (status.status !== 'success') return null;

  const missing = status.data.items.filter((s) => !s.uploaded);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-800">Upload status for this period</p>
      <ul className="mt-2 flex flex-col gap-2">
        {status.data.items.map((s) => (
          <li key={s.rationType} className="text-sm">
            <span className="inline-block w-16 font-bold uppercase tracking-wide text-slate-900">
              {RATION_TYPE_LABELS[s.rationType]}
            </span>
            {s.uploaded ? (
              <>
                <span className="font-semibold text-brand-greenDark">
                  {s.status === 'APPLIED'
                    ? 'Uploaded'
                    : s.status === 'PENDING_REVIEW'
                      ? 'Awaiting review'
                      : 'Discarded'}
                </span>
                {s.batchRef ? (
                  <span className="ml-2 font-mono text-xs text-slate-500">{s.batchRef}</span>
                ) : null}
                {s.uploadedAt ? (
                  <span className="ml-2 text-xs tabular-nums text-slate-500">{s.uploadedAt}</span>
                ) : null}
                {s.totals ? (
                  <span className="ml-2 text-xs text-slate-600">
                    {s.totals.rows} row{s.totals.rows === 1 ? '' : 's'} · {s.totals.applied} applied ·{' '}
                    {s.totals.exceptions} exception{s.totals.exceptions === 1 ? '' : 's'}
                  </span>
                ) : null}
                <span className="ml-2 text-xs text-slate-600">
                  {s.officersWithValue} officer{s.officersWithValue === 1 ? '' : 's'} with a figure
                </span>
              </>
            ) : (
              <span className="font-semibold text-brand-amberDark">Not uploaded</span>
            )}
          </li>
        ))}
      </ul>

      {missing.length > 0 ? (
        <p className="mt-2 text-xs font-semibold text-brand-amberDark">
          {missing.map((s) => RATION_TYPE_LABELS[s.rationType]).join(' and ')} eligibility has not been
          uploaded for this period. Officers cannot draw that ration until it is uploaded, and are shown
          "not yet published" for it — never zero days.
        </p>
      ) : null}

      {/*
       * THE SENTENCE THAT USED TO BE HERE SAID THE OPPOSITE.
       *
       * Until the Fresh/Dry change, it read that entitlement quantities were
       * "still calculated from the existing single eligibility figure". That
       * is no longer true, and a false sentence on the screen staff act from
       * is worse than no sentence, so it was corrected rather than left for
       * someone to notice.
       */}
      <p className="mt-2 text-xs text-slate-500">
        These Fresh and Dry figures are what entitlement quantities are now calculated from: a Fresh
        category is scaled by the Fresh figure and a Dry category by the Dry figure. The two are
        separate — never added together, and never transferred between categories. Bread is issued on
        a Fresh day but belongs to the Dry cereals category, so it is scaled by the Dry figure.
      </p>

      <OfficerGapList periodId={periodId} reloadKey={reloadKey} />
    </div>
  );
}

/**
 * WHICH OFFICERS ARE MISSING A FIGURE, BY NAME.
 *
 * The panel above answers "did the sheet arrive". That stopped being enough
 * once eligible days actually drive the calculation: an applied Fresh sheet
 * with nine officers left out of it reads as "Fresh: Uploaded" while nine
 * officers cannot draw their Fresh ration at all. This lists them, with their
 * RIK ID, the period, each figure, and what to do about it.
 *
 * EXTENDED INTO THE EXISTING PANEL rather than built as a screen of its own:
 * a staff member who has just uploaded a sheet is already looking here, and a
 * second screen would be a second place to remember.
 *
 * Renders nothing while loading or on failure, like the panel it sits in —
 * this is an aid, never a gate on uploading a sheet.
 *
 * IT DOES NOT CLAIM MORE THAN THE SERVER ESTABLISHED. "Not in the latest
 * sheet" appears only where an applied batch for that ration type exists and
 * does not contain the officer. Otherwise the wording is the generic
 * "verification required", because no sheet exists for them to be absent
 * from. Every label comes from VERIFICATION_STATUS_LABELS and officerGapLabel
 * so this component decides none of it.
 */
function OfficerGapList({ periodId, reloadKey }: { periodId: string; reloadKey: number }) {
  const gaps = useResource<EligibilityGapPage>(
    () => fetchEligibilityGaps(periodId),
    [periodId, reloadKey]
  );
  if (gaps.status !== 'success') return null;

  const { totals, items, truncated } = gaps.data;

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="text-sm font-semibold text-slate-800">
        Officer eligibility ·{' '}
        <span className="tabular-nums">
          {totals.complete} of {totals.officers}
        </span>{' '}
        complete
      </p>

      {items.length === 0 ? (
        <p className="mt-1 text-xs text-brand-greenDark">
          Every officer has a Fresh and a Dry figure above zero for this period.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs font-semibold text-brand-amberDark">
            <span className="tabular-nums">{totals.needsAttention}</span> officer
            {totals.needsAttention === 1 ? '' : 's'} need attention before this period&rsquo;s issue
            windows open.
          </p>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead>
                <tr className="text-slate-600">
                  <th className="py-1 pr-3 font-semibold">RIK ID</th>
                  <th className="py-1 pr-3 font-semibold">Officer</th>
                  {RATION_TYPES.map((t) => (
                    <th key={t} className="py-1 pr-3 font-semibold">
                      {RATION_TYPE_LABELS[t]}
                    </th>
                  ))}
                  <th className="py-1 pr-3 font-semibold">Status</th>
                  <th className="py-1 font-semibold">Action required</th>
                </tr>
              </thead>
              <tbody>
                {items.map((officer) => (
                  <OfficerGapRow key={officer.customerId} officer={officer} />
                ))}
              </tbody>
            </table>
          </div>

          {truncated ? (
            <p className="mt-2 text-xs font-semibold text-brand-amberDark">
              Showing the first <span className="tabular-nums">{items.length}</span> of{' '}
              <span className="tabular-nums">{totals.needsAttention}</span>. The list is cut short
              here, not the count — use the officer search for the rest.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function OfficerGapRow({ officer }: { officer: OfficerEligibilityGap }) {
  const summary = officerGapLabel(officer);

  // The action to show is the first one that has one, in Fresh-then-Dry
  // order — the same order the columns are in, so the sentence matches the
  // column a reader's eye has just left.
  const action = officer.byRationType
    .map((t) => VERIFICATION_STATUS_LABELS[t.status].action)
    .find((a) => a !== null);

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="py-1 pr-3 font-mono text-slate-700">{officer.rikId}</td>
      <td className="py-1 pr-3 text-slate-900">
        {officer.name}
        {officer.officialName ? (
          <span className="block text-slate-500">{officer.officialName}</span>
        ) : null}
      </td>
      {officer.byRationType.map((t) => (
        <td key={t.rationType} className="py-1 pr-3">
          {/*
           * A PUBLISHED ZERO AND A MISSING FIGURE ARE WRITTEN DIFFERENTLY.
           * "0 days" is a figure the facility published. "—" with the status
           * beside it is the absence of one. They are never the same cell.
           */}
          <span className="tabular-nums font-semibold text-slate-900">
            {t.days === null ? '—' : `${t.days} day${t.days === 1 ? '' : 's'}`}
          </span>
          <span
            className={[
              'block',
              t.status === 'PUBLISHED' ? 'text-brand-greenDark' : 'text-brand-amberDark',
            ].join(' ')}
          >
            {VERIFICATION_STATUS_LABELS[t.status].label}
          </span>
        </td>
      ))}
      <td className="py-1 pr-3 font-semibold text-brand-amberDark">{summary}</td>
      <td className="py-1 text-slate-600">{action ?? ''}</td>
    </tr>
  );
}

// ----------------------------------------------------------------- preview

function StatusBadge({ status }: { status: ImportStatus }) {
  const label =
    status === 'PENDING_REVIEW' ? 'Awaiting review' : status === 'APPLIED' ? 'Applied' : 'Discarded';
  const tone =
    status === 'PENDING_REVIEW'
      ? 'bg-brand-amberLight text-brand-amberDark'
      : status === 'APPLIED'
        ? 'bg-brand-greenLight text-brand-greenDark'
        : 'bg-slate-100 text-slate-600';
  return <span className={['rounded px-2 py-0.5 text-xs font-bold', tone].join(' ')}>{label}</span>;
}

function OutcomeBadge({ row }: { row: ImportPreviewRow }) {
  const exception = isException(row.outcome);
  const tone = exception
    ? 'bg-semantic-dangerLight text-semantic-danger'
    : row.outcome === 'MATCHED_CHANGED'
      ? 'bg-brand-greenLight text-brand-greenDark'
      : 'bg-slate-100 text-slate-600';
  return (
    <span className={['rounded px-2 py-0.5 text-xs font-semibold', tone].join(' ')}>
      {OUTCOME_LABELS[row.outcome]}
    </span>
  );
}

function BatchPreview({
  batch,
  busy,
  onDecide,
}: {
  batch: ImportBatch;
  busy: boolean;
  onDecide: (action: 'confirm' | 'discard') => void;
}) {
  const pending = batch.status === 'PENDING_REVIEW';

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">
          <span className="font-mono">{batch.batchRef}</span> — {batch.periodName}
          {/*
            The ration type is RESTATED HERE on purpose. A reviewer who
            confirms a dry sheet believing it is fresh has moved the wrong
            figure for every officer in the file, and the only defence against
            that is for the preview itself to name which figure it will move.
          */}
          {batch.rationType ? (
            <span className="ml-2 rounded bg-brand-blue/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-blue">
              {RATION_TYPE_LABELS[batch.rationType]} eligibility
            </span>
          ) : null}
        </h2>
        <StatusBadge status={batch.status} />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
        <Total label="Rows" value={batch.totals.rows} />
        <Total label="Will change" value={batch.totals.changed} />
        <Total label="No change" value={batch.totals.noChange} />
        <Total label="Exceptions" value={batch.totals.exceptions} />
        <Total label="Applied" value={batch.totals.applied} />
      </dl>

      <p className="text-sm text-slate-600">
        {pending ? (
          <>
            <strong className="font-semibold text-slate-800">Nothing has been applied yet.</strong> These are the
            changes this sheet would make. Exception rows are never applied — settle them with the facility, or
            adjust a single officer below with a reason.
          </>
        ) : batch.status === 'APPLIED' ? (
          <>
            Applied. Each changed officer has an adjustment recording the previous value, the change and who made
            it. Exception rows were not applied.
          </>
        ) : (
          <>Discarded. This sheet was not applied, and the record of it is kept.</>
        )}
      </p>

      <ConfigTable
        caption={`Preview of ${batch.batchRef}`}
        head={
          <>
            <Th>Sheet row</Th>
            <Th>RIK ID</Th>
            <Th>Officer (system)</Th>
            <Th>Name in sheet</Th>
            <Th>Mobile</Th>
            <Th>Previous days</Th>
            <Th>Sheet days</Th>
            <Th>Delta</Th>
            <Th>Result</Th>
            <Th>Why</Th>
          </>
        }
      >
        {batch.rows.map((row) => (
          <tr key={row.rowId} className="border-b border-slate-100 last:border-0">
            <Td numeric>{row.sheetRow}</Td>
            <Td>
              {row.rikId ? (
                <span className="font-mono text-xs font-bold text-slate-900">{row.rikId}</span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </Td>
            <Td>
              {row.systemOfficialName ?? row.systemName ?? <span className="text-xs text-slate-400">—</span>}
            </Td>
            <Td>{row.excelName === '' ? <span className="text-xs text-slate-400">blank</span> : row.excelName}</Td>
            <Td>
              <span className="font-mono text-xs text-slate-700">
                {row.normalisedMobile ?? row.excelMobile}
              </span>
            </Td>
            <Td numeric>{row.previousEligibleDays ?? '—'}</Td>
            <Td numeric>
              {row.importedEligibleDays ?? (
                // The raw cell, so "7.5" or "abc" is shown as the sheet had it
                // rather than as a blank the reviewer cannot act on.
                <span className="text-xs text-semantic-danger">
                  {row.excelEligibleDays === '' ? 'blank' : row.excelEligibleDays}
                </span>
              )}
            </Td>
            <Td numeric>
              {row.delta === null ? '—' : row.delta > 0 ? `+${row.delta}` : String(row.delta)}
            </Td>
            <Td>
              <OutcomeBadge row={row} />
            </Td>
            <Td>
              {row.outcome === 'NAME_MISMATCH' && row.systemName ? (
                <span className="text-xs text-slate-600">
                  Sheet says “{row.excelName}”, record says “{row.systemOfficialName ?? row.systemName}”.
                </span>
              ) : (
                <span className="text-xs text-slate-600">{row.exceptionReason ?? '—'}</span>
              )}
            </Td>
          </tr>
        ))}
      </ConfigTable>

      {pending ? (
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton
            type="button"
            disabled={busy || batch.totals.changed === 0}
            onClick={() => onDecide('confirm')}
          >
            {busy ? 'Applying…' : `Confirm and apply ${batch.totals.changed} change${batch.totals.changed === 1 ? '' : 's'}`}
          </PrimaryButton>
          <SecondaryButton disabled={busy} onClick={() => onDecide('discard')}>
            Discard this sheet
          </SecondaryButton>
          {batch.totals.changed === 0 ? (
            <span className="text-xs text-slate-500">
              This sheet changes nothing, so there is nothing to apply.
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

// -------------------------------------------------------- one officer, by hand

/**
 * The exception path (STEP 15B Phase B, requirement 10).
 *
 * An import cannot settle every case: a mobile number the facility has wrong,
 * a name that genuinely differs, a correction agreed by telephone. This panel
 * changes ONE officer's eligible days for ONE period and will not proceed
 * without a reason — the reason, the previous value, the change, the staff
 * member and the moment are all recorded together, because an unexplained
 * change is the thing this whole phase exists to make impossible.
 */
function OfficerAdjustmentPanel({
  periods,
  onAdjusted,
}: {
  periods: ReadonlyArray<{ periodId: string; name: string }>;
  onAdjusted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Officer[] | null>(null);
  const [officer, setOfficer] = useState<Officer | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const [periodId, setPeriodId] = useState('');
  /**
   * Which of the officer's THREE figures this correction moves.
   *
   * Defaults to LEGACY — the figure the entitlement engine calculates from,
   * and the one this panel has corrected since it was built. The default is
   * not a convenience: it keeps the screen doing what the facility already
   * relies on it for, and makes correcting one of the two new figures a
   * deliberate choice rather than the accident of a changed default.
   */
  const [figure, setFigure] = useState<AdjustmentFigure>(LEGACY_FIGURE);
  const [eligibleDays, setEligibleDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const find = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const page = await fetchOfficers({ q: search });
      setResults(page.items);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!officer) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await adjustOfficerEligibility(officer.officerId, {
        periodId,
        // THE KEY IS OMITTED ENTIRELY for the legacy figure, not sent as
        // undefined. The request then carries no `rationType` at all, the
        // server stores NULL, and migration 0066's legacy trigger branch
        // writes `eligible_days` exactly as it did before any of this.
        ...(figure === LEGACY_FIGURE ? {} : { rationType: figure }),
        // Passed through as typed: the SERVER decides whether 7.5 or -1 is
        // acceptable and says why. Rounding it here would hide the rule.
        eligibleDays: Number(eligibleDays),
        reason,
      });
      setNotice(
        // The legacy sentence is the original one, unchanged, so that the
        // screen reads as it always has when the legacy figure is corrected.
        `${officer.rikId}${
          figure === LEGACY_FIGURE ? '' : ` ${RATION_TYPE_LABELS[figure].toLowerCase()}`
        }: ${result.previousEligibleDays} → ${result.newEligibleDays} (${
          result.delta > 0 ? `+${result.delta}` : result.delta
        }). Recorded with your name and the reason.`
      );
      setEligibleDays('');
      setReason('');
      setHistoryKey((k) => k + 1);
      onAdjusted();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AddPanel title="Adjust one officer's eligible days" open={open} onToggle={() => setOpen((v) => !v)}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          For the cases a sheet cannot settle. The officer never sees or edits this figure, and every change is
          recorded with its reason.
        </p>

        <form onSubmit={find} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <FieldLabel label="Find the officer">
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="RIK ID, name or mobile"
                aria-label="Find the officer"
              />
            </FieldLabel>
          </div>
          <PrimaryButton disabled={busy}>Search</PrimaryButton>
        </form>

        {results !== null && officer === null ? (
          results.length === 0 ? (
            <p className="text-sm text-slate-600">No officer matches that. An import never creates one.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.slice(0, 10).map((o) => (
                <li key={o.officerId}>
                  <button
                    type="button"
                    onClick={() => setOfficer(o)}
                    className="min-h-touch w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-mono font-bold text-slate-900">{o.rikId}</span>{' '}
                    <span className="text-slate-700">{o.officialName ?? o.name}</span>{' '}
                    <span className="font-mono text-xs text-slate-500">{o.mobileNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {officer ? (
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">
                <span className="font-mono">{officer.rikId}</span> {officer.officialName ?? officer.name}
              </p>
              <SecondaryButton
                onClick={() => {
                  setOfficer(null);
                  setNotice(null);
                  setError(null);
                }}
              >
                Choose another
              </SecondaryButton>
            </div>

            <OfficerEligibilityHistory officerId={officer.officerId} reloadKey={historyKey} />

            <form onSubmit={submit} className="flex flex-col gap-3">
              <FieldLabel label="Period">
                <SelectInput
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                  required
                  aria-label="Adjustment period"
                >
                  <option value="">Choose a period…</option>
                  {periods.map((p) => (
                    <option key={p.periodId} value={p.periodId}>
                      {p.name}
                    </option>
                  ))}
                </SelectInput>
              </FieldLabel>

              <AdjustmentFigureChoice value={figure} onChange={setFigure} />

              <FieldLabel
                label="Eligible days"
                hint={
                  figure === LEGACY_FIGURE
                    ? 'A whole number. Zero is allowed — an officer with no eligible days is a real statement.'
                    : `A whole number, at most ${RATION_TYPE_MAX_DAYS[figure]} for ${RATION_TYPE_LABELS[
                        figure
                      ].toLowerCase()}. Zero is allowed — an officer with no eligible days is a real statement.`
                }
              >
                <TextInput
                  value={eligibleDays}
                  onChange={(e) => setEligibleDays(e.target.value)}
                  inputMode="numeric"
                  required
                  aria-label="Eligible days"
                />
              </FieldLabel>

              <FieldLabel label="Reason" hint="Recorded against the change. Required.">
                <TextInput
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  required
                  aria-label="Reason"
                />
              </FieldLabel>

              <ConfigNotice>{notice}</ConfigNotice>
              <ConfigError error={error} />

              <div>
                <PrimaryButton disabled={busy || periodId === '' || eligibleDays.trim() === '' || reason.trim() === ''}>
                  {busy ? 'Recording…' : 'Record the adjustment'}
                </PrimaryButton>
              </div>
            </form>
          </div>
        ) : null}

        {officer === null ? <ConfigError error={error} /> : null}
      </div>
    </AddPanel>
  );
}

function OfficerEligibilityHistory({ officerId, reloadKey }: { officerId: string; reloadKey: number }) {
  const eligibility = useResource(() => fetchOfficerEligibility(officerId), [officerId, reloadKey]);

  if (eligibility.status === 'loading') return <LoadingState label="Loading eligibility…" />;
  if (eligibility.status === 'error') return <FailureState error={eligibility.error} />;
  if (eligibility.status === 'not_implemented') return null;

  const { periods, history } = eligibility.data;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-700">
        {periods.length === 0
          ? 'No eligible days are recorded for this officer yet.'
          : periods
              .map((p) =>
                p.eligibleDays === null
                  ? `${p.periodName}: no legacy figure`
                  : `${p.periodName}: ${p.eligibleDays} day${p.eligibleDays === 1 ? '' : 's'}`
              )
              .join(' · ')}
      </p>

      {/*
        The two new figures, listed separately from the line above.
        "Not published" is spelled out rather than shown as a dash or a zero:
        an officer whose dry sheet has not arrived has no dry figure, which is
        a different statement from having nought days, and staff need to see
        which one they are looking at.
      */}
      {periods.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-slate-600">
          {periods.map((p) => (
            <li key={p.periodId}>
              <span className="font-semibold text-slate-700">{p.periodName}</span>
              {' — fresh: '}
              <span className="tabular-nums">
                {p.freshEligibleDays === null ? 'not published' : `${p.freshEligibleDays} days`}
              </span>
              {' · dry: '}
              <span className="tabular-nums">
                {p.dryEligibleDays === null ? 'not published' : `${p.dryEligibleDays} days`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {history.length > 0 ? (
        <ConfigTable
          caption="Eligibility history"
          head={
            <>
              <Th>When</Th>
              <Th>Period</Th>
              <Th>Figure</Th>
              <Th>Previous</Th>
              <Th>Change</Th>
              <Th>New</Th>
              <Th>Reason</Th>
              <Th>Source</Th>
              <Th>By</Th>
            </>
          }
        >
          {history.map((h) => (
            <tr key={h.adjustmentId} className="border-b border-slate-100 last:border-0">
              <Td>
                <span className="text-xs tabular-nums text-slate-600">{h.createdAt.slice(0, 10)}</span>
              </Td>
              <Td>{h.periodName}</Td>
              <Td>
                <span className="text-xs text-slate-600">
                  {h.rationType ? RATION_TYPE_LABELS[h.rationType] : 'Legacy'}
                </span>
              </Td>
              <Td numeric>{h.previousEligibleDays}</Td>
              <Td numeric>{h.delta > 0 ? `+${h.delta}` : String(h.delta)}</Td>
              <Td numeric>{h.newEligibleDays}</Td>
              <Td>
                <span className="text-xs text-slate-600">{h.reason}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-600">
                  {h.source === 'IMPORT' ? (h.batchRef ?? 'Import') : 'By hand'}
                </span>
              </Td>
              <Td>
                <span className="text-xs text-slate-600">{h.staffName ?? '—'}</span>
              </Td>
            </tr>
          ))}
        </ConfigTable>
      ) : null}
    </div>
  );
}
