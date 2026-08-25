import {
  formatScheduledSlot,
  getFulfillmentLabel,
  getOrderTypeForMode,
  getTrackingLine,
  resolveFulfillmentMode,
} from "../../../../core/billing/utils/orderTracking";

const DEFAULT_RESERVATION_MERIDIEM = "PM";

export const FULFILLMENT_MODES = [
  {
    key: "TABLE",
    label: "Table",
    description: "Dine-in table billing with reservation support",
    orderType: "Dine-In",
    menuChannel: "Dine-In",
  },
  {
    key: "TOKEN",
    label: "Token",
    description: "Counter takeaway with token tracking",
    orderType: "Takeaway",
    menuChannel: "Takeaway",
  },
  {
    key: "PICKUP",
    label: "Pickup",
    description: "Scheduled pickup for later collection",
    orderType: "Pickup",
    menuChannel: "Takeaway",
  },
  {
    key: "DELIVERY",
    label: "Delivery",
    description: "Dispatch order to customer address",
    orderType: "Delivery",
    menuChannel: "Delivery",
  },
];

const getModeConfig = (mode) => FULFILLMENT_MODES.find((item) => item.key === mode) || FULFILLMENT_MODES[0];

export const createInitialOrderMeta = () => ({
  fulfillment_mode: "TABLE",
  order_type: "Dine-In",
  table_id: "",
  table_label: "",
  reservation_id: "",
  guests_count: "",
  pickup_date: "",
  pickup_time: "",
  pickup_meridiem: DEFAULT_RESERVATION_MERIDIEM,
  token_number: "",
  customer_name: "",
  customer_phone: "",
  notes: "",
});

export const sanitizeTenDigitPhoneInput = (value) => String(value || "").replace(/\D/g, "").slice(0, 10);

export const buildScheduledDateTime = (dateValue, timeValue, meridiemValue) => {
  if (!dateValue && !timeValue) return "";
  if (!dateValue || !timeValue) return null;
  const match = String(timeValue).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  const meridiem = meridiemValue === "PM" ? "PM" : "AM";
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  const [year, month, day] = dateValue.split("-").map(Number);
  const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(localDate.getTime()) ? null : localDate.toISOString();
};

const parseScheduledFields = (value) => {
  if (!value) {
    return { date: "", time: "", meridiem: DEFAULT_RESERVATION_MERIDIEM };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: "", time: "", meridiem: DEFAULT_RESERVATION_MERIDIEM };
  }
  let hours = parsed.getHours();
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours %= 12;
  if (hours === 0) hours = 12;
  return {
    date: parsed.toISOString().slice(0, 10),
    time: `${String(hours).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`,
    meridiem,
  };
};

export const getMenuChannelForMode = (mode) => getModeConfig(mode).menuChannel;

export const applyFulfillmentMode = (current, mode, suggestedTokenNumber = "") => {
  const nextMode = getModeConfig(mode).key;
  const next = {
    ...current,
    fulfillment_mode: nextMode,
    order_type: getOrderTypeForMode(nextMode),
  };

  if (nextMode !== "TOKEN") {
    next.token_number = "";
  } else if (!next.token_number) {
    next.token_number = suggestedTokenNumber;
  }

  if (nextMode !== "PICKUP") {
    next.pickup_date = "";
    next.pickup_time = "";
    next.pickup_meridiem = DEFAULT_RESERVATION_MERIDIEM;
  }

  if (nextMode !== "TABLE") {
    next.table_id = "";
    next.table_label = "";
    next.reservation_id = "";
    next.guests_count = "";
  }

  return next;
};

export const hydrateOrderMeta = (record = {}, suggestedTokenNumber = "") => {
  const mode = resolveFulfillmentMode(record);
  const pickupFields = parseScheduledFields(record.pickup_slot);
  return applyFulfillmentMode(
    {
      ...createInitialOrderMeta(),
      fulfillment_mode: mode,
      order_type: record.order_type || getOrderTypeForMode(mode),
      customer_name: record.customer_name || "",
      customer_phone: record.customer_phone || "",
      notes: record.notes || "",
      token_number: record.token_number || "",
      table_id: record.table_id || "",
      table_label: record.table_label || record.table_name || "",
      reservation_id: record.reservation_id || "",
      guests_count: record.guests_count ? String(record.guests_count) : "",
      pickup_date: pickupFields.date,
      pickup_time: pickupFields.time,
      pickup_meridiem: pickupFields.meridiem,
    },
    mode,
    suggestedTokenNumber,
  );
};

export {
  formatScheduledSlot,
  getFulfillmentLabel,
  getOrderTypeForMode,
  getTrackingLine,
  resolveFulfillmentMode,
};
