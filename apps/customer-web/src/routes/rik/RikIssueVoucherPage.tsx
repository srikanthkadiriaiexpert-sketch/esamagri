import { useParams } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { Logo } from '../../design-system/Logo';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { ApiError } from '../../lib/api/client';
import {
  fetchMyIssueVoucher,
  finalWindowReminder,
  formatLineQuantity,
  formatQuantity,
  lineCountNoun,
  formatResidence,
  formatVoucherDate,
  formatVoucherMoment,
  formatWindowRange,
  fulfillmentWords,
  rationWords,
  statusWords,
  type IssueVoucherDocument,
  type VoucherIssueStatus,
  type VoucherPool,
} from '../../lib/api/rik-issue-voucher-api';

/**
 * One issue voucher, as a document (PHASE D).
 *
 * It is laid out to READ LIKE THE PAPER IT REPLACES, in the order the
 * facility's own voucher runs: the logo and the two titles, then the voucher
 * number and issue date, the ration type, the current issue window, how it
 * will be fulfilled, who it belongs to, its status, where to collect it or
 * where it will be delivered, and then what is to be issued.
 *
 * READ ONLY, STRUCTURALLY. There is no form, no field, no status control and
 * no action on this screen that changes anything. The server has no customer
 * write route to a voucher, and the application holds no UPDATE privilege on
 * the voucher table at all, so there is nothing for a control to reach even
 * if one were added by mistake.
 *
 * Print is offered because a browser already does it and it needs no library.
 * There is deliberately no QR code: generating one would mean adding a
 * dependency, which this phase does not do, and a scannable code is an
 * identity mechanism the facility has not defined yet.
 *
 * NOT YOURS READS AS NOT THERE. A voucher belonging to another officer
 * answers 404, exactly as one that does not exist, and this screen shows the
 * same "not found" for both — so an id in the address bar reveals nothing.
 *
 * NOTHING IS CALCULATED HERE. Every figure is the server's, replayed from the
 * rule snapshot the officer's own confirmation froze. A later catalogue
 * change, a corrected eligibility figure or a new pack size cannot move a
 * number on this page, because none of them is consulted.
 *
 * Mobile first: one column, 16px gutters, no sideways scrolling.
 */
export function RikIssueVoucherPage() {
  const { voucherId = '' } = useParams<{ voucherId: string }>();
  const voucher = useResource<IssueVoucherDocument>(
    () => fetchMyIssueVoucher(voucherId),
    undefined,
    [voucherId]
  );

  const notFound =
    voucher.status === 'error' && voucher.error instanceof ApiError && voucher.error.status === 404;

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Issue voucher" showBack tone="forest" />

      <main className="px-4 py-4">
        {voucher.status === 'loading' ? <LoadingState label="Loading your voucher…" /> : null}

        {notFound ? (
          <EmptyState
            title="Voucher not found"
            description="This voucher does not exist, or it is not yours."
          />
        ) : voucher.status === 'error' ? (
          <ErrorState description="This voucher could not be loaded." />
        ) : null}

        {voucher.status === 'not_implemented' ? (
          <ErrorState
            variant="not_implemented"
            description="Issue vouchers are being set up and will appear here soon."
          />
        ) : null}

        {voucher.status === 'success' ? (
          <VoucherDocument document={voucher.data} />
        ) : null}
      </main>
    </div>
  );
}

