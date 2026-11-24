import type { PifOrderStatus, RikOrderStatus } from '../lib/api/types';

/**
 * PHASE F — the real PIF sequence, in the database's own states.
 *
 * PLACED and ACCEPTED are two different facts: the customer submitted the
 * order, and the facility then acknowledged it. Both are shown, because a
 * shopper waiting for confirmation is entitled to see which of the two has
 * happened. COD_COLLECTED is not a step — it is Delivered with the cash
 * taken — so it lights the Delivered step (see `reached` below).
 */
const PIF_STEPS: { status: PifOrderStatus; label: string }[] = [
  { status: 'PLACED', label: 'Order Placed' },
  { status: 'ACCEPTED', label: 'Confirmed' },
  { status: 'PREPARING', label: 'Being Prepared' },
  { status: 'READY_PICKED', label: 'Ready' },
  { status: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { status: 'DELIVERED', label: 'Delivered' },
];

const RIK_PICKUP_STEPS: { status: RikOrderStatus; label: string }[] = [
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'READY_FOR_PICKUP', label: 'Ready for Pickup' },
  { status: 'COLLECTED', label: 'Collected' },
];

const RIK_DELIVERY_STEPS: { status: RikOrderStatus; label: string }[] = [
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { status: 'DELIVERED', label: 'Delivered' },
];

export interface OrderStatusStepperProps {
  kind: 'pif' | 'rik-pickup' | 'rik-delivery';
  status: PifOrderStatus | RikOrderStatus;
}

/**
 * Reusable order-status progress display (STEP 8 Section 14). Renders
 * the step sequence appropriate to the order type; a RIK order can
 * also land on NOT_COLLECTED, shown as a distinct terminal state
 * rather than forced into the step sequence. This is UI-only — no
 * order engine exists behind it yet.
 */
export function OrderStatusStepper({ kind, status }: OrderStatusStepperProps) {
  if (status === 'NOT_COLLECTED') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-semantic-dangerLight px-3.5 py-3 text-sm font-semibold text-semantic-danger">
        <span aria-hidden="true">⚠</span> Not collected
      </div>
    );
  }

  // An order that ended badly is a terminal state, not a step: forcing
  // CANCELLED or NOT_DELIVERED into the sequence would show a shopper a
  // half-lit progress bar for something that is not progressing.
  if (status === 'CANCELLED' || status === 'NOT_DELIVERED') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-semantic-dangerLight px-3.5 py-3 text-sm font-semibold text-semantic-danger">
        <span aria-hidden="true">⚠</span>{' '}
        {status === 'CANCELLED' ? 'Cancelled' : 'Could not be delivered'}
      </div>
    );
  }

  const steps = kind === 'pif' ? PIF_STEPS : kind === 'rik-pickup' ? RIK_PICKUP_STEPS : RIK_DELIVERY_STEPS;
  // Cash collected at the door means the goods were delivered.
  const reached = status === 'COD_COLLECTED' ? 'DELIVERED' : status;
  const currentIndex = steps.findIndex((s) => s.status === reached);

  return (
    <ol className="flex items-start">
      {steps.map((step, i) => {
        const done = currentIndex >= 0 && i <= currentIndex;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.status} className="flex flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span
                className={[
                  'flex h-2.5 w-2.5 shrink-0 rounded-full',
                  i === 0 ? 'ml-auto' : '',
                  done ? 'bg-brand-green' : 'bg-slate-200',
                ].join(' ')}
                style={i === 0 ? { marginLeft: '50%' } : undefined}
              />
              {!isLast ? <span className={['h-0.5 flex-1', done ? 'bg-brand-green' : 'bg-slate-200'].join(' ')} /> : null}
            </div>
            <p className={['mt-1.5 px-0.5 text-[11px] leading-tight', done ? 'font-semibold text-slate-800' : 'text-slate-400'].join(' ')}>
              {step.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
