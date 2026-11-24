import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth/AuthContext';
import { RequireAuth } from '../lib/auth/RequireAuth';
import { RequireRikProfile } from '../lib/auth/RequireRikProfile';
import { RikCartProvider } from '../lib/cart/RikCartContext';
import { PifCartProvider } from '../lib/cart/PifCartContext';
import { ToastProvider } from '../design-system/ToastProvider';

import { AppLayout } from '../routes/AppLayout';
import { LoginMobilePage } from '../routes/auth/LoginMobilePage';
import { RegisterPage } from '../routes/auth/RegisterPage';
import { VerifyOtpPage } from '../routes/auth/VerifyOtpPage';
import { HomePage } from '../routes/HomePage';
import { CategoriesChooserPage } from '../routes/CategoriesChooserPage';
import { OrdersChooserPage } from '../routes/OrdersChooserPage';
import { NotFoundPage } from '../routes/NotFoundPage';

import { RikIssueSchedulePage } from '../routes/rik/RikIssueSchedulePage';
import { RikIssueVouchersPage } from '../routes/rik/RikIssueVouchersPage';
import { RikIssueVoucherPage } from '../routes/rik/RikIssueVoucherPage';
import { RikHomePage } from '../routes/rik/RikHomePage';
import { RikCategoryPage } from '../routes/rik/RikCategoryPage';
import { RikProductDetailPage } from '../routes/rik/RikProductDetailPage';
import { RikSearchPage } from '../routes/rik/RikSearchPage';
import { NutritionInfoPage } from '../routes/rik/NutritionInfoPage';
import { NewArrivalsPage } from '../routes/rik/NewArrivalsPage';
import { RikCartPage } from '../routes/rik/RikCartPage';
import { RikCheckoutPage } from '../routes/rik/RikCheckoutPage';
import { RikOrdersPage } from '../routes/rik/RikOrdersPage';
import { RikOrderDetailPage } from '../routes/rik/RikOrderDetailPage';
import { KnowYourRationPage } from '../routes/rik/ration/KnowYourRationPage';
import { RationCategoryPage } from '../routes/rik/ration/RationCategoryPage';
import { RationCheckoutPage } from '../routes/rik/ration/RationCheckoutPage';

import { PifBusinessesPage } from '../routes/pif/PifBusinessesPage';
import { GrocersShopPage } from '../routes/pif/business/GrocersShopPage';
import { FreshMartShopPage } from '../routes/pif/business/FreshMartShopPage';
import { BusinessInfoPage } from '../routes/pif/business/BusinessInfoPage';
import { PifCategoryPage } from '../routes/pif/PifCategoryPage';
import { PifProductDetailPage } from '../routes/pif/PifProductDetailPage';
import { PifSearchPage } from '../routes/pif/PifSearchPage';
import { PifCartPage } from '../routes/pif/PifCartPage';
import { PifCheckoutPage } from '../routes/pif/PifCheckoutPage';
import { PifOrdersPage } from '../routes/pif/PifOrdersPage';
import { PifOrderDetailPage } from '../routes/pif/PifOrderDetailPage';

import { AccountPage } from '../routes/account/AccountPage';
import { ProfilePage } from '../routes/account/ProfilePage';
import { NotificationsPage } from '../routes/account/NotificationsPage';

/**
 * e Samagri customer app shell (Phase 3B STEP 8). Routing structure:
 *
 *  /auth/login, /auth/verify        — public, real STEP 6 OTP flow
 *  everything else                  — behind <RequireAuth>, inside <AppLayout>
 *    /                               — Home (RIK/PIF selector — Section 4)
 *    /rik/*                         — RIK module (Section 5), own <RikCartProvider>
 *      /rik/ration, /rik/ration/:poolId — Know Your Ration (STEP 11D),
 *                                       the customer's real entitlement
 *      /rik/ration/confirm              — review, acknowledge availability,
 *                                       choose fulfillment, confirm (STEP 11E).
 *                                       Deliberately NOT /rik/checkout, which
 *                                       the STEP 8 catalogue cart already owns:
 *                                       a ration issue and a cart checkout are
 *                                       different things and must not share a
 *                                       URL. The static segment outranks
 *                                       :poolId, so the two never collide.
 *    /pif/*                         — PIF module (Section 6), own <PifCartProvider>
 *    /categories, /orders           — bottom-nav targets that route into the right module
 *    /account, /account/notifications
 *
 * Both cart providers are mounted once, permanently, at the root —
 * see lib/cart/createCartContext.ts for why that's what makes "RIK
 * and PIF have strictly separate carts" (Section 7) actually true
 * rather than just filtered-by-field.
 */
/**
 * The two carts, tied to whoever is signed in.
 *
 * Mounted inside <AuthProvider> so it can read the signed-in customer's id
 * and hand it to each cart as its `ownerKey`. That id is what lets a basket
 * survive a reload (a phone app loses its tab constantly) while making it
 * impossible for one customer's basket to appear in front of the next
 * person to sign in on the same device: a different id is a different key,
 * and no id at all means no stored cart.
 */
