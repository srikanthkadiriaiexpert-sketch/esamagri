import { useCallback, useMemo, useState } from 'react';
import { useResource } from '../lib/api/resource';
import { ApiError } from '../lib/api/client';
import {
  fetchIncomingRequests,
  fulfillmentLabel,
  residenceLabel,
  type IncomingRequest,
  type IncomingRequestFilters,
  type IncomingRequestPage,
} from '../lib/api/rik-incoming-requests-api';
import { createIssueVoucher, countedQuantityLabel, dateLabel } from '../lib/api/rik-issue-vouchers-api';
import { EmptyState, FailureState, LoadingState, UnauthorizedState } from '../design-system/States';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';

/**
 * Incoming RIK requests (PHASE B).
 *
 * The work queue between a customer confirming their monthly selection and
 * the yard holding an issue voucher for it. One row is one selection AND one
 * ration type, because a voucher is unique per (selection, ration type) — a
 * selection whose Fresh voucher exists and whose Dry voucher does not is
 * half done, and only the outstanding half belongs in a queue.
 *
 * CREATING A VOUCHER HERE USES THE EXISTING ENDPOINT, deliberately. The
 * button calls the same `createIssueVoucher` the Issue vouchers screen
 * calls, so there is one voucher-creation path in the portal and the
 * duplicate rule lives in one place: the server checks for an existing
 * voucher, the INSERT's ON CONFLICT handles a concurrent duplicate, and the
 * unique constraint behind both makes a second voucher impossible. The
 * disabled button below is a courtesy, not the guard — it cannot be, since
 * two administrators may be looking at this screen at once.
 *
 * NO NUMBER ON THIS SCREEN IS INVENTED. Quantities are the customer's own
 * selected quantities; pack sizes are configuration; the total is the
 * server's count under the same filters as the page.
 */

const PAGE_SIZE = 25;

interface FilterState {
  q: string;
  rationType: '' | 'FRESH' | 'DRY';
  fulfillmentMode: '' | 'PICKUP' | 'DELIVERY';
  confirmedFrom: string;
  confirmedTo: string;
}

/**
 * What the resource holds when the staff member may not see this queue.
 * Never rendered — the unauthorized state returns before the list does —
 * and it exists only so the loader has something to resolve with instead
 * of calling the server.
 */
const NO_PAGE: IncomingRequestPage = { items: [], total: 0, limit: 0, offset: 0 };

const EMPTY_FILTERS: FilterState = {
  q: '',
  rationType: '',
  fulfillmentMode: '',
  confirmedFrom: '',
  confirmedTo: '',
};

/** What happened to the last conversion attempt, for the row it happened on. */
type RowOutcome =
  | { kind: 'created'; voucherNumber: string }
  | { kind: 'existed'; voucherNumber: string }
  | { kind: 'failed'; message: string };

