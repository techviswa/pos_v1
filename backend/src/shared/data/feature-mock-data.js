export const kotTicketItems = [
  { id: "kot_1", orderId: "ord_1001", status: "queued" },
  { id: "kot_2", orderId: "ord_1002", status: "preparing" },
];

export const barcodeItems = [{ id: "barcode_1", sku: "SKU-101", code: "8901234567890" }];

export const batchItems = [{ id: "batch_1", sku: "SKU-101", batchNo: "B-APR-01", expiryDate: "2026-05-30" }];

export const tableItems = [
  { id: "tbl_2", name: "T2", seats: 2, status: "available" },
  { id: "tbl_3", name: "T3", seats: 4, status: "occupied" },
];

export const outletInventoryAllocationItems = [
  {
    id: "alloc_1",
    outletId: "outlet_1",
    sourceLocation: "central-kitchen",
    status: "approved",
    items: [{ inventoryItemId: "inv_1", name: "Flour", quantity: 15, unit: "kg" }],
  },
];

export const outletPurchaseOrderItems = [
  {
    id: "opo_1",
    outletId: "outlet_1",
    requestedBy: "Outlet Manager",
    status: "pending",
    items: [{ inventoryItemId: "inv_2", name: "Milk", quantity: 20, unit: "liter" }],
  },
];

export const deliveryRoutePlanItems = [
  {
    id: "route_1",
    vehicleId: "vehicle_1",
    driverName: "Ravi",
    status: "planned",
    stops: [
      { outletId: "outlet_1", sequence: 1, eta: "09:00" },
      { outletId: "outlet_2", sequence: 2, eta: "10:00" },
    ],
  },
];
