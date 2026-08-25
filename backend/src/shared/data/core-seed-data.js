import env from "../../config/env.js";
import {
  DEFAULT_BILLING_CURRENCY,
  DEFAULT_CUSTOMER_NAME,
  DEFAULT_OUTLET_STATUS,
  DEFAULT_ORDER_CHANNEL,
  DEFAULT_PRODUCT_CATEGORY,
} from "../constants/domain.constants.js";

export const orderSeedData = [
  {
    id: "ord_1001",
    tenantId: env.defaultTenantId,
    customerName: DEFAULT_CUSTOMER_NAME,
    channel: DEFAULT_ORDER_CHANNEL,
    total: 450,
    status: "open",
  },
  {
    id: "ord_1002",
    tenantId: env.defaultTenantId,
    customerName: "Aarav",
    channel: "delivery",
    total: 720,
    status: "completed",
  },
];

export const billingSeedData = [
  {
    id: "bill_1001",
    tenantId: env.defaultTenantId,
    customerName: DEFAULT_CUSTOMER_NAME,
    currency: DEFAULT_BILLING_CURRENCY,
    subtotal: 1200,
    tax: 216,
    total: 1416,
    status: "issued",
  },
];

export const inventorySeedData = [
  {
    id: "inv_1",
    tenantId: env.defaultTenantId,
    name: "Flour",
    stock: 100,
    unit: "kg",
  },
  {
    id: "inv_2",
    tenantId: env.defaultTenantId,
    name: "Milk",
    stock: 60,
    unit: "liter",
  },
];

export const userSeedData = [
  {
    id: "usr_owner_1",
    tenantId: env.defaultTenantId,
    name: "System Owner",
    email: "owner@pos.com",
    password: "admin123",
    role: "Owner",
    permissions: [
      "dashboard",
      "billing",
      "inventory",
      "reports",
      "products",
      "shift_swaps",
      "bills",
      "staff",
      "settings",
      "central_kitchen",
    ],
    profile_required: false,
    assigned_outlet_ids: ["outlet_hq"],
    active: true,
  },
  {
    id: "usr_cashier_1",
    tenantId: env.defaultTenantId,
    name: "Cashier One",
    email: "cashier@pos.com",
    password: "cash123",
    role: "Cashier",
    permissions: ["billing", "bills"],
    profile_required: false,
    assigned_outlet_ids: ["outlet_hq"],
    active: true,
  },
];

export const productSeedData = [
  {
    id: "prd_1",
    tenantId: env.defaultTenantId,
    name: "Classic Coffee",
    price: 120,
    cost_price: 42,
    stock: 40,
    active: true,
    category: "Beverages",
    dietary_type: "Veg",
  },
  {
    id: "prd_2",
    tenantId: env.defaultTenantId,
    name: "Veg Sandwich",
    price: 180,
    cost_price: 68,
    stock: 25,
    active: true,
    category: DEFAULT_PRODUCT_CATEGORY,
    dietary_type: "Veg",
  },
];

export const outletSeedData = [
  {
    id: "outlet_hq",
    tenantId: env.defaultTenantId,
    name: "Main Outlet",
    code: "MO1",
    location: "Bengaluru",
    manager_name: "System Owner",
    phone: "9876543210",
    status: DEFAULT_OUTLET_STATUS,
  },
  {
    id: "outlet_2",
    tenantId: env.defaultTenantId,
    name: "Airport Outlet",
    code: "AO1",
    location: "Airport Road",
    manager_name: "Cashier One",
    phone: "9123456780",
    status: DEFAULT_OUTLET_STATUS,
  },
];
