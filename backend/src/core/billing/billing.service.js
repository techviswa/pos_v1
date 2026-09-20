import prisma from "../../database/prisma/client.js";
import { nextDocumentSequence } from "../../database/prisma/document-sequence.js";
import { settlementService, lockSettlement, ensureOpenShift } from "./settlement.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { mutateBillPayment } from "./billing-payments.service.js";
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

  async createInvoice({ tenantId, payload, user }) {
    const business = await ensureBusiness({ tenantId });
    const createdBill = await prisma.$transaction(async (tx) => {
      await lockSettlement(tx, business.id);
      const requestedOrderId = payload.order_id || payload.orderId || null;
      if (requestedOrderId && !await tx.order.findFirst({ where: { id: requestedOrderId, businessId: business.id }, select: { id: true } })) {
        throw createHttpError({ statusCode: 404, message: "Order not found for this business" });
      }
      let resolvedItems = payload.items || [];

      if (requestedOrderId && !(resolvedItems || []).length) {
        const linkedOrder = await tx.order.findFirst({
          where: {
            id: requestedOrderId,
            businessId: business.id,
          },
          include: { items: true },
        });

        if (linkedOrder) {
          resolvedItems = linkedOrder.items.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            variation: item.variation,
            addons: item.addons || [],
          }));
        }
      }

      const totals = calculateInvoiceTotals(payload, resolvedItems);
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
      const invoiceNumber = createInvoiceNumber({
          outletCode: payload.outlet_code || payload.outletCode || "MO1",
          sequence: invoiceSequence,
        });
      const payments = normalizeSubmittedPayments(payload.payments, {
        fallbackMethod: payload.payment_type || payload.paymentType || "Cash",
        total,
      });
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
          status: payload.status || "issued",
          kitchenStatus: payload.kitchen_status || payload.kitchenStatus || null,
          metadata: extractBillingMetadataFromRequest({
            ...payload,
            outlet_id: shift.outlet_id,
            invoice_number: invoiceNumber,
            invoice_sequence: invoiceSequence,
            gst_breakup: gstBreakup,
            item_costs: itemCosts,
            payments: payments.map((payment) => ({ ...payment, settlement_shift_id: shift.id })),
            ...paymentSummary,
            discount_amount: totals.discount_amount,
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

      await orderFulfillmentService.handleBillIssued({
        tenantId,
        businessId: business.id,
        orderId: bill.orderId,
        billId: bill.id,
        items: resolvedItems,
        tx,
      });

      return bill;
    });

    const serializedBill = serializeBill(createdBill);
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

  async refundInvoice({ tenantId, invoiceId, payload, user }) {
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
