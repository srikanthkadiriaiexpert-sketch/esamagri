import { useParams } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { OrderStatusStepper } from '../../design-system/OrderStatusStepper';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/StateViews';
import { RemoteImage } from '../../design-system/RemoteImage';
import { useResource } from '../../lib/api/resource';
import { ApiError } from '../../lib/api/client';
import {
  fetchMyPifOrder,
  mediaUrl,
  orderStateWords,
  rupees,
  type PifOrderDocument,
} from '../../lib/api/pif-api';

/**
 * One PIF order, as the customer follows it (PHASE F).
 *
 * WHAT IT SHOWS: the state the facility actually recorded, when each step
 * happened, what was ordered at the prices that were charged, and the cash to
 * have ready. The amounts are the ones frozen onto the order when it was
 * placed — a later price change in the shop cannot move them.
 *
 * WHAT IT DOES NOT SHOW: which staff member did what, and any internal note
 * the desk wrote. The server does not send either to a customer.
 *
 * NOT YOURS READS AS NOT THERE. Another officer's order answers 404, exactly
 * as one that does not exist.
 */
export function PifOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const order = useResource<PifOrderDocument>(
    () => fetchMyPifOrder(orderId ?? ''),
    undefined,
    [orderId]
  );

  const notFound =
    order.status === 'error' && order.error instanceof ApiError && order.error.status === 404;

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title={order.status === 'success' ? order.data.orderNumber : 'Order'}
        showBack
        tone="forest"
      />
      <main className="p-4">
        {order.status === 'loading' ? <LoadingState /> : null}
        {notFound ? (
          <EmptyState title="Order not found" description="This order does not exist, or it is not yours." />
        ) : order.status === 'error' ? (
          <ErrorState />
        ) : null}
        {order.status === 'not_implemented' ? <ErrorState variant="not_implemented" /> : null}

        {order.status === 'success' ? (
          <article aria-label={`Order ${order.data.orderNumber}`} className="flex flex-col gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <OrderStatusStepper kind="pif" status={order.data.status} />
              <p className="mt-3 text-center text-sm font-semibold text-slate-800">
                {orderStateWords(order.data.status)}
              </p>
              {order.data.timeline.length === 0 ? null : (
                <ul className="mt-3 flex flex-col gap-1">
                  {order.data.timeline.map((step) => (
                    <li key={`${step.status}-${step.at}`} className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {orderStateWords(step.status)}
                      </span>{' '}
                      · {new Date(step.at).toLocaleString('en-GB')}
                      {step.reason === null ? '' : ` · ${step.reason}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold text-slate-900">
                {order.data.fulfillmentMode === 'DELIVERY' ? 'Delivery to' : 'Collection'}
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                {order.data.fulfillmentMode === 'DELIVERY'
                  ? (order.data.deliveryAddress ?? '—')
                  : 'You are collecting this order at the facility.'}
              </p>
              {order.data.customerNote === null ? null : (
                <p className="mt-2 text-sm text-slate-600">“{order.data.customerNote}”</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold text-slate-900">What you ordered</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {order.data.items.map((item) => (
                  <li key={item.productId} className="flex items-center gap-3">
                    <RemoteImage
                      src={mediaUrl(item.imageUrl)}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      fallback={
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[10px] text-slate-400">
                          no photo
                        </span>
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {item.name}
                      </span>
                      <span className="block text-xs tabular-nums text-slate-500">
                        {item.qty} {item.unit} × {rupees(item.unitPrice)}
                        {item.taxRatePct === 0 ? '' : ` · GST ${item.taxRatePct}%`}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
                      {rupees(item.lineTotal)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between gap-3 text-slate-600">
                  <dt>Subtotal</dt>
                  <dd className="tabular-nums">{rupees(order.data.subtotal)}</dd>
                </div>
                {order.data.discountTotal > 0 ? (
                  <div className="flex justify-between gap-3 text-brand-greenDark">
                    <dt>Discount</dt>
                    <dd className="tabular-nums">−{rupees(order.data.discountTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3 text-slate-600">
                  <dt>GST</dt>
                  <dd className="tabular-nums">{rupees(order.data.taxTotal)}</dd>
                </div>
                {/*
                  The delivery charge AS IT WAS on this order. Shown on a
                  pickup order too, as a free line, so the record is complete
                  rather than quietly missing a row.
                */}
                <div className="flex justify-between gap-3 text-slate-600">
                  <dt>
                    {order.data.fulfillmentMode === 'PICKUP' ? 'Store pickup' : 'Home delivery'}
                  </dt>
                  <dd className="tabular-nums">
                    {order.data.deliveryTotal > 0 ? (
                      rupees(order.data.deliveryTotal)
                    ) : (
                      <span className="font-bold text-brand-greenDark">FREE</span>
                    )}
                  </dd>
                </div>
                <div className="mt-1 flex justify-between gap-3 text-base font-extrabold text-slate-900">
                  <dt>
                    {order.data.codCollectedAt === null ? 'To pay in cash' : 'Paid in cash'}
                  </dt>
                  <dd className="tabular-nums">{rupees(order.data.total)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                These are the prices charged when you placed the order. Payment is in cash at
                handover — nothing is collected in the app.
              </p>
            </section>
          </article>
        ) : null}
      </main>
    </div>
  );
}
