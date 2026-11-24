import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';
import { PifOrderAlerts } from '../design-system/PifOrderAlerts';

interface NavItem {
  to: string;
  label: string;
  /** Shown only when the staff member holds this permission (usability, not security). */
  permission?: string;
  /**
   * …or ANY of these. Fulfilment is reachable by two different roles — the
   * pickup counter and the administrator who works the delivery lane — and
   * each holds its own code, so one `permission` could only ever show it to
   * one of them.
   */
  anyPermission?: readonly string[];
  module: 'shared' | 'rik' | 'pif';
  /**
   * The heading this item sits under. One portal, two modules: the sections
   * make the separation visible, and the permission filter above decides
   * whether a section appears for this staff member at all — a PIF
   * administrator never sees the RIK heading, and the reverse.
   */
  section?: 'RIK Administration' | 'PIF Administration';
}

/**
 * Navigation is role-aware: an item appears only when the signed-in
 * staff member actually holds the permission that governs the data
 * behind it. Every permission code below exists in the approved seed.
 *
 * This is a usability filter and nothing more. The server authorizes
 * every request independently, so typing a hidden route's URL reaches a
 * screen that renders the unauthorized state from a real 403 — proven
 * by the role-isolation tests in apps/api.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', module: 'shared' },
  { to: '/announcements', label: 'Announcements', permission: 'shared.announcement.manage', module: 'shared' },
  // Staff accounts. `shared.user.manage` is held by SUPER_ADMIN alone in the
  // approved seed, so this entry appears for a Super Admin and for nobody
  // else — and, as with every item here, hiding it is a usability filter:
  // the API refuses the underlying routes on its own.
  { to: '/staff', label: 'Staff accounts', permission: 'shared.user.manage', module: 'shared' },
  // Shared settings — currently the PIF self-registration switch. Gated on
  // `shared.settings.write`, which the approved seed grants to SUPER_ADMIN
  // alone, so this appears for a Super Admin and for nobody else. Same
  // caveat as every entry here: the API refuses both routes behind it
  // independently of what this filter decided to draw.
  { to: '/settings', label: 'Settings', permission: 'shared.settings.write', module: 'shared' },
  {
    to: '/rik',
    label: 'RIK overview',
    // Gated like everything else: a PIF administrator holds no rik.* code and
    // so sees no RIK heading at all.
    anyPermission: [
      'rik.entitlement.allocate',
      'rik.entitlement.adjust',
      'rik.order.manage',
      'rik.order.mark_collected',
      'rik.issue_schedule.manage',
      'rik.product.manage',
    ],
    module: 'rik',
    section: 'RIK Administration',
  },
  { to: '/rik/officers', label: 'Officers', section: 'RIK Administration', permission: 'rik.entitlement.allocate', module: 'rik' },
  { to: '/rik/eligibility', label: 'Eligibility', section: 'RIK Administration', permission: 'rik.entitlement.allocate', module: 'rik' },
  { to: '/rik/config', label: 'RIK configuration', section: 'RIK Administration', permission: 'rik.entitlement.adjust', module: 'rik' },
  { to: '/rik/issue-windows', label: 'Issue windows', section: 'RIK Administration', permission: 'rik.issue_schedule.manage', module: 'rik' },
  // PHASE B. Same permission as Issue vouchers, and immediately before it,
  // because this is where the work arrives and that is where it goes. The
  // code is `rik.order.manage` rather than a new one: every row in the queue
  // exists to be turned into a voucher by the endpoint that same code
  // governs, so anyone who can see the queue can already work it.
  { to: '/rik/incoming-requests', label: 'Incoming requests', section: 'RIK Administration', permission: 'rik.order.manage', module: 'rik' },
  { to: '/rik/issue-vouchers', label: 'Issue vouchers', section: 'RIK Administration', permission: 'rik.order.manage', module: 'rik' },
  {
    to: '/rik/fulfillment',
    label: 'Fulfilment',
    anyPermission: ['rik.order.mark_collected', 'rik.order.manage'],
    module: 'rik',
    section: 'RIK Administration',
  },
  // ISSUE SCHEDULES IS NOT LISTED HERE, DELIBERATELY.
  //
  // `rik.issue_schedules` is a structure the approved schema provides and
  // that was never switched on: its repository is read-only by design —
  // there is no create or update path anywhere — and the table is empty,
  // so the screen could only ever show an empty state. Offering it in the
  // sidebar invited an administrator to open it, find nothing, and wonder
  // what was broken.
  //
  // ONLY THE MENU ENTRY WAS REMOVED. The route (/rik/issue-schedules), the
  // page, the API endpoint, the repository and the table all remain exactly
  // as they were, so anyone holding a direct link still reaches it and
  // nothing behind it changed. This is a visibility decision, not a
  // deletion.
  //
  // NOTE FOR ANYONE TIDYING UP LATER: `rik.issue_schedule.manage` is still
  // in use — it is the permission that governs ISSUE WINDOWS, two lines
  // above, and it also appears in the RIK section's own permission list.
  // Removing it because this entry went would hide Issue windows from an
  // administrator who holds nothing else.
  // PHASE F — PIF administration, inside this same portal and under its own
  // heading. Each item names the permission that governs the data behind it,
  // so a RIK administrator (who holds no pif.* code) sees none of them.
  { to: '/pif/dashboard', label: 'PIF dashboard', anyPermission: ['pif.order.prepare', 'pif.order.manage', 'pif.product.manage'], module: 'pif', section: 'PIF Administration' },
  { to: '/pif/orders', label: 'Orders', anyPermission: ['pif.order.prepare', 'pif.order.manage', 'pif.order.mark_delivered', 'pif.order.mark_not_delivered'], module: 'pif', section: 'PIF Administration' },
  { to: '/pif/categories', label: 'Product categories', permission: 'pif.product.manage', module: 'pif', section: 'PIF Administration' },
  { to: '/pif/products', label: 'Product catalogue', permission: 'pif.product.manage', module: 'pif', section: 'PIF Administration' },
  { to: '/pif/products/import', label: 'Import products', permission: 'pif.product.manage', module: 'pif', section: 'PIF Administration' },
  // The order-alert sound the client manages themselves. Same permission as
  // the other client-managed PIF content, because that is what it is.
  { to: '/pif/settings/notifications', label: 'Notification settings', permission: 'pif.product.manage', module: 'pif', section: 'PIF Administration' },
  {
    to: '/pif',
    label: 'PIF overview',
    anyPermission: [
      'pif.product.manage',
      'pif.order.manage',
      'pif.order.prepare',
      'pif.report.view',
      'pif.order.mark_delivered',
      'pif.order.mark_not_delivered',
    ],
    module: 'pif',
    section: 'PIF Administration',
  },
  { to: '/account', label: 'Your account', module: 'shared' },
];

/**
 * The staff application shell: identity header, role-aware navigation,
 * and the routed content area. Responsive by construction — the
 * navigation is a collapsible drawer below `lg` and a persistent
 * sidebar at `lg` and above, so the same shell works on a facility
 * desktop and on a phone without a separate mobile build.
 */
