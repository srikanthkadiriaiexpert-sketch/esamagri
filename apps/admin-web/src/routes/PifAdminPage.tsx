import { Link } from 'react-router-dom';
import { EmptyState } from '../design-system/States';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';

/**
 * PIF administration — the overview (PHASE F).
 *
 * WHAT CHANGED HERE, AND WHY. This screen used to advertise seven areas,
 * three of which — Inventory, Purchase orders, Point of sale — were removed
 * from the PIF scope by the corrected specification. They are gone, not
 * hidden: an admin console that lists a module the product will never
 * contain is misleading even when every tile says "not built yet".
 *
 * What remains is what PIF actually is: a grocery catalogue the facility
 * manages itself, and an order desk. Each card below links to a screen that
 * works, and each appears only when the signed-in staff member holds the
 * permission that governs the data behind it.
 */
interface Area {
  label: string;
  to: string;
  detail: string;
  /** Any one of these is enough to use the screen. */
  permissions: readonly string[];
}

const AREAS: readonly Area[] = [
  {
    label: 'PIF dashboard',
    to: '/pif/dashboard',
    detail: 'New orders waiting, what is in progress, and the state of the catalogue.',
    permissions: ['pif.order.prepare', 'pif.order.manage', 'pif.product.manage'],
  },
  {
    label: 'Orders',
    to: '/pif/orders',
    detail:
      'Accept, prepare and hand over customer orders, and record the cash collected on delivery.',
    permissions: [
      'pif.order.prepare',
      'pif.order.manage',
      'pif.order.mark_delivered',
      'pif.order.mark_not_delivered',
    ],
  },
  {
    label: 'Product categories',
    to: '/pif/categories',
    detail: 'Categories and the subcategories under them, as customers browse them.',
    permissions: ['pif.product.manage'],
  },
  {
    label: 'Product catalogue',
    to: '/pif/products',
    detail:
      'Products, prices, GST, pack sizes, order limits, availability and product photographs.',
    permissions: ['pif.product.manage'],
  },
];

export function PifAdminPage() {
  const { session } = useStaffAuth();
  const held = session?.permissions ?? [];
  const permitted = AREAS.filter((area) => area.permissions.some((code) => held.includes(code)));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">PIF administration</h1>
        <p className="mt-1 text-sm text-slate-600">
          Payment Issue Facility — the facility&apos;s online grocery shop. Ration (RIK) work is a
          separate section of this portal, with separate permissions.
        </p>
      </header>

      {permitted.length === 0 ? (
        <EmptyState
          title="Nothing here is yours"
          description="Your account holds no PIF permission. If that is wrong, ask an administrator to grant it."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {permitted.map((area) => (
            <li key={area.to}>
              <Link
                to={area.to}
                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-forest hover:bg-brand-greenLight"
              >
                <span className="text-sm font-bold text-slate-900">{area.label}</span>
                <span className="mt-1 text-sm text-slate-600">{area.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">What PIF does not do</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          There is no point of sale, no billing, no invoice or receipt, no cash drawer, no purchase
          orders, no suppliers and no stock quantity. The facility&apos;s own billing software
          raises the bill; e&nbsp;Samagri records the order, what happened to it, and the cash
          collected at handover. &ldquo;Available&rdquo; on a product is a switch an administrator
          sets for the day, not a counted balance.
        </p>
      </section>
    </div>
  );
}
