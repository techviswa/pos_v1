# Project review inventory

Automated inventory of first-party source, configuration and migration files. This records coverage of the scan; it is not a claim that every line has passed human review or runtime testing.

## POS

296 files; 45096 lines.

| File | Lines | Review leads |
| --- | ---: | --- |
| backend/migration-history-diff.sql | 445 |  |
| backend/prisma/migrations/20260403_init/migration.sql | 340 |  |
| backend/prisma/migrations/20260417_bill_metadata_persistence/migration.sql | 2 |  |
| backend/prisma/migrations/20260816_qr_ordering/migration.sql | 23 |  |
| backend/prisma/migrations/20260816_qr_tracking_rules/migration.sql | 25 |  |
| backend/prisma/migrations/20260825_table_management_schema_alignment/migration.sql | 59 |  |
| backend/prisma/migrations/20260829_auth_tokens/migration.sql | 22 |  |
| backend/prisma/migrations/20260829_qr_table_sessions/migration.sql | 29 |  |
| backend/prisma/migrations/20260906_production_persistence/migration.sql | 23 |  |
| backend/prisma/migrations/20260907_schema_alignment/migration.sql | 497 |  |
| backend/prisma/migrations/migration_lock.toml | 2 |  |
| backend/prisma/schema.prisma | 627 |  |
| backend/prisma/seed.js | 156 |  |
| backend/scripts/import-sqlite-to-postgres.py | 258 |  |
| backend/scripts/seed-cafe-menu.js | 884 | memory store:800 |
| backend/src/app.js | 101 |  |
| backend/src/config/db.js | 47 |  |
| backend/src/config/env.js | 82 |  |
| backend/src/core/admincore/admincore-change-sync.service.js | 202 |  |
| backend/src/core/admincore/admincore.controller.js | 191 |  |
| backend/src/core/admincore/admincore.routes.js | 65 |  |
| backend/src/core/admincore/admincore.service.js | 94 |  |
| backend/src/core/auth/auth-session.js | 49 |  |
| backend/src/core/auth/auth-tokens.js | 95 | memory store:7 |
| backend/src/core/auth/auth.controller.js | 136 |  |
| backend/src/core/auth/auth.routes.js | 21 |  |
| backend/src/core/auth/auth.service.js | 488 |  |
| backend/src/core/auth/passwords.js | 37 |  |
| backend/src/core/auth/session-store.js | 25 | memory store:6 |
| backend/src/core/billing/bill-analytics.utils.js | 71 | memory store:13 |
| backend/src/core/billing/billing-depth.utils.js | 141 |  |
| backend/src/core/billing/billing-legacy.serializer.js | 90 |  |
| backend/src/core/billing/billing-metadata.repository.js | 42 |  |
| backend/src/core/billing/billing-metadata.utils.js | 179 |  |
| backend/src/core/billing/billing-payments.service.js | 57 |  |
| backend/src/core/billing/billing.controller.js | 194 |  |
| backend/src/core/billing/billing.routes.js | 29 |  |
| backend/src/core/billing/billing.service.js | 540 |  |
| backend/src/core/businesses/businesses.controller.js | 34 |  |
| backend/src/core/businesses/businesses.routes.js | 16 |  |
| backend/src/core/businesses/businesses.service.js | 83 |  |
| backend/src/core/customers/customers.controller.js | 35 |  |
| backend/src/core/customers/customers.routes.js | 12 |  |
| backend/src/core/customers/customers.service.js | 20 |  |
| backend/src/core/dashboard/dashboard.controller.js | 12 |  |
| backend/src/core/dashboard/dashboard.routes.js | 12 |  |
| backend/src/core/dashboard/dashboard.service.js | 196 | memory store:18 |
| backend/src/core/features/features.controller.js | 38 |  |
| backend/src/core/features/features.routes.js | 16 |  |
| backend/src/core/features/features.service.js | 29 |  |
| backend/src/core/feedback/feedback.controller.js | 25 |  |
| backend/src/core/feedback/feedback.routes.js | 13 |  |
| backend/src/core/feedback/feedback.service.js | 90 |  |
| backend/src/core/inventory/inventory-operations.service.js | 628 | memory store:549, memory store:550 |
| backend/src/core/inventory/inventory.controller.js | 136 |  |
| backend/src/core/inventory/inventory.routes.js | 25 |  |
| backend/src/core/inventory/inventory.service.js | 147 |  |
| backend/src/core/orders/orders.controller.js | 57 |  |
| backend/src/core/orders/orders.routes.js | 16 |  |
| backend/src/core/orders/orders.service.js | 186 |  |
| backend/src/core/outlets/outlets.controller.js | 122 |  |
| backend/src/core/outlets/outlets.routes.js | 26 |  |
| backend/src/core/outlets/outlets.service.js | 812 | memory store:229, memory store:230, memory store:231, memory store:232, memory store:233, memory store:234, memory store:269, memory store:310, memory store:363, memory store:377, memory store:396, memory store:642, memory store:733 |
| backend/src/core/payments/payments.controller.js | 73 |  |
| backend/src/core/payments/payments.routes.js | 18 |  |
| backend/src/core/payments/payments.service.js | 149 | memory store:1 |
| backend/src/core/printer/printer.controller.js | 76 |  |
| backend/src/core/printer/printer.routes.js | 39 |  |
| backend/src/core/products/products.controller.js | 90 |  |
| backend/src/core/products/products.routes.js | 21 |  |
| backend/src/core/products/products.service.js | 258 |  |
| backend/src/core/reports/reports.controller.js | 92 |  |
| backend/src/core/reports/reports.routes.js | 26 |  |
| backend/src/core/reports/reports.service.js | 441 | memory store:126, memory store:127, memory store:171, memory store:225, memory store:226, memory store:256, memory store:257, memory store:284, filesystem persistence:386, filesystem persistence:394 |
| backend/src/core/reservations/reservations.controller.js | 30 |  |
| backend/src/core/reservations/reservations.routes.js | 12 |  |
| backend/src/core/saas/saas-plans.js | 43 |  |
| backend/src/core/saas/saas-store.js | 16 |  |
| backend/src/core/saas/saas.controller.js | 33 |  |
| backend/src/core/saas/saas.routes.js | 15 |  |
| backend/src/core/saas/saas.service.js | 280 |  |
| backend/src/core/sync/admincore-sync-log.repository.js | 56 |  |
| backend/src/core/sync/sync-contract.js | 62 |  |
| backend/src/core/sync/sync.controller.js | 57 |  |
| backend/src/core/sync/sync.routes.js | 17 |  |
| backend/src/core/sync/sync.service.js | 1056 | memory store:157, memory store:513, filesystem persistence:62, filesystem persistence:71 |
| backend/src/core/tables/tables.controller.js | 28 |  |
| backend/src/core/tables/tables.routes.js | 11 |  |
| backend/src/core/users/users.controller.js | 100 |  |
| backend/src/core/users/users.routes.js | 22 |  |
| backend/src/core/users/users.service.js | 346 |  |
| backend/src/database/prisma/client.js | 17 |  |
| backend/src/database/prisma/document-sequence.js | 7 |  |
| backend/src/database/prisma/helpers.js | 620 | memory store:20, memory store:21 |
| backend/src/database/prisma/schema-health.js | 84 | memory store:39 |
| backend/src/database/prisma/state-store.js | 13 |  |
| backend/src/features/barcode/barcode.controller.js | 20 |  |
| backend/src/features/barcode/barcode.routes.js | 12 |  |
| backend/src/features/barcode/barcode.service.js | 22 |  |
| backend/src/features/inventory-advanced/batch-tracking/batch-tracking.controller.js | 20 |  |
| backend/src/features/inventory-advanced/batch-tracking/batch-tracking.routes.js | 12 |  |
| backend/src/features/inventory-advanced/batch-tracking/batch-tracking.service.js | 37 |  |
| backend/src/features/kitchen/kot/kot.controller.js | 126 |  |
| backend/src/features/kitchen/kot/kot.repository.js | 30 |  |
| backend/src/features/kitchen/kot/kot.routes.js | 58 |  |
| backend/src/features/kitchen/kot/kot.service.js | 489 |  |
| backend/src/features/kitchen/kot/kot.utils.js | 127 | memory store:43 |
| backend/src/features/logistics/delivery-route-plan/delivery-route-plan.controller.js | 53 |  |
| backend/src/features/logistics/delivery-route-plan/delivery-route-plan.routes.js | 16 |  |
| backend/src/features/logistics/delivery-route-plan/delivery-route-plan.service.js | 163 |  |
| backend/src/features/logistics/outlet-inventory-allocation/outlet-inventory-allocation.controller.js | 53 |  |
| backend/src/features/logistics/outlet-inventory-allocation/outlet-inventory-allocation.routes.js | 24 |  |
| backend/src/features/logistics/outlet-inventory-allocation/outlet-inventory-allocation.service.js | 113 |  |
| backend/src/features/logistics/outlet-purchase-orders/outlet-purchase-orders.controller.js | 53 |  |
| backend/src/features/logistics/outlet-purchase-orders/outlet-purchase-orders.routes.js | 24 |  |
| backend/src/features/logistics/outlet-purchase-orders/outlet-purchase-orders.service.js | 116 |  |
| backend/src/features/sales-extensions/qr-ordering/qr-ordering.controller.js | 80 |  |
| backend/src/features/sales-extensions/qr-ordering/qr-ordering.routes.js | 20 |  |
| backend/src/features/sales-extensions/qr-ordering/qr-ordering.service.js | 680 | memory store:14, memory store:396 |
| backend/src/features/sales-extensions/table-management/table-management.controller.js | 173 |  |
| backend/src/features/sales-extensions/table-management/table-management.repository.js | 310 |  |
| backend/src/features/sales-extensions/table-management/table-management.routes.js | 33 |  |
| backend/src/features/sales-extensions/table-management/table-management.service.js | 787 | memory store:119 |
| backend/src/features/sales-extensions/table-management/table-management.validation.js | 137 |  |
| backend/src/routes/index.js | 15 |  |
| backend/src/routes/legacy.routes.js | 1246 | memory store:87, memory store:92, memory store:244, memory store:402, memory store:1048, memory store:1049, memory store:1067 |
| backend/src/routes/module-registry.js | 146 |  |
| backend/src/server.js | 89 |  |
| backend/src/services/featureToggleService.js | 121 |  |
| backend/src/services/jobs/durable-job-queue.js | 83 | memory store:13 |
| backend/src/services/jobs/job-queue.js | 139 | memory store:4, memory store:5 |
| backend/src/services/printer/printer.service.js | 56 |  |
| backend/src/services/workflows/logistics-workflow.service.js | 146 |  |
| backend/src/services/workflows/order-fulfillment.service.js | 228 | memory store:130, memory store:150, memory store:151 |
| backend/src/shared/constants/access.constants.js | 23 |  |
| backend/src/shared/constants/domain.constants.js | 9 |  |
| backend/src/shared/constants/feature.constants.js | 49 |  |
| backend/src/shared/constants/module.constants.js | 42 |  |
| backend/src/shared/middleware/authGuard.middleware.js | 266 |  |
| backend/src/shared/middleware/errorHandler.middleware.js | 52 |  |
| backend/src/shared/middleware/feature.middleware.js | 37 |  |
| backend/src/shared/middleware/notFound.middleware.js | 12 |  |
| backend/src/shared/middleware/requestContext.middleware.js | 16 |  |
| backend/src/shared/middleware/saasLimit.middleware.js | 34 |  |
| backend/src/shared/utils/apiResponse.js | 19 |  |
| backend/src/shared/utils/asyncHandler.js | 3 |  |
| backend/src/shared/utils/create-feature-router.js | 27 |  |
| backend/src/shared/utils/error-monitor.js | 75 |  |
| backend/src/shared/utils/http-error.js | 24 |  |
| backend/src/shared/utils/in-memory-repository.js | 64 |  |
| backend/src/shared/utils/logger.js | 16 |  |
| backend/src/shared/utils/pagination.js | 35 |  |
| backend_test.py | 577 |  |
| frontend/craco.config.js | 109 |  |
| frontend/postcss.config.js | 7 |  |
| frontend/src/App.css | 3597 | placeholder:1282, placeholder:1283, placeholder:1284 |
| frontend/src/App.js | 411 | placeholder:51, placeholder:52, placeholder:368, placeholder:376 |
| frontend/src/components/ApiErrorPanel.js | 41 |  |
| frontend/src/components/AppErrorBoundary.js | 47 |  |
| frontend/src/components/GlobalErrorHandlers.js | 43 |  |
| frontend/src/components/Layout.js | 244 |  |
| frontend/src/components/OfflineStatus.js | 57 |  |
| frontend/src/components/ProtectedRoute.js | 71 |  |
| frontend/src/components/ui/accordion.jsx | 42 |  |
| frontend/src/components/ui/alert-dialog.jsx | 98 |  |
| frontend/src/components/ui/alert.jsx | 48 |  |
| frontend/src/components/ui/aspect-ratio.jsx | 6 |  |
| frontend/src/components/ui/avatar.jsx | 34 |  |
| frontend/src/components/ui/badge.jsx | 35 |  |
| frontend/src/components/ui/breadcrumb.jsx | 93 |  |
| frontend/src/components/ui/button.jsx | 49 |  |
| frontend/src/components/ui/calendar.jsx | 72 |  |
| frontend/src/components/ui/card.jsx | 51 |  |
| frontend/src/components/ui/carousel.jsx | 194 |  |
| frontend/src/components/ui/checkbox.jsx | 23 |  |
| frontend/src/components/ui/collapsible.jsx | 10 |  |
| frontend/src/components/ui/command.jsx | 117 | placeholder:41 |
| frontend/src/components/ui/context-menu.jsx | 157 |  |
| frontend/src/components/ui/dialog.jsx | 95 |  |
| frontend/src/components/ui/drawer.jsx | 91 |  |
| frontend/src/components/ui/dropdown-menu.jsx | 157 |  |
| frontend/src/components/ui/form.jsx | 134 |  |
| frontend/src/components/ui/hover-card.jsx | 24 |  |
| frontend/src/components/ui/input-otp.jsx | 54 |  |
| frontend/src/components/ui/input.jsx | 20 | placeholder:10 |
| frontend/src/components/ui/label.jsx | 17 |  |
| frontend/src/components/ui/menubar.jsx | 199 |  |
| frontend/src/components/ui/navigation-menu.jsx | 105 |  |
| frontend/src/components/ui/pagination.jsx | 101 |  |
| frontend/src/components/ui/popover.jsx | 28 |  |
| frontend/src/components/ui/progress.jsx | 22 |  |
| frontend/src/components/ui/radio-group.jsx | 30 |  |
| frontend/src/components/ui/resizable.jsx | 41 |  |
| frontend/src/components/ui/scroll-area.jsx | 39 |  |
| frontend/src/components/ui/select.jsx | 120 | placeholder:17 |
| frontend/src/components/ui/separator.jsx | 24 |  |
| frontend/src/components/ui/sheet.jsx | 109 |  |
| frontend/src/components/ui/skeleton.jsx | 15 |  |
| frontend/src/components/ui/slider.jsx | 22 |  |
| frontend/src/components/ui/sonner.jsx | 29 |  |
| frontend/src/components/ui/switch.jsx | 23 |  |
| frontend/src/components/ui/table.jsx | 87 |  |
| frontend/src/components/ui/tabs.jsx | 42 |  |
| frontend/src/components/ui/textarea.jsx | 19 | placeholder:9 |
| frontend/src/components/ui/toast.jsx | 86 |  |
| frontend/src/components/ui/toaster.jsx | 34 |  |
| frontend/src/components/ui/toggle-group.jsx | 44 |  |
| frontend/src/components/ui/toggle.jsx | 41 |  |
| frontend/src/components/ui/tooltip.jsx | 27 |  |
| frontend/src/contexts/AuthContext.js | 323 | memory store:35, memory store:36, public URL default:21 |
| frontend/src/contexts/UiContext.js | 37 |  |
| frontend/src/core/billing/pages/BillingWorkspace.jsx | 2 |  |
| frontend/src/core/billing/pages/BillsWorkspace.jsx | 2 |  |
| frontend/src/core/billing/utils/orderTracking.js | 61 |  |
| frontend/src/core/modules/components/ModuleGate.jsx | 14 |  |
| frontend/src/core/modules/store/useClientModules.js | 27 |  |
| frontend/src/core/modules/utils/clientModules.js | 40 | placeholder:18, placeholder:23 |
| frontend/src/core/navigation/config/appNavigation.js | 34 |  |
| frontend/src/core/navigation/utils/appAccess.js | 40 |  |
| frontend/src/core/navigation/utils/defaultRoute.js | 14 |  |
| frontend/src/core/offline/offlineQueue.js | 79 | public URL default:17 |
| frontend/src/core/outlets/components/OutletOverviewPanel.jsx | 76 |  |
| frontend/src/core/outlets/store/ActiveOutletContext.jsx | 205 | public URL default:20 |
| frontend/src/core/payments/utils/paymentMethods.js | 13 |  |
| frontend/src/core/platform/components/FeatureGate.jsx | 14 |  |
| frontend/src/core/platform/config/activeBusinessConfig.js | 21 |  |
| frontend/src/core/platform/config/businessConfigModel.js | 38 |  |
| frontend/src/core/platform/config/businessConfigResolver.js | 40 |  |
| frontend/src/core/platform/config/businessPlans.js | 32 |  |
| frontend/src/core/platform/features/featureRegistry.js | 80 |  |
| frontend/src/core/platform/store/useBusinessTemplate.js | 31 |  |
| frontend/src/core/platform/templates/businessTemplates.js | 118 |  |
| frontend/src/features/billing/fulfillment/components/FulfillmentDetailsFields.jsx | 94 | placeholder:51, placeholder:62, placeholder:73, placeholder:86 |
| frontend/src/features/billing/fulfillment/components/FulfillmentModeSelector.jsx | 27 |  |
| frontend/src/features/billing/fulfillment/components/FulfillmentTablePanel.jsx | 988 | memory store:46, memory store:47, placeholder:634, placeholder:644, placeholder:733, placeholder:820, placeholder:830, placeholder:871, placeholder:960 |
| frontend/src/features/billing/fulfillment/components/TableManagerPanel.jsx | 75 | placeholder:25, placeholder:32 |
| frontend/src/features/billing/fulfillment/pages/BillingFulfillmentSection.jsx | 97 |  |
| frontend/src/features/billing/fulfillment/services/fulfillment.service.js | 169 | public URL default:17 |
| frontend/src/features/billing/fulfillment/store/useBillingFulfillment.js | 40 |  |
| frontend/src/features/billing/fulfillment/utils/fulfillmentMode.js | 161 |  |
| frontend/src/hooks/use-toast.js | 156 | memory store:22 |
| frontend/src/hooks/useAutoRefresh.js | 88 |  |
| frontend/src/index.css | 50 |  |
| frontend/src/index.js | 29 |  |
| frontend/src/lib/apiErrors.js | 107 |  |
| frontend/src/lib/pos.js | 217 | memory store:165, memory store:182, memory store:183 |
| frontend/src/lib/sessionSlots.js | 29 |  |
| frontend/src/lib/utils.js | 7 |  |
| frontend/src/modules/bakery/components/BakeryModulePlaceholder.jsx | 14 | placeholder:3, placeholder:7 |
| frontend/src/modules/bakery/pages/BakeryPlaceholderPage.jsx | 12 | placeholder:3, placeholder:5, placeholder:8 |
| frontend/src/modules/bakery/services/index.js | 2 |  |
| frontend/src/modules/bakery/store/index.js | 2 |  |
| frontend/src/modules/bakery/utils/moduleMeta.js | 6 | placeholder:4 |
| frontend/src/modules/kirana/components/KiranaModulePlaceholder.jsx | 14 | placeholder:3, placeholder:7 |
| frontend/src/modules/kirana/pages/KiranaPlaceholderPage.jsx | 12 | placeholder:3, placeholder:5, placeholder:8 |
| frontend/src/modules/kirana/services/index.js | 2 |  |
| frontend/src/modules/kirana/store/index.js | 2 |  |
| frontend/src/modules/kirana/utils/moduleMeta.js | 6 | placeholder:4 |
| frontend/src/modules/restaurant/components/RestaurantFeatureGate.jsx | 12 |  |
| frontend/src/modules/restaurant/components/RestaurantModuleGate.jsx | 9 |  |
| frontend/src/modules/restaurant/pages/RestaurantBillingPage.jsx | 10 |  |
| frontend/src/modules/restaurant/pages/RestaurantBillsPage.jsx | 10 |  |
| frontend/src/modules/restaurant/store/index.js | 2 |  |
| frontend/src/modules/restaurant/utils/moduleMeta.js | 6 |  |
| frontend/src/pages/AcceptInvite.js | 120 | placeholder:96, public URL default:20 |
| frontend/src/pages/Billing.js | 1522 | memory store:45, placeholder:88, placeholder:94, placeholder:100, placeholder:109, placeholder:120, placeholder:1012, placeholder:1178, placeholder:1202, placeholder:1486, public URL default:35 |
| frontend/src/pages/Bills.js | 306 | placeholder:142, placeholder:144, placeholder:145, public URL default:26 |
| frontend/src/pages/CentralKitchen.js | 741 | placeholder:658, placeholder:718, public URL default:23 |
| frontend/src/pages/CentralKitchenMetricDetail.js | 319 | public URL default:22 |
| frontend/src/pages/Chef.js | 189 | public URL default:24 |
| frontend/src/pages/Dashboard.js | 467 | public URL default:24 |
| frontend/src/pages/DashboardMetricDetail.js | 528 | public URL default:23 |
| frontend/src/pages/FeedbackForm.js | 123 | public URL default:19 |
| frontend/src/pages/ForgotPassword.js | 103 | placeholder:70, public URL default:20 |
| frontend/src/pages/Inventory.js | 801 | placeholder:471, placeholder:637, public URL default:23 |
| frontend/src/pages/InventorySummaryPage.js | 202 | public URL default:21 |
| frontend/src/pages/Login.js | 143 | placeholder:79, placeholder:94 |
| frontend/src/pages/Manager.js | 296 | public URL default:24 |
| frontend/src/pages/OutletDetailPage.js | 448 | placeholder:352, public URL default:23 |
| frontend/src/pages/Products.js | 1362 | placeholder:607, placeholder:786, placeholder:820, placeholder:918, placeholder:1001, placeholder:1200, placeholder:1229, placeholder:1241, public URL default:25 |
| frontend/src/pages/ProfileSetup.js | 238 | public URL default:22 |
| frontend/src/pages/QrManagement.js | 337 |  |
| frontend/src/pages/QrOrdering.js | 658 | placeholder:360, placeholder:492, placeholder:502, placeholder:508, placeholder:522, placeholder:531, public URL default:21 |
| frontend/src/pages/Reports.js | 894 | public URL default:23 |
| frontend/src/pages/ReservationPlanner.js | 479 | memory store:107, placeholder:282, placeholder:286, placeholder:322, placeholder:334 |
| frontend/src/pages/ResetPassword.js | 99 | placeholder:64, placeholder:76, public URL default:20 |
| frontend/src/pages/RoleMetricDetail.js | 354 | memory store:36, public URL default:25 |
| frontend/src/pages/Settings.js | 477 | placeholder:230, placeholder:239, placeholder:279 |
| frontend/src/pages/Staff.js | 780 | public URL default:34 |
| frontend/src/pages/StaffDetailPage.js | 243 | public URL default:23 |
| frontend/src/pages/StaffSummaryPage.js | 176 | public URL default:23 |
| frontend/src/pages/Waiter.js | 411 | memory store:56, public URL default:29 |
| frontend/tailwind.config.js | 56 |  |
| index.js | 47 |  |
| render.yaml | 46 |  |
| tests/__init__.py | 1 |  |

