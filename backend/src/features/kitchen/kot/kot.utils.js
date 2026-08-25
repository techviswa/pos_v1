const DEFAULT_STATIONS = [
  { id: "bar", name: "Bar", keywords: ["coffee", "tea", "juice", "drink", "beverage", "latte"] },
  { id: "grill", name: "Grill", keywords: ["grill", "burger", "sandwich", "steak"] },
  { id: "tandoor", name: "Tandoor", keywords: ["tandoor", "naan", "roti", "kebab"] },
  { id: "dessert", name: "Dessert", keywords: ["cake", "dessert", "ice cream", "pastry"] },
  { id: "main_kitchen", name: "Main Kitchen", keywords: [] },
];

export const KOT_STATUSES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  PREPARING: "preparing",
  READY: "ready",
  SERVED: "served",
  COMPLETED: "completed",
  REJECTED: "rejected",
};

export const getDefaultStations = () => DEFAULT_STATIONS.map((station) => ({ ...station }));

export const nowIso = () => new Date().toISOString();

export const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const routeItemToStation = (item, stations = DEFAULT_STATIONS) => {
  const haystack = `${item?.name || ""} ${item?.category || ""}`.toLowerCase();
  const matchedStation = stations.find((station) =>
    (station.keywords || []).some((keyword) => haystack.includes(String(keyword).toLowerCase())),
  );
  return matchedStation || stations.find((station) => station.id === "main_kitchen") || stations[0];
};

export const createKotTicketNumber = ({ createdAt = new Date(), sequence = 1 } = {}) => {
  const date = new Date(createdAt);
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `KOT-${ymd}-${String(sequence).padStart(4, "0")}`;
};

export const buildKotItemState = ({ orderItems = [], stations = DEFAULT_STATIONS, existingItems = [] }) => {
  const existingById = new Map((existingItems || []).map((item) => [item.item_id, item]));

  return (orderItems || []).map((item, index) => {
    const station = routeItemToStation(item, stations);
    const existing = existingById.get(item.id);
    return {
      item_id: item.id || `item_${index + 1}`,
      product_id: item.productId || item.product_id || null,
      name: item.name || "Item",
      quantity: Math.max(1, toNumber(item.quantity, 1)),
      price: toNumber(item.price, 0),
      variation: item.variation || null,
      addons: item.addons || [],
      station_id: existing?.station_id || station.id,
      station_name: existing?.station_name || station.name,
      status: existing?.status || KOT_STATUSES.PENDING,
      accepted_at: existing?.accepted_at || null,
      prep_started_at: existing?.prep_started_at || null,
      ready_at: existing?.ready_at || null,
      served_at: existing?.served_at || null,
      rejected_at: existing?.rejected_at || null,
      reject_reason: existing?.reject_reason || null,
    };
  });
};

export const appendKotAudit = (kot = {}, event) => ({
  ...(kot || {}),
  audit: [
    ...((kot || {}).audit || []),
    {
      id: `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: nowIso(),
      ...event,
    },
  ],
});

export const summarizeKotTiming = (kot = {}) => {
  const startedAt = kot.accepted_at || kot.created_at;
  const endedAt = kot.served_at || kot.ready_at || nowIso();
  const elapsedMinutes =
    startedAt && endedAt
      ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
      : 0;
  const estimatedPrepMinutes = Math.max(0, toNumber(kot.estimated_prep_minutes, 20));

  return {
    estimated_prep_minutes: estimatedPrepMinutes,
    elapsed_prep_minutes: elapsedMinutes,
    sla_status:
      kot.ready_at && estimatedPrepMinutes > 0 && elapsedMinutes > estimatedPrepMinutes
        ? "breached"
        : "within_sla",
  };
};

export const buildPrintPayload = ({ ticket, order, kot }) => ({
  printer_type: "kitchen_thermal",
  template: "kot_ticket_v1",
  auto_print: Boolean(kot.auto_print),
  payload: {
    ticket_id: ticket.id,
    ticket_number: kot.ticket_number || ticket.id,
    token_number: order.metadata?.token_number || order.metadata?.kot?.token_number || null,
    table_label: order.metadata?.table_name || order.metadata?.table_label || null,
    customer_name: order.customerName,
    channel: order.channel,
    station_groups: Object.values(
      (kot.items || []).reduce((groups, item) => {
        const key = item.station_id || "main_kitchen";
        groups[key] = groups[key] || {
          station_id: key,
          station_name: item.station_name || "Main Kitchen",
          items: [],
        };
        groups[key].items.push(item);
        return groups;
      }, {}),
    ),
    notes: order.metadata?.notes || order.metadata?.customer_note || "",
    printed_at: nowIso(),
  },
});
