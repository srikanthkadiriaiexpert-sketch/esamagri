import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/StateViews';
import { Badge } from '../../design-system/Badge';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import type { OrderSummary } from '../../lib/api/types';

export function RikOrdersPage() {
  const navigate = useNavigate();
  // No dev fallback here deliberately: order history is exactly the
  // kind of data that must never be fabricated, even labeled (STEP 8
  // Section 28 — "Do NOT create fake orders"). Until the real RIK
  // order engine exists this always shows the honest "coming soon"
  // state instead.
  const orders = useResource<OrderSummary[]>(() => apiRequest('/rik/orders'), undefined, []);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="My RIK Orders" showBack tone="forest" />
      <main className="p-4">
        {orders.status === 'loading' ? <LoadingState /> : null}
        {orders.status === 'error' ? <ErrorState /> : null}
        {orders.status === 'not_implemented' ? (
          <ErrorState variant="not_implemented" description="RIK request history will appear here once the RIK order module is live." />
        ) : null}
        {orders.status === 'success' && orders.data.length === 0 ? (
          <EmptyState title="No RIK requests yet" action={{ label: 'Browse RIK', onClick: () => navigate('/rik') }} />
        ) : null}
        {orders.status === 'success' && orders.data.length > 0 ? (
          <div className="flex flex-col gap-3">
            {orders.data.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => navigate(`/rik/orders/${o.id}`)}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">Request #{o.id}</p>
                  <Badge tone="info">{o.status.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {o.fulfilmentMethod.toLowerCase()}
                </p>
              </button>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
