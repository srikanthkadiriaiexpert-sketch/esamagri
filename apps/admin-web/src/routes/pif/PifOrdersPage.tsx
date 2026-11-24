import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResource } from '../../lib/api/resource';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  ConfigError,
  ConfigNotice,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  SelectInput,
  TextInput,
} from '../../design-system/ConfigUI';
import { ProductImage } from './ProductImage';
import {
  addOrderNote,
  fetchOrder,
  fetchOrders,
  needsReason,
  recordOrderStatus,
  rupees,
  quantityLabel,
  statusLabel,
  type PifOrderDetail,
  type PifOrderStatus,
  type PifOrderSummary,
} from '../../lib/api/pif-admin-api';
import { useStaffAuth } from '../../lib/auth/StaffAuthContext';

/**
 * The PIF order desk (PHASE F).
 *
 * WHAT THE STAFF MEMBER NEEDS, ON ONE SCREEN: who ordered, how to reach
 * them, whether it is pickup or delivery and to what address, exactly what to
 * pick, how much cash to collect at handover, and what has happened to the
 * order so far with each step's actor named.
 *
 * THE BUTTONS ARE THE SERVER'S OPINION, not this screen's. `nextSteps` comes
 * from the API, so the desk is never offered a move the server would refuse,
 * and the server refuses anything else regardless of what is rendered.
 *
 * AUTHORITY IS PER-ACTION. A packer holds `pif.order.prepare` and sees the
 * preparation steps; accepting and cancelling need `pif.order.manage`;
 * recording a delivery needs `pif.order.mark_delivered`. The screen hides
 * what the signed-in staff member cannot do — and the server checks it again
 * on every request, so hiding is a courtesy, never the control.
 *
 * NOTHING COMPLETES BY ITSELF. Every state on this screen is recorded by a
 * named person pressing a button. No timer, no customer action and no
 * elapsed delivery window moves an order.
 */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Open orders' },
  { value: 'PLACED', label: 'New (not accepted)' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'PREPARING', label: 'Being prepared' },
  { value: 'READY_PICKED', label: 'Ready' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'COD_COLLECTED', label: 'Cash collected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'NOT_DELIVERED', label: 'Not delivered' },
];

/** Which permission each move needs. The same table the service enforces. */
const PERMISSION_FOR: Readonly<Record<string, string>> = {
  ACCEPTED: 'pif.order.manage',
  PREPARING: 'pif.order.prepare',
  READY_PICKED: 'pif.order.prepare',
  OUT_FOR_DELIVERY: 'pif.order.manage',
  DELIVERED: 'pif.order.mark_delivered',
  NOT_DELIVERED: 'pif.order.mark_not_delivered',
  COD_COLLECTED: 'pif.order.manage',
  CANCELLED: 'pif.order.manage',
};

