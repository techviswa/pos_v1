import { useMemo, useState } from "react";
import {
  applyFulfillmentMode,
  buildScheduledDateTime,
  createInitialOrderMeta,
  getFulfillmentLabel,
  getMenuChannelForMode,
  hydrateOrderMeta,
} from "../utils/fulfillmentMode";

const getNextTokenNumber = (orders = []) => {
  const tokenOrders = orders.filter((order) => String(order.service_mode || "").toUpperCase() === "TOKEN" || order.order_type === "Takeaway");
  const maxToken = tokenOrders.reduce((highest, order) => {
    const parsed = Number(order.token_number || String(order.fulfillment_label || "").replace(/\D/g, ""));
    return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
  }, 0);
  return String(maxToken + 1).padStart(3, "0");
};

export const useBillingFulfillment = (recentOrders = []) => {
  const [orderMeta, setOrderMeta] = useState(createInitialOrderMeta);
  const suggestedTokenNumber = useMemo(() => getNextTokenNumber(recentOrders), [recentOrders]);
  const pickupSlotValue = useMemo(
    () => buildScheduledDateTime(orderMeta.pickup_date, orderMeta.pickup_time, orderMeta.pickup_meridiem),
    [orderMeta.pickup_date, orderMeta.pickup_meridiem, orderMeta.pickup_time],
  );

  return {
    orderMeta,
    setOrderMeta,
    suggestedTokenNumber,
    pickupSlotValue,
    menuChannel: getMenuChannelForMode(orderMeta.fulfillment_mode),
    fulfillmentLabel: getFulfillmentLabel({ ...orderMeta, pickup_slot: pickupSlotValue }),
    changeFulfillmentMode: (mode) => setOrderMeta((current) => applyFulfillmentMode(current, mode, suggestedTokenNumber)),
    resetOrderMeta: () => setOrderMeta(createInitialOrderMeta()),
    hydrateFromOrder: (order) => setOrderMeta(hydrateOrderMeta(order, suggestedTokenNumber)),
  };
};
