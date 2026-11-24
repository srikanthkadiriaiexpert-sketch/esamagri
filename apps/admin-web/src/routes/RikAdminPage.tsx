import { UnavailableState, EmptyState } from '../design-system/States';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';
import { Link } from 'react-router-dom';

/**
 * RIK administration hub (STEP 10 Section 5, extended by STEP 11C).
 *
 * The areas the product needs are listed so the structure is visible.
 * An area whose behaviour depends on an unresolved facility decision is
 * still shown as explicitly pending, with no pickup locations, no
 * collection windows and no NOT_COLLECTED behaviour anywhere on the
 * screen — BD-4 and BD-5 are untouched.
 *
 * Entitlement configuration is no longer pending: STEP 11C built it,
 * and the quantities, ratios and pooling rules behind it now live in
 * the database where an administrator maintains them, not in a
 * specification waiting to be coded.
 *
 * Areas are listed only where the staff member holds the governing
 * permission; the server enforces the same thing independently.
 */
interface Area {
  label: string;
  permission: string;
  state: 'pending-decision' | 'not-built';
  detail: string;
  to?: string;
}

const AREAS: readonly Area[] = [
  {
    label: 'Entitlement configuration',
    permission: 'rik.entitlement.adjust',
    state: 'not-built',
    detail:
      'Pools, daily scales by dietary preference, conversions and the rule history. A change saved here applies to the next entitlement calculation.',
    to: '/rik/config',
  },
  {
    label: 'Provisions, pack sizes and availability',
    permission: 'rik.product.manage',
    state: 'not-built',
    detail:
      'The items entitlement is spent on, their consumption ratios, pack sizes, per-officer limits, issue day and who is offered them.',
    to: '/rik/config/provisions',
  },
  {
    label: 'RIK orders',
    permission: 'rik.order.manage',
    state: 'not-built',
    detail: 'Order administration has not been built yet.',
  },
  {
    label: 'Pickup and delivery',
    permission: 'rik.order.manage',
    state: 'pending-decision',
    detail: 'Pickup locations, collection windows and delivery eligibility are pending confirmation by the facility.',
  },
  // Issue schedules was listed here and is not any more — the same
  // decision as in AdminLayout, and for the same reason: the table is
  // empty and the repository has no write path, so the tile only ever led
  // to an empty page. The route, page, endpoint and table are all
  // untouched; this removes the signpost, not the road.
  //
  // Issue WINDOWS is the live feature and is reached from the sidebar.
];

export function RikAdminPage() {
  const { session } = useStaffAuth();
  const permitted = AREAS.filter((a) => session?.permissions.includes(a.permission));

  return (
    <section aria-labelledby="rik-admin-heading">
      <h1 id="rik-admin-heading" className="mb-1 text-xl font-bold text-brand-blueDark">
        RIK — Ration in Kind
      </h1>
      <p className="mb-4 text-sm text-slate-500">Administration for the entitlement-based ration service.</p>

      {permitted.length === 0 ? (
        <EmptyState
          title="No RIK administration is assigned to you"
          description="Your role does not include RIK administrative permissions."
        />
      ) : (
        <ul className="flex flex-col gap-3" role="list">
          {permitted.map((area) => (
            <li key={area.label}>
              {area.to ? (
                <Link
                  to={area.to}
                  className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-blue"
                >
                  <p className="text-sm font-semibold text-slate-800">{area.label}</p>
                  <p className="mt-1 text-sm text-slate-500">{area.detail}</p>
                </Link>
              ) : (
                <UnavailableState title={area.label} reason={area.detail} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
