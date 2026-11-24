import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../lib/api/resource';
import { fetchPeriods, type EntitlementPeriodOption } from '../lib/api/rik-eligibility-api';
import {
  ALL_STATUSES,
  dateLabel,
  fetchIssueVoucher,
  fetchIssueVoucherHistory,
  fetchIssueVouchers,
  countNoun,
  countedQuantityLabel,
  downloadIssueVoucherExport,
  quantityLabel,
  statusLabel,
  type FulfillmentMode,
  type IssueVoucherSummary,
  type RationType,
  type VoucherSearchFilters,
  type VoucherStatus,
} from '../lib/api/rik-issue-vouchers-api';
import { ApiError } from '../lib/api/client';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
import {
  ConfigError,
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
 * Issue vouchers — RIK operations (PHASE D).
 *
 * The operational list the yard works from: find a voucher, then read exactly
 * what is to be issued against it.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT HAVE
 *
 *   No collection, no delivery, no "mark as done", no substitution, no
 *   quantity edit, no delete. Those are the physical fulfilment actions, and
 *   this phase does not implement them — so there is no button here that
 *   would quietly do nothing, and no form that would post to a route that
 *   does not exist. The application cannot change a voucher at all: migration
 *   0048 leaves it SELECT and INSERT on the voucher table and nothing else.
 *
 * WHAT IT SHOWS, AND WHERE EACH FIGURE COMES FROM
 *
 *   Every number on the detail panel is the server's, recalculated from the
 *   confirmed selection's own frozen rule snapshot. This screen does no
 *   arithmetic: it does not multiply a quantity by a ratio, total a pool or
 *   decide which issue window is current. A later catalogue change therefore
 *   cannot move a figure shown here, because nothing here consults the
 *   catalogue.
 *
 *   A Fresh voucher carries NO window of its own — the same voucher runs
 *   through Fresh Windows 1, 2 and 3 — so the panel lists every configured
 *   window and marks the one containing today. Change the schedule and this
 *   follows it, with no reissue and the same voucher number.
 *
 * Mobile first: the filters stack into one column on a phone, the table
 * scrolls sideways rather than squashing, and the detail panel is readable at
 * phone width.
 */

const PAGE_SIZE = 25;

export function IssueVouchersPage() {
  const periods = useResource(() => fetchPeriods(), []);

  const [draft, setDraft] = useState<VoucherSearchFilters>({});
  const [applied, setApplied] = useState<VoucherSearchFilters>({});
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const vouchers = useResource(
    () => fetchIssueVouchers({ ...applied, limit: PAGE_SIZE, offset }),
    [applied, offset]
  );

  const search = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      setOffset(0);
      setOpenId(null);
      setApplied(draft);
    },
    [draft]
  );

  const update = (patch: Partial<VoucherSearchFilters>) => setDraft((d) => ({ ...d, ...patch }));

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Download the five-sheet workbook for the filters CURRENTLY APPLIED —
   * `applied`, not `draft`, so the file matches the rows on screen rather
   * than half-typed filter boxes.
   *
   * A refusal (too many vouchers, or a voucher whose frozen snapshot cannot
   * be replayed) arrives as an ApiError before any bytes are written, so
   * the operator gets the SERVER'S OWN SENTENCE — which names the count and
   * the limit, or the offending voucher number — rather than a generic
   * failure this screen invented.
   */
  const exportWorkbook = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await downloadIssueVoucherExport(applied);
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename ?? 'rik-issue-vouchers.xlsx';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        // Revoked on a later tick: revoking synchronously can cancel the
        // download in some browsers before it has read the blob.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (err) {
      setExportError(
        err instanceof ApiError
          ? err.message
          : 'The export could not be produced. Try again, or narrow the filters.'
      );
    } finally {
      setExporting(false);
    }
  }, [applied]);

  return (
    <div className="flex flex-col gap-5">
      <div data-print="hide">
        <h1 className="text-lg font-bold text-slate-900">Issue vouchers</h1>
        <p className="mt-1 text-sm text-slate-600">
          The operational document for a confirmed monthly selection: one Fresh voucher and one Dry
          voucher per selection, each carrying the ration exactly as it was confirmed. Creating or
          reading a voucher changes no entitlement.
        </p>
      </div>

      <form
        onSubmit={search}
        data-print="hide"
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <FieldLabel
          label="Search"
          hint="Voucher number, RIK ID, officer name, mobile number or selection reference."
        >
          <TextInput
            value={draft.q ?? ''}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="IV-… / RIK-O-… / name / mobile"
            aria-label="Search vouchers"
          />
        </FieldLabel>

        <FieldLabel label="Ration" hint="Fresh and Dry are issued on different schedules.">
          <SelectInput
            value={draft.rationType ?? ''}
            onChange={(e) => update({ rationType: e.target.value as RationType | '' })}
            aria-label="Ration type"
          >
            <option value="">All rations</option>
            <option value="FRESH">Fresh</option>
            <option value="DRY">Dry</option>
          </SelectInput>
        </FieldLabel>

        <FieldLabel label="Fulfilment" hint="As the officer confirmed it.">
          <SelectInput
            value={draft.fulfillmentMode ?? ''}
            onChange={(e) => update({ fulfillmentMode: e.target.value as FulfillmentMode | '' })}
            aria-label="Fulfilment mode"
          >
            <option value="">Pickup and delivery</option>
            <option value="PICKUP">Pickup</option>
            <option value="DELIVERY">Delivery</option>
          </SelectInput>
        </FieldLabel>

        <FieldLabel label="Status">
          <SelectInput
            value={draft.status ?? ''}
            onChange={(e) => update({ status: e.target.value as VoucherStatus | '' })}
            aria-label="Status"
          >
            <option value="">Any status</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>

        <FieldLabel label="Period">
          <SelectInput
            value={draft.periodId ?? ''}
            onChange={(e) => update({ periodId: e.target.value })}
            aria-label="Period"
          >
            <option value="">Every period</option>
            {periods.status === 'success'
              ? periods.data.items.map((p: EntitlementPeriodOption) => (
                  <option key={p.periodId} value={p.periodId}>
                    {p.name}
                  </option>
                ))
              : null}
          </SelectInput>
        </FieldLabel>

        <div className="flex items-end gap-2">
          <PrimaryButton type="submit">Search</PrimaryButton>
          <SecondaryButton
            type="button"
            onClick={() => {
              setDraft({});
              setApplied({});
              setOffset(0);
              setOpenId(null);
            }}
          >
            Clear
          </SecondaryButton>
        </div>
      </form>

      {/*
        The operational workbook. Outside the form on purpose: it must not be
        submitted by Enter, and it exports the APPLIED filters, which are not
        necessarily what is currently typed into the boxes above.
      */}
      <div data-print="hide" className="flex flex-wrap items-center gap-3">
        <SecondaryButton type="button" onClick={exportWorkbook} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Export to Excel'}
        </SecondaryButton>
        <p className="text-xs text-slate-500">
          Five sheets for the filters applied above: register, home delivery, store pickup,
          provision totals and the delivery manifest.
        </p>
        {exportError === null ? null : (
          <p role="alert" className="w-full text-sm font-semibold text-semantic-danger">
            {exportError}
          </p>
        )}
      </div>

      {vouchers.status === 'loading' ? <LoadingState label="Loading vouchers…" /> : null}
      {vouchers.status === 'error' ? (
        <FailureState error={vouchers.error} onRetry={() => setApplied({ ...applied })} />
      ) : null}
      {vouchers.status === 'not_implemented' ? (
        <EmptyState title="Issue vouchers are not available yet." />
      ) : null}

      {vouchers.status === 'success' ? (
        vouchers.data.items.length === 0 ? (
          <EmptyState
            title="No voucher matches"
            description="A voucher exists once a confirmed monthly selection has been issued against. Widen the search, or clear the filters."
          />
        ) : (
          // Wrapped so the whole result region carries one print marker:
          // the list is chrome when a single voucher is being printed.
          <div data-print="hide" className="flex flex-col gap-5">
            <p className="text-sm text-slate-600">
              Showing {vouchers.data.items.length} of {vouchers.data.total}
            </p>

            <ConfigTable
              caption="Issue vouchers"
              head={
                <>
                  <Th>Voucher</Th>
                  <Th>Officer</Th>
                  <Th>Ration</Th>
                  <Th>Fulfilment</Th>
                  <Th>Status</Th>
                  <Th>Period</Th>
                  <Th>Action</Th>
                </>
              }
            >
              {vouchers.data.items.map((v: IssueVoucherSummary) => (
                <tr key={v.voucherId} className="border-b border-slate-100 last:border-0">
                  <Td>
                    <p className="font-semibold tabular-nums text-slate-800">{v.voucherNumber}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Selection {v.selectionReference ?? '—'} · issued {dateLabel(v.issueDate)}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-slate-800">{v.officerName ?? '—'}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                      {v.rikId ?? '—'}
                      {v.mobileNumber ? ` · ${v.mobileNumber}` : ''}
                    </p>
                  </Td>
                  <Td>{v.rationType === 'FRESH' ? 'Fresh' : 'Dry'}</Td>
                  <Td>{v.fulfillmentMode === 'PICKUP' ? 'Pickup' : 'Delivery'}</Td>
                  <Td>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {statusLabel(v.status)}
                    </span>
                  </Td>
                  <Td>{v.periodName}</Td>
                  <Td>
                    <SecondaryButton
                      onClick={() => setOpenId(openId === v.voucherId ? null : v.voucherId)}
                    >
                      {openId === v.voucherId ? 'Close' : 'View'}
                    </SecondaryButton>
                  </Td>
                </tr>
              ))}
            </ConfigTable>

            <div className="flex items-center justify-between gap-3">
              <SecondaryButton
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </SecondaryButton>
              <SecondaryButton
                type="button"
                disabled={offset + vouchers.data.items.length >= vouchers.data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </SecondaryButton>
            </div>
          </div>
        )
      ) : null}

      {openId === null ? null : <VoucherDetailPanel voucherId={openId} />}
    </div>
  );
}

