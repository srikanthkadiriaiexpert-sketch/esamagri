import { useParams } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { OrderStatusStepper } from '../../design-system/OrderStatusStepper';
import { ErrorState, LoadingState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import type { OrderSummary } from '../../lib/api/types';

export function RikOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const order = useResource<OrderSummary>(() => apiRequest(`/rik/orders/${orderId}`), undefined, [orderId]);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title={`Request #${orderId ?? ''}`} showBack tone="forest" />
      <main className="p-4">
        {order.status === 'loading' ? <LoadingState /> : null}
        {(order.status === 'error' || order.status === 'not_implemented') ? (
          <ErrorState variant="not_implemented" description="RIK request tracking will appear here once the RIK order module is live." />
        ) : null}
        {order.status === 'success' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <OrderStatusStepper
              kind={order.data.fulfilmentMethod === 'PICKUP' ? 'rik-pickup' : 'rik-delivery'}
              status={order.data.status}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
