// Allocated QR invoices can contain several source orders and intentionally have
// no single orderId. Keep them visible to QR feedback without widening outlet scope.
export const qrBillScope = (outletIds) => ({ OR: [
  { order: { channel: "qr", ...(outletIds ? { outletId: { in: outletIds } } : {}) } },
  { AND: [
    { metadata: { path: ["menu_channel"], equals: "QR" } },
    ...(outletIds ? [{ OR: outletIds.map((id) => ({ metadata: { path: ["outlet_id"], equals: id } })) }] : []),
  ] },
] });
