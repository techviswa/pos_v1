const INR_CURRENCY = "INR";
const DEFAULT_GST_RATE = 18;

export const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const nowIso = () => new Date().toISOString();

export const todayKey = (date = new Date()) => date.toISOString().slice(0, 10).replace(/-/g, "");

export const createInvoiceNumber = ({ outletCode = "MO1", sequence = 1, date = new Date() } = {}) =>
  `CF-${String(outletCode || "MO1").toUpperCase()}-${todayKey(date)}-${String(sequence).padStart(4, "0")}`;

export const normalizePayments = (payments = [], { fallbackMethod = "Cash", total = 0 } = {}) => {
  const rows = Array.isArray(payments) ? payments : [];
  const normalized = rows
    .map((payment, index) => ({
      id: payment.id || `pay_${Date.now()}_${index + 1}`,
      method: payment.method || payment.payment_method || fallbackMethod || "Cash",
      amount: Math.max(0, toNumber(payment.amount, 0)),
      status: payment.status || payment.confirmation_status || "confirmed",
      reference: payment.reference || payment.transaction_id || payment.upi_reference || null,
      gateway: payment.gateway || null,
      received_at: payment.received_at || payment.confirmed_at || nowIso(),
      received_by: payment.received_by || null,
      received_by_name: payment.received_by_name || null,
    }))
    .filter((payment) => payment.amount > 0);

  if (!normalized.length && toNumber(total, 0) > 0) {
    normalized.push({
      id: `pay_${Date.now()}_1`,
      method: fallbackMethod || "Cash",
      amount: toNumber(total, 0),
      status: ["UPI", "Gateway", "Card"].includes(fallbackMethod) ? "pending_confirmation" : "confirmed",
      reference: null,
      gateway: fallbackMethod === "UPI" ? "upi" : null,
      received_at: nowIso(),
      received_by: null,
      received_by_name: null,
    });
  }

  return normalized;
};

export const summarizePayments = (payments = [], total = 0) => {
  const confirmedPaid = payments
    .filter((payment) => payment.status === "confirmed")
    .reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0);
  const pendingPaid = payments
    .filter((payment) => payment.status !== "confirmed")
    .reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0);
  const dueAmount = Math.max(0, toNumber(total, 0) - confirmedPaid);

  return {
    paid_amount: confirmedPaid,
    pending_payment_amount: pendingPaid,
    due_amount: dueAmount,
    payment_status: dueAmount <= 0 ? "paid" : confirmedPaid > 0 ? "partial_due" : "unpaid",
  };
};

export const buildGstBreakup = ({ subtotal = 0, tax = 0, gstRate = DEFAULT_GST_RATE } = {}) => {
  const taxableValue = toNumber(subtotal, 0);
  const taxAmount = toNumber(tax, 0);
  const halfTax = Math.round((taxAmount / 2) * 100) / 100;

  return {
    gst_rate: gstRate,
    taxable_value: taxableValue,
    cgst: halfTax,
    sgst: taxAmount - halfTax,
    igst: 0,
    tax_total: taxAmount,
    currency: INR_CURRENCY,
  };
};

export const roundMoney = (value) => Math.round(toNumber(value, 0) * 100) / 100;

export const calculateInvoiceTotals = (payload = {}, items = payload.items || []) => {
  const subtotalFromItems = (items || []).reduce(
    (sum, item) => sum + Math.max(0, toNumber(item.quantity, 0)) * Math.max(0, toNumber(item.price, 0)),
    0,
  );
  const subtotal = roundMoney(items?.length ? subtotalFromItems : payload.subtotal);
  const discountType = payload.discount_type || payload.discountType || "none";
  const discountValue = Math.max(0, toNumber(payload.discount_value ?? payload.discountValue, 0));
  const requestedDiscount = Math.max(0, toNumber(payload.discount_amount ?? payload.discountAmount, 0));
  const discountAmount = roundMoney(
    discountType === "percent"
      ? Math.min(subtotal, subtotal * (Math.min(discountValue, 100) / 100))
      : discountType === "fixed"
        ? Math.min(subtotal, discountValue || requestedDiscount)
        : Math.min(subtotal, requestedDiscount),
  );
  const taxableSubtotal = roundMoney(Math.max(0, subtotal - discountAmount));
  const gstRate = toNumber(payload.gst_rate ?? payload.gstRate, DEFAULT_GST_RATE);
  const tax = roundMoney(taxableSubtotal * (gstRate / 100));
  const total = roundMoney(taxableSubtotal + tax);

  return {
    subtotal,
    discount_amount: discountAmount,
    taxable_subtotal: taxableSubtotal,
    tax,
    total,
    gst_rate: gstRate,
  };
};

export const createReceiptPrintPayload = ({ bill, business, settings = {} }) => ({
  printer_type: settings.printer_type || "thermal_80mm",
  copies: toNumber(settings.copies, 1),
  auto_print: Boolean(settings.auto_print),
  cash_drawer_kick: Boolean(settings.cash_drawer_kick),
  template: settings.template || "gst_receipt_v1",
  payload: {
    business_name: business?.name || "CashFlow Lite POS",
    gstin: settings.gstin || bill.gstin || null,
    invoice_number: bill.invoice_number || bill.id,
    invoice_date: bill.created_at,
    customer_name: bill.customer_name || bill.customerName || "Walk-in",
    customer_phone: bill.customer_phone || null,
    order_type: bill.order_type || "Dine-In",
    table_label: bill.table_label || null,
    items: bill.items || [],
    subtotal: bill.subtotal,
    discount_amount: bill.discount_amount || 0,
    tax: bill.tax,
    total: bill.total,
    payments: bill.payments || [],
    payment_status: bill.payment_status,
    due_amount: bill.due_amount || 0,
    footer: settings.footer || "Thank you. Visit again.",
  },
});