const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex min-h-touch items-center rounded-lg px-3 py-2 text-sm font-medium',
    isActive ? 'bg-brand-forest text-white' : 'text-slate-700 hover:bg-slate-100',
  ].join(' ');

export function AdminLayout() {
  const { pathname } = useLocation();
  const { session, logout } = useStaffAuth();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.anyPermission) {
      return item.anyPermission.some((code) => session?.permissions.includes(code) ?? false);
    }
    return !item.permission || (session?.permissions.includes(item.permission) ?? false);
  });

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* PHASE C — chrome, not content. Hidden when a voucher is printed. */}
      <header data-print="hide" className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
            className="flex h-touch w-touch items-center justify-center rounded-lg hover:bg-slate-100 lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <div className="flex min-w-0 items-center gap-2">
            {/* The approved logo, used unaltered — see AS-2: no horizontal
                lockup has been supplied, so the square asset is scaled,
                never cropped, to fit the header. */}
            <img src="/brand/e-samagri-logo.jpg" alt="e Samagri" className="h-9 w-9 rounded object-contain" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-brand-forest">e Samagri Admin</p>
              <p className="truncate text-xs text-slate-500">Administration Portal</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="truncate text-sm font-semibold text-slate-800">{session?.displayName ?? session?.username ?? 'Staff'}</p>
              <p className="truncate text-xs text-slate-500">{session?.roles.join(', ') || 'No role assigned'}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="min-h-touch rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6">
        <nav
          data-print="hide"
          aria-label="Admin sections"
          className={[
            'w-full shrink-0 lg:block lg:w-56',
            navOpen ? 'block' : 'hidden',
          ].join(' ')}
        >
          <ul className="flex flex-col gap-1">
            {/*
              One portal, two modules. Items with no section (Dashboard,
              Announcements, Your account) are shared and sit at the top;
              the RIK and PIF groups follow under their own headings, and a
              heading only appears when this staff member can reach
              something inside it.
            */}
            {visible
              .filter((item) => item.section === undefined)
              .map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setNavOpen(false)}
                    className={navClass}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}

            {(['RIK Administration', 'PIF Administration'] as const).map((section) => {
              const items = visible.filter((item) => item.section === section);
              if (items.length === 0) return null;
              return (
                <li key={section} className="mt-3">
                  <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {section}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => setNavOpen(false)}
                          className={navClass}
                        >
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className={['min-w-0 flex-1', navOpen ? 'hidden lg:block' : 'block'].join(' ')}>
          <Outlet />
        </main>
      </div>

      {/*
        THE PIF INCOMING-ORDER ALERT, AND ONLY ON PIF SCREENS.

        PIF's routes are flat siblings of RIK's under this layout, so there is
        no PIF layout element to hang this on. Rather than restructure the
        router for one panel, it mounts here behind an explicit path test:
        on /pif and everything under it, and nowhere else.

        That test is the whole of the RIK exclusion, and it is deliberately a
        condition on RENDERING rather than on behaviour: off a PIF route the
        component is never mounted, so its polling timer does not exist, no
        request is made and no sound can play. A RIK screen is not a PIF
        screen with the alert switched off; it has nothing to switch off.

        It stays mounted while the reader moves between PIF pages, which is
        what keeps a pending alert alive across PIF navigation.
      */}
      {pathname === '/pif' || pathname.startsWith('/pif/') ? <PifOrderAlerts /> : null}
    </div>
  );
}
