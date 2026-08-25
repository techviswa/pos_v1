export const DEFAULT_UI_SETTINGS = {
  shopName: "CashFlow Lite",
  gst: "29ABCDE1234F1Z5",
  address: "123 Main Street, Bengaluru - 560001",
  phone: "9876543210",
  taxRate: 18,
  footer: "Thank you, visit again!",
  receiptOfferTitle: "",
  receiptOfferMessage: "",
  currency: "\u20B9",
  ownerName: "Owner",
  ownerEmail: "owner@pos.com",
  paymentMethods: ["Cash", "UPI", "Card"],
};

export const STAFF_PERMISSION_KEYS = [
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
];

export const STAFF_ROLE_OPTIONS = ["Owner", "Manager", "Waiter", "Chef", "Cashier"];

export const ROLE_DEFAULT_PERMISSIONS = {
  Owner: STAFF_PERMISSION_KEYS,
  Manager: ["dashboard", "billing", "reports", "inventory", "products", "shift_swaps", "bills"],
  Waiter: ["billing", "bills"],
  Chef: [],
  Cashier: ["billing", "bills"],
};

export const PERMISSION_LABELS = {
  dashboard: "Dashboard",
  billing: "Billing",
  inventory: "Inventory",
  reports: "Reports",
  products: "Products",
  shift_swaps: "Shift Swaps",
  bills: "Bills",
  staff: "Staff",
  settings: "Settings",
  central_kitchen: "Central Kitchen",
};

export const STAFF_BIO_DEFAULTS = {
  employee_code: "",
  date_of_birth: "",
  gender: "",
  address: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_name_2: "",
  emergency_contact_phone_2: "",
  joining_date: "",
  education: "",
  id_number: "",
  shift_timing: "",
  notes: "",
};

export const STAFF_BIO_REQUIRED_FIELDS = [
  "employee_code",
  "date_of_birth",
  "gender",
  "address",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_name_2",
  "emergency_contact_phone_2",
  "joining_date",
];

export function normalizeStaffBio(bio) {
  return { ...STAFF_BIO_DEFAULTS, ...(bio || {}) };
}

export function getDefaultPermissionsForRole(role) {
  return [...(ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.Cashier)];
}

const UI_SETTINGS_KEY = "cashflow-lite-ui-settings";
const STAFF_META_KEY = "cashflow-lite-staff-meta";

export function getStoredUiSettings() {
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) return DEFAULT_UI_SETTINGS;
    return { ...DEFAULT_UI_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    return DEFAULT_UI_SETTINGS;
  }
}

export function saveStoredUiSettings(settings) {
  window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}

export function formatCurrency(amount, currency = "\u20B9") {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return `${currency}${safe.toFixed(2)}`;
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === "Owner") return true;
  return (user.permissions || []).includes(permission);
}

export function getInitials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function getStaffMeta() {
  try {
    const raw = window.localStorage.getItem(STAFF_META_KEY);
    return raw ? JSON.parse(raw) : { hiddenEmails: [], overrides: {} };
  } catch (error) {
    return { hiddenEmails: [], overrides: {} };
  }
}

export function saveStaffMeta(meta) {
  window.localStorage.setItem(STAFF_META_KEY, JSON.stringify(meta));
}

export function mergeStaffWithMeta(staff) {
  const meta = getStaffMeta();
  return staff
    .filter((member) => !meta.hiddenEmails.includes(member.email))
    .map((member) => ({
      ...member,
      ...(meta.overrides[member.email] || {}),
      active: meta.overrides[member.email]?.active ?? true,
    }));
}

export function setStaffOverride(email, partial) {
  const meta = getStaffMeta();
  meta.overrides[email] = { ...(meta.overrides[email] || {}), ...partial };
  saveStaffMeta(meta);
}

export function hideStaffMember(email) {
  const meta = getStaffMeta();
  if (!meta.hiddenEmails.includes(email)) {
    meta.hiddenEmails.push(email);
  }
  saveStaffMeta(meta);
}

export function summarizeBillsByDate(bills) {
  const grouped = new Map();
  bills.forEach((bill) => {
    const created = new Date(bill.created_at);
    const key = created.toISOString().slice(0, 10);
    const existing = grouped.get(key) || { date: key, bills: 0, sales: 0, tax: 0, net: 0 };
    const total = Number(bill.total || 0);
    const tax = Number(bill.tax || 0);
    existing.bills += 1;
    existing.sales += total;
    existing.tax += tax;
    existing.net += total - tax;
    grouped.set(key, existing);
  });
  return [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function summarizeBillsByProduct(bills, products) {
  const categories = new Map(products.map((product) => [product.name, product.category || "Other"]));
  const grouped = new Map();
  bills.forEach((bill) => {
    (bill.items || []).forEach((item) => {
      const key = item.name;
      const existing = grouped.get(key) || {
        name: key,
        cat: categories.get(key) || "Other",
        qty: 0,
        rev: 0,
      };
      existing.qty += Number(item.quantity || 0);
      existing.rev += Number(item.quantity || 0) * Number(item.price || 0);
      grouped.set(key, existing);
    });
  });
  return [...grouped.values()].sort((a, b) => b.rev - a.rev);
}

export function isDateInPeriod(dateInput, period) {
  const date = new Date(dateInput);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const startWeek = new Date(startToday);
  startWeek.setDate(startWeek.getDate() - startWeek.getDay());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (period === "today") return date >= startToday;
  if (period === "yesterday") return date >= startYesterday && date < startToday;
  if (period === "week") return date >= startWeek;
  if (period === "month") return date >= startMonth;
  return true;
}