function CartProviders({ children }: { children: ReactNode }) {
  const { principal } = useAuth();
  const ownerKey = principal?.principalType === 'CUSTOMER' ? principal.principalId : null;
  return (
    <RikCartProvider ownerKey={ownerKey}>
      <PifCartProvider ownerKey={ownerKey}>{children}</PifCartProvider>
    </RikCartProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <CartProviders>
              <Routes>
                <Route path="/auth/login" element={<LoginMobilePage />} />
                <Route path="/auth/register" element={<RegisterPage />} />
                <Route path="/auth/verify" element={<VerifyOtpPage />} />

                <Route
                  element={
                    <RequireAuth>
                      <AppLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<HomePage />} />
                  <Route path="/categories" element={<CategoriesChooserPage />} />
                  <Route path="/orders" element={<OrdersChooserPage />} />

                  {/*
                    COMMON CONTENT — outside RequireRikProfile on purpose.

                    Nutrition Info is a reference page about the food and New
                    Arrivals is a shop window. Neither selects anything, counts
                    anything against an allowance, or reads an entitlement,
                    a period or an eligibility row; both now read `/content/*`,
                    which requires a customer and not a ration-approved one.

                    They used to live at `/rik/nutrition` and
                    `/rik/new-arrivals`, inside the guard below, which is why a
                    PIF-only resident could not open them. The old paths are
                    redirected rather than deleted, so a bookmark, a cached
                    bundle or a link in an old announcement still lands on the
                    page instead of on "Rations are not available".
                  */}
                  <Route path="/nutrition" element={<NutritionInfoPage />} />
                  <Route path="/new-arrivals" element={<NewArrivalsPage />} />
                  <Route path="/rik/nutrition" element={<Navigate to="/nutrition" replace />} />
                  <Route
                    path="/rik/new-arrivals"
                    element={<Navigate to="/new-arrivals" replace />}
                  />

                  {/* Every RIK route sits inside RequireRikProfile, which
                      shows a PIF-only resident one clear sentence instead of a
                      screen of failed requests. It is NOT the protection —
                      @RequireRikCustomer on the server refuses these endpoints
                      regardless. A layout route rather than fifteen wrappers,
                      so a RIK route added later is covered by construction. */}
                  <Route
                    element={
                      <RequireRikProfile>
                        <Outlet />
                      </RequireRikProfile>
                    }
                  >
                  <Route path="/rik" element={<RikHomePage />} />
                  <Route path="/rik/ration" element={<KnowYourRationPage />} />
                  <Route path="/rik/issue-schedule" element={<RikIssueSchedulePage />} />
                  <Route path="/rik/issue-vouchers" element={<RikIssueVouchersPage />} />
                  <Route path="/rik/issue-vouchers/:voucherId" element={<RikIssueVoucherPage />} />
                  <Route path="/rik/ration/confirm" element={<RationCheckoutPage />} />
                  <Route path="/rik/ration/:poolId" element={<RationCategoryPage />} />
                  <Route path="/rik/search" element={<RikSearchPage />} />
                  <Route path="/rik/categories/:categoryId" element={<RikCategoryPage />} />
                  <Route path="/rik/products/:productId" element={<RikProductDetailPage />} />
                  <Route path="/rik/cart" element={<RikCartPage />} />
                  <Route path="/rik/checkout" element={<RikCheckoutPage />} />
                  <Route path="/rik/orders" element={<RikOrdersPage />} />
                  <Route path="/rik/orders/:orderId" element={<RikOrderDetailPage />} />
                  </Route>

                  {/* PIF entry is now the six-business chooser. The grocery
                      shop itself did not move: every route below /pif that
                      existed before still resolves to the same page, so the
                      cart, checkout, search, orders and product screens are
                      untouched. The shop's own home is /pif/grocers. */}
                  <Route path="/pif" element={<PifBusinessesPage />} />

                  {/* Grocers and Fresh Mart are the SAME approved screen —
                      see routes/pif/business/ShopScreen.tsx. Each has its own
                      page only because the drawer holds a different slice of
                      a different tree: Fresh Mart's whole catalogue is ten
                      entries and fits, Grocers' nineteen mains open one at a
                      time. */}
                  <Route path="/pif/grocers" element={<GrocersShopPage />} />
                  <Route path="/pif/grocers/:mainSlug" element={<GrocersShopPage />} />
                  <Route path="/pif/grocers/:mainSlug/:subSlug" element={<GrocersShopPage />} />

                  <Route
                    path="/pif/fresh-mart"
                    element={<FreshMartShopPage />}
                  />
                  <Route
                    path="/pif/fresh-mart/:mainSlug"
                    element={<FreshMartShopPage />}
                  />
                  <Route
                    path="/pif/fresh-mart/:mainSlug/:subSlug"
                    element={<FreshMartShopPage />}
                  />

                  <Route path="/pif/fit-food-bay" element={<BusinessInfoPage businessSlug="fit-food-bay" />} />
                  <Route path="/pif/kelvin-scale" element={<BusinessInfoPage businessSlug="kelvin-scale" />} />
                  <Route path="/pif/visakha-dairy" element={<BusinessInfoPage businessSlug="visakha-dairy" />} />
                  <Route path="/pif/laddu-gopal" element={<BusinessInfoPage businessSlug="laddu-gopal" />} />

                  <Route path="/pif/search" element={<PifSearchPage />} />
                  <Route path="/pif/categories/:categoryId" element={<PifCategoryPage />} />
                  <Route path="/pif/products/:productId" element={<PifProductDetailPage />} />
                  <Route path="/pif/cart" element={<PifCartPage />} />
                  <Route path="/pif/checkout" element={<PifCheckoutPage />} />
                  <Route path="/pif/orders" element={<PifOrdersPage />} />
                  <Route path="/pif/orders/:orderId" element={<PifOrderDetailPage />} />

                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/account/profile" element={<ProfilePage />} />
                  <Route path="/account/notifications" element={<NotificationsPage />} />
                </Route>

                <Route path="/auth" element={<Navigate to="/auth/login" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
          </CartProviders>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
