// A manual UPI request made at the till closes when the manager confirms that payment on Bills; a payment still being
// collected through Razorpay cannot be confirmed by hand (it would be counted twice).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { paymentsService } from "../src/core/payments/payments.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const id = `upi-confirm-${randomUUID().slice(0, 8)}`, tenantId = `tenant-${id}`;
const owner = { id: "owner", role: "Owner", name: "Owner" };
try {
  await connectDatabase();
  await prisma.business.create({ data: { id, tenantId, name: "UPI confirm fixture" } });
  const product = await prisma.product.create({ data: { businessId: id, name: "Coffee", category: "Drinks", price: 100, stock: 50 } });
  const sale = () => billingService.createInvoice({ tenantId, user: owner, payload: { payment_type: "UPI", gst_rate: 0, items: [{ productId: product.id, name: "Coffee", quantity: 1, price: 100 }] } });

  // Till flow: the bill holds a UPI payment waiting for confirmation and a manual UPI request for it.
  const bill = await sale();
  const pending = bill.payments.find((row) => row.status === "pending_confirmation");
  const request = await paymentsService.createIntent({ tenantId, businessId: id, user: owner, payload: { invoice_id: bill.id, amount: 100, method: "UPI" } });
  assert.equal(request.status, "pending");
  const confirmed = await billingService.confirmPayment({ tenantId, invoiceId: bill.id, paymentId: pending.id, user: owner, payload: { reference: "UTR-123" } });
  assert.equal(confirmed.payment_status, "paid");
  const closed = (await paymentsService.listIntents({ tenantId, businessId: id })).find((row) => row.id === request.id);
  assert.equal(closed.status, "confirmed", "the till's UPI request closes with the bill payment");
  assert.equal(closed.reference, "UTR-123");

  // A Razorpay request still collecting a payment blocks confirming that payment by hand.
  const second = await sale();
  const waiting = second.payments.find((row) => row.status === "pending_confirmation");
  await prisma.stateDocument.create({ data: { key: `payment-intent:${encodeURIComponent(id)}:payint_rzp_${randomUUID()}`, data: {
    id: "rzp", tenantId, businessId: id, provider: "razorpay", method: "UPI", status: "pending", amount: 100, invoiceId: second.id, billPaymentId: waiting.id } } });
  await assert.rejects(billingService.confirmPayment({ tenantId, invoiceId: second.id, paymentId: waiting.id, user: owner, payload: { reference: "UTR-999" } }), (error) => error.code === "GATEWAY_PAYMENT_PENDING");
  assert.equal((await billingService.getInvoiceById({ tenantId, invoiceId: second.id })).payment_status, "unpaid");
  console.log("UPI request confirmation passed: manual UPI requests close with the bill payment; Razorpay-collected payments cannot be confirmed by hand.");
} finally {
  await prisma.stateDocument.deleteMany({ where: { key: { contains: encodeURIComponent(id) } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
