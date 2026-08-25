import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { UiProvider } from './contexts/UiContext';
import { ActiveOutletProvider } from './core/outlets/store/ActiveOutletContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { GlobalErrorHandlers } from './components/GlobalErrorHandlers';
import { OfflineStatus } from './components/OfflineStatus';
import { Toaster } from './components/ui/sonner';
import { ModuleGate } from './core/modules/components/ModuleGate';
import { FeatureGate } from './core/platform/components/FeatureGate';
import { getDefaultRouteForUser } from './core/navigation/utils/defaultRoute';
import './App.css';

const lazyPage = (loader, exportName) => {
  const Component = lazy(() => loader().then((module) => ({ default: module[exportName] })));
  Component.preload = () => loader();
  return Component;
};

const Login = lazyPage(() => import('./pages/Login'), 'Login');
const Dashboard = lazyPage(() => import('./pages/Dashboard'), 'Dashboard');
const DashboardMetricDetail = lazyPage(() => import('./pages/DashboardMetricDetail'), 'DashboardMetricDetail');
const Manager = lazyPage(() => import('./pages/Manager'), 'Manager');
const Waiter = lazyPage(() => import('./pages/Waiter'), 'Waiter');
const Chef = lazyPage(() => import('./pages/Chef'), 'Chef');
const RoleMetricDetail = lazyPage(() => import('./pages/RoleMetricDetail'), 'RoleMetricDetail');
const RestaurantBillingPage = lazyPage(() => import('./modules/restaurant/pages/RestaurantBillingPage'), 'RestaurantBillingPage');
const Inventory = lazyPage(() => import('./pages/Inventory'), 'Inventory');
const InventorySummaryPage = lazyPage(() => import('./pages/InventorySummaryPage'), 'InventorySummaryPage');
const CentralKitchen = lazyPage(() => import('./pages/CentralKitchen'), 'CentralKitchen');
const CentralKitchenMetricDetail = lazyPage(() => import('./pages/CentralKitchenMetricDetail'), 'CentralKitchenMetricDetail');
const Reports = lazyPage(() => import('./pages/Reports'), 'Reports');
const Products = lazyPage(() => import('./pages/Products'), 'Products');
const QrManagement = lazyPage(() => import('./pages/QrManagement'), 'QrManagement');
const ReservationPlanner = lazyPage(() => import('./pages/ReservationPlanner'), 'ReservationPlanner');
const RestaurantBillsPage = lazyPage(() => import('./modules/restaurant/pages/RestaurantBillsPage'), 'RestaurantBillsPage');
const Staff = lazyPage(() => import('./pages/Staff'), 'Staff');
const StaffDetailPage = lazyPage(() => import('./pages/StaffDetailPage'), 'StaffDetailPage');
const StaffSummaryPage = lazyPage(() => import('./pages/StaffSummaryPage'), 'StaffSummaryPage');
const OutletDetailPage = lazyPage(() => import('./pages/OutletDetailPage'), 'OutletDetailPage');
const Settings = lazyPage(() => import('./pages/Settings'), 'Settings');
const FeedbackForm = lazyPage(() => import('./pages/FeedbackForm'), 'FeedbackForm');
const QrOrdering = lazyPage(() => import('./pages/QrOrdering'), 'QrOrdering');
const QrOrderTracking = lazyPage(() => import('./pages/QrOrdering'), 'QrOrderTracking');
const ProfileSetup = lazyPage(() => import('./pages/ProfileSetup'), 'ProfileSetup');
const KiranaPlaceholderPage = lazyPage(() => import('./modules/kirana/pages/KiranaPlaceholderPage'), 'KiranaPlaceholderPage');
const BakeryPlaceholderPage = lazyPage(() => import('./modules/bakery/pages/BakeryPlaceholderPage'), 'BakeryPlaceholderPage');

const preloadedRoutePages = [
  Dashboard,
  Manager,
  Waiter,
  Chef,
  RestaurantBillingPage,
  RestaurantBillsPage,
  Inventory,
  Reports,
  Products,
  QrManagement,
  ReservationPlanner,
  Staff,
  Settings,
  CentralKitchen,
];

