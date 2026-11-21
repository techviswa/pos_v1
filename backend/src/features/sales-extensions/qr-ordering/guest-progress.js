export function guestProgress(order, kitchenStatus) {
  const approval = order.metadata?.approval_status;
  if (["cancelled", "rejected"].includes(order.status) || approval === "rejected" || kitchenStatus === "rejected") {
    return order.status === "cancelled" ? "cancelled" : "rejected";
  }
  if (approval === "pending" || order.status === "qr_pending_approval") return "pending";
  if (["served", "completed"].includes(kitchenStatus)) return "completed";
  if (kitchenStatus === "ready") return "ready";
  if (kitchenStatus === "preparing") return "preparing";
  if (kitchenStatus) return "accepted";
  return ["preparing", "ready", "completed"].includes(order.status) ? order.status : "accepted";
}
