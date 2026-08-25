const BILL_METADATA_DEFAULTS = {
  customer_name: null,
  customer_phone: null,
  payment_type: null,
  invoice_number: null,
  invoice_sequence: 0,
  invoice_format: "gst_receipt_v1",
  gstin: null,
  gst_breakup: null,
  payments: [],
  paid_amount: 0,
  pending_payment_amount: 0,
  due_amount: 0,
  payment_status: "unpaid",
  payment_gateway_status: null,
  refunds: [],
  refunded_amount: 0,
  void_status: null,
  void_requested_by: null,
  void_requested_by_name: null,
  void_requested_at: null,
  void_reason: null,
  void_approved_by: null,
  void_approved_by_name: null,
  void_approved_at: null,
  shift_id: null,
  shift_opened_at: null,
  shift_closed_at: null,
  receipt_printer: null,
  order_type: "Dine-In",
  service_mode: null,
  table_label: null,
  token_number: null,
  pickup_slot: null,
  fulfillment_label: null,
  outlet_id: null,
  notes: "",
  discount_label: null,
  discount_type: null,
  discount_value: 0,
  discount_amount: 0,
  printable_offer_title: null,
  printable_offer_message: null,
  created_by: null,
  created_by_name: null,
  created_by_role: null,
  created_at: null,
  updated_at: null,
  feedback_token: null,
  feedback_link: null,
};

const NUMBER_KEYS = new Set([
  "discount_value",
  "discount_amount",
  "invoice_sequence",
  "paid_amount",
  "pending_payment_amount",
  "due_amount",
  "refunded_amount",
]);
const JSON_KEYS = new Set(["gst_breakup", "payments", "refunds", "receipt_printer"]);
const TEXT_KEYS = new Set(["notes"]);

const hasOwn = (payload, key) => Object.prototype.hasOwnProperty.call(payload || {}, key);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableString = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

const toText = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value);
};

export const normalizeBillingMetadata = (payload = {}, { base = {} } = {}) => {
  const merged = {
    ...BILL_METADATA_DEFAULTS,
    ...(base || {}),
  };

  Object.keys(BILL_METADATA_DEFAULTS).forEach((key) => {
    if (!hasOwn(payload, key)) return;

    if (NUMBER_KEYS.has(key)) {
      merged[key] = toNumber(payload[key], BILL_METADATA_DEFAULTS[key]);
      return;
    }

    if (TEXT_KEYS.has(key)) {
      merged[key] = toText(payload[key], BILL_METADATA_DEFAULTS[key]);
      return;
    }

    if (JSON_KEYS.has(key)) {
      merged[key] = payload[key] === undefined ? BILL_METADATA_DEFAULTS[key] : payload[key];
      return;
    }

    merged[key] = toNullableString(payload[key]);
  });

  return merged;
};