/**
 * One voucher in full, for staff.
 *
 * Reads the detail route rather than reusing the list row, because the list
 * deliberately carries only what a list needs: the ration, the pool
 * arithmetic, the configured windows and the issuing staff member are on the
 * detail route alone.
 */
function VoucherDetailPanel({ voucherId }: { voucherId: string }) {
  const detail = useResource(() => fetchIssueVoucher(voucherId), [voucherId]);
  const [showHistory, setShowHistory] = useState(false);

  if (detail.status === 'loading') return <LoadingState label="Loading the voucher…" />;
  if (detail.status === 'error') return <ConfigError error={detail.error} />;
  if (detail.status === 'not_implemented') {
    return <EmptyState title="This voucher cannot be shown." />;
  }

  const v = detail.data;
  const residence = v.officer.residence;

  return (
    <section
      data-print="sheet"
      aria-label={`Issue voucher ${v.voucherNumber}`}
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            e-SAMAGRI · Issue voucher
          </p>
          <h2 className="text-base font-bold tabular-nums text-slate-900">{v.voucherNumber}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {v.rationType === 'FRESH' ? 'Fresh ration' : 'Dry ration'} ·{' '}
            {v.fulfillmentMode === 'PICKUP' ? 'Pickup' : 'Delivery'} · {statusLabel(v.status)}
          </p>
          {/*
            On paper only. The screen already shows the period beside the
            voucher; a printed sheet that leaves the counter needs it in the
            heading, where someone filing it will look.
          */}
          <p className="print-only mt-1 text-sm">
            {v.period.name} · issued {dateLabel(v.issueDate)}
          </p>
        </div>
        <div data-print="hide" className="flex flex-wrap gap-2">
          {/*
            PRINTING MAKES NO REQUEST. It hands the already-loaded panel to
            the browser's print dialog — so it cannot record an outcome,
            move a status or write anything, and "print must not change
            fulfilment status" holds by construction rather than by care.
          */}
          <SecondaryButton type="button" onClick={() => window.print()}>
            Print voucher
          </SecondaryButton>
          <SecondaryButton type="button" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? 'Hide history' : 'History'}
          </SecondaryButton>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Detail label="Officer">
          {v.officer.officialName ?? v.officer.name ?? '—'}
          <span className="block text-xs tabular-nums text-slate-500">
            {v.officer.rikId ?? '—'}
            {v.officer.mobileNumber ? ` · ${v.officer.mobileNumber}` : ''}
          </span>
        </Detail>
        <Detail label="Quarter">
          {residence === null
            ? '—'
            : [residence.quarterBlock, residence.quarterNumber].filter(Boolean).join('-') || '—'}
          {residence?.landmark ? (
            <span className="block text-xs text-slate-500">{residence.landmark}</span>
          ) : null}
        </Detail>
        <Detail label="Period">
          {v.period.name}
          <span className="block text-xs tabular-nums text-slate-500">
            {dateLabel(v.period.startDate)} → {dateLabel(v.period.endDate)}
          </span>
        </Detail>
        <Detail label="Issue date">{dateLabel(v.issueDate)}</Detail>
        <Detail label={v.fulfillment.mode === 'PICKUP' ? 'Pickup location' : 'Delivery address'}>
          {v.fulfillment.mode === 'PICKUP'
            ? (v.fulfillment.pickupLocationName ?? '—')
            : (v.fulfillment.deliveryAddress ?? '—')}
        </Detail>
        <Detail label="Issued by">{v.issuedBy.name ?? '—'}</Detail>
      </dl>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Issue window</h3>
        {v.windows.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">
            No window is configured for this ration type in this period.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {v.windows.map((w) => (
              <li
                key={w.windowCode}
                className={[
                  'rounded-lg border px-3 py-2 text-sm',
                  w.windowCode === v.currentWindowCode
                    ? 'border-brand-green bg-brand-greenLight text-brand-greenDark'
                    : 'border-slate-200 text-slate-700',
                ].join(' ')}
              >
                <span className="font-semibold">{w.label}</span>{' '}
                <span className="tabular-nums">
                  {dateLabel(w.startDate)} → {dateLabel(w.endDate)}
                </span>
                {w.windowCode === v.currentWindowCode ? (
                  <span className="ml-2 text-xs font-semibold uppercase">Current</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {v.rationType === 'FRESH' ? (
          <p className="mt-2 text-xs text-slate-500">
            One Fresh voucher runs through every Fresh window. It is not reissued per window and its
            number does not change.
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Entitlement source</h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
          {v.sourceComponents.map((c) => (
            <li key={`${c.kind}-${c.periodId}`} className="tabular-nums">
              <span className="font-semibold">{c.periodName}</span> · {c.eligibleDays} eligible days
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Ration to issue</h3>
        {v.pools.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Nothing of this ration type was selected.</p>
        ) : (
          v.pools.map((pool) => (
            <div key={pool.poolCode} className="mt-3">
              <p className="text-sm font-semibold text-slate-700">
                {pool.poolName}{' '}
                <span className="font-normal tabular-nums text-slate-500">
                  entitlement {quantityLabel(pool.totalEntitlement, pool.unit)} ·{' '}
                  {pool.eligibleDays} days
                </span>
              </p>
              <ConfigTable
                caption={`${pool.poolName} lines`}
                head={
                  <>
                    <Th>Provision</Th>
                    <Th>Variety</Th>
                    <Th>Pack</Th>
                    <Th>To issue</Th>
                    <Th>Pool equivalent</Th>
                  </>
                }
              >
                {pool.lines.map((line) => (
                  <tr key={line.provisionId} className="border-b border-slate-100 last:border-0">
                    <Td>
                      <p className="text-slate-800">{line.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{line.code}</p>
                    </Td>
                    <Td>{line.brand ?? '—'}</Td>
                    <Td>
                      {countNoun(line) !== null
                        ? `Each ${countNoun(line)} ${quantityLabel(line.consumptionRatio, pool.unit)}`
                        : line.packSize === null
                          ? 'Loose'
                          : quantityLabel(line.packSize, line.packUnit ?? line.unit)}
                    </Td>
                    <Td numeric>{countedQuantityLabel(line, line.quantityToIssue)}</Td>
                    <Td numeric>{quantityLabel(line.poolEquivalentQty, pool.unit)}</Td>
                  </tr>
                ))}
              </ConfigTable>
            </div>
          ))
        )}
        <p data-print="hide" className="mt-2 text-xs text-slate-500">
          Substitution and the physical collection or delivery record are not part of this phase.
        </p>
      </div>

      {/*
        THE PAPER FOOTER. Two signature lines and a date, on the printed
        sheet only.

        They are blank rules, not fields: this phase records no collection
        and no delivery, and the application cannot write a fulfilment
        outcome from here at all. Signing the paper is exactly what it looks
        like — a paper record — and nothing on it is read back into the
        system.
      */}
      <div className="print-only print-keep mt-6 border-t border-black pt-4 text-sm">
        <div className="flex justify-between gap-8">
          <div className="w-1/2">
            <p className="mb-8">Issued by</p>
            <p className="border-t border-black pt-1">Name, signature and date</p>
          </div>
          <div className="w-1/2">
            <p className="mb-8">
              Received by ({v.fulfillment.mode === 'PICKUP' ? 'officer / nominee' : 'officer'})
            </p>
            <p className="border-t border-black pt-1">Name, signature and date</p>
          </div>
        </div>
        <p className="mt-4 text-xs">
          Voucher {v.voucherNumber} · {v.period.name} ·{' '}
          {v.rationType === 'FRESH' ? 'Fresh ration' : 'Dry ration'} ·{' '}
          {v.fulfillmentMode === 'PICKUP' ? 'Store pickup' : 'Home delivery'}
        </p>
      </div>

      {/* The audit trail is for staff, not for the sheet an officer signs. */}
      {showHistory ? (
        <div data-print="hide">
          <VoucherHistory voucherId={voucherId} />
        </div>
      ) : null}
    </section>
  );
}

function VoucherHistory({ voucherId }: { voucherId: string }) {
  const history = useResource(() => fetchIssueVoucherHistory(voucherId), [voucherId]);

  if (history.status === 'loading') return <LoadingState label="Loading history…" />;
  if (history.status === 'error') return <ConfigError error={history.error} />;
  if (history.status === 'not_implemented') return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">History</h3>
      {history.data.items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">No recorded event.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {history.data.items.map((entry) => (
            <li key={entry.entryId} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <p className="font-semibold text-slate-800">{entry.action}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {entry.at.slice(0, 10)}
                {entry.actorName ? ` · ${entry.actorName}` : ''}
                {entry.actorRole ? ` · ${entry.actorRole}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        From the facility&rsquo;s existing audit log. Phase D added no second audit trail.
      </p>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}
