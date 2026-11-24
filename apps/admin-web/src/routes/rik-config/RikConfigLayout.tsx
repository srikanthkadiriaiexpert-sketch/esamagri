import { NavLink, Outlet } from 'react-router-dom';
import { useStaffAuth } from '../../lib/auth/StaffAuthContext';
import { UnauthorizedState } from '../../design-system/States';

/**
 * RIK administration — entitlement configuration (STEP 11C).
 *
 * Eight screens over five tables. The grouping is by the question an
 * administrator is answering, not by table:
 *
 *   Entitlement pools      what categories of entitlement exist
 *   Daily scales           how much per day, per dietary preference
 *   Conversions            what may be exchanged for what
 *   Provisions             which items entitlement is spent on
 *   Pack sizes & limits    how those items are issued and capped
 *   Issue period & availability   when and to whom they are offered
 *   Collection points      where a customer may collect an issue
 *   Rule history           what was changed, by whom, and when
 *
 * Pack sizes & limits and Issue period & availability are views of the
 * PROVISIONS table rather than tables of their own — and are labelled
 * as such on each screen — because that is the truth of the data model.
 * Pretending otherwise would invent a structure the engine does not
 * have. Collection points, added in STEP 11E, genuinely is its own
 * table.
 *
 * Every tab is gated by the permission that governs the data behind it,
 * and hidden when the staff member does not hold it. That is a
 * usability filter only: the server authorizes each request
 * independently, so reaching one of these URLs without the permission
 * produces the unauthorized state from a real 403.
 */
interface Tab {
  to: string;
  label: string;
  permission: 'rik.entitlement.adjust' | 'rik.product.manage' | 'rik.entitlement.allocate';
  end?: boolean;
}

export const CONFIG_TABS: readonly Tab[] = [
  // Periods come first because everything else in RIK belongs to one: an
  // eligibility upload, an issue window and an entitlement are all recorded
  // against a period. Guarded by `rik.entitlement.allocate`, the same
  // permission as eligibility — opening a period and allocating what may be
  // drawn in it are the same administrative authority.
  { to: '/rik/config/periods', label: 'Entitlement periods', permission: 'rik.entitlement.allocate' },
  { to: '/rik/config', label: 'Entitlement pools', permission: 'rik.entitlement.adjust', end: true },
  { to: '/rik/config/scales', label: 'Daily scales', permission: 'rik.entitlement.adjust' },
  { to: '/rik/config/conversions', label: 'Conversions', permission: 'rik.entitlement.adjust' },
  { to: '/rik/config/provisions', label: 'Provisions', permission: 'rik.product.manage' },
  // Merchandising, not entitlement: which existing products the customer app
  // highlights. Same permission as the provisions it features.
  { to: '/rik/config/new-arrivals', label: 'New Arrivals', permission: 'rik.product.manage' },
  // Also merchandising: the seasonal pictures that appear BELOW the customer
  // home screen's permanent banner. Same permission again, and nothing on
  // that screen can reach the permanent banner, which is a committed asset in
  // the customer app rather than a row in any table.
  { to: '/rik/config/banners', label: 'Seasonal banners', permission: 'rik.product.manage' },
  { to: '/rik/config/packs', label: 'Pack sizes & limits', permission: 'rik.product.manage' },
  { to: '/rik/config/availability', label: 'Issue period & availability', permission: 'rik.product.manage' },
  { to: '/rik/config/pickup-locations', label: 'Collection points', permission: 'rik.entitlement.adjust' },
  { to: '/rik/config/history', label: 'Rule history', permission: 'rik.entitlement.adjust' },
];

export function RikConfigLayout() {
  const { session } = useStaffAuth();
  const held = (code: string) => session?.permissions.includes(code) ?? false;
  const visible = CONFIG_TABS.filter((t) => held(t.permission));

  return (
    <section aria-labelledby="rik-config-heading">
      <h1 id="rik-config-heading" className="mb-1 text-xl font-bold text-brand-blueDark">
        RIK entitlement configuration
      </h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        The rules the entitlement calculation runs on. A change saved here applies to the next calculation — there is no
        separate publish step, and nothing is copied anywhere.
      </p>

      {visible.length === 0 ? (
        <UnauthorizedState description="Changing RIK entitlement configuration requires the RIK administrator role." />
      ) : (
        <>
          <nav aria-label="RIK configuration areas" className="mb-5 overflow-x-auto">
            <ul className="flex min-w-max gap-1 border-b border-slate-200 pb-px">
              {visible.map((tab) => (
                <li key={tab.to}>
                  <NavLink
                    to={tab.to}
                    end={tab.end}
                    className={({ isActive }) =>
                      [
                        'inline-flex min-h-touch items-center whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium',
                        isActive
                          ? 'border-b-2 border-brand-forest text-brand-forest'
                          : 'text-slate-600 hover:bg-slate-100',
                      ].join(' ')
                    }
                  >
                    {tab.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <Outlet />
        </>
      )}
    </section>
  );
}