export function PifOrdersPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('order');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const orders = useResource<{ items: PifOrderSummary[]; total: number }>(
    () => fetchOrders({ status: status === '' ? undefined : status, open: status === '', q: query }),
    [reloadKey, status, query]
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Grocery orders</h1>
        <p className="mt-1 text-sm text-slate-600">
          Accept, prepare and hand over customer orders. Cash is collected on delivery.
        </p>
      </header>

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
        <FieldLabel label="Show">
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Search" hint="Order number, customer name or mobile number.">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search orders…" />
        </FieldLabel>
      </section>

      {orders.status === 'loading' ? <LoadingState label="Loading orders…" /> : null}
      {orders.status === 'error' ? <FailureState error={orders.error} onRetry={reload} /> : null}
      {orders.status === 'not_implemented' ? (
        <EmptyState title="Not available" description="The PIF order route is not available." />
      ) : null}

      {orders.status === 'success' ? (
        orders.data.items.length === 0 ? (
          <EmptyState
            title="Nothing to do here"
            description="No order matches. New orders appear here as soon as a customer places one."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.data.items.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setParams(order.id === selected ? {} : { order: order.id })}
                  aria-expanded={order.id === selected}
                  className={[
                    'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left',
                    order.id === selected
                      ? 'border-brand-forest bg-brand-greenLight'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {order.orderNumber} · {statusLabel(order.status)}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {order.customerName ?? 'Customer'}
                      {order.customerMobile === null ? '' : ` · ${order.customerMobile}`} ·{' '}
                      {order.itemCount} item(s) ·{' '}
                      {order.fulfillmentMode === 'DELIVERY' ? 'Delivery' : 'Pickup'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                    {rupees(order.total)}
                  </span>
                </button>

                {order.id === selected ? (
                  <OrderPanel orderId={order.id} onChanged={reload} />
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function OrderPanel({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const { session } = useStaffAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const detail = useResource<PifOrderDetail>(() => fetchOrder(orderId), [orderId, reloadKey]);

  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const may = (status: string) => {
    const code = PERMISSION_FOR[status];
    return code === undefined || (session?.permissions.includes(code) ?? false);
  };

  const record = async (status: PifOrderStatus) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await recordOrderStatus(orderId, {
        status,
        ...(needsReason(status) ? { reason: reason.trim() } : {}),
      });
      setNotice(`Recorded: ${statusLabel(status)}.`);
      setReason('');
      setReloadKey((n) => n + 1);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setError(null);
    setBusy(true);
    try {
      await addOrderNote(orderId, note.trim());
      setNote('');
      setNotice('The note was added to the order.');
      setReloadKey((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (detail.status === 'loading') return <LoadingState label="Loading the order…" />;
  if (detail.status === 'error') return <FailureState error={detail.error} />;
  if (detail.status === 'not_implemented') {
    return <EmptyState title="Not available" description="That order could not be loaded." />;
  }

  const order = detail.data;
  const offered = order.nextSteps.filter((step) => may(step));
  const blocked = order.nextSteps.filter((step) => !may(step));

  return (
    <section className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      {notice ? <ConfigNotice>{notice}</ConfigNotice> : null}
      {error ? <ConfigError error={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Customer</h3>
          <p className="mt-1 text-sm text-slate-700">{order.customer.name ?? '—'}</p>
          <p className="text-sm tabular-nums text-slate-600">{order.customer.mobile ?? '—'}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {order.fulfillmentMode === 'DELIVERY' ? 'Deliver to' : 'Collection'}
          </p>
          <p className="text-sm text-slate-700">
            {order.fulfillmentMode === 'DELIVERY'
              ? (order.deliveryAddress ?? '—')
              : 'Customer collects at the facility'}
          </p>
          {order.customerNote === null ? null : (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              “{order.customerNote}”
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-900">To collect</h3>
          <p className="mt-1 text-2xl font-bold tabular-nums text-brand-forest">
            {rupees(order.codAmount ?? order.total)}
          </p>
          <p className="text-xs text-slate-500">
            Cash on delivery · {order.codCollectedAt === null ? 'not collected yet' : 'collected'}
          </p>
          <dl className="mt-2 text-sm text-slate-600">
            <div className="flex justify-between gap-3">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{rupees(order.subtotal)}</dd>
            </div>
            {order.discountTotal > 0 ? (
              <div className="flex justify-between gap-3">
                <dt>Discount</dt>
                <dd className="tabular-nums">−{rupees(order.discountTotal)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt>GST</dt>
              <dd className="tabular-nums">{rupees(order.taxTotal)}</dd>
            </div>
            {/*
              THE DELIVERY LINE, for the desk and the driver. It is part of
              what the total is made of and part of what has to be collected
              in cash, so it is shown on every order - as a free line on a
              pickup order and on a qualifying delivery, rather than silently
              omitted.
            */}
            <div className="flex justify-between gap-3">
              <dt>{order.fulfillmentMode === 'PICKUP' ? 'Store pickup' : 'Home delivery'}</dt>
              <dd className="tabular-nums">
                {order.deliveryTotal > 0 ? rupees(order.deliveryTotal) : 'FREE'}
              </dd>
            </div>
            <div className="flex justify-between gap-3 font-semibold text-slate-900">
              <dt>Total</dt>
              <dd className="tabular-nums">{rupees(order.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            These are the amounts recorded with the order. The bill itself is raised in the
            facility&apos;s own billing software.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-bold text-slate-900">What to pick</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {order.items.map((item) => (
            <li
              key={item.productId}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              <ProductImage
                url={item.imageUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
                fallback={
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-500">
                    none
                  </span>
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  {item.name}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {item.sku}
                  {item.brand === null ? '' : ` · ${item.brand}`}
                  {item.packSize === null ? '' : ` · pack ${item.packSize}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold tabular-nums text-slate-900">
                  {quantityLabel(item.qty, item.unit)}
                </span>
                <span className="block text-xs tabular-nums text-slate-500">
                  {rupees(item.unitPrice)} · {rupees(item.lineTotal)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">
          Next step <span className="font-normal text-slate-500">({statusLabel(order.status)})</span>
        </h3>

        {order.nextSteps.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            This order is finished. Nothing further can be recorded against it.
          </p>
        ) : (
          <>
            {order.nextSteps.some((step) => needsReason(step)) ? (
              <div className="mt-2 max-w-md">
                <FieldLabel label="Reason" hint="Required to cancel, or to record a failed delivery.">
                  <TextInput
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    placeholder="e.g. Nobody at the quarter"
                  />
                </FieldLabel>
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-2">
              {offered.map((step) => (
                <PrimaryButton
                  key={step}
                  type="button"
                  disabled={busy || (needsReason(step) && reason.trim().length < 3)}
                  onClick={() => void record(step)}
                >
                  {statusLabel(step)}
                </PrimaryButton>
              ))}
            </div>

            {blocked.length > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                {blocked.map((step) => statusLabel(step)).join(', ')} —{' '}
                {blocked.length === 1 ? 'this step is' : 'these steps are'} recorded by another role.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">Add a note</h3>
        <div className="mt-2 flex max-w-xl flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <TextInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Internal note for the desk"
              aria-label="Internal note"
            />
          </div>
          <SecondaryButton type="button" disabled={busy || note.trim().length < 3} onClick={() => void saveNote()}>
            Save note
          </SecondaryButton>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Notes stay inside the facility — the customer never sees them.
        </p>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">History</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {order.history.map((event) => (
            <li key={event.eventId} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-800">
                {event.status === null ? 'Note' : statusLabel(event.status)}
              </span>
              {event.reason === null ? null : <span className="text-slate-600"> · {event.reason}</span>}
              {event.notes === null ? null : <span className="block text-slate-600">{event.notes}</span>}
              <span className="block text-xs text-slate-500">
                {new Date(event.recordedAt).toLocaleString('en-GB')} ·{' '}
                {event.recordedBy.name ?? event.recordedBy.role}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
