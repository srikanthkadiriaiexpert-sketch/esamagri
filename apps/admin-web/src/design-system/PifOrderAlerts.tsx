import { PrimaryButton, SecondaryButton } from './ConfigUI';
import { rupees, type PifOrderSummary } from '../lib/api/pif-admin-api';
import { usePifOrderAlerts } from '../lib/orders/usePifOrderAlerts';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';

/**
 * The PIF incoming-order alert panel.
 *
 * PIF ONLY. AdminLayout renders this on /pif routes and nowhere else, so it
 * cannot appear over a RIK screen, and the hook behind it reads one PIF
 * endpoint that no RIK order can ever appear in.
 *
 * THE VISUAL ALERT IS THE ALERT. The buzzer is an addition to it, never a
 * substitute: every pending order is on screen whether or not sound is
 * enabled, whether or not the browser allows it, and whether or not the
 * reader has speakers. If audio cannot play, the panel says so plainly
 * rather than letting the desk believe it will be told.
 *
 * PROMINENT, NOT OBSTRUCTIVE. It sits in the bottom-right corner above the
 * content, wide enough to read at a glance and capped in height so a pile of
 * orders scrolls inside the panel instead of burying the screen. The rest of
 * the portal stays usable with alerts up, because the order desk still has
 * to do the work the alert is about.
 */

/**
 * An order's shop, for display. Deliberately NOT pif-admin-api's shopLabel():
 * that one answers for a CATEGORY and renders a null as "Demo", which is
 * right there and wrong here — an order whose items resolve no business is
 * not a demonstration order, it is an order we cannot attribute.
 */
function businessLabel(business: string | null): string {
  if (business === 'grocers') return 'Grocers';
  if (business === 'fresh-mart') return 'Fresh Mart';
  if (business === 'mixed') return 'Grocers + Fresh Mart';
  return 'Unattributed';
}

function placedLabel(placedAt: string | null): string {
  if (placedAt === null) return '—';
  const when = new Date(placedAt);
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function PifOrderAlerts() {
  const { pending, offline, audio, acknowledging, enableSound, testSound, acknowledge } =
    usePifOrderAlerts();
  const { session } = useStaffAuth();

  /*
   * AUTHORIZATION IS THE SERVER'S, and this only mirrors it. The notes
   * endpoint refuses a caller without one of these two permissions, so a
   * disabled button here is a courtesy that explains the refusal in advance
   * — it is not the check itself, and removing it would not let anyone
   * acknowledge anything.
   */
  const held = session?.permissions ?? [];
  const mayAcknowledge =
    held.includes('pif.order.prepare') || held.includes('pif.order.manage');

  const hasPending = pending.length > 0;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="assertive"
      aria-atomic="false"
    >
      {offline ? (
        <div className="pointer-events-auto rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Not reaching the server. Alerts already on screen are kept, and anything that
          arrived meanwhile appears when the connection returns.
        </div>
      ) : null}

      {audio === 'blocked' ? (
        <div className="pointer-events-auto rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Sound is blocked by this browser. New orders still appear here — watch the screen.
        </div>
      ) : null}

      {hasPending ? (
        <div className="pointer-events-auto max-h-[60vh] overflow-y-auto rounded-xl border-2 border-brand-forest bg-white shadow-card">
          <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-brand-forest px-3 py-2">
            <span className="text-sm font-bold text-white">
              {pending.length === 1 ? '1 new order' : `${pending.length} new orders`}
            </span>
            <span className="text-xs font-semibold text-white/80">Awaiting acknowledgement</span>
          </div>

          <ul className="divide-y divide-slate-200">
            {pending.map((order: PifOrderSummary) => (
              <li key={order.id} className="p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">{order.orderNumber}</span>
                  <span className="text-sm font-extrabold text-slate-900">
                    {rupees(order.total)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  {businessLabel(order.business)} · {placedLabel(order.placedAt)} ·{' '}
                  {order.itemCount === 1 ? '1 item' : `${order.itemCount} items`}
                </p>
                {order.customerName === null ? null : (
                  <p className="text-xs text-slate-600">{order.customerName}</p>
                )}

                <div className="mt-2">
                  {mayAcknowledge ? (
                    <PrimaryButton
                      onClick={() => void acknowledge(order.id)}
                      disabled={acknowledging.has(order.id)}
                    >
                      {acknowledging.has(order.id) ? 'Recording…' : 'Received'}
                    </PrimaryButton>
                  ) : (
                    <>
                      <PrimaryButton disabled>Received</PrimaryButton>
                      <p className="mt-1 text-xs text-slate-500">
                        Your account holds no PIF order permission, so you can see this alert
                        but not acknowledge it. Ask an administrator for
                        &ldquo;pif.order.prepare&rdquo;.
                      </p>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        The sound controls stay on screen with nothing pending, because
        enabling audio needs a real click and the desk should do it at the
        start of a shift rather than discovering it during the first order.
      */}
      <div className="pointer-events-auto flex items-center justify-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-card">
        <span className="mr-auto text-xs font-semibold text-slate-600">
          {audio === 'ready' ? 'Order sound on' : audio === 'blocked' ? 'Sound blocked' : 'Order sound off'}
        </span>
        {audio === 'ready' ? (
          <SecondaryButton onClick={() => void testSound()}>Test sound</SecondaryButton>
        ) : (
          <PrimaryButton onClick={() => void enableSound()}>Enable sound</PrimaryButton>
        )}
      </div>
    </div>
  );
}
