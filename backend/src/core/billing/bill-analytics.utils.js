const VOID_STATUSES = new Set(["void", "cancelled", "canceled"]);

export const toAnalyticsNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getBillMetadata = (bill = {}) =>
  bill.metadata && typeof bill.metadata === "object" && !Array.isArray(bill.metadata)
    ? bill.metadata
    : {};

export const getBillOutletId = (bill = {}, orderOutletMap = new Map()) => {
  const metadata = getBillMetadata(bill);
  return (
    bill.outlet_id ||
    bill.outletId ||
    metadata.outlet_id ||
    metadata.outletId ||
    orderOutletMap.get(bill.orderId || bill.order_id) ||
    bill.order?.outletId ||
    bill.order?.outlet_id ||
    null
  );
};

export const getBillRefundAmount = (bill = {}) => {
  const metadata = getBillMetadata(bill);
  return toAnalyticsNumber(bill.refunded_amount ?? bill.refundedAmount ?? metadata.refunded_amount, 0);
};

export const getBillRevenue = (bill = {}) =>
  Math.max(0, toAnalyticsNumber(bill.total, 0) - getBillRefundAmount(bill));

export const isRevenueBill = (bill = {}) =>
  !VOID_STATUSES.has(String(bill.status || "").toLowerCase()) && getBillRevenue(bill) > 0;

export const getBillTax = (bill = {}) => {
  const total = toAnalyticsNumber(bill.total, 0);
  const revenue = getBillRevenue(bill);
  const ratio = total > 0 ? revenue / total : 0;
  return toAnalyticsNumber(bill.tax, 0) * ratio;
};

export const getBillSubtotal = (bill = {}) => {
  const total = toAnalyticsNumber(bill.total, 0);
  const revenue = getBillRevenue(bill);
  const ratio = total > 0 ? revenue / total : 0;
  return toAnalyticsNumber(bill.subtotal, 0) * ratio;
};

export const getBillChannel = (bill = {}) => {
  const metadata = getBillMetadata(bill);
  return String(bill.order_type || bill.service_mode || bill.payment_type || metadata.order_type || metadata.service_mode || metadata.payment_type || "")
    .toLowerCase()
    .match(/online|website|web|delivery|swiggy|zomato|qr/)
    ? "online"
    : "dine_in";
};

export const getBillCreatedAt = (bill = {}) => bill.created_at || bill.createdAt || getBillMetadata(bill).created_at || null;

export const getBillLineGrossTotal = (bill = {}) =>
  (bill.items || []).reduce((sum, item) => sum + toAnalyticsNumber(item.quantity, 0) * toAnalyticsNumber(item.price, 0), 0);

export const getAllocatedLineRevenue = (bill = {}, item = {}) => {
  const gross = getBillLineGrossTotal(bill);
  const lineGross = toAnalyticsNumber(item.quantity, 0) * toAnalyticsNumber(item.price, 0);
  return gross > 0 ? getBillRevenue(bill) * (lineGross / gross) : 0;
};
