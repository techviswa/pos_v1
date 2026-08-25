const TRACKING_SEPARATOR = " | ";

export const formatScheduledSlot = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const resolveFulfillmentMode = (record = {}) => {
  const explicitMode = String(record.fulfillment_mode || record.service_mode || "").toUpperCase();
  if (["TABLE", "DINE_IN", "TOKEN", "PICKUP", "DELIVERY"].includes(explicitMode)) {
    return explicitMode === "DINE_IN" ? "TABLE" : explicitMode;
  }

  const reservationStatus = String(record.reservation_status || record.status || "").toLowerCase();
  if (["reserved", "occupied"].includes(reservationStatus) && (record.table_label || record.table_name)) {
    return "TABLE";
  }

  const orderType = String(record.order_type || "").toLowerCase();
  if (orderType.includes("dine")) return "TABLE";
  if (orderType.includes("table")) return "TABLE";
  if (orderType.includes("pickup")) return "PICKUP";
  if (orderType.includes("delivery")) return "DELIVERY";
  if (record.table_label || record.table_name) return "TABLE";
  return "TOKEN";
};

export const getOrderTypeForMode = (mode) => {
  if (mode === "TABLE") return "Dine-In";
  if (mode === "TOKEN") return "Takeaway";
  if (mode === "PICKUP") return "Pickup";
  if (mode === "DELIVERY") return "Delivery";
  return "Takeaway";
};

export const getFulfillmentLabel = (record = {}) => {
  const mode = resolveFulfillmentMode(record);
  if (mode === "TABLE") {
    return record.table_label || record.table_name ? `Table ${record.table_label || record.table_name}` : "Dine-In";
  }
  if (mode === "TOKEN") return record.token_number ? `Token ${record.token_number}` : "";
  if (mode === "PICKUP") {
    return record.pickup_slot ? `Pickup ${formatScheduledSlot(record.pickup_slot)}` : "Pickup";
  }
  return "";
};

export const getTrackingLine = (record = {}) => {
  const orderType = record.order_type || getOrderTypeForMode(resolveFulfillmentMode(record));
  const label = record.fulfillment_label || getFulfillmentLabel(record);
  const guests = record.guests_count ? `${record.guests_count} guests` : "";
  return [orderType, label, guests].filter(Boolean).join(TRACKING_SEPARATOR);
};
