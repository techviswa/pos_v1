import prisma from "../../database/prisma/client.js";
import { nextDocumentSequence } from "../../database/prisma/document-sequence.js";
import { settlementService, lockSettlement, ensureOpenShift } from "./settlement.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { GATEWAY_REFUND_METHOD, mutateBillPayment } from "./billing-payments.service.js";
import { gatewayService } from "../payments/gateway.service.js";
import {
  ensureBusiness,
  serializeBill,
  toPrismaBillItems,
} from "../../database/prisma/helpers.js";
import { extractBillingMetadataFromRequest, normalizeBillingMetadata } from "./billing-metadata.utils.js";
import {
  buildGstBreakup,
  calculateInvoiceTotals,
  createInvoiceNumber,
  createReceiptPrintPayload,
  normalizePayments,
  normalizeSubmittedPayments,
  nowIso,
  summarizePayments,
  toNumber,
} from "./billing-depth.utils.js";
import { orderFulfillmentService } from "../../services/workflows/order-fulfillment.service.js";
import { DEFAULT_BILLING_CURRENCY, DEFAULT_CUSTOMER_NAME } from "../../shared/constants/domain.constants.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { resolveTrustedItems } from "../orders/order-pricing.js";
import { resolveMenuChannel } from "../menu/menu-pricing.js";
import { assertOwnedIds } from "../../database/prisma/scope.js";
import { recordBillTip, resolveTipRecipient } from "../staff/tips.service.js";
import { randomUUID } from "node:crypto";
import { reconcileBillCustomer, upsertCustomerForBill, validateRedemption } from "../customers/customer-core.js";
import { isGiftCardMethod, loadCardForUse, maskCode, normalizeCode, redeemForBill } from "../customers/gift-cards.service.js";

// Discounts above this share of the subtotal need an Owner/Manager. Configurable per deployment.
const MAX_STAFF_DISCOUNT_PERCENT = Math.min(100, Math.max(0, Number(process.env.MAX_STAFF_DISCOUNT_PERCENT ?? 30)));
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

const isManagerRole = (user) => ["owner", "manager"].includes(String(user?.role || "").trim().toLowerCase().replace(/^system[\s_-]+owner$/, "owner"));

// Everything a bill records about who/what/when is decided by the server. Refunds, voids, shift ids, payment
// status, author and timestamps sent by a client are dropped, never stored.
const CLIENT_INVOICE_FIELDS = [
  "customer_name", "customerName", "customer_phone", "payment_type", "paymentType", "payments", "order_id", "orderId",
  "items", "outlet_id", "outletId", "currency", "kitchen_status", "kitchenStatus",
  "order_type", "service_mode", "menu_channel", "table_label", "token_number", "pickup_slot", "fulfillment_label", "notes",
  "discount_label", "discount_type", "discountType", "discount_value", "discountValue", "discount_amount", "discountAmount",
  "printable_offer_title", "printable_offer_message", "invoice_format", "gstin", "receipt_printer",
  "tip_amount", "tip_staff_id", "loyalty_redeem_points", "marketing_opt_in",
];