function VoucherDocument({ document }: { document: IssueVoucherDocument }) {
  const v = document;
  const current = v.windows.find((w) => w.windowCode === v.currentWindowCode) ?? null;
  const residence = formatResidence(v.officer.residence);
  const fulfillment = v.issueStatus ?? null;
  const reminder = fulfillment === null ? null : finalWindowReminder(fulfillment);

  return (
    <article
      aria-label={`Issue voucher ${v.voucherNumber}`}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
    >
      {/* The facility's own masthead, in the facility's own order. */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-brand-greenLight px-4 py-4">
        <Logo className="h-12 w-12" />
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-brand-greenDark">
            e-SAMAGRI
          </p>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-greenDark/80">
            Issue voucher
          </p>
          <p className="mt-0.5 text-[11px] text-brand-greenDark/70">
            Base Victualling Yard, Visakhapatnam
          </p>
        </div>
      </header>

      {/*
        The reminder and the lapse notice sit ABOVE the voucher's own fields,
        because they are the only things on this screen that are time-critical
        — and both are the server's judgement, not this screen's.
      */}
      {reminder === null ? null : (
        <p
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-900"
        >
          {reminder}
        </p>
      )}

      {fulfillment !== null && fulfillment.lapsed ? (
        <p className="border-b border-slate-300 bg-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-700">
          <span className="font-semibold">This Fresh ration has lapsed.</span> The final Fresh
          window for this period has closed, so anything not issued can no longer be collected.
          Your voucher number and your eligible days are unchanged, and your Dry ration is not
          affected.
        </p>
      ) : null}

      <dl className="divide-y divide-slate-100">
        <Row label="Voucher number">
          <span className="font-bold tabular-nums">{v.voucherNumber}</span>
        </Row>
        <Row label="Issue date">{formatVoucherDate(v.issueDate)}</Row>
        <Row label="Ration">{rationWords(v.rationType)}</Row>
        <Row label="Issue window">
          {current === null ? (
            <span className="text-slate-500">
              No window is open today. Your voucher stays valid for the windows listed below.
            </span>
          ) : (
            <>
              <span className="font-semibold">{current.label}</span>
              <span className="block tabular-nums text-slate-600">
                {formatWindowRange(current.startDate, current.endDate)}
              </span>
            </>
          )}
        </Row>
        <Row label="Fulfilment">{fulfillmentWords(v.fulfillment.mode)}</Row>
        <Row label="RIK ID">
          <span className="tabular-nums">{v.officer.rikId ?? '—'}</span>
        </Row>
        <Row label="Name">{v.officer.name ?? '—'}</Row>
        <Row label="Mobile">
          <span className="tabular-nums">{v.officer.mobileNumber ?? '—'}</span>
        </Row>
        <Row label="Quarter">{residence ?? '—'}</Row>
        <Row label="Status">
          <span className="font-semibold text-brand-greenDark">{statusWords(v.status)}</span>
        </Row>
        {v.fulfillment.mode === 'PICKUP' ? (
          <Row label="Collect from">{v.fulfillment.pickupLocationName ?? '—'}</Row>
        ) : (
          <Row label="Deliver to">{v.fulfillment.deliveryAddress ?? '—'}</Row>
        )}
        <Row label="Period">
          {v.period.name}
          <span className="block text-xs text-slate-500">
            {formatWindowRange(v.period.startDate, v.period.endDate)}
          </span>
        </Row>
        {v.selectionReference === null ? null : (
          <Row label="Selection">
            <span className="tabular-nums">{v.selectionReference}</span>
          </Row>
        )}
      </dl>

      <section className="border-t border-slate-200 px-4 py-4" aria-labelledby="voucher-ration">
        <h2 id="voucher-ration" className="text-sm font-bold text-slate-900">
          What will be issued
        </h2>

        {v.pools.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">
            Nothing of this ration was selected for this period.
          </p>
        ) : (
          v.pools.map((pool: VoucherPool) => (
            <div key={pool.poolCode} className="mt-3">
              <h3 className="text-sm font-semibold text-slate-800">{pool.poolName}</h3>
              <p className="text-xs tabular-nums text-slate-500">
                Entitlement {formatQuantity(pool.totalEntitlement, pool.unit)} · {pool.eligibleDays}{' '}
                eligible days
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {pool.lines.map((line) => (
                  <li
                    key={line.provisionId}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-slate-900">{line.name}</p>
                    {line.brand === null ? null : (
                      <p className="text-xs text-slate-500">{line.brand}</p>
                    )}
                    <p className="mt-1 text-sm font-bold tabular-nums text-brand-greenDark">
                      {formatLineQuantity(line, line.quantityToIssue)}
                    </p>
                    <p className="text-xs tabular-nums text-slate-500">
                      {lineCountNoun(line) !== null
                        ? `Each ${lineCountNoun(line)} ${formatQuantity(line.consumptionRatio, pool.unit)}`
                        : line.packSize === null
                          ? 'Loose'
                          : `Pack ${formatQuantity(line.packSize, line.packUnit ?? line.unit)}`}
                      {' · '}
                      {formatQuantity(line.poolEquivalentQty, pool.unit)} of {pool.poolName}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {fulfillment === null ? null : <IssuedSection fulfillment={fulfillment} />}

      <section className="border-t border-slate-200 px-4 py-4" aria-labelledby="voucher-source">
        <h2 id="voucher-source" className="text-sm font-bold text-slate-900">
          Entitlement used
        </h2>
        <ul className="mt-1 flex flex-col gap-1">
          {v.sourceComponents.map((c) => (
            <li key={`${c.kind}-${c.periodId}`} className="text-sm tabular-nums text-slate-700">
              {c.periodName} · {c.eligibleDays} eligible days
            </li>
          ))}
        </ul>
      </section>

      {v.windows.length === 0 ? null : (
        <section className="border-t border-slate-200 px-4 py-4" aria-labelledby="voucher-windows">
          <h2 id="voucher-windows" className="text-sm font-bold text-slate-900">
            {v.rationType === 'FRESH' ? 'Fresh windows this period' : 'Dry window this period'}
          </h2>
          {v.rationType === 'FRESH' ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              This one voucher covers every Fresh window. It is not reissued per window and its
              number does not change.
            </p>
          ) : null}
          <ul className="mt-2 flex flex-col gap-1.5">
            {v.windows.map((w) => (
              <li
                key={w.windowCode}
                className={[
                  'rounded-xl px-3 py-2 text-sm',
                  w.windowCode === v.currentWindowCode
                    ? 'bg-brand-greenLight font-semibold text-brand-greenDark'
                    : 'bg-slate-50 text-slate-700',
                ].join(' ')}
              >
                {w.label}{' '}
                <span className="tabular-nums">
                  {formatWindowRange(w.startDate, w.endDate)}
                </span>
                {w.windowCode === v.currentWindowCode ? ' · open now' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-slate-200 px-4 py-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex min-h-touch w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
        >
          Print this voucher
        </button>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          This voucher is issued by the Base Victualling Yard. Nothing on it can be changed from
          this app — if something is wrong, speak to the facility.
        </p>
      </footer>
    </article>
  );
}

/**
 * What was actually handed over, and any balance carried from last month
 * (PHASE E).
 *
 * NOTHING HERE IS INFERRED. An empty "issued" list means the facility has not
 * recorded a physical issue, and this screen says exactly that rather than
 * assuming the voucher's status implies one. The carried balance is shown as
 * its own block with its source month named, so an officer can always see
 * which month a quantity came from and what is left of it.
 */
function IssuedSection({ fulfillment }: { fulfillment: VoucherIssueStatus }) {
  const f = fulfillment;

  return (
    <section className="border-t border-slate-200 px-4 py-4" aria-labelledby="voucher-issued">
      <h2 id="voucher-issued" className="text-sm font-bold text-slate-900">
        What was actually issued
      </h2>

      {f.completedAt === null ? (
        <p className="mt-1 text-sm text-slate-500">
          Nothing has been recorded as issued yet. This updates only when the facility records a
          physical issue at the counter or on delivery.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-semibold text-brand-greenDark">
            {statusWords(f.completedOutcome ?? f.status)}
          </span>
          <span className="block text-xs tabular-nums text-slate-500">
            {formatVoucherMoment(f.completedAt)}
            {f.outcomeReason === null ? '' : ` · ${f.outcomeReason}`}
          </span>
        </p>
      )}

      {f.issued.length === 0 ? null : (
        <ul className="mt-2 flex flex-col gap-2">
          {f.issued.map((line, index) => (
            <li
              key={`${line.poolName}-${line.name}-${index}`}
              className="rounded-xl border border-slate-200 px-3 py-2"
            >
              <p className="text-sm font-semibold text-slate-900">{line.name}</p>
              {line.brand === null ? null : <p className="text-xs text-slate-500">{line.brand}</p>}
              <p className="mt-1 text-sm font-bold tabular-nums text-brand-greenDark">
                {formatQuantity(line.quantityIssued, line.poolUnit)}
              </p>
              <p className="text-xs text-slate-500">{line.poolName}</p>
              {line.substitutedFor === null ? null : (
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Issued in place of {line.substitutedFor.name} · {line.substitutedFor.reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {f.carryForward.length === 0 ? null : (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-800">Carried from last month</h3>
          <p className="text-xs leading-relaxed text-slate-500">
            Kept separate from this month’s Dry ration. It can only be issued in this
            month’s Dry window and lapses once that window closes.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {f.carryForward.map((c, index) => (
              <li
                key={`${c.sourcePeriodName}-${c.poolName}-${index}`}
                className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <span className="font-semibold">{c.poolName}</span>
                <span className="block text-xs tabular-nums text-slate-600">
                  {formatQuantity(c.remaining, c.unit)} left of{' '}
                  {formatQuantity(c.quantity, c.unit)} · from {c.sourcePeriodName}
                </span>
                {c.lapsedAt === null ? null : (
                  <span className="block text-xs text-slate-500">
                    Lapsed {formatVoucherMoment(c.lapsedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}