## AdminCore

85 files; 14883 lines.

| File | Lines | Review leads |
| --- | ---: | --- |
| backend/server.py | 5296 |  |
| backend/test_entitlements.py | 92 |  |
| backend_test (2).py | 598 |  |
| frontend/craco.config.js | 72 |  |
| frontend/plugins/health-check/health-endpoints.js | 214 |  |
| frontend/plugins/health-check/webpack-health-plugin.js | 121 |  |
| frontend/postcss.config (1).js | 7 |  |
| frontend/postcss.config.js | 7 |  |
| frontend/src/App.css | 3 |  |
| frontend/src/App.js | 113 |  |
| frontend/src/components/layout/DashboardLayout.js | 257 |  |
| frontend/src/components/ui/accordion.jsx | 42 |  |
| frontend/src/components/ui/alert-dialog.jsx | 98 |  |
| frontend/src/components/ui/alert.jsx | 48 |  |
| frontend/src/components/ui/aspect-ratio.jsx | 6 |  |
| frontend/src/components/ui/avatar.jsx | 34 |  |
| frontend/src/components/ui/badge.jsx | 35 |  |
| frontend/src/components/ui/breadcrumb.jsx | 93 |  |
| frontend/src/components/ui/button.jsx | 49 |  |
| frontend/src/components/ui/calendar.jsx | 72 |  |
| frontend/src/components/ui/card.jsx | 51 |  |
| frontend/src/components/ui/carousel.jsx | 194 |  |
| frontend/src/components/ui/checkbox.jsx | 23 |  |
| frontend/src/components/ui/collapsible.jsx | 10 |  |
| frontend/src/components/ui/command.jsx | 117 | placeholder:41 |
| frontend/src/components/ui/context-menu.jsx | 157 |  |
| frontend/src/components/ui/dialog.jsx | 95 |  |
| frontend/src/components/ui/drawer.jsx | 91 |  |
| frontend/src/components/ui/dropdown-menu.jsx | 157 |  |
| frontend/src/components/ui/form.jsx | 134 |  |
| frontend/src/components/ui/hover-card.jsx | 24 |  |
| frontend/src/components/ui/input-otp.jsx | 54 |  |
| frontend/src/components/ui/input.jsx | 20 | placeholder:10 |
| frontend/src/components/ui/label.jsx | 17 |  |
| frontend/src/components/ui/menubar.jsx | 199 |  |
| frontend/src/components/ui/navigation-menu.jsx | 105 |  |
| frontend/src/components/ui/pagination.jsx | 101 |  |
| frontend/src/components/ui/popover.jsx | 28 |  |
| frontend/src/components/ui/progress.jsx | 22 |  |
| frontend/src/components/ui/radio-group.jsx | 30 |  |
| frontend/src/components/ui/resizable.jsx | 41 |  |
| frontend/src/components/ui/scroll-area.jsx | 39 |  |
| frontend/src/components/ui/select.jsx | 120 | placeholder:17 |
| frontend/src/components/ui/separator.jsx | 24 |  |
| frontend/src/components/ui/sheet.jsx | 109 |  |
| frontend/src/components/ui/skeleton.jsx | 15 |  |
| frontend/src/components/ui/slider.jsx | 22 |  |
| frontend/src/components/ui/sonner.jsx | 29 |  |
| frontend/src/components/ui/switch.jsx | 23 |  |
| frontend/src/components/ui/table.jsx | 87 |  |
| frontend/src/components/ui/tabs.jsx | 42 |  |
| frontend/src/components/ui/textarea.jsx | 19 | placeholder:9 |
| frontend/src/components/ui/toast.jsx | 86 |  |
| frontend/src/components/ui/toaster.jsx | 34 |  |
| frontend/src/components/ui/toggle-group.jsx | 44 |  |
| frontend/src/components/ui/toggle.jsx | 41 |  |
| frontend/src/components/ui/tooltip.jsx | 27 |  |
| frontend/src/contexts/AuthContext.js | 57 |  |
| frontend/src/hooks/use-toast.js | 156 | memory store:22 |
| frontend/src/hooks/useEntitlement.js | 45 |  |
| frontend/src/index.css | 103 |  |
| frontend/src/index.js | 12 |  |
| frontend/src/lib/api.js | 153 | public URL default:5 |
| frontend/src/lib/moduleAccess.js | 44 |  |
| frontend/src/lib/posAdminNav.js | 29 |  |
| frontend/src/lib/utils.js | 7 |  |
| frontend/src/pages/AuditLogsPage.js | 121 | placeholder:71 |
| frontend/src/pages/BusinessesPage.js | 310 | placeholder:233, placeholder:261, placeholder:265, placeholder:269 |
| frontend/src/pages/ClientsPage.js | 221 | placeholder:125, placeholder:213 |
| frontend/src/pages/ControlCenterPage.js | 190 |  |
| frontend/src/pages/DashboardPage.js | 198 |  |
| frontend/src/pages/FeatureFlagsPage.js | 151 | placeholder:137 |
| frontend/src/pages/IntegrationsPage.js | 167 | placeholder:148, placeholder:150 |
| frontend/src/pages/LoginPage.js | 133 | placeholder:81, placeholder:86, placeholder:102, placeholder:106, placeholder:111 |
| frontend/src/pages/ModulesPage.js | 243 | placeholder:184 |
| frontend/src/pages/OutletsPage.js | 176 | placeholder:155 |
| frontend/src/pages/PlansPage.js | 311 |  |
| frontend/src/pages/POSAdminPage.js | 1033 | placeholder:685, placeholder:700, placeholder:837, placeholder:889, placeholder:916, placeholder:949, placeholder:958, placeholder:962, placeholder:1022 |
| frontend/src/pages/POSBridgePage.js | 387 |  |
| frontend/src/pages/ProductsPage.js | 190 |  |
| frontend/src/pages/SettingsPage.js | 165 | placeholder:154 |
| frontend/src/pages/SubscriptionsPage.js | 267 | placeholder:231 |
| frontend/src/pages/UsersPage.js | 243 | placeholder:189 |
| frontend/tailwind.config.js | 82 |  |
| tests/__init__.py | 1 |  |
