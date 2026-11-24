import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  ConfigError,
  ConfigNotice,
  ConfigTable,
  PrimaryButton,
  SecondaryButton,
  SelectInput,
  Td,
  Th,
} from '../../design-system/ConfigUI';
import {
  applyImport,
  discardImport,
  downloadImportTemplate,
  fetchImportBatches,
  fetchImportRows,
  previewImport,
  rupees,
  IMPORT_STATUS_LABELS,
  VERDICT_LABELS,
  type ImportBatch,
  type ImportPreview,
  type ImportRow,
} from '../../lib/api/pif-admin-api';

/**
 * Bulk product import, in the operator's own order of work
 * (LAUNCH PREPARATION).
 *
 * THE SCREEN FOLLOWS THE SAFE SEQUENCE, and cannot be used out of order:
 *
 *   1. Download the template, fill it in, save it as .xlsx or .csv.
 *   2. Upload it. This shows what WOULD happen — every row, with its
 *      verdict and, where there is one, its problem in plain words. Nothing
 *      has been written to the shop at this point, and the screen says so.
 *   3. Either apply it, or throw it away. Both are one deliberate click,
 *      and either one can only be done once.
 *
 * WHAT THIS SCREEN IS CAREFUL TO SAY OUT LOUD, because an import is the one
 * action here that can change hundreds of rows at once:
 *
 *   * A row whose SKU already exists UPDATES that product, and only the
 *     columns the file contains are changed.
 *   * Nothing is ever deleted or taken off sale by an import.
 *   * A category or GST rate named in the file must already exist in the
 *     portal — and when it does not, this screen lists exactly which ones,
 *     so the next step is obvious.
 *
 * No arithmetic happens here. The verdicts, the counts and the problems are
 * all the server's, read and displayed.
 */