export function IncomingRequestsPage() {
  const { can } = useStaffAuth();
  const allowed = can('rik.order.manage');

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});

  const query: IncomingRequestFilters = useMemo(
    () => ({
      q: applied.q,
      rationType: applied.rationType,
      fulfillmentMode: applied.fulfillmentMode,
      confirmedFrom: applied.confirmedFrom,
      confirmedTo: applied.confirmedTo,
      limit: PAGE_SIZE,
      offset,
    }),
    [applied, offset]
  );

  /**
   * NOT FETCHED AT ALL WITHOUT THE PERMISSION.
   *
   * The unauthorized branch is an early return further down, and a hook
   * cannot sit behind one — so without this guard the request would already
   * have been sent by the time the screen decided to refuse. The server
   * would answer 403 and no data would reach anyone, but a staff member who
   * may not see this queue would still have caused a query for officers'
   * names, mobile numbers and home addresses. Asking for nothing is the
   * honest behaviour, and it is pinned by a test.
   */
  const page = useResource<IncomingRequestPage>(
    () => (allowed ? fetchIncomingRequests(query) : Promise.resolve(NO_PAGE)),
    [query, reloadKey, allowed]
  );

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const onApply = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setApplied(filters);
  };

  const onClear = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
  };

  /**
   * Convert one request into its voucher.
   *
   * On success the row leaves the queue, so the list is reloaded rather than
   * patched in place — the server decides what is still outstanding, and a
   * locally spliced list would start disagreeing with it the moment a second
   * administrator worked a row.
   */
  const onCreate = async (request: IncomingRequest) => {
    const key = rowKey(request);
    setBusyRow(key);
    try {
      const voucher = await createIssueVoucher({
        selectionId: request.selectionId,
        rationType: request.rationType,
      });
      setOutcomes((prev) => ({
        ...prev,
        [key]: {
          // `created: false` means someone (or something) got there first and
          // the server handed back the existing voucher. That is a success,
          // not an error, and it is reported as what it is.
          kind: voucher.created ? 'created' : 'existed',
          voucherNumber: voucher.voucherNumber,
        },
      }));
      refresh();
    } catch (err) {
      setOutcomes((prev) => ({
        ...prev,
        [key]: {
          kind: 'failed',
          // The server's own sentence — it explains why far better than
          // anything this screen could compose, e.g. that the selection has
          // no entitlement of this ration type to issue.
          message:
            err instanceof ApiError
              ? err.message
              : 'The voucher could not be created. Try again.',
        },
      }));
    } finally {
      setBusyRow(null);
    }
  };

  if (!allowed) {
    return (
      <section aria-labelledby="incoming-heading">
        <h1 id="incoming-heading" className="text-xl font-bold text-brand-forest">
          Incoming RIK requests
        </h1>
        <div className="mt-4">
          <UnauthorizedState description="Working incoming RIK requests needs the RIK order management permission." />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="incoming-heading">
      <div className="mb-4">
        <h1 id="incoming-heading" className="text-xl font-bold text-brand-forest">
          Incoming RIK requests
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Confirmed customer selections with no issue voucher yet. A request leaves this list as soon
          as its voucher exists.
        </p>
      </div>

      <form onSubmit={onApply} className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="min-w-0 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Search</span>
            <input
              type="search"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="RIK ID, name, mobile or reference"
              className="min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="min-w-0 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Ration type</span>
            <select
              value={filters.rationType}
              onChange={(e) => setFilters((f) => ({ ...f, rationType: e.target.value as FilterState['rationType'] }))}
              className="min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">All</option>
              <option value="FRESH">Fresh</option>
              <option value="DRY">Dry</option>
            </select>
          </label>

          <label className="min-w-0 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Fulfilment</span>
            <select
              value={filters.fulfillmentMode}
              onChange={(e) =>
                setFilters((f) => ({ ...f, fulfillmentMode: e.target.value as FilterState['fulfillmentMode'] }))
              }
              className="min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">All</option>
              <option value="DELIVERY">Home delivery</option>
              <option value="PICKUP">Store pickup</option>
            </select>
          </label>

          <label className="min-w-0 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Confirmed from</span>
            <input
              type="date"
              value={filters.confirmedFrom}
              onChange={(e) => setFilters((f) => ({ ...f, confirmedFrom: e.target.value }))}
              className="min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="min-w-0 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Confirmed to</span>
            <input
              type="date"
              value={filters.confirmedTo}
              onChange={(e) => setFilters((f) => ({ ...f, confirmedTo: e.target.value }))}
              className="min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="min-h-touch rounded-lg bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={onClear}
              className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>
      </form>

      {page.status === 'loading' ? <LoadingState label="Loading incoming requests…" /> : null}
      {page.status === 'error' ? <FailureState error={page.error} onRetry={refresh} /> : null}
      {page.status === 'not_implemented' ? (
        <EmptyState title="Incoming requests are not available yet." />
      ) : null}

      {page.status === 'success' ? (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {page.data.total === 0
              ? 'No requests awaiting a voucher'
              : `${page.data.total} request${page.data.total === 1 ? '' : 's'} awaiting a voucher`}
          </p>

          {page.data.items.length === 0 ? (
            <EmptyState
              title="Nothing is waiting"
              description="Every confirmed selection that matches these filters already has its issue voucher."
            />
          ) : (
            <ul className="flex flex-col gap-3" role="list">
              {page.data.items.map((request) => (
                <li key={rowKey(request)}>
                  <RequestCard
                    request={request}
                    busy={busyRow === rowKey(request)}
                    outcome={outcomes[rowKey(request)]}
                    onCreate={() => onCreate(request)}
                  />
                </li>
              ))}
            </ul>
          )}

          <Pager
            total={page.data.total}
            offset={offset}
            count={page.data.items.length}
            onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            onNext={() => setOffset((o) => o + PAGE_SIZE)}
          />
        </>
      ) : null}
    </section>
  );
}

