BEGIN;
-- DropForeignKey
ALTER TABLE "Addon" DROP CONSTRAINT "Addon_productId_fkey";

-- DropForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT "Allocation_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT "Allocation_outletId_fkey";

-- DropForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT "Allocation_purchaseOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT "Allocation_routePlanId_fkey";

-- DropForeignKey
ALTER TABLE "Batch" DROP CONSTRAINT "Batch_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_orderId_fkey";

-- DropForeignKey
ALTER TABLE "BillItem" DROP CONSTRAINT "BillItem_billId_fkey";

-- DropForeignKey
ALTER TABLE "BillItem" DROP CONSTRAINT "BillItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "DiningArea" DROP CONSTRAINT "DiningArea_businessId_fkey";

-- DropForeignKey
ALTER TABLE "DiningTable" DROP CONSTRAINT "DiningTable_businessId_fkey";

-- DropForeignKey
ALTER TABLE "FeatureToggle" DROP CONSTRAINT "FeatureToggle_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_billId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_businessId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_businessId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_inventoryItemId_fkey";

-- DropForeignKey
ALTER TABLE "KitchenTicket" DROP CONSTRAINT "KitchenTicket_businessId_fkey";

-- DropForeignKey
ALTER TABLE "KitchenTicket" DROP CONSTRAINT "KitchenTicket_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_outletId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "Outlet" DROP CONSTRAINT "Outlet_businessId_fkey";

-- DropForeignKey
ALTER TABLE "OutletFeatureToggle" DROP CONSTRAINT "OutletFeatureToggle_outletId_fkey";

-- DropForeignKey
ALTER TABLE "OutletInventory" DROP CONSTRAINT "OutletInventory_inventoryItemId_fkey";

-- DropForeignKey
ALTER TABLE "OutletInventory" DROP CONSTRAINT "OutletInventory_outletId_fkey";

-- DropForeignKey
ALTER TABLE "OutletProduct" DROP CONSTRAINT "OutletProduct_outletId_fkey";

-- DropForeignKey
ALTER TABLE "OutletProduct" DROP CONSTRAINT "OutletProduct_productId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_businessId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_businessId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_outletId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- DropForeignKey
ALTER TABLE "RoutePlan" DROP CONSTRAINT "RoutePlan_businessId_fkey";

-- DropForeignKey
ALTER TABLE "RouteStop" DROP CONSTRAINT "RouteStop_outletId_fkey";

-- DropForeignKey
ALTER TABLE "RouteStop" DROP CONSTRAINT "RouteStop_routePlanId_fkey";

-- DropForeignKey
ALTER TABLE "StaffActivity" DROP CONSTRAINT "StaffActivity_userId_fkey";

-- DropForeignKey
ALTER TABLE "TableManagementSettings" DROP CONSTRAINT "TableManagementSettings_businessId_fkey";

-- DropForeignKey
ALTER TABLE "TableReservation" DROP CONSTRAINT "TableReservation_businessId_fkey";

-- DropForeignKey
ALTER TABLE "TableReservation" DROP CONSTRAINT "TableReservation_tableId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_businessId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- DropForeignKey
ALTER TABLE "UserOutletAssignment" DROP CONSTRAINT "UserOutletAssignment_outletId_fkey";

-- DropForeignKey
ALTER TABLE "UserOutletAssignment" DROP CONSTRAINT "UserOutletAssignment_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT "UserPermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT "UserPermission_userId_fkey";

-- DropForeignKey
ALTER TABLE "Variation" DROP CONSTRAINT "Variation_productId_fkey";

