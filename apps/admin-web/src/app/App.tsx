import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StaffAuthProvider, useStaffAuth } from '../lib/auth/StaffAuthContext';
import { RequireStaffAuth } from '../lib/auth/RequireStaffAuth';

import { AdminLayout } from '../routes/AdminLayout';
import { LoginPage } from '../routes/LoginPage';
import { DashboardPage } from '../routes/DashboardPage';
import { AnnouncementsPage } from '../routes/AnnouncementsPage';
import { RikAdminPage } from '../routes/RikAdminPage';
import { PifAdminPage } from '../routes/PifAdminPage';
import { PifDashboardPage } from '../routes/pif/PifDashboardPage';
import { PifCategoriesPage } from '../routes/pif/PifCategoriesPage';
import { PifProductsPage } from '../routes/pif/PifProductsPage';
import { PifProductImportPage } from '../routes/pif/PifProductImportPage';
import { PifOrdersPage } from '../routes/pif/PifOrdersPage';
import { PifNotificationSettingsPage } from '../routes/pif/PifNotificationSettingsPage';
import { IssueSchedulesPage } from '../routes/IssueSchedulesPage';
import { OfficersPage } from '../routes/OfficersPage';
import { EligibilityImportPage } from '../routes/EligibilityImportPage';
import { IssueWindowsPage } from '../routes/IssueWindowsPage';
import { IncomingRequestsPage } from '../routes/IncomingRequestsPage';
import { IssueVouchersPage } from '../routes/IssueVouchersPage';
import { FulfillmentPage } from '../routes/FulfillmentPage';
import { RikConfigLayout } from '../routes/rik-config/RikConfigLayout';
import { PoolsPage } from '../routes/rik-config/PoolsPage';
import { ScalesPage } from '../routes/rik-config/ScalesPage';
import { ConversionsPage } from '../routes/rik-config/ConversionsPage';
import { ProvisionsPage } from '../routes/rik-config/ProvisionsPage';
import { NewArrivalsPage } from '../routes/rik-config/NewArrivalsPage';
import { BannersPage } from '../routes/rik-config/BannersPage';
import { PackSizesPage } from '../routes/rik-config/PackSizesPage';
import { AvailabilityPage } from '../routes/rik-config/AvailabilityPage';
import { PickupLocationsPage } from '../routes/rik-config/PickupLocationsPage';
import { PeriodsPage } from '../routes/rik-config/PeriodsPage';
import { RuleHistoryPage } from '../routes/rik-config/RuleHistoryPage';
import { StaffPage } from '../routes/StaffPage';
import { AccountPage } from '../routes/AccountPage';
import { SettingsPage } from '../routes/SettingsPage';
import { NotFoundPage } from '../routes/NotFoundPage';

/**
 * e Samagri admin/staff application shell (Phase 3B STEP 10).
 *
 *   /login            — public; the existing STEP 6 staff credential flow
 *   everything else   — behind <RequireStaffAuth>, inside <AdminLayout>
 *     /                          Dashboard
 *     /announcements             Shared announcement administration
 *     /staff                     Staff accounts and roles — Super Admin
 *                                only, enforced by the API on every
 *                                request and not by this route
 *     /rik, /rik/issue-schedules RIK administration
 *     /rik/config/*              RIK entitlement configuration — seven
 *                                screens from STEP 11C plus collection
 *                                points from STEP 11E, each gated by the
 *                                permission that governs the data behind
 *                                it
 *     /pif                       PIF administration
 *     /account                   The signed-in staff member's own account
 *
 * Every route below is reachable by URL. That is intentional and safe:
 * navigation visibility is a usability filter only, and each screen's
 * data comes from a server endpoint that authorizes independently, so
 * typing a hidden route's address produces the honest unauthorized
 * state from a real 403 rather than any data.
 *
 * No route here is a placeholder for an unbuilt feature dressed up as a
 * working one — an area whose module does not yet exist says so
 * explicitly, and shows nothing else.
 */
export function App() {
  return (
    <BrowserRouter>
      <StaffAuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectWhenSignedIn>
                <LoginPage />
              </RedirectWhenSignedIn>
            }
          />

          <Route
            element={
              <RequireStaffAuth>
                <AdminLayout />
              </RequireStaffAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/rik" element={<RikAdminPage />} />
            <Route path="/rik/officers" element={<OfficersPage />} />
            <Route path="/rik/eligibility" element={<EligibilityImportPage />} />
            <Route path="/rik/issue-windows" element={<IssueWindowsPage />} />
            {/* PHASE B — confirmed selections awaiting a voucher. Sits before
                issue vouchers because it is the step before one exists. */}
            <Route path="/rik/incoming-requests" element={<IncomingRequestsPage />} />
            <Route path="/rik/issue-vouchers" element={<IssueVouchersPage />} />
            <Route path="/rik/fulfillment" element={<FulfillmentPage />} />
            <Route path="/rik/issue-schedules" element={<IssueSchedulesPage />} />
            <Route path="/rik/config" element={<RikConfigLayout />}>
              <Route index element={<PoolsPage />} />
              <Route path="periods" element={<PeriodsPage />} />
              <Route path="scales" element={<ScalesPage />} />
              <Route path="conversions" element={<ConversionsPage />} />
              <Route path="provisions" element={<ProvisionsPage />} />
              <Route path="new-arrivals" element={<NewArrivalsPage />} />
              <Route path="banners" element={<BannersPage />} />
              <Route path="packs" element={<PackSizesPage />} />
              <Route path="availability" element={<AvailabilityPage />} />
              <Route path="pickup-locations" element={<PickupLocationsPage />} />
              <Route path="history" element={<RuleHistoryPage />} />
            </Route>
            <Route path="/pif" element={<PifAdminPage />} />
            <Route path="/pif/dashboard" element={<PifDashboardPage />} />
            <Route path="/pif/categories" element={<PifCategoriesPage />} />
            <Route path="/pif/products" element={<PifProductsPage />} />
            <Route path="/pif/products/import" element={<PifProductImportPage />} />
            <Route path="/pif/orders" element={<PifOrdersPage />} />
            <Route path="/pif/settings/notifications" element={<PifNotificationSettingsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </StaffAuthProvider>
    </BrowserRouter>
  );
}

/**
 * Keeps an already-signed-in staff member off the sign-in form, so a
 * stray /login does not look like a session loss. Renders nothing while
 * the mount-time refresh is still deciding.
 */
function RedirectWhenSignedIn({ children }: { children: ReactNode }) {
  const { status } = useStaffAuth();
  if (status === 'loading') return null;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}