/** A selection appears twice when both streams are outstanding — key on both. */
function rowKey(request: IncomingRequest): string {
  return `${request.selectionId}:${request.rationType}`;
}

function RequestCard({
  request,
  busy,
  outcome,
  onCreate,
}: {
  request: IncomingRequest;
  busy: boolean;
  outcome: RowOutcome | undefined;
  onCreate: () => void;
}) {
  const residence = residenceLabel(request.officer.residence);
  const isFresh = request.rationType === 'FRESH';

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="min-w-0 break-words text-sm font-bold text-slate-800">
            {request.officer.name}
            <span className="ml-2 font-normal text-slate-500">{request.officer.rikId}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {request.officer.mobileNumber}
            {residence === null ? ' · No address on file' : ` · ${residence}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className={[
              'rounded px-2 py-0.5 text-xs font-bold',
              isFresh ? 'bg-brand-greenLight text-brand-greenDark' : 'bg-brand-blueLight text-brand-blueDark',
            ].join(' ')}
          >
            {isFresh ? 'Fresh' : 'Dry'}
          </span>
          <span className="rounded bg-brand-amberLight px-2 py-0.5 text-xs font-bold text-brand-amberDark">
            Awaiting voucher
          </span>
          {request.otherRationTypeIssued ? (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {isFresh ? 'Dry already issued' : 'Fresh already issued'}
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Reference" value={request.selectionReference ?? '—'} />
        <Field label="Issue period" value={request.period.name} />
        <Field label="Confirmed" value={dateLabel(request.confirmedAt)} />
        <Field label="Fulfilment" value={fulfillmentLabel(request.fulfillment)} />
      </dl>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Requested provisions
        </p>
        {request.lines.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            No {isFresh ? 'fresh' : 'dry'} provisions are recorded against this selection.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1" role="list">
            {request.lines.map((line) => (
              <li key={line.provisionId} className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="min-w-0 break-words text-slate-700">
                  {line.name}
                  {line.brand === null ? '' : ` · ${line.brand}`}
                  <span className="ml-1 text-xs text-slate-400">{line.poolName}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                  {countedQuantityLabel(line, line.quantity)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="min-h-touch rounded-lg bg-brand-forest px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Creating…' : `Create ${isFresh ? 'Fresh' : 'Dry'} voucher`}
        </button>

        {outcome?.kind === 'created' ? (
          <p role="status" className="text-sm font-semibold text-brand-greenDark">
            Voucher {outcome.voucherNumber} created.
          </p>
        ) : null}
        {outcome?.kind === 'existed' ? (
          <p role="status" className="text-sm font-semibold text-slate-600">
            Voucher {outcome.voucherNumber} already existed — no second voucher was created.
          </p>
        ) : null}
        {outcome?.kind === 'failed' ? (
          <p role="alert" className="text-sm font-semibold text-semantic-danger">
            {outcome.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="min-w-0 break-words text-slate-700">{value}</dd>
    </div>
  );
}

function Pager({
  total,
  offset,
  count,
  onPrev,
  onNext,
}: {
  total: number;
  offset: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total <= PAGE_SIZE) return null;
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + count;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={offset === 0}
          className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={last >= total}
          className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
