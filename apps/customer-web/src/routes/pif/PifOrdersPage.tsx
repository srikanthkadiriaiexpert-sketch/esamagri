import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/StateViews';
import { Badge } from '../../design-system/Badge';
import { useResource } from '../../lib/api/resource';
import {
  fetchMyPifOrders,
  orderStateWords,
  rupees,
  type PifOrderListItem,
} from '../../lib/api/pif-api';

/**
 * My PIF orders (PHASE F).
 *
 * The officer's own orders, newest first, exactly as the facility recorded
 * them. Nothing here is fabricated and nothing is inferred: an order shows
 * the state a named member of staff put it in, and if nobody has touched it
 * yet it still reads "Order placed".
 *
 * READ ONLY. There is no cancel, no reorder-by-rewriting and no status
 * control on this screen or the next one, because the server exposes no
 * customer route that changes an order.
 */
export function PifOrdersPage() {
  const navigate = useNavigate();
  const orders = useResource<{ items: PifOrderListItem[] }>(() => fetchMyPifOrders(), undefined, []);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="My PIF Orders" showBack tone="forest" />
      <main className="p-4">
        {orders.status === 'loading' ? <LoadingState /> : null}
        {orders.status === 'error' ? <ErrorState /> : null}
        {orders.status === 'not_implemented' ? (
          <ErrorState variant="not_implemented" description="Order history is not available." />
        ) : null}
        {orders.status === 'success' && orders.data.items.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Your grocery orders will appear here once you place one."
            action={{ label: 'Start shopping', onClick: () => navigate('/pif') }}
          />
        ) : null}
        {orders.status === 'success' && orders.data.items.length > 0 ? (
          <div className="flex flex-col gap-3">
            {orders.data.items.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => navigate(`/pif/orders/${order.id}`)}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold tabular-nums text-slate-900">{order.orderNumber}</p>
                  <Badge
                    tone={
                      order.status === 'CANCELLED' || order.status === 'NOT_DELIVERED'
                        ? 'danger'
                        : 'green'
                    }
                  >
                    {orderStateWords(order.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {order.itemCount} item(s) ·{' '}
                  {order.fulfillmentMode === 'DELIVERY' ? 'Home delivery' : 'Collect yourself'} ·{' '}
                  cash on delivery
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-slate-800">
                  {rupees(order.total)}
                </p>
              </button>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