const AppShellLoader = ({ label = 'Loading...' }) => (
  <div className="min-h-screen flex items-center justify-center bg-white">
    <div className="text-center">
      <div className="w-16 h-16 border-4 border-[#002DF5] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p className="text-[#475467] font-medium">{label}</p>
    </div>
  </div>
);

const RestaurantModuleRoute = ({ children }) => (
  <ModuleGate fallbackPath="/settings" moduleKey="restaurant">
    {children}
  </ModuleGate>
);

const RestaurantFeatureRoute = ({ featureKey, children }) => (
  <RestaurantModuleRoute>
    <FeatureGate fallbackPath="/settings" featureKey={featureKey}>
      {children}
    </FeatureGate>
  </RestaurantModuleRoute>
);

const AppRoutes = () => {
  const { user, loading } = useAuth();
  const defaultPath = getDefaultRouteForUser(user);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const preload = () => {
      preloadedRoutePages.forEach((Page) => {
        Page.preload?.();
      });
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timer = window.setTimeout(preload, 800);
    return () => window.clearTimeout(timer);
  }, [user]);

  if (loading) {
    return <AppShellLoader />;
  }

  return (
    <Suspense fallback={<AppShellLoader />}>
      <Routes>
        <Route path="/feedback/:token" element={<FeedbackForm />} />
        <Route path="/qr/orders/:trackingToken" element={<QrOrderTracking />} />
        <Route path="/qr/:token" element={<QrOrdering />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/complete-profile"
          element={
            <ProtectedRoute allowIncompleteProfile>
              <ProfileSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute requirePermission="dashboard">
              <RestaurantFeatureRoute featureKey="reports">
                <Dashboard />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/:metric"
          element={
            <ProtectedRoute requirePermission="dashboard">
              <RestaurantFeatureRoute featureKey="reports">
                <DashboardMetricDetail />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manager"
          element={
            <ProtectedRoute requireRoles={["Owner", "Manager"]}>
              <RestaurantFeatureRoute featureKey="reports">
                <Manager />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manager/:metric"
          element={
            <ProtectedRoute requireRoles={["Owner", "Manager"]}>
              <RestaurantFeatureRoute featureKey="reports">
                <RoleMetricDetail />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/waiter"
          element={
            <ProtectedRoute requireRoles={["Owner", "Waiter"]}>
              <RestaurantFeatureRoute featureKey="tables">
                <Waiter />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/waiter/:metric"
          element={
            <ProtectedRoute requireRoles={["Owner", "Waiter"]}>
              <RestaurantFeatureRoute featureKey="tables">
                <RoleMetricDetail />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/chef"
          element={
            <ProtectedRoute requireRoles={["Owner", "Chef"]}>
              <RestaurantFeatureRoute featureKey="kot">
                <Chef />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/chef/:metric"
          element={
            <ProtectedRoute requireRoles={["Owner", "Chef"]}>
              <RestaurantFeatureRoute featureKey="kot">
                <RoleMetricDetail />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/billing"
          element={
            <ProtectedRoute requirePermission="billing">
              <RestaurantBillingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qr-management"
          element={
            <ProtectedRoute requireRoles={["Owner", "Manager"]}>
              <RestaurantFeatureRoute featureKey="tables">
                <QrManagement />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations"
          element={
            <ProtectedRoute requireRoles={["Owner", "Manager"]}>
              <RestaurantFeatureRoute featureKey="tables">
                <ReservationPlanner />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/central-kitchen"
          element={
            <ProtectedRoute requirePermission="central_kitchen">
              <RestaurantFeatureRoute featureKey="inventory">
                <CentralKitchen />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/central-kitchen/:metric"
          element={
            <ProtectedRoute requirePermission="central_kitchen">
              <RestaurantFeatureRoute featureKey="inventory">
                <CentralKitchenMetricDetail />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory"
          element={
            <ProtectedRoute requirePermission="inventory">
              <RestaurantFeatureRoute featureKey="inventory">
                <Inventory />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory/summary/:summary"
          element={
            <ProtectedRoute requirePermission="inventory">
              <RestaurantFeatureRoute featureKey="inventory">
                <InventorySummaryPage />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute requirePermission="reports">
              <RestaurantFeatureRoute featureKey="reports">
                <Reports />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute requirePermission="products">
              <RestaurantFeatureRoute featureKey="products">
                <Products />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/bills"
          element={
            <ProtectedRoute requirePermission="bills">
              <RestaurantBillsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute requirePermission="settings">
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff"
          element={
            <ProtectedRoute requirePermission="staff">
              <RestaurantFeatureRoute featureKey="staff">
                <Staff />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/summary/:summary"
          element={
            <ProtectedRoute requirePermission="staff">
              <RestaurantFeatureRoute featureKey="staff">
                <StaffSummaryPage />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/:staffId/:section"
          element={
            <ProtectedRoute requirePermission="staff">
              <RestaurantFeatureRoute featureKey="staff">
                <StaffDetailPage />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/outlets/:outletId"
          element={
            <ProtectedRoute requirePermission="central_kitchen">
              <RestaurantFeatureRoute featureKey="inventory">
                <OutletDetailPage />
              </RestaurantFeatureRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/modules/kirana"
          element={
            <ProtectedRoute requirePermission="settings">
              <KiranaPlaceholderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/modules/bakery"
          element={
            <ProtectedRoute requirePermission="settings">
              <BakeryPlaceholderPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <AuthProvider>
      <ActiveOutletProvider>
        <UiProvider>
          <BrowserRouter>
            <AppErrorBoundary>
              <AppRoutes />
            </AppErrorBoundary>
            <GlobalErrorHandlers />
            <OfflineStatus />
            <Toaster position="top-right" />
          </BrowserRouter>
        </UiProvider>
      </ActiveOutletProvider>
    </AuthProvider>
  );
}

export default App;