const sanitizeInvoiceRequest = (payload = {}, user) => {
  const clean = {};
  for (const key of CLIENT_INVOICE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) clean[key] = payload[key];
  }
  // A tax rate override is a manager decision; everyone else bills at the business default.
  if (isManagerRole(user)) {
    for (const key of ["gst_rate", "gstRate"]) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) clean[key] = payload[key];
    }
  }
  // Bills taken offline keep the time they were really rung up, as long as it is a plausible past time.
  const offlineAt = Date.parse(payload.offline_created_at);
  if (Number.isFinite(offlineAt) && offlineAt <= Date.now() + 60_000 && Date.now() - offlineAt <= 30 * 24 * 60 * 60 * 1000) {
    clean.offline_created_at = new Date(offlineAt).toISOString();
  }
  const requestKey = String(payload.client_request_id ?? payload.clientRequestId ?? "").trim();
  if (requestKey) clean.client_request_id = requestKey.slice(0, 80);
  Object.assign(clean, {
    status: "issued",
    created_by: user?.id || null,
    created_by_name: user?.name || null,
    created_by_role: user?.role || null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return clean;
};

const getBillInclude = () => ({
  business: true,
  feedback: true,
  items: true,
});

class BillingService {
  async getNextInvoiceSequence({ businessId }) {
    const sequence = await prisma.documentSequence.findUnique({ where: { key: `invoice:${businessId}` } });
    if (sequence) return sequence.value + 1;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const count = await prisma.bill.count({
      where: {
        businessId,
        createdAt: {
          gte: start,
        },
      },
    });

    return count + 1;
  }

  async getNextInvoicePreview({ tenantId, outletCode = "MO1" }) {
    const business = await ensureBusiness({ tenantId });
    const sequence = await this.getNextInvoiceSequence({ businessId: business.id });

    return {
      invoice_sequence: sequence,
      invoice_number: createInvoiceNumber({ outletCode, sequence }),
    };
  }

  async listInvoices({ tenantId, limit, page, offset }) {
    const business = await ensureBusiness({ tenantId });
    const pagination = getPagination({ limit, page, offset });
    const bills = await prisma.bill.findMany({
      where: { businessId: business.id },
      include: getBillInclude(),
      orderBy: { createdAt: "desc" },
      take: pagination.take,
      skip: pagination.skip,
    });

    return bills.map(serializeBill);
  }

  async getInvoiceById({ tenantId, invoiceId }) {
    const business = await ensureBusiness({ tenantId });
    const bill = await prisma.bill.findFirstOrThrow({
      where: {
        id: invoiceId,
        businessId: business.id,
      },
      include: getBillInclude(),
    });

    return serializeBill(bill);
  }

  async createInvoice({ tenantId, payload: rawPayload, user }) {
    const business = await ensureBusiness({ tenantId });
    const payload = sanitizeInvoiceRequest(rawPayload, user);
    if (payload.outlet_id || payload.outletId) {
      await assertOwnedIds({ kind: "outlet", ids: [payload.outlet_id || payload.outletId], businessId: business.id });
    }
    const { bill: createdBill, replayed } = await prisma.$transaction(async (tx) => {
      await lockSettlement(tx, business.id);

      // Retry safety: the same checkout submitted twice (double tap, network replay) yields the same bill.
      // The settlement lock above serialises bill creation per business, so this check cannot race.
      if (payload.client_request_id) {
        const earlier = await tx.bill.findFirst({
          where: {
            businessId: business.id,
            createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
            metadata: { path: ["client_request_id"], equals: payload.client_request_id },
          },
          include: getBillInclude(),
        });
        if (earlier) return { bill: earlier, replayed: true };
      }

      const requestedOrderId = payload.order_id || payload.orderId || null;
      if (requestedOrderId && !await tx.order.findFirst({ where: { id: requestedOrderId, businessId: business.id }, select: { id: true } })) {
        throw createHttpError({ statusCode: 404, message: "Order not found for this business" });
      }
      let resolvedItems = payload.items || [];
      let linkedOrder = null;

      if (requestedOrderId) {
        linkedOrder = await tx.order.findFirst({
          where: {
            id: requestedOrderId,
            businessId: business.id,
          },
          include: { items: true, bill: { select: { id: true } } },
        });
        if (linkedOrder?.bill) {
          throw createHttpError({ statusCode: 409, code: "ORDER_ALREADY_BILLED", message: "This order already has a bill" });
        }
      }

      if (linkedOrder && !(resolvedItems || []).length) {
        resolvedItems = linkedOrder.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          variation: item.variation,
          addons: item.addons || [],
          modifiers: item.modifiers || null,
        }));
      }

      if (!resolvedItems.length) {
        throw createHttpError({ statusCode: 400, code: "BILL_ITEMS_REQUIRED", message: "A bill needs at least one item" });
      }
      // Prices come from the catalogue, never from the request. Lines taken from an existing order keep the price
      // the server fixed when that order was created (a QR customer has already seen it).
      const itemsFromOrder = Boolean(linkedOrder) && !(payload.items || []).length;
      resolvedItems = itemsFromOrder
        ? resolvedItems.map((item) => ({ ...item, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) }))
        : await resolveTrustedItems({
          client: tx,
          businessId: business.id,
          items: resolvedItems,
          allowOpenPrice: isManagerRole(user),
          outletId: payload.outlet_id || payload.outletId || null,
          channel: resolveMenuChannel(payload),
          // A bill rung up offline is priced by the rules in force when it was taken (e.g. a happy hour).
          at: payload.offline_created_at ? new Date(payload.offline_created_at) : new Date(),
        });

      // QR orders carry a service charge and tip the customer already saw; they must survive into the bill.
      // At the counter a tip can be added at checkout. Either way it is paid with the bill and never taxed.
      const carriesCharges = linkedOrder?.channel === "qr";
      let tipAmount = carriesCharges ? Number(linkedOrder.metadata?.tip_amount || 0) : 0;
      if (!carriesCharges && payload.tip_amount !== undefined && payload.tip_amount !== null && payload.tip_amount !== "") {
        tipAmount = Number(payload.tip_amount);
        if (!Number.isFinite(tipAmount) || tipAmount < 0) {
          throw createHttpError({ statusCode: 400, code: "TIP_AMOUNT_INVALID", message: "Tip must be zero or a positive amount" });
        }
      }
      const tipRecipient = tipAmount > 0 ? await resolveTipRecipient(tx, business.id, payload.tip_staff_id) : null;
      // The guest behind the phone number: builds their profile and pays with / earns loyalty points.
      const customer = await upsertCustomerForBill(tx, {
        businessId: business.id,
        phone: payload.customer_phone,
        name: payload.customer_name || payload.customerName,
        marketingOptIn: payload.marketing_opt_in === true,
      });
      const chargeOptions = { serviceCharge: carriesCharges ? linkedOrder.metadata?.service_charge : 0, tip: tipAmount };
      const redeemPoints = payload.loyalty_redeem_points === undefined || payload.loyalty_redeem_points === null || payload.loyalty_redeem_points === ""
        ? 0 : Number(payload.loyalty_redeem_points);
      let loyaltyDiscount = 0;
      if (redeemPoints) {
        const before = calculateInvoiceTotals(payload, resolvedItems, chargeOptions);
        loyaltyDiscount = await validateRedemption(tx, {
          businessId: business.id, customer, points: redeemPoints, eligibleAmount: before.subtotal - before.discount_amount,
        });
      }
      const totals = calculateInvoiceTotals(payload, resolvedItems, { ...chargeOptions, loyaltyDiscount });
      if (!carriesCharges && totals.tip_amount > Math.max(10000, totals.subtotal)) {
        throw createHttpError({ statusCode: 400, code: "TIP_AMOUNT_INVALID", message: "Tip is larger than this bill allows" });
      }
      const discountShare = totals.subtotal > 0 ? (totals.discount_amount / totals.subtotal) * 100 : 0;
      if (discountShare > MAX_STAFF_DISCOUNT_PERCENT && !isManagerRole(user)) {
        throw createHttpError({
          statusCode: 403,
          code: "DISCOUNT_APPROVAL_REQUIRED",
          message: `Discounts above ${MAX_STAFF_DISCOUNT_PERCENT}% need an Owner or Manager`,
        });
      }
      const costProducts = await tx.product.findMany({ where: { businessId: business.id, OR: [
        { id: { in: resolvedItems.map((item) => item.productId || item.product_id).filter(Boolean) } },
        { name: { in: resolvedItems.map((item) => item.name).filter(Boolean) } },
      ] }, select: { id: true, name: true, costPrice: true } });
      const itemCosts = resolvedItems.map((item) => {
        const productId = item.productId || item.product_id;
        const product = costProducts.find((entry) => productId ? entry.id === productId : entry.name === item.name);
        if (productId && !product) throw createHttpError({ statusCode: 404, message: "Product not found for this business" });
        return { product_id: productId || null, name: item.name, unit_cost: product ? Number(product.costPrice || 0) : null };
      });
      const { subtotal, tax, total } = totals;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const currentSequence = await tx.bill.count({
        where: {
          businessId: business.id,
          createdAt: {
            gte: start,
          },
        },
      });
      const invoiceSequence = await nextDocumentSequence(tx, `invoice:${business.id}`, currentSequence);
      // The outlet segment comes from the outlet record, never from the request.
      const requestedOutletId = payload.outlet_id || payload.outletId || null;
      const outletRow = requestedOutletId
        ? await tx.outlet.findFirst({ where: { id: requestedOutletId, businessId: business.id }, select: { code: true } })
        : null;
      const invoiceNumber = createInvoiceNumber({
          outletCode: String(outletRow?.code || "MO1").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "MO1",
          sequence: invoiceSequence,
        });
      // Gift cards are checked and charged by the server; everything else goes through the usual payment rules.
      const submittedPayments = payload.payments;
      const giftRows = Array.isArray(submittedPayments)
        ? submittedPayments.filter((row) => row && isGiftCardMethod(row.method || row.payment_method))
        : [];
      const paymentType = payload.payment_type || payload.paymentType || "Cash";
      if (isGiftCardMethod(paymentType) && !giftRows.length) {
        throw createHttpError({ statusCode: 400, code: "GIFT_CARD_CODE_REQUIRED", message: "Enter the gift card code" });
      }
      const giftByCode = new Map();
      for (const row of giftRows) {
        const amount = Math.round(Number(row.amount) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) throw createHttpError({ statusCode: 400, code: "GIFT_CARD_AMOUNT_INVALID", message: "Gift card payment must be positive" });
        const code = normalizeCode(row.gift_card_code || row.code);
        giftByCode.set(code, Math.round(((giftByCode.get(code) || 0) + amount) * 100) / 100);
      }
      const giftPayments = [];
      for (const [code, amount] of giftByCode) {
        const card = await loadCardForUse(tx, { businessId: business.id, code });
        giftPayments.push({ id: randomUUID(), method: "Gift Card", amount, status: "confirmed", reference: `GC ${maskCode(card.code)}`,
          gift_card_id: card.id, gift_card_code: code, gateway: null, received_at: nowIso(), received_by: user?.id || null, received_by_name: user?.name || null });
      }
      const giftTotal = Math.round(giftPayments.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
      if (giftTotal > total) throw createHttpError({ statusCode: 400, message: "Payments cannot exceed the invoice total" });
      const payments = [
        ...giftPayments,
        ...normalizeSubmittedPayments(Array.isArray(submittedPayments) ? submittedPayments.filter((row) => !giftRows.includes(row)) : submittedPayments, {
          fallbackMethod: isGiftCardMethod(paymentType) ? "Due" : paymentType,
          total: Math.round((total - giftTotal) * 100) / 100,
        }),
      ];
      const paymentSummary = summarizePayments(payments, total);
      const gstBreakup = buildGstBreakup({ subtotal: totals.taxable_subtotal, tax, gstRate: totals.gst_rate });
      const shift = await this.getCurrentShift({
        tx,
        user,
        businessId: business.id,
        outletId: payload.outlet_id || payload.outletId || null,
      });

      const bill = await tx.bill.create({
        data: {
          businessId: business.id,
          orderId: requestedOrderId,
          customerName: payload.customerName || payload.customer_name || DEFAULT_CUSTOMER_NAME,
          currency: payload.currency || DEFAULT_BILLING_CURRENCY,
          subtotal,
          tax,
          total,
          status: "issued",
          invoiceNumber,
          kitchenStatus: payload.kitchen_status || payload.kitchenStatus || null,
          metadata: extractBillingMetadataFromRequest({
            ...payload,
            outlet_id: shift.outlet_id,
            invoice_number: invoiceNumber,
            invoice_sequence: invoiceSequence,
            gst_breakup: gstBreakup,
            item_costs: itemCosts,
            customer_id: customer?.id || null,
            loyalty_redeem_points: loyaltyDiscount ? redeemPoints : 0,
            loyalty_discount: totals.loyalty_discount,
            payments: payments.map(({ gift_card_code: _code, ...payment }) => ({
              ...payment,
              settlement_shift_id: shift.id,
              received_by: user?.id || null,
              received_by_name: user?.name || null,
            })),
            ...paymentSummary,
            discount_amount: totals.discount_amount,
            service_charge: totals.service_charge,
            tip_amount: totals.tip_amount,
            tip_staff_id: tipRecipient?.id || null,
            tip_staff_name: tipRecipient?.name || null,
            refunds: [],
            refunded_amount: 0,
            payment_gateway_status: payments.some((payment) => payment.status !== "confirmed")
              ? "pending_confirmation"
              : "confirmed",
            shift_id: shift.id,
            shift_opened_at: shift.opened_at,
          }),
          items: {
            create: toPrismaBillItems(resolvedItems),
          },
        },
        include: getBillInclude(),
      });

      for (const payment of giftPayments) {
        await redeemForBill(tx, { businessId: business.id, code: payment.gift_card_code, amount: payment.amount, billId: bill.id, actor: user, outletId: shift.outlet_id });
      }
      const customerEffects = await reconcileBillCustomer(tx, { bill, actor: user });
      if (Object.keys(customerEffects).length) {
        bill.metadata = { ...bill.metadata, ...customerEffects };
        await tx.bill.update({ where: { id: bill.id }, data: { metadata: bill.metadata } });
      }

      await recordBillTip(tx, {
        businessId: business.id,
        billId: bill.id,
        outletId: shift.outlet_id,
        amount: totals.tip_amount,
        recipient: tipRecipient,
        source: carriesCharges ? "qr" : "bill",
        actor: user,
      });

      const fulfillment = await orderFulfillmentService.handleBillIssued({
        tenantId,
        businessId: business.id,
        orderId: bill.orderId,
        billId: bill.id,
        outletId: shift.outlet_id,
        items: resolvedItems,
        tx,
      });
      if (fulfillment.consumption.length) {
        const costs = itemCosts.map((entry) => {
          const productId = entry.product_id || costProducts.find((product) => product.name === entry.name)?.id;
          const recipe = fulfillment.recipeCosts.get(productId);
          return recipe ? { ...entry, unit_cost: recipe.cost / recipe.quantity, cost_source: "recipe" } : entry;
        });
        bill.metadata = { ...bill.metadata, item_costs: costs, inventory_consumption: fulfillment.consumption,
          inventory_consumption_by_product: fulfillment.consumptionByProduct };
        await tx.bill.update({ where: { id: bill.id }, data: { metadata: bill.metadata } });
      }

      return { bill, replayed: false };
    });

    const serializedBill = serializeBill(createdBill);
    if (replayed) return serializedBill;
    await admincoreChangeSyncService.notifyChange({
      resource: "bills",
      action: "created",
      recordId: serializedBill.id,
      tenantId,
      businessId: business.id,
      outletId: serializedBill.outlet_id,
      metadata: {
        total: serializedBill.total,
        status: serializedBill.status,
        invoice_number: serializedBill.invoice_number,
      },
    });

    return serializedBill;
  }

  async updateInvoice({ tenantId, invoiceId, payload, initializeFeedback = false }) {
    const editableFields = new Set([
      "customer_name", "customerName", "customer_phone", "notes",
      "kitchen_status", "kitchenStatus", "updated_at",
    ]);
    if (initializeFeedback) {
      editableFields.add("feedback_token");
      editableFields.add("feedback_link");
    }
    if (!payload || Object.keys(payload).some((key) => !editableFields.has(key))) {
      throw createHttpError({ statusCode: 409, message: "Issued invoice financial and ownership fields are immutable. Use payment, refund, or void actions." });
    }
    const business = await ensureBusiness({ tenantId });
    const bill = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${invoiceId}`}))`;
      const currentBill = await tx.bill.findFirstOrThrow({
        where: { id: invoiceId, businessId: business.id },
        include: getBillInclude(),
      });

      return tx.bill.update({
        where: { id: invoiceId },
        data: {
          customerName: payload.customerName ?? payload.customer_name ?? currentBill.customerName,
          kitchenStatus: payload.kitchen_status ?? payload.kitchenStatus ?? currentBill.kitchenStatus,
          metadata: extractBillingMetadataFromRequest(
            { ...payload, updated_at: new Date().toISOString() },
            { base: currentBill.metadata || {} },
          ),
        },
        include: getBillInclude(),
      });
    });

    const serializedBill = serializeBill(bill);
    await admincoreChangeSyncService.notifyChange({
      resource: "bills",
      action: "updated",
      recordId: serializedBill.id,
      tenantId,
      businessId: business.id,
      outletId: serializedBill.outlet_id,
      metadata: {
        total: serializedBill.total,
        status: serializedBill.status,
        invoice_number: serializedBill.invoice_number,
      },
    });

    return serializedBill;
  }

  async getCurrentShift({ businessId, outletId = null, tx = null, user }) {
    if (tx) return ensureOpenShift(tx, businessId, outletId, user);
    return settlementService.current({ businessId, outletId });
  }

  async openShift({ tenantId, outletId = null, openingCash = 0, user } = {}) {
    const business = await ensureBusiness({ tenantId });
    return settlementService.open({ businessId: business.id, outletId, openingCash, user });
  }

  async getShift({ tenantId, outletId = null } = {}) {
    const business = await ensureBusiness({ tenantId });
    return settlementService.current({ businessId: business.id, outletId });
  }

  async closeShift({ tenantId, outletId = null, closingCash, shiftId, user } = {}) {
    const business = await ensureBusiness({ tenantId });
    return settlementService.close({ businessId: business.id, outletId, closingCash, shiftId, user });
  }

  async getShiftHistory({ tenantId, outletId = null }) {
    const business = await ensureBusiness({ tenantId });
    return settlementService.history({ businessId: business.id, outletId });
  }

  async addPayment({ tenantId, invoiceId, payload, user }) {
    return mutateBillPayment({ tenantId, invoiceId, payload, user, action: "payment" });
  }

  async confirmPayment({ tenantId, invoiceId, paymentId, payload, user }) {
    return mutateBillPayment({ tenantId, invoiceId, paymentId, payload, user, action: "confirm" });
  }

  async refundInvoice({ tenantId, invoiceId, payload = {}, user }) {
    // Refunds to the customer's UPI/card go to Razorpay first and are recorded once Razorpay accepts them.
    if (String(payload.method || "").trim().toLowerCase() === GATEWAY_REFUND_METHOD.toLowerCase()) {
      return gatewayService.refundBill({ tenantId, invoiceId, payload, user });
    }
    return mutateBillPayment({ tenantId, invoiceId, payload, user, action: "refund" });
  }

  async requestVoid({ tenantId, invoiceId, reason, user }) {
    return mutateBillPayment({ tenantId, invoiceId, payload: { reason }, user, action: "void_request" });
  }

  async approveVoid({ tenantId, invoiceId, approved = true, user }) {
    return mutateBillPayment({ tenantId, invoiceId, payload: { approved }, user, action: "void_approve" });
  }

  async getGstInvoice({ tenantId, invoiceId, settings = {} }) {
    const business = await ensureBusiness({ tenantId });
    const bill = await this.getInvoiceById({ tenantId, invoiceId });
    const gstBreakup = bill.gst_breakup || buildGstBreakup({ subtotal: bill.subtotal, tax: bill.tax });

    return {
      invoice_number: bill.invoice_number || bill.id,
      invoice_format: bill.invoice_format || "gst_receipt_v1",
      supplier: {
        name: business.name,
        gstin: settings.gstin || bill.gstin || null,
      },
      customer: {
        name: bill.customer_name || bill.customerName || "Walk-in",
        phone: bill.customer_phone || null,
      },
      items: bill.items,
      subtotal: bill.subtotal,
      discount_amount: bill.discount_amount || 0,
      gst_breakup: gstBreakup,
      total: bill.total,
      payment_status: bill.payment_status,
      due_amount: bill.due_amount,
      created_at: bill.created_at,
    };
  }

  async getReceiptPrintPayload({ tenantId, invoiceId, settings = {} }) {
    const business = await ensureBusiness({ tenantId });
    const bill = await this.getInvoiceById({ tenantId, invoiceId });
    return createReceiptPrintPayload({ bill, business, settings });
  }

  async getCashDrawerReport({ tenantId, outletId = null, shiftId = null }) {
    const business = await ensureBusiness({ tenantId });
    return settlementService.report({ businessId: business.id, outletId, shiftId });
  }

  async deleteInvoice({ tenantId, invoiceId }) {
    const business = await ensureBusiness({ tenantId });
    const bill = await prisma.bill.findFirstOrThrow({
      where: {
        id: invoiceId,
        businessId: business.id,
      },
      include: getBillInclude(),
    });

    throw createHttpError({ statusCode: 409, message: "Issued invoices must be retained for audit. Use the void approval workflow." });
  }

  async getBillingSummary({ tenantId }) {
    const bills = await this.listInvoices({ tenantId });
    const subtotal = bills.reduce((sum, bill) => sum + Number(bill.subtotal || 0), 0);
    const tax = bills.reduce((sum, bill) => sum + Number(bill.tax || 0), 0);
    const total = bills.reduce((sum, bill) => sum + Number(bill.total || 0), 0);

    return {
      tenantId,
      currency: bills[0]?.currency || DEFAULT_BILLING_CURRENCY,
      invoiceCount: bills.length,
      subtotal,
      tax,
      total,
    };
  }
}

export const billingService = new BillingService();
