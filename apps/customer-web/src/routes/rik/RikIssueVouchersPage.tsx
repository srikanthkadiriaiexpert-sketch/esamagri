import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import {
  fetchMyIssueVouchers,
  formatVoucherDate,
  rationWords,
  statusWords,
  type IssueVoucherListItem,
} from '../../lib/api/rik-issue-voucher-api';

/**
 * The officer's own issue vouchers (PHASE D).
 *
 * READ ONLY, and short by design: the voucher number, what it is for, and
 * when it was issued. The document itself is one tap away.
 *
 * There is no control on this screen that changes anything. The server has no
 * customer write route to a voucher, and the officer's list is filtered by
 * the authenticated principal on the server — this screen passes no officer
 * id and could not ask for someone else's.
 *
 * Mobile first: one column, cards rather than a table, 16px gutters.
 */
export function RikIssueVouchersPage() {
  const navigate = useNavigate();
  const vouchers = useResource(() => fetchMyIssueVouchers(), undefined, []);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Issue vouchers" showBack tone="forest" />

      <main className="px-4 py-4">
        <p className="text-sm leading-relaxed text-slate-600">
          Your issue voucher is the document the yard works from once your monthly selection is
          confirmed — one for Fresh and one for Dry.
        </p>

        {vouchers.status === 'loading' ? (
          <div className="mt-4">
            <LoadingState label="Loading your vouchers…" />
          </div>
        ) : null}

        {vouchers.status === 'error' ? (
          <div className="mt-4">
            <ErrorState description="Your issue vouchers could not be loaded." />
          </div>
        ) : null}

        {vouchers.status === 'not_implemented' ? (
          <div className="mt-4">
            <ErrorState
              variant="not_implemented"
              description="Issue vouchers are being set up and will appear here soon."
            />
          </div>
        ) : null}

        {vouchers.status === 'success' ? (
          vouchers.data.items.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No issue voucher yet"
                description="A voucher appears here once the facility has issued against your confirmed selection."
              />
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {vouchers.data.items.map((v: IssueVoucherListItem) => (
                <li key={v.voucherId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/rik/issue-vouchers/${v.voucherId}`)}
                    className="flex min-h-touch w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold tabular-nums text-slate-900">
                        {v.voucherNumber}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {rationWords(v.rationType)} · {v.periodName}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-brand-greenDark">
                        {statusWords(v.status)}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-400">
                        Issued {formatVoucherDate(v.issueDate)}
                      </span>
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-5 w-5 shrink-0 text-slate-400"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M7.5 4.5l6 5.5-6 5.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </main>
    </div>
  );
}