export const extractBillingMetadataFromRequest = (payload = {}, { base = {} } = {}) =>
  normalizeBillingMetadata(
    {
      ...(hasOwn(payload, "customer_name") || hasOwn(payload, "customerName")
        ? { customer_name: payload.customer_name ?? payload.customerName }
        : {}),
      ...(hasOwn(payload, "customer_phone") ? { customer_phone: payload.customer_phone } : {}),
      ...(hasOwn(payload, "payment_type") ? { payment_type: payload.payment_type } : {}),
      ...(hasOwn(payload, "invoice_number") ? { invoice_number: payload.invoice_number } : {}),
      ...(hasOwn(payload, "invoice_sequence") ? { invoice_sequence: payload.invoice_sequence } : {}),
      ...(hasOwn(payload, "invoice_format") ? { invoice_format: payload.invoice_format } : {}),
      ...(hasOwn(payload, "gstin") ? { gstin: payload.gstin } : {}),
      ...(hasOwn(payload, "gst_breakup") ? { gst_breakup: payload.gst_breakup } : {}),
      ...(hasOwn(payload, "payments") ? { payments: payload.payments } : {}),
      ...(hasOwn(payload, "paid_amount") ? { paid_amount: payload.paid_amount } : {}),
      ...(hasOwn(payload, "pending_payment_amount") ? { pending_payment_amount: payload.pending_payment_amount } : {}),
      ...(hasOwn(payload, "due_amount") ? { due_amount: payload.due_amount } : {}),
      ...(hasOwn(payload, "payment_status") ? { payment_status: payload.payment_status } : {}),
      ...(hasOwn(payload, "payment_gateway_status")
        ? { payment_gateway_status: payload.payment_gateway_status }
        : {}),
      ...(hasOwn(payload, "refunds") ? { refunds: payload.refunds } : {}),
      ...(hasOwn(payload, "refunded_amount") ? { refunded_amount: payload.refunded_amount } : {}),
      ...(hasOwn(payload, "void_status") ? { void_status: payload.void_status } : {}),
      ...(hasOwn(payload, "void_requested_by") ? { void_requested_by: payload.void_requested_by } : {}),
      ...(hasOwn(payload, "void_requested_by_name")
        ? { void_requested_by_name: payload.void_requested_by_name }
        : {}),
      ...(hasOwn(payload, "void_requested_at") ? { void_requested_at: payload.void_requested_at } : {}),
      ...(hasOwn(payload, "void_reason") ? { void_reason: payload.void_reason } : {}),
      ...(hasOwn(payload, "void_approved_by") ? { void_approved_by: payload.void_approved_by } : {}),
      ...(hasOwn(payload, "void_approved_by_name")
        ? { void_approved_by_name: payload.void_approved_by_name }
        : {}),
      ...(hasOwn(payload, "void_approved_at") ? { void_approved_at: payload.void_approved_at } : {}),
      ...(hasOwn(payload, "shift_id") ? { shift_id: payload.shift_id } : {}),
      ...(hasOwn(payload, "shift_opened_at") ? { shift_opened_at: payload.shift_opened_at } : {}),
      ...(hasOwn(payload, "shift_closed_at") ? { shift_closed_at: payload.shift_closed_at } : {}),
      ...(hasOwn(payload, "receipt_printer") ? { receipt_printer: payload.receipt_printer } : {}),
      ...(hasOwn(payload, "order_type") ? { order_type: payload.order_type } : {}),
      ...(hasOwn(payload, "service_mode") ? { service_mode: payload.service_mode } : {}),
      ...(hasOwn(payload, "table_label") ? { table_label: payload.table_label } : {}),
      ...(hasOwn(payload, "token_number") ? { token_number: payload.token_number } : {}),
      ...(hasOwn(payload, "pickup_slot") ? { pickup_slot: payload.pickup_slot } : {}),
      ...(hasOwn(payload, "fulfillment_label") ? { fulfillment_label: payload.fulfillment_label } : {}),
      ...(hasOwn(payload, "outlet_id") ? { outlet_id: payload.outlet_id } : {}),
      ...(hasOwn(payload, "notes") ? { notes: payload.notes } : {}),
      ...(hasOwn(payload, "discount_label") ? { discount_label: payload.discount_label } : {}),
      ...(hasOwn(payload, "discount_type") ? { discount_type: payload.discount_type } : {}),
      ...(hasOwn(payload, "discount_value") ? { discount_value: payload.discount_value } : {}),
      ...(hasOwn(payload, "discount_amount") ? { discount_amount: payload.discount_amount } : {}),
      ...(hasOwn(payload, "printable_offer_title")
        ? { printable_offer_title: payload.printable_offer_title }
        : {}),
      ...(hasOwn(payload, "printable_offer_message")
        ? { printable_offer_message: payload.printable_offer_message }
        : {}),
      ...(hasOwn(payload, "created_by") ? { created_by: payload.created_by } : {}),
      ...(hasOwn(payload, "created_by_name") ? { created_by_name: payload.created_by_name } : {}),
      ...(hasOwn(payload, "created_by_role") ? { created_by_role: payload.created_by_role } : {}),
      ...(hasOwn(payload, "created_at") ? { created_at: payload.created_at } : {}),
      ...(hasOwn(payload, "updated_at") ? { updated_at: payload.updated_at } : {}),
      ...(hasOwn(payload, "feedback_token") ? { feedback_token: payload.feedback_token } : {}),
      ...(hasOwn(payload, "feedback_link") ? { feedback_link: payload.feedback_link } : {}),
    },
    { base },
  );