export function PifProductImportPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const batches = useResource<{ items: ImportBatch[] }>(() => fetchImportBatches(20), [reloadKey]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const fileInput = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [rowFilter, setRowFilter] = useState<'ALL' | 'CREATE' | 'UPDATE' | 'INVALID'>('ALL');
  const [busy, setBusy] = useState<null | 'upload' | 'apply' | 'discard' | 'template'>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRows = async (batchId: string, filter: typeof rowFilter) => {
    const page = await fetchImportRows(batchId, {
      verdict: filter === 'ALL' ? undefined : filter,
      limit: 300,
    });
    setRows(page.items);
  };

  const onTemplate = async () => {
    setError(null);
    setBusy('template');
    try {
      const { blob, filename } = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? 'esamagri-products-template.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setError(null);
    setNotice(null);
    setBusy('upload');
    try {
      const result = await previewImport(file);
      setPreview(result);
      setRowFilter('ALL');
      await loadRows(result.batch.id, 'ALL');
      reload();
    } catch (err) {
      setError(err);
      setPreview(null);
      setRows([]);
    } finally {
      setBusy(null);
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const onFilter = async (filter: typeof rowFilter) => {
    setRowFilter(filter);
    if (preview === null) return;
    try {
      await loadRows(preview.batch.id, filter);
    } catch (err) {
      setError(err);
    }
  };

  const onApply = async () => {
    if (preview === null) return;
    setError(null);
    setBusy('apply');
    try {
      const result = await applyImport(preview.batch.id);
      setPreview({ ...preview, batch: result.batch });
      setNotice(
        `${result.batch.appliedRows} product${result.batch.appliedRows === 1 ? '' : 's'} written to the catalogue — ${result.batch.createRows} new, ${result.batch.updateRows} updated.`
      );
      await loadRows(preview.batch.id, rowFilter);
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const onDiscard = async () => {
    if (preview === null) return;
    setError(null);
    setBusy('discard');
    try {
      const result = await discardImport(preview.batch.id);
      setPreview({ ...preview, batch: result.batch });
      setNotice('That file was thrown away. Nothing was written to the catalogue.');
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const awaitingDecision = preview !== null && preview.batch.status === 'PREVIEW';
  const applicable = preview === null ? 0 : preview.batch.createRows + preview.batch.updateRows;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Import products from a spreadsheet</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload your own Excel or CSV file, check what it would do, then apply it. Nothing is
          written to the shop until you press Apply.
        </p>
      </header>

      {notice ? <ConfigNotice>{notice}</ConfigNotice> : null}
      {error ? <ConfigError error={error} /> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">1 · Start from the template</h2>
        <p className="mt-1 text-sm text-slate-600">
          The template has the exact column headings this screen understands, and a second sheet
          explaining each one. Your own file works too, as long as it has SKU and Name columns.
        </p>
        <div className="mt-3">
          <SecondaryButton type="button" onClick={() => void onTemplate()} disabled={busy !== null}>
            {busy === 'template' ? 'Preparing…' : 'Download the template (.xlsx)'}
          </SecondaryButton>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">2 · Upload it to see what it would do</h2>
        <p className="mt-1 text-sm text-slate-600">
          Create your categories and GST rates in the portal first — a file that names one which
          does not exist will tell you so rather than invent it.
        </p>
        <div className="mt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => void onFile(event)}
              disabled={busy !== null}
            />
            {busy === 'upload' ? 'Reading the file…' : 'Choose a file…'}
          </label>
        </div>
      </section>

      {preview === null ? null : (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            3 · {preview.batch.filename}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {IMPORT_STATUS_LABELS[preview.batch.status] ?? preview.batch.status} ·{' '}
            {preview.batch.totalRows} row{preview.batch.totalRows === 1 ? '' : 's'} read
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="New products" value={preview.batch.createRows} />
            <Figure label="Updates" value={preview.batch.updateRows} />
            <Figure label="Problems" value={preview.batch.invalidRows} tone="warn" />
            <Figure label="Written so far" value={preview.batch.appliedRows} />
          </dl>

          {awaitingDecision ? (
            <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Nothing has been written to the shop yet. Rows marked <strong>Cannot be imported</strong>{' '}
              will be skipped; the other {applicable} will be written.
            </p>
          ) : null}

          {preview.batch.failureReason === null ? null : (
            <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
              {preview.batch.failureReason}
            </p>
          )}

          {preview.missingCategories.length === 0 ? null : (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold">
                Create these categories first, then upload the file again:
              </p>
              <ul className="mt-1 list-inside list-disc">
                {preview.missingCategories.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.unknownTaxRates.length === 0 ? null : (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold">
                These GST rates are not configured: {preview.unknownTaxRates.join('%, ')}%.
              </p>
              <p className="mt-1">Add them under Tax rates, or correct the file.</p>
            </div>
          )}

          {preview.ignoredColumns.length === 0 ? null : (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold">Columns in your file that were not imported:</p>
              <ul className="mt-1 space-y-1">
                {preview.ignoredColumns.map((column) => (
                  <li key={column.heading}>
                    <strong>{column.heading}</strong> — {column.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.unknownColumns.length === 0 ? null : (
            <p className="mt-3 text-sm text-slate-600">
              Headings not recognised and ignored: {preview.unknownColumns.join(', ')}.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PrimaryButton
              type="button"
              onClick={() => void onApply()}
              disabled={!awaitingDecision || busy !== null || applicable === 0}
            >
              {busy === 'apply' ? 'Writing…' : `Apply ${applicable} row${applicable === 1 ? '' : 's'}`}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              onClick={() => void onDiscard()}
              disabled={!awaitingDecision || busy !== null}
            >
              Throw this file away
            </SecondaryButton>
            <SelectInput
              value={rowFilter}
              onChange={(event) => void onFilter(event.target.value as typeof rowFilter)}
              aria-label="Which rows to show"
            >
              <option value="ALL">Show every row</option>
              <option value="INVALID">Only the problems</option>
              <option value="CREATE">Only new products</option>
              <option value="UPDATE">Only updates</option>
            </SelectInput>
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No rows to show for that filter.</p>
          ) : (
            <div className="mt-4">
              <ConfigTable
                caption="Rows in the uploaded file"
                head={
                  <>
                    <Th>Row</Th>
                    <Th>SKU</Th>
                    <Th>Name</Th>
                    <Th>Price</Th>
                    <Th>What will happen</Th>
                  </>
                }
              >
                {rows.map((row) => (
                  <tr key={row.id} className={row.verdict === 'INVALID' ? 'bg-red-50' : ''}>
                    <Td numeric>{row.rowNo}</Td>
                    <Td>{row.sku ?? '—'}</Td>
                    <Td>{row.name ?? '—'}</Td>
                    <Td numeric>{row.sellingPrice === null ? '—' : rupees(row.sellingPrice)}</Td>
                    <Td>
                      <span className={row.verdict === 'INVALID' ? 'font-semibold text-red-800' : ''}>
                        {VERDICT_LABELS[row.verdict] ?? row.verdict}
                      </span>
                      {row.appliedAt === null ? null : (
                        <span className="block text-xs text-slate-500">Written</span>
                      )}
                      {row.problems.length === 0 ? null : (
                        <ul className="mt-1 list-inside list-disc text-xs text-red-800">
                          {row.problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                      )}
                    </Td>
                  </tr>
                ))}
              </ConfigTable>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Recent imports</h2>
        {batches.status === 'loading' ? <LoadingState label="Loading imports…" /> : null}
        {batches.status === 'error' ? (
          <FailureState error={batches.error} onRetry={reload} />
        ) : null}
        {batches.status === 'not_implemented' ? (
          <EmptyState title="Not available" description="The product import route is not available." />
        ) : null}
        {batches.status === 'success' ? (
          batches.data.items.length === 0 ? (
            <EmptyState
              title="No imports yet"
              description="Download the template above to make your first one."
            />
          ) : (
            <ConfigTable
              caption="Recent product imports"
              head={
                <>
                  <Th>File</Th>
                  <Th>Uploaded</Th>
                  <Th>By</Th>
                  <Th>Rows</Th>
                  <Th>Outcome</Th>
                </>
              }
            >
              {batches.data.items.map((batch) => (
                <tr key={batch.id}>
                  <Td>
                    <span className="font-medium">{batch.filename}</span>
                    <span className="block text-xs text-slate-500">{batch.format}</span>
                  </Td>
                  <Td>{new Date(batch.uploadedAt).toLocaleString('en-IN')}</Td>
                  <Td>{batch.uploadedBy ?? '—'}</Td>
                  <Td numeric>{batch.totalRows}</Td>
                  <Td>
                    {IMPORT_STATUS_LABELS[batch.status] ?? batch.status}
                    <span className="block text-xs text-slate-500">
                      {batch.appliedRows} written · {batch.invalidRows} with problems
                      {batch.decidedBy === null ? '' : ` · ${batch.decidedBy}`}
                    </span>
                  </Td>
                </tr>
              ))}
            </ConfigTable>
          )
        ) : null}
      </section>

      <p className="text-xs leading-relaxed text-slate-500">
        An import only creates and updates products. It never deletes one, never takes one off
        sale, and never touches ration entitlements. A product you leave out of the file is left
        exactly as it is. There is no stock column: “Available = No” is how something is taken off
        sale for the day.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className={`mt-1 text-lg font-bold ${
          tone === 'warn' && value > 0 ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
