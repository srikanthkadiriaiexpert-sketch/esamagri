import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from '../design-system/BottomNav';
import { AppDrawer } from '../design-system/AppDrawer';
import { StickyCartBar } from '../design-system/StickyCartBar';
import { usePifCartTotal } from '../lib/cart/usePifCartTotal';

/**
 * Shared shell for every authenticated screen: bottom nav (Home /
 * Categories / Orders / Account — STEP 8 Section 8) plus the drawer.
 * Individual pages own their own header (module-tinted for RIK/PIF,
 * plain for Home/Account) via <Header>/<HomeHeader>, so this layout
 * only supplies what's truly global.
 */
/**
 * PIF routes that belong to a business which does not sell through this app.
 * Kept here beside the rule it governs rather than derived from the business
 * list, so a reader of this file can see exactly which paths are excluded.
 */
/**
 * The two PIF shops render their own five-item bottom bar, from the approved
 * mockup — the fifth item is Cart, which the shared bar does not carry and
 * must not, because the shared bar is also shown on every RIK screen and RIK
 * keeps a separate basket. The shared four-item bar steps aside on these
 * paths so the two never stack, and is left exactly as it is for RIK and
 * everything else.
 */
const OWN_BOTTOM_NAV_PATHS = ['/pif/grocers', '/pif/fresh-mart'] as const;

const NON_SELLING_PIF_PATHS = [
  '/pif/fit-food-bay',
  '/pif/kelvin-scale',
  '/pif/visakha-dairy',
  '/pif/laddu-gopal',
] as const;

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const pifCart = usePifCartTotal();

  /*
   * THE STICKY CART BAR LIVES HERE, not on each screen.
   *
   * It was missing entirely before, and putting it in the shell is what
   * makes "it appears the moment something is added" true everywhere rather
   * than on the screens somebody remembered. It is shown on the PIF shop
   * screens and withheld on the two where it would be noise or an
   * obstruction — the cart itself and checkout, both of which already carry
   * their own total and their own primary action.
   *
   * RIK never sees it. The two modules keep separate carts, and a ration
   * selection is not a basket with a price.
   */
  const onPifShop =
    location.pathname.startsWith('/pif') &&
    !location.pathname.startsWith('/pif/cart') &&
    !location.pathname.startsWith('/pif/checkout') &&
    // The four businesses that sell nothing here must not carry a basket.
    // Showing a cart total over an ice-cream menu invites a tap that leads
    // to groceries the reader never chose.
    !NON_SELLING_PIF_PATHS.some((p) => location.pathname.startsWith(p));
  const showCartBar = onPifShop && pifCart.itemCount > 0;
  const ownsBottomNav = OWN_BOTTOM_NAV_PATHS.some((p) => location.pathname.startsWith(p));

  return (
    <div className={showCartBar ? 'min-h-screen pb-36' : 'min-h-screen pb-20'}>
      <Outlet context={{ openDrawer: () => setDrawerOpen(true) }} />
      {showCartBar ? (
        <StickyCartBar
          itemCount={pifCart.itemCount}
          total={pifCart.total}
          pricing={pifCart.pricing}
          onClick={() => navigate('/pif/cart')}
        />
      ) : null}
      {ownsBottomNav ? null : (
      <BottomNav
        items={[
          { to: '/', label: 'Home', icon: <HomeIcon /> },
          { to: '/categories', label: 'Categories', icon: <CategoriesIcon />, matchPrefixes: ['/rik/categories', '/pif/categories'] },
          { to: '/orders', label: 'Orders', icon: <OrdersIcon />, matchPrefixes: ['/rik/orders', '/pif/orders'] },
          { to: '/account', label: 'Account', icon: <AccountIcon /> },
        ]}
      />
      )}
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22" className="h-6 w-6" fill="none">
      <path d="M4 10.5L11 4l7 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9.5V18h10V9.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function CategoriesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22" className="h-6 w-6" fill="none">
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="12" y="3.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3.5" y="12" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="12" y="12" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function OrdersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22" className="h-6 w-6" fill="none">
      <rect x="4.5" y="3.5" width="13" height="16" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 8.5h6M8 12h6M8 15.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function AccountIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22" className="h-6 w-6" fill="none">
      <circle cx="11" cy="7.5" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 18c1.2-3.3 4-4.8 6.5-4.8s5.3 1.5 6.5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
