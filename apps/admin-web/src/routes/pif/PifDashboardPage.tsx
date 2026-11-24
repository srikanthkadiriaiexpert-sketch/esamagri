import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../../lib/api/resource';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  fetchDashboard,
  rupees,
  statusLabel,
  type PifDashboard,
} from '../../lib/api/pif-admin-api';

/**
 * The PIF operational dashboard — ITS OWN, separate from RIK's (PHASE F).
 *
 * WHY SEPARATE. The two modules are two physical operations with different
 * staff, different authority and different work. A single combined dashboard
 * would put a ration issue window next to a grocery order queue and serve
 * neither; the corrected PIF scope asks for a PIF order-awareness screen, and
 * this is it.
 *
 * THE NEW-ORDER ALERT. A PLACED order is work nobody has picked up yet, so it
 * is the one figure on this screen that is loud. It refreshes on an interval
 * and announces itself to a screen reader through `aria-live`, because the
 * order desk is not watching the tab. There is deliberately NO audible
 * buzzer here: a sound that plays itself needs an explicit, approved choice
 * about volume, mute and the visible fallback, and this screen shows the
 * visible part rather than inventing the rest.
 */
export function PifDashboardPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const dashboard = useResource<PifDashboard>(() => fetchDashboard(), [reloadKey]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // The desk leaves this open all day. A quiet refresh keeps the count
  // honest without anyone pressing anything.
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">PIF dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Grocery orders and the catalogue behind them. Ration (RIK) work is in its own section.
        </p>
      </header>

      {dashboard.status === 'loading' ? <LoadingState label="Loading the PIF dashboard…" /> : null}
      {dashboard.status === 'error' ? <FailureState error={dashboard.error} onRetry={reload} /> : null}
      {dashboard.status === 'not_implemented' ? (
        <EmptyState title="Not available" description="The PIF dashboard route is not available." />
      ) : null}

      {dashboard.status === 'success' ? (
        <>
          <section
            aria-live="polite"
            className={[
              'rounded-xl border px-4 py-4',
              dashboard.data.newOrders > 0
                ? 'border-amber-300 bg-amber-50'
                : 'border-slate-200 bg-white',
            ].join(' ')}
          >
            <p className="text-sm font-semibold text-slate-700">New orders waiting</p>
            <p
              className={[
                'mt-1 text-3xl font-bold tabular-nums',
                dashboard.data.newOrders > 0 ? 'text-amber-900' : 'text-slate-400',
              ].join(' ')}
            >
              {dashboard.data.newOrders}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {dashboard.data.newOrders > 0
                ? 'These have not been accepted yet.'
                : 'Nothing is waiting to be accepted.'}
            </p>
            <Link
              to="/pif/orders"
              className="mt-3 inline-flex min-h-touch items-center rounded-lg bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
            >
              Open the order desk
            </Link>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Tile label="Open orders" value={dashboard.data.openOrders} />
            <Tile label="Products in the catalogue" value={dashboard.data.catalogue.products} />
            <Tile
              label="Out of stock today"
              value={dashboard.data.catalogue.unavailable}
              tone={dashboard.data.catalogue.unavailable > 0 ? 'warn' : 'plain'}
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800">Orders in progress</h2>
            {dashboard.data.recent.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No order is currently in progress.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {dashboard.data.recent.map((order) => (
                  <li key={order.id}>
                    <Link
                      to={`/pif/orders?order=${order.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">
                          {order.orderNumber}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {order.customerName ?? 'Customer'} · {order.itemCount} item(s) ·{' '}
                          {order.fulfillmentMode === 'DELIVERY' ? 'Delivery' : 'Pickup'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-slate-900">
                          {rupees(order.total)}
                        </span>
                        <span className="block text-xs text-slate-500">{statusLabel(order.status)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800">By status</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {Object.entries(dashboard.data.counts)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([status, count]) => (
                  <li
                    key={status}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
                  >
                    {statusLabel(status)}: <span className="tabular-nums">{count}</span>
                  </li>
                ))}
            </ul>
          </section>

          <p className="text-xs leading-relaxed text-slate-500">
            Billing, invoices and receipts are not part of e&nbsp;Samagri — the facility&apos;s own
            billing software does that. What is recorded here is the order, what happened to it, and
            the cash collected on handover.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={[
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'warn' && value > 0 ? 'text-amber-700' : 'text-slate-900',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
}
