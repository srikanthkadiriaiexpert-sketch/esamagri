import { useCallback, useMemo, useState } from 'react';
import { useResource } from '../lib/api/resource';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';
import {
  fetchAdminView,
  fetchCounterView,
  nextSteps,
  outcomeLabel,
  countedQuantityLabel,
  quantityLabel,
  recordDelivery,
  recordPickup,
  reverseCompletion,
  settleLapse,
  type CounterView,
  type FulfillmentOutcome,
  type IssueLineInput,
  type SubstitutionGroup,
} from '../lib/api/rik-fulfillment-api';
import {
  fetchIssueVouchers,
  statusLabel,
  type IssueVoucherSummary,
} from '../lib/api/rik-issue-vouchers-api';
import { downloadCsv, timestampForFilename } from '../lib/export/csv';
import {
  MAX_EXPORT_ROWS,
  buildLineCsv,
  buildVoucherCsv,
  collectFilteredVouchers,
  collectSelectedLines,
} from '../lib/export/fulfilment-export';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
import {
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
 * RIK fulfilment — the counter screen (PHASE E).
 *
 * WHAT THIS SCREEN IS FOR: a staff member has an officer in front of them
 * (or a delivery to record) and needs to say what actually happened and what
 * was actually handed over.
 *
 * WHAT IT WILL NOT LET THEM DO
 *
 *   It offers only the steps the locked lane allows from the voucher's
 *   current status, so a delivery cannot be recorded before it has gone out
 *   and a collected voucher offers no second collection. The server refuses
 *   the rest in any case — this screen simply does not pretend otherwise.
 *
 *   A completed voucher has NO edit, NO delete and NO undo. It has a
 *   correction, which asks for a reason, and which leaves the original
 *   completion in the history where it belongs.
 *
 *   A substitution can only be chosen from the alternatives the SERVER
 *   offers for that line's own entitlement, and the equivalent quantity is
 *   the server's figure. Nothing here invents a conversion.
 */
export function FulfillmentPage() {
  const { session } = useStaffAuth();
  const canManage = session?.permissions.includes('rik.order.manage') ?? false;
  const canCount = session?.permissions.includes('rik.order.mark_collected') ?? false;

  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Ticked rows, by voucher id. Cleared whenever the filter changes. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState<'all' | 'selected' | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);

  const vouchers = useResource(
    () =>
      fetchIssueVouchers({
        q: applied === '' ? undefined : applied,
        issuedFrom: appliedFrom === '' ? undefined : appliedFrom,
        issuedTo: appliedTo === '' ? undefined : appliedTo,
        limit: 25,
      }),
    [applied, appliedFrom, appliedTo, reloadKey]
  );

  const pageItems: IssueVoucherSummary[] =
    vouchers.status === 'success' ? vouchers.data.items : [];

  /**
   * The filter the export must reproduce. It is the APPLIED filter, not what is
   * currently typed in the boxes: exporting something the operator can't see on
   * screen is how a report ends up disagreeing with the screen it came from.
   */
  const exportFilters = useMemo(
    () => ({
      q: applied === '' ? undefined : applied,
      issuedFrom: appliedFrom === '' ? undefined : appliedFrom,
      issuedTo: appliedTo === '' ? undefined : appliedTo,
    }),
    [applied, appliedFrom, appliedTo]
  );

  const rangeInverted = fromDate !== '' && toDate !== '' && fromDate > toDate;
  const selectedOnPage = pageItems.filter((v) => selected.has(v.voucherId));
  const allOnPageSelected = pageItems.length > 0 && selectedOnPage.length === pageItems.length;

  const toggleOne = (voucherId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(voucherId)) next.delete(voucherId);
      else next.add(voucherId);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) for (const v of pageItems) next.delete(v.voucherId);
      else for (const v of pageItems) next.add(v.voucherId);
      return next;
    });
  };

  /**
   * Every voucher the filter matches, one row each, from the list endpoint
   * alone. Voucher-level only: issued provisions are not in that response, so
   * claiming them here would mean inventing them.
   */
  const exportAllFiltered = async () => {
    setExporting('all');
    setExportError(null);
    setExportNote(null);
    try {
      const result = await collectFilteredVouchers(fetchIssueVouchers, exportFilters);
      downloadCsv(
        `rik-fulfilment-vouchers-${timestampForFilename()}.csv`,
        buildVoucherCsv(result.vouchers)
      );
      setExportNote(
        result.vouchers.length === 0
          ? 'No voucher matched the filter. The file contains the column headings only.'
          : result.truncated
            ? `Exported the first ${result.vouchers.length} of ${result.total} vouchers (the export stops at ${MAX_EXPORT_ROWS}). Narrow the date range to export the rest.`
            : `Exported ${result.vouchers.length} voucher${result.vouchers.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      setExportError(err);
    } finally {
      setExporting(null);
    }
  };

  /**
   * The ticked rows, with their issued provisions — one row per provision.
   * This costs one request per voucher, which is why it is offered for a
   * selection and not for the whole filter.
   */
  const exportSelectedWithLines = async () => {
    setExporting('selected');
    setExportError(null);
    setExportNote(null);
    try {
      const { rows, failures } = await collectSelectedLines(fetchAdminView, selectedOnPage);
      downloadCsv(
        `rik-fulfilment-lines-${timestampForFilename()}.csv`,
        buildLineCsv(rows)
      );
      const base =
        rows.length === 0
          ? 'Nothing to export. The file contains the column headings only.'
          : `Exported ${rows.length} line${rows.length === 1 ? '' : 's'} from ${selectedOnPage.length - failures.length} voucher${selectedOnPage.length - failures.length === 1 ? '' : 's'}.`;
      setExportNote(
        failures.length === 0
          ? base
          : `${base} ${failures.length} voucher${failures.length === 1 ? '' : 's'} could not be read and ${failures.length === 1 ? 'was' : 'were'} left out: ${failures.map((f) => f.voucherNumber).join(', ')}.`
      );
    } catch (err) {
      setExportError(err);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Fulfilment</h1>
        <p className="mt-1 text-sm text-slate-600">
          Record what was actually handed over, against an issue voucher. Nothing here is inferred:
          a ration counts as issued only because a staff member recorded it.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setOpenId(null);
          setApplied(query);
          setAppliedFrom(fromDate);
          setAppliedTo(toDate);
          // The ticked ids belong to the old result set; keeping them would
          // export rows the operator can no longer see.
          setSelected(new Set());
          setExportNote(null);
          setExportError(null);
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <FieldLabel label="Find the voucher" hint="Voucher number, RIK ID, officer name or mobile.">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="IV-… / RIK-O-… / name"
              aria-label="Find the voucher"
            />
          </FieldLabel>
        </div>
        <div>
          <FieldLabel label="Issued from" hint="The date the voucher was issued.">
            <TextInput
              type="date"
              value={fromDate}
              max={toDate === '' ? undefined : toDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="Issued from"
            />
          </FieldLabel>
        </div>
        <div>
          <FieldLabel label="Issued to" hint="Inclusive.">
            <TextInput
              type="date"
              value={toDate}
              min={fromDate === '' ? undefined : fromDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="Issued to"
            />
          </FieldLabel>
        </div>
        <PrimaryButton type="submit" disabled={rangeInverted}>
          Search
        </PrimaryButton>
        {rangeInverted ? (
          <p className="w-full text-xs font-semibold text-rose-700" data-testid="range-problem">
            The “issued from” date is after the “issued to” date.
          </p>
        ) : null}
      </form>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Export to CSV</p>
            <p className="mt-0.5 text-xs text-slate-600">
              All filtered records export one row per voucher. Ticked records also include the
              provisions and quantities actually issued, one row each. Ticking applies to the
              vouchers listed below.
            </p>
          </div>
          <SecondaryButton
            onClick={exportAllFiltered}
            disabled={exporting !== null || vouchers.status !== 'success'}
          >
            {exporting === 'all' ? 'Exporting…' : 'Export all filtered'}
          </SecondaryButton>
          <SecondaryButton
            onClick={exportSelectedWithLines}
            disabled={exporting !== null || selectedOnPage.length === 0}
          >
            {exporting === 'selected'
              ? 'Exporting…'
              : `Export selected with provisions (${selectedOnPage.length})`}
          </SecondaryButton>
        </div>
      ) : null}

      {exportError !== null ? <ConfigError error={exportError} /> : null}
      {exportNote !== null ? <ConfigNotice>{exportNote}</ConfigNotice> : null}

      {vouchers.status === 'loading' ? <LoadingState label="Loading vouchers…" /> : null}
      {vouchers.status === 'error' ? <FailureState error={vouchers.error} onRetry={reload} /> : null}
      {vouchers.status === 'success' ? (
        vouchers.data.items.length === 0 ? (
          <EmptyState title="No voucher matches" />
        ) : (
          <ConfigTable
            caption="Issue vouchers"
            head={
              <>
                {canManage ? (
                  <Th>
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      aria-label="Select all listed vouchers"
                      className="h-4 w-4"
                    />
                  </Th>
                ) : null}
                <Th>Voucher</Th>
                <Th>Officer</Th>
                <Th>Ration</Th>
                <Th>Fulfilment</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {vouchers.data.items.map((v: IssueVoucherSummary) => (
              <tr key={v.voucherId} className="border-b border-slate-100 last:border-0">
                {canManage ? (
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.has(v.voucherId)}
                      onChange={() => toggleOne(v.voucherId)}
                      aria-label={`Select voucher ${v.voucherNumber}`}
                      className="h-4 w-4"
                    />
                  </Td>
                ) : null}
                <Td>
                  <span className="font-semibold tabular-nums text-slate-800">{v.voucherNumber}</span>
                </Td>
                <Td>
                  <p className="text-slate-800">{v.officerName ?? '—'}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500">{v.rikId ?? '—'}</p>
                </Td>
                <Td>{v.rationType === 'FRESH' ? 'Fresh' : 'Dry'}</Td>
                <Td>{v.fulfillmentMode === 'PICKUP' ? 'Pickup' : 'Delivery'}</Td>
                <Td>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {statusLabel(v.status)}
                  </span>
                </Td>
                <Td>
                  <SecondaryButton onClick={() => setOpenId(openId === v.voucherId ? null : v.voucherId)}>
                    {openId === v.voucherId ? 'Close' : 'Open'}
                  </SecondaryButton>
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}

      {openId === null ? null : (
        <CounterPanel
          voucherId={openId}
          canManage={canManage}
          canCount={canCount}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function CounterPanel({
  voucherId,
  canManage,
  canCount,
  onChanged,
}: {
  voucherId: string;
  canManage: boolean;
  canCount: boolean;
  onChanged: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const view = useResource(
    () => (canCount ? fetchCounterView(voucherId) : fetchAdminView(voucherId)),
    [voucherId, reloadKey, canCount]
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [issue, setIssue] = useState<Record<string, { quantity: string; substituteId: string; reason: string }>>({});

  const refresh = () => {
    setReloadKey((k) => k + 1);
    onChanged();
  };

  if (view.status === 'loading') return <LoadingState label="Loading the voucher…" />;
  if (view.status === 'error') return <ConfigError error={view.error} />;
  if (view.status === 'not_implemented') return <EmptyState title="Fulfilment is not available." />;

  const v: CounterView = view.data;
  const steps = nextSteps(v.status);
  const isPickup = v.fulfillmentMode === 'PICKUP';
  const mayAct = isPickup ? canCount : canManage;

  const lines = (): IssueLineInput[] =>
    v.substitutionOptions.flatMap((group) => {
      const entry = issue[group.originalProvisionId];
      const quantity = Number(entry?.quantity ?? group.originalQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      const substituteId = entry?.substituteId ?? '';
      if (substituteId === '') return [{ provisionId: group.originalProvisionId, quantity }];
      return [
        {
          provisionId: substituteId,
          quantity,
          originalProvisionId: group.originalProvisionId,
          substitutionReason: entry?.reason ?? '',
        },
      ];
    });

  const act = async (outcome: FulfillmentOutcome) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const completing = outcome === 'COLLECTED' || outcome === 'DELIVERED';
      const body = {
        outcome,
        reason: reason.trim() === '' ? undefined : reason.trim(),
        lines: completing ? lines() : undefined,
      };
      const result = isPickup
        ? await recordPickup(voucherId, body as Parameters<typeof recordPickup>[1])
        : await recordDelivery(voucherId, body as Parameters<typeof recordDelivery>[1]);
      setNotice(`${result.voucherNumber} is now ${outcomeLabel(result.status)}.`);
      setReason('');
      refresh();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const correct = async () => {
    if (v.completion === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await reverseCompletion(voucherId, {
        outcomeId: v.completion.outcomeId,
        reason: reason.trim(),
      });
      setNotice(`${result.voucherNumber} was returned to ${outcomeLabel(result.status)} and the correction recorded.`);
      setReason('');
      refresh();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const lapse = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await settleLapse(voucherId);
      setNotice(result.lapsed ? `Lapsed: ${result.reason}` : `Not lapsed: ${result.reason}`);
      refresh();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={`Fulfilment for ${v.voucherNumber}`}
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tabular-nums text-slate-900">{v.voucherNumber}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {v.officer.name ?? '—'} · {v.officer.rikId ?? '—'}
            {v.officer.mobileNumber ? ` · ${v.officer.mobileNumber}` : ''}
          </p>
          <p className="text-sm text-slate-600">
            {v.rationType === 'FRESH' ? 'Fresh' : 'Dry'} ·{' '}
            {isPickup
              ? `Pickup at ${v.destination.pickupLocationName ?? '—'}`
              : `Deliver to ${v.destination.deliveryAddress ?? '—'}`}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
          {outcomeLabel(v.status)}
        </span>
      </header>

      {v.reminderDue ? (
        <p className="rounded-lg border border-brand-amber/30 bg-brand-amberLight px-3 py-2 text-sm text-brand-amberDark">
          {v.finalWindowCode} closes on {v.finalWindowEndDate} — {v.daysToFinalWindowClose} day(s) left.
        </p>
      ) : null}
      {v.lapsed ? (
        <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          The final window closed on {v.finalWindowEndDate}; the unissued ration has lapsed.
        </p>
      ) : null}

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={error} />

      {v.carryForward.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Carried from the previous period</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
            {v.carryForward.map((c) => (
              <li key={c.carryForwardId} className="tabular-nums">
                <span className="font-semibold">{c.poolName}</span> — {quantityLabel(c.remaining, c.unit)} of{' '}
                {quantityLabel(c.quantity, c.unit)} left from {c.sourcePeriodName}
                {c.lapsedAt === null ? '' : ' · lapsed'}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">
            Kept separate from this period&rsquo;s own entitlement, and drawn on first.
          </p>
        </div>
      ) : null}

      {steps.length > 0 && mayAct ? (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-800">What was handed over</h3>
          {v.substitutionOptions.length === 0 ? (
            <p className="text-sm text-slate-500">This voucher has nothing of this ration to issue.</p>
          ) : (
            v.substitutionOptions.map((group: SubstitutionGroup) => {
              const entry = issue[group.originalProvisionId];
              const chosenSubstitute = group.alternatives.find((a) => a.provisionId === entry?.substituteId);
              return (
                <div key={group.originalProvisionId} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {group.originalName}{' '}
                    <span className="font-normal text-slate-500">
                      ({group.poolName}, confirmed {quantityLabel(group.originalQuantity, group.poolUnit)})
                    </span>
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <FieldLabel label="Quantity issued">
                      <TextInput
                        type="number"
                        min="0"
                        step="any"
                        value={entry?.quantity ?? String(group.originalQuantity)}
                        aria-label={`Quantity issued for ${group.originalName}`}
                        onChange={(e) =>
                          setIssue((s) => ({
                            ...s,
                            [group.originalProvisionId]: {
                              quantity: e.target.value,
                              substituteId: s[group.originalProvisionId]?.substituteId ?? '',
                              reason: s[group.originalProvisionId]?.reason ?? '',
                            },
                          }))
                        }
                      />
                    </FieldLabel>
                    <FieldLabel label="Substitute" hint="Only approved alternatives of the same entitlement.">
                      <SelectInput
                        value={entry?.substituteId ?? ''}
                        aria-label={`Substitute for ${group.originalName}`}
                        onChange={(e) =>
                          setIssue((s) => ({
                            ...s,
                            [group.originalProvisionId]: {
                              quantity:
                                e.target.value === ''
                                  ? String(group.originalQuantity)
                                  : String(
                                      group.alternatives.find((a) => a.provisionId === e.target.value)
                                        ?.equivalentQuantity ?? group.originalQuantity
                                    ),
                              substituteId: e.target.value,
                              reason: s[group.originalProvisionId]?.reason ?? '',
                            },
                          }))
                        }
                      >
                        <option value="">Issued as confirmed</option>
                        {group.alternatives.map((a) => (
                          <option key={a.provisionId} value={a.provisionId}>
                            {a.name}
                            {a.brand ? ` (${a.brand})` : ''} — {countedQuantityLabel(a, a.equivalentQuantity)}
                          </option>
                        ))}
                      </SelectInput>
                    </FieldLabel>
                    {chosenSubstitute ? (
                      <FieldLabel label="Why substituted">
                        <TextInput
                          value={entry?.reason ?? ''}
                          aria-label={`Reason for substituting ${group.originalName}`}
                          onChange={(e) =>
                            setIssue((s) => ({
                              ...s,
                              [group.originalProvisionId]: {
                                quantity: s[group.originalProvisionId]?.quantity ?? '',
                                substituteId: s[group.originalProvisionId]?.substituteId ?? '',
                                reason: e.target.value,
                              },
                            }))
                          }
                        />
                      </FieldLabel>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}

          <FieldLabel label="Reason" hint="Required when recording that the ration was not taken.">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          </FieldLabel>

          <div className="flex flex-wrap gap-2">
            {steps.map((step) => (
              <PrimaryButton key={step} disabled={busy} onClick={() => void act(step)}>
                {outcomeLabel(step)}
              </PrimaryButton>
            ))}
          </div>
        </div>
      ) : null}

      {steps.length > 0 && !mayAct ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Your role does not record {isPickup ? 'pickup' : 'delivery'} for RIK vouchers.
        </p>
      ) : null}

      {v.issuedLines.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Actually issued</h3>
          <ConfigTable
            caption="Issued lines"
            head={
              <>
                <Th>Provision</Th>
                <Th>Issued</Th>
                <Th>Pool equivalent</Th>
                <Th>From carry-forward</Th>
                <Th>Substituted for</Th>
              </>
            }
          >
            {v.issuedLines.map((l) => (
              <tr key={l.lineId} className="border-b border-slate-100 last:border-0">
                <Td>
                  <p className="text-slate-800">{l.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{l.poolName}</p>
                </Td>
                <Td numeric>{quantityLabel(l.quantityIssued, l.poolUnit)}</Td>
                <Td numeric>{quantityLabel(l.poolEquivalentQty, l.poolUnit)}</Td>
                <Td numeric>
                  {l.carryForwardQty > 0 ? quantityLabel(l.carryForwardQty, l.poolUnit) : '—'}
                </Td>
                <Td>
                  {l.substitutedFor === null ? (
                    '—'
                  ) : (
                    <span className="text-xs text-slate-600">
                      {l.substitutedFor.name} · {l.substitutedFor.reason}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </ConfigTable>
        </div>
      ) : null}

      {v.completion !== null && canManage ? (
        <div className="rounded-xl border border-semantic-danger/30 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-800">Correction</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            A completed voucher is never edited, deleted or undone. A correction reverses the
            completion with a reason, and the original stays in the history.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <FieldLabel label="Reason for the correction">
                <TextInput
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Reason for the correction"
                />
              </FieldLabel>
            </div>
            <SecondaryButton disabled={busy || reason.trim().length < 5} onClick={() => void correct()}>
              Reverse this completion
            </SecondaryButton>
          </div>
        </div>
      ) : null}

      {v.rationType === 'FRESH' && v.completion === null && canManage ? (
        <div>
          <SecondaryButton disabled={busy} onClick={() => void lapse()}>
            Settle the final-window lapse
          </SecondaryButton>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold text-slate-800">History</h3>
        {v.events.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Nothing has been recorded against this voucher.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {v.events.map((e) => (
              <li
                key={e.outcomeId}
                className={[
                  'rounded-lg border px-3 py-2 text-sm',
                  e.reversed ? 'border-slate-200 text-slate-400 line-through' : 'border-slate-200 text-slate-700',
                ].join(' ')}
              >
                <span className="font-semibold">{outcomeLabel(e.outcome)}</span>
                {e.reason ? ` · ${e.reason}` : ''}
                <span className="block text-xs text-slate-500">
                  {e.recordedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                  {e.recordedBy.name ?? e.recordedBy.role}
                  {e.windowCode ? ` · ${e.windowCode}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
