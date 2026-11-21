import prisma from "../../../database/prisma/client.js";
import { bindTenantScope } from "../../../database/prisma/tenant-context.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { qrOrderingService } from "./qr-ordering.service.js";
import { paymentsService } from "../../../core/payments/payments.service.js";
import { gatewayService } from "../../../core/payments/gateway.service.js";
import { billingService } from "../../../core/billing/billing.service.js";
import { summarizePayments } from "../../../core/billing/billing-depth.utils.js";
import { getCustomerSettings, lockedBalance, validateRedemption } from "../../../core/customers/customer-core.js";
import { publishChange } from "../../../services/realtime/realtime.service.js";

const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
const publicIntent = (intent) => intent ? {
  id: intent.id, amount: intent.amount, status: intent.status,
  url: intent.razorpay?.short_url || null, expires_at: intent.razorpay?.expires_at || null,
} : null;
const scope = (order) => ({ businessId: order.businessId, tenantId: order.business.tenantId });

class QrCheckoutService {
  async order(trackingToken, billId = null) {
    const order = await prisma.order.findUnique({ where: { trackingToken }, include: { business: true, items: true, bill: { include: { items: true } } } });
    if (!order || order.channel !== "qr") fail(404, "QR order not found");
    bindTenantScope(scope(order));
    if (order.metadata?.qr_bill_ids?.length) {
      order.checkoutBills = await prisma.bill.findMany({ where: { businessId: order.businessId, id: { in: order.metadata.qr_bill_ids } }, include: { items: true }, orderBy: { createdAt: "asc" } });
      order.bill = billId ? order.checkoutBills.find((bill) => bill.id === billId) : order.checkoutBills[0];
      if (!order.bill) fail(404, "Bill not found for this order");
    } else if (billId && order.bill?.id !== billId) fail(404, "Bill not found for this order");
    return order;
  }
  async snapshot({ trackingToken, billId }) {
    const order = await this.order(trackingToken, billId);
    const gateway = await gatewayService.status(scope(order));
    if (!order.bill) return { bill: null, requested: Boolean(order.metadata?.bill_requested), redeem_points_requested: order.metadata?.qr_loyalty_points || 0, online_enabled: gateway.enabled };
    const bill = order.bill, metadata = bill.metadata || {};
    const summary = summarizePayments(metadata.payments || [], bill.total);
    const intents = (await paymentsService.listIntents(scope(order))).filter((row) => row.invoice_id === bill.id && row.provider === "razorpay");
    return {
      online_enabled: gateway.enabled,
      invoices: (order.checkoutBills || [bill]).map((row) => ({ id: row.id, number: row.invoiceNumber, total: Number(row.total), ...summarizePayments(row.metadata?.payments || [], row.total) })),
      bill: {
        id: bill.id, number: bill.invoiceNumber, currency: bill.currency, status: bill.status,
        subtotal: Number(bill.subtotal), tax: Number(bill.tax), total: Number(bill.total),
        discount: Number(metadata.discount_amount || 0), service_charge: Number(metadata.service_charge || 0), tip: Number(metadata.tip_amount || 0),
        loyalty_discount: Number(metadata.loyalty_discount || 0), loyalty_points_earned: Number(metadata.loyalty_points_earned || 0),
        loyalty_points_redeemed: Number(metadata.loyalty_redeem_points || 0),
        ...summary,
        items: bill.items.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, price: Number(item.price), variation: item.variation })),
      },
      // Only this order's invoice and payment links; never a table-wide list of other guests' bills.
      active_payment: publicIntent(intents.find((row) => row.status === "pending" && row.client_request_id?.startsWith("qr:"))),
      staff_payment_in_progress: intents.some((row) => row.status === "pending" && !row.client_request_id?.startsWith("qr:")),
      payments: (metadata.payments || []).filter((row) => row.status === "confirmed").map((row) => ({ amount: row.amount, method: row.method, status: "confirmed" })),
    };
  }
  async qrForOrder(order) {
    const qr = await prisma.tableQrCode.findFirst({ where: { id: order.metadata?.qr_code_id || "", businessId: order.businessId } });
    if (!qr) fail(409, "Please ask staff to help verify your loyalty account; this QR has been replaced.");
    return qr;
  }
  async sendCode({ trackingToken }) {
    const order = await this.order(trackingToken), qr = await this.qrForOrder(order);
    const phone = order.metadata?.customer_phone;
    if (!phone) fail(400, "This order has no customer phone. Ask staff to link your loyalty account.");
    return qrOrderingService.requestPhoneVerification({ token: qr.token, phone });
  }
  async verifyCode({ trackingToken, verificationToken, otp }) {
    const order = await this.order(trackingToken), qr = await this.qrForOrder(order);
    await qrOrderingService.verifyPhone({ token: qr.token, verificationToken, otp });
    return this.loyalty({ trackingToken, verificationToken });
  }
  async verified(order, verificationToken) {
    await qrOrderingService.assertPhoneVerified({ businessId: order.businessId, customerPhone: order.metadata?.customer_phone, verificationToken, rules: { requirePhoneVerification: true } });
  }
  async loyalty({ trackingToken, verificationToken }) {
    const order = await this.order(trackingToken);
    await this.verified(order, verificationToken);
    const { loyalty } = await getCustomerSettings(order.businessId);
    const customer = await prisma.customer.findUnique({ where: { businessId_phone: { businessId: order.businessId, phone: order.metadata.customer_phone } } });
    const current = customer ? await prisma.$transaction((tx) => lockedBalance(tx, customer.id)) : null;
    return { rules: loyalty, points: current?.loyaltyPoints || 0 };
  }
  async requestBill({ trackingToken, points = 0, verificationToken }) {
    const order = await this.order(trackingToken);
    if (!Number.isSafeInteger(points) || points < 0) fail(400, "Choose a whole number of loyalty points");
    if (points) await this.verified(order, verificationToken);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qr-invoice:${order.id}`}))`;
      const current = await tx.order.findUnique({ where: { id: order.id }, include: { bill: true } });
      if (current.bill || current.metadata?.qr_bill_ids?.length) fail(409, "Your bill is already issued. Ask staff for changes.");
      if (current.metadata?.approval_status !== "approved" || ["cancelled", "rejected", "qr_rejected"].includes(current.status)) fail(409, "The restaurant must accept this order before preparing a bill");
      if (points) {
        const customer = await tx.customer.findUnique({ where: { businessId_phone: { businessId: order.businessId, phone: order.metadata.customer_phone } } });
        await validateRedemption(tx, { businessId: order.businessId, customer, points, eligibleAmount: Number(order.metadata?.subtotal || 0) });
      }
      await tx.order.update({ where: { id: order.id }, data: { metadata: { ...current.metadata, bill_requested: true, qr_loyalty_points: points, qr_loyalty_verified: points > 0 } } });
      await publishChange({ businessId: order.businessId, resource: "qr_orders", action: "bill_requested", recordId: order.id, outletId: order.outletId }, { tx });
    });
    return { requested: true, redeem_points_requested: points };
  }
  async issueBill({ businessId, tenantId, orderId, user, applyPoints = true }) {
    const order = await prisma.order.findFirst({ where: { id: orderId, businessId, channel: "qr" }, include: { bill: true } });
    if (!order) fail(404, "QR order not found");
    if (order.metadata?.qr_bill_ids?.length) return { id: order.metadata.qr_bill_ids[0] };
    if (order.bill) return { id: order.bill.id };
    if (order.metadata?.approval_status !== "approved" || ["cancelled", "rejected", "qr_rejected"].includes(order.status)) fail(409, "Only accepted orders can be billed");
    return billingService.createInvoice({ tenantId, user, payload: {
      order_id: order.id, customer_name: order.customerName, customer_phone: order.metadata?.customer_phone,
      outlet_id: order.outletId, payment_type: "Due", payments: [], order_type: "Dine-In", table_label: order.metadata?.table_name,
      client_request_id: `qr-invoice:${order.id}`,
      ...(applyPoints ? {} : { loyalty_redeem_points: 0 }),
    } });
  }
  async pay({ trackingToken, amount, requestId, billId }) {
    const order = await this.order(trackingToken, billId);
    if (!order.bill) fail(409, "Ask the restaurant to issue your final bill first");
    if (!(await gatewayService.status(scope(order))).enabled) fail(409, "Online payment is not enabled. Please pay restaurant staff.");
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) fail(400, "A valid payment request key is required");
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) fail(400, "Enter an amount with at most two decimal places");
    const reference = `qr:${order.id}:${requestId}`;
    const claimKey = `qr-checkout-claim:${order.businessId}:${order.bill.id}`;
    const decision = await prisma.$transaction(async (tx) => {
      // Sequential shares: only one open online request per invoice. The gateway remains responsible for confirmation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qr-payment:${order.bill.id}`}))`;
      const intents = (await paymentsService.listIntents(scope(order))).filter((row) => row.invoice_id === order.bill.id && row.provider === "razorpay");
      const earlier = intents.find((row) => row.client_request_id === reference);
      if (earlier) return { existing: publicIntent(earlier) };
      if (intents.some((row) => row.status === "pending")) fail(409, "A payment is already in progress. Complete or cancel it before paying another share.");
      if (intents.filter((row) => Date.parse(row.created_at) > Date.now() - 10 * 60000).length >= 60) fail(429, "Too many payment requests. Please ask restaurant staff for help.");
      const claim = await tx.stateDocument.findUnique({ where: { key: claimKey } });
      if (claim?.data?.status === "creating" && Date.now() - claim.data.at < 60000) fail(409, "A payment link is being prepared. Please wait and refresh your bill.");
      const data = { business_id: order.businessId, request_id: requestId, status: "creating", at: Date.now() };
      await tx.stateDocument.upsert({ where: { key: claimKey }, create: { key: claimKey, data }, update: { data } });
      return {};
    });
    if (decision.existing) return decision.existing;
    try {
      // No database transaction is held across the network call. The durable claim serializes link creation.
      const intent = await paymentsService.createIntent({ ...scope(order), payload: { provider: "razorpay", razorpay_mode: "link", invoice_id: order.bill.id, order_id: order.id, amount, method: "Gateway", reference, client_request_id: reference, note: `Bill ${order.bill.invoiceNumber}` } });
      await prisma.stateDocument.update({ where: { key: claimKey }, data: { data: { business_id: order.businessId, request_id: requestId, status: "ready", at: Date.now() } } });
      return publicIntent(intent);
    } catch (error) {
      await prisma.stateDocument.update({ where: { key: claimKey }, data: { data: { business_id: order.businessId, request_id: requestId, status: "failed", at: Date.now() } } });
      throw error;
    }
  }
  async paymentAction({ trackingToken, intentId, action, billId }) {
    const order = await this.order(trackingToken, billId);
    const intent = await paymentsService.getIntent(intentId, scope(order));
    if (!order.bill || !intent || intent.invoice_id !== order.bill.id || intent.provider !== "razorpay" || !intent.client_request_id?.startsWith("qr:")) fail(404, "Payment not found for this bill");
    return publicIntent(await paymentsService[action === "cancel" ? "cancelIntent" : "refreshIntent"]({ ...scope(order), intentId }));
  }
}
export const qrCheckoutService = new QrCheckoutService();
