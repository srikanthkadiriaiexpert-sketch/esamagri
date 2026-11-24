import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../lib/api/resource';
import { fetchDashboard, type DashboardTile } from '../lib/api/admin-api';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';

/**
 * Dashboard foundation (STEP 10 Section 4).
 *
 * A tile shows either a real figure the server actually queried, or an
 * explicit "not available yet" with the reason. There is no third kind
 * of tile, and no number on this screen is invented: no sales, revenue,
 * inventory, order, customer, entitlement, product, cash or purchasing
 * figure is fabricated anywhere. Which tiles appear at all is decided
 * server-side from the staff member's real permissions.
 */
/**
 * Where each tile goes, when it goes anywhere.
 *
 * KEPT IN THE BROWSER, NOT RETURNED BY THE API. A route is a fact about
 * this application's own navigation; the server has no business knowing
 * that /rik/config exists, and shipping routes from the API would mean
 * the two could drift apart with no compiler to notice.
 *
 * A key absent from this map renders as a plain, unfocusable card. That
 * is the default and it is deliberate: a tile becomes clickable only by
 * being listed here, so a new tile cannot accidentally arrive with a
 * link to nowhere.
 *
 * The SERVER still decides whether a tile appears at all, from the staff
 * member's real permissions. This map only says where a tile that was
 * already permitted should lead. Every destination below is governed by
 * the same permission that produced its tile — checked when this was
 * written, and the reason rik-entitlements is gated on
 * `rik.entitlement.adjust`: /rik/config requires that code, and the tile
 * previously used `rik.entitlement.allocate`, which would have offered a
 * link that led to a refusal.
 *
 * NOT LISTED, ON PURPOSE: pif-reports, which is not built. The absence
 * of a link is the honest signal, and it is paired with the reason the
 * server supplies.
 */
const TILE_ROUTES: Readonly<Record<string, string>> = {
  announcements: '/announcements',
  'rik-issue-windows': '/rik/issue-windows',
  'rik-entitlements': '/rik/config',
  'rik-issue-vouchers': '/rik/issue-vouchers',
  'rik-provisions': '/rik/config/provisions',
  'pif-products': '/pif/products',
};

export function DashboardPage() {
  const { session } = useStaffAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const dashboard = useResource<{ tiles: DashboardTile[] }>(() => fetchDashboard(), [reloadKey]);

  return (
    <section aria-labelledby="dashboard-heading">
      <div className="mb-4">
        <h1 id="dashboard-heading" className="text-xl font-bold text-brand-forest">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {session?.displayName ?? session?.username ?? 'staff'}
          {session?.roles.length ? ` · ${session.roles.join(', ')}` : ' · no role assigned'}
        </p>
      </div>

      {dashboard.status === 'loading' ? <LoadingState label="Loading dashboard…" /> : null}
      {dashboard.status === 'error' ? <FailureState error={dashboard.error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {dashboard.status === 'not_implemented' ? (
        <EmptyState title="Dashboard data is not available yet." />
      ) : null}

      {dashboard.status === 'success' && dashboard.data.tiles.length === 0 ? (
        <EmptyState
          title="Nothing is assigned to you yet"
          description="Your account has no permissions granted, so there is nothing to show here. A super administrator can grant your role."
        />
      ) : null}

      {dashboard.status === 'success' && dashboard.data.tiles.length > 0 ? (
        /*
          THREE COLUMNS FROM `lg`, NOT `xl`, AND THE WIDTH WAS MEASURED.
          The shell is max-w-7xl (1280px) less px-4 either side (32px),
          less the sidebar at lg:w-56 (224px), less gap-6 (24px) — so a
          desktop content column is 1000px, not 1280. Three cards and two
          12px gaps need 984px, which fits with room to spare, and `xl`
          was holding two wide columns on screens that comfortably take
          three.

          `min-w-0` on every item because a grid item's default min-width
          is auto: a long label would otherwise widen its track and push
          the row past the container instead of wrapping. <main> already
          carries min-w-0 for the same reason one level up.
        */
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {dashboard.data.tiles.map((tile) => (
            <li key={tile.key} className="min-w-0">
              <Tile tile={tile} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * One tile — a LINK when it has somewhere to go, and a plain card
 * otherwise.
 *
 * A REAL <Link>, NEVER A CLICKABLE <div>. An anchor is reachable by Tab,
 * activated by Enter, announced as a link, and can be opened in a new
 * tab with the middle mouse button or a modifier — all of which a div
 * with an onClick silently loses, and none of which `tabIndex` and a
 * keydown handler put back properly. The focus ring is visible rather
 * than suppressed, because an administrator navigating by keyboard has
 * to be able to see where they are.
 *
 * An unavailable tile stays a <div>: not focusable, no hover, no
 * pointer. The absence of affordance is the message, and it matches the
 * reason printed inside.
 */
function Tile({ tile }: { tile: DashboardTile }) {
  const moduleLabel = tile.module === 'rik' ? 'RIK' : tile.module === 'pif' ? 'PIF' : 'Shared';
  const accent =
    tile.module === 'rik' ? 'text-brand-blueDark bg-brand-blueLight' : tile.module === 'pif' ? 'text-brand-greenDark bg-brand-greenLight' : 'text-slate-600 bg-slate-100';

  const to = tile.status === 'available' ? TILE_ROUTES[tile.key] : undefined;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        {/* min-w-0 + break-words: a long label wraps inside the tile
            rather than widening it and pushing the grid row out. */}
        <p className="min-w-0 break-words text-sm font-semibold text-slate-800">{tile.label}</p>
        <span className={['shrink-0 rounded px-2 py-0.5 text-xs font-bold', accent].join(' ')}>
          {moduleLabel}
        </span>
      </div>

      {tile.status === 'available' && tile.value !== undefined ? (
        <p className="mt-3 text-3xl font-extrabold tabular-nums text-brand-forest">{tile.value}</p>
      ) : tile.status === 'available' ? (
        // A built screen with no figure of its own. Says where it goes
        // instead of showing a number nobody queried.
        <p className="mt-3 text-sm font-semibold text-brand-blueDark">Open →</p>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{tile.reason ?? 'Not available yet.'}</p>
      )}
    </>
  );

  const shared = 'flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4';

  if (to === undefined) {
    return <div className={shared}>{body}</div>;
  }

  return (
    <Link
      to={to}
      className={[
        shared,
        'cursor-pointer transition hover:border-brand-blue hover:shadow-sm',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2',
      ].join(' ')}
    >
      {body}
    </Link>
  );
}