-- AlterTable
ALTER TABLE "Addon" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Allocation" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Batch" ALTER COLUMN "expiryDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Bill" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Business" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DiningArea" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DiningTable" ALTER COLUMN "seats" SET DEFAULT 4,
ALTER COLUMN "status" SET DEFAULT 'available',
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Feedback" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InventoryItem" ALTER COLUMN "expiryDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InventoryMovement" ALTER COLUMN "expiryDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "KitchenTicket" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Outlet" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutletFeatureToggle" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutletInventory" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutletProduct" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Permission" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "requiredBy" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RoutePlan" ALTER COLUMN "dispatchDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StaffActivity" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TableManagementSettings" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TableQrCode" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "rotatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "lastScannedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TableQrScanEvent" ALTER COLUMN "scannedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TableReservation" ALTER COLUMN "reservationDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'reserved',
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "confirmedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "releasedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "canceledAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TableSession" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Variation" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT IF EXISTS "RolePermission_roleId_fkey";
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT IF EXISTS "RolePermission_permissionId_fkey";
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT IF EXISTS "UserPermission_userId_fkey";
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT IF EXISTS "UserPermission_permissionId_fkey";
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_roleId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_businessId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" DROP CONSTRAINT IF EXISTS "Outlet_businessId_fkey";
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutletAssignment" DROP CONSTRAINT IF EXISTS "UserOutletAssignment_userId_fkey";
ALTER TABLE "UserOutletAssignment" ADD CONSTRAINT "UserOutletAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOutletAssignment" DROP CONSTRAINT IF EXISTS "UserOutletAssignment_outletId_fkey";
ALTER TABLE "UserOutletAssignment" ADD CONSTRAINT "UserOutletAssignment_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_businessId_fkey";
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" DROP CONSTRAINT IF EXISTS "Variation_productId_fkey";
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Addon" DROP CONSTRAINT IF EXISTS "Addon_productId_fkey";
ALTER TABLE "Addon" ADD CONSTRAINT "Addon_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_businessId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_outletId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_orderId_fkey";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_productId_fkey";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_businessId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_orderId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItem" DROP CONSTRAINT IF EXISTS "BillItem_billId_fkey";
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItem" DROP CONSTRAINT IF EXISTS "BillItem_productId_fkey";
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT IF EXISTS "InventoryItem_businessId_fkey";
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProduct" DROP CONSTRAINT IF EXISTS "OutletProduct_outletId_fkey";
ALTER TABLE "OutletProduct" ADD CONSTRAINT "OutletProduct_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProduct" DROP CONSTRAINT IF EXISTS "OutletProduct_productId_fkey";
ALTER TABLE "OutletProduct" ADD CONSTRAINT "OutletProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletInventory" DROP CONSTRAINT IF EXISTS "OutletInventory_outletId_fkey";
ALTER TABLE "OutletInventory" ADD CONSTRAINT "OutletInventory_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletInventory" DROP CONSTRAINT IF EXISTS "OutletInventory_inventoryItemId_fkey";
ALTER TABLE "OutletInventory" ADD CONSTRAINT "OutletInventory_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletFeatureToggle" DROP CONSTRAINT IF EXISTS "OutletFeatureToggle_outletId_fkey";
ALTER TABLE "OutletFeatureToggle" ADD CONSTRAINT "OutletFeatureToggle_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" DROP CONSTRAINT IF EXISTS "InventoryMovement_inventoryItemId_fkey";
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_businessId_fkey";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_outletId_fkey";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_requestedById_fkey";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT IF EXISTS "Allocation_businessId_fkey";
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT IF EXISTS "Allocation_outletId_fkey";
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT IF EXISTS "Allocation_purchaseOrderId_fkey";
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" DROP CONSTRAINT IF EXISTS "Allocation_routePlanId_fkey";
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_routePlanId_fkey" FOREIGN KEY ("routePlanId") REFERENCES "RoutePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePlan" DROP CONSTRAINT IF EXISTS "RoutePlan_businessId_fkey";
ALTER TABLE "RoutePlan" ADD CONSTRAINT "RoutePlan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" DROP CONSTRAINT IF EXISTS "RouteStop_routePlanId_fkey";
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routePlanId_fkey" FOREIGN KEY ("routePlanId") REFERENCES "RoutePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" DROP CONSTRAINT IF EXISTS "RouteStop_outletId_fkey";
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" DROP CONSTRAINT IF EXISTS "KitchenTicket_businessId_fkey";
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" DROP CONSTRAINT IF EXISTS "KitchenTicket_orderId_fkey";
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" DROP CONSTRAINT IF EXISTS "Batch_businessId_fkey";
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableManagementSettings" DROP CONSTRAINT IF EXISTS "TableManagementSettings_businessId_fkey";
ALTER TABLE "TableManagementSettings" ADD CONSTRAINT "TableManagementSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningArea" DROP CONSTRAINT IF EXISTS "DiningArea_businessId_fkey";
ALTER TABLE "DiningArea" ADD CONSTRAINT "DiningArea_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" DROP CONSTRAINT IF EXISTS "DiningTable_businessId_fkey";
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" DROP CONSTRAINT IF EXISTS "DiningTable_areaId_fkey";
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "DiningArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableReservation" DROP CONSTRAINT IF EXISTS "TableReservation_businessId_fkey";
ALTER TABLE "TableReservation" ADD CONSTRAINT "TableReservation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableReservation" DROP CONSTRAINT IF EXISTS "TableReservation_tableId_fkey";
ALTER TABLE "TableReservation" ADD CONSTRAINT "TableReservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT IF EXISTS "Feedback_businessId_fkey";
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT IF EXISTS "Feedback_billId_fkey";
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureToggle" DROP CONSTRAINT IF EXISTS "FeatureToggle_businessId_fkey";
ALTER TABLE "FeatureToggle" ADD CONSTRAINT "FeatureToggle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffActivity" DROP CONSTRAINT IF EXISTS "StaffActivity_userId_fkey";
ALTER TABLE "StaffActivity" ADD CONSTRAINT "StaffActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
