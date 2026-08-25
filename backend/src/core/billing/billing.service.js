import prisma from "../../database/prisma/client.js";
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
  nowIso,
  summarizePayments,
  toNumber,
} from "./billing-depth.utils.js";
import { orderFulfillmentService } from "../../services/workflows/order-fulfillment.service.js";
import { DEFAULT_BILLING_CURRENCY, DEFAULT_CUSTOMER_NAME } from "../../shared/constants/domain.constants.js";
import { getPagination } from "../../shared/utils/pagination.js";

const getBillInclude = () => ({
  business: true,
  feedback: true,
  items: true,
});

const shiftStore = new Map();

const getShiftKey = ({ businessId, outletId = "all" }) => `${businessId}:${outletId || "all"}`;

const defaultShift = ({ businessId, outletId = null, openedBy = null, openedByName = null } = {}) => {
  const openedAt = nowIso();
  return {
    id: `shift_${businessId}_${outletId || "all"}_${openedAt.replace(/[-:.TZ]/g, "")}`,
    business_id: businessId,
    outlet_id: outletId || null,
    opened_at: openedAt,
    opened_by: openedBy,
    opened_by_name: openedByName,
    opening_cash: 0,
    closed_at: null,
    closed_by: null,
    closed_by_name: null,
    closing_cash: null,
    expected_cash: 0,
    variance: 0,
    status: "open",
  };
};

class BillingService {
  async getNextInvoiceSequence({ businessId }) {
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

  async createInvoice({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const createdBill = await prisma.$transaction(async (tx) => {
      const requestedOrderId = payload.order_id || payload.orderId || null;
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
      const invoiceSequence = payload.invoice_sequence || currentSequence + 1;
      const invoiceNumber =
        payload.invoice_number ||
        createInvoiceNumber({
          outletCode: payload.outlet_code || payload.outletCode || "MO1",
          sequence: invoiceSequence,
        });
      const payments = normalizePayments(payload.payments, {
        fallbackMethod: payload.payment_type || payload.paymentType || "Cash",
        total,
      });
      const paymentSummary = summarizePayments(payments, total);
      const gstBreakup = buildGstBreakup({ subtotal: totals.taxable_subtotal, tax, gstRate: totals.gst_rate });
      const shift = this.getCurrentShift({
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
            invoice_number: invoiceNumber,
            invoice_sequence: invoiceSequence,
            gst_breakup: gstBreakup,
            payments,
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

    return serializeBill(createdBill);
  }

  async updateInvoice({ tenantId, invoiceId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentBill = await prisma.bill.findFirstOrThrow({
      where: {
        id: invoiceId,
        businessId: business.id,
      },
      include: getBillInclude(),
    });

    const totals = calculateInvoiceTotals(
      {
        ...normalizeBillingMetadata(currentBill.metadata || {}),
        subtotal: currentBill.subtotal,
        tax: currentBill.tax,
        total: currentBill.total,
        ...payload,
      },
      payload.items !== undefined ? payload.items : currentBill.items,
    );

    await prisma.bill.update({
      where: { id: invoiceId },
      data: {
        orderId: payload.order_id ?? payload.orderId ?? currentBill.orderId,
        customerName: payload.customerName ?? payload.customer_name ?? currentBill.customerName,
        currency: payload.currency ?? currentBill.currency,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        status: payload.status ?? currentBill.status,
        kitchenStatus: payload.kitchen_status ?? payload.kitchenStatus ?? currentBill.kitchenStatus,
        metadata: extractBillingMetadataFromRequest(
          {
            ...payload,
            discount_amount: totals.discount_amount,
            gst_breakup: buildGstBreakup({ subtotal: totals.taxable_subtotal, tax: totals.tax, gstRate: totals.gst_rate }),
          },
          { base: currentBill.metadata || {} },
        ),
      },
    });

    if (payload.items !== undefined) {
      await prisma.billItem.deleteMany({
        where: { billId: invoiceId },
      });

      if ((payload.items || []).length) {
        await prisma.billItem.createMany({
          data: toPrismaBillItems(payload.items).map((item) => ({
            ...item,
            billId: invoiceId,
          })),
        });
      }
    }

    const bill = await prisma.bill.findUniqueOrThrow({
      where: { id: invoiceId },
      include: getBillInclude(),
    });

    return serializeBill(bill);
  }

  getCurrentShift({ businessId, outletId = null, openedBy = null, openedByName = null }) {
    const key = getShiftKey({ businessId, outletId });
    const current = shiftStore.get(key);
    if (current?.status === "open") {
      return current;
    }

    const shift = defaultShift({ businessId, outletId, openedBy, openedByName });
    shiftStore.set(key, shift);
    return shift;
  }

  async openShift({ tenantId, outletId = null, openingCash = 0, user } = {}) {
    const business = await ensureBusiness({ tenantId });
    const key = getShiftKey({ businessId: business.id, outletId });
    const current = shiftStore.get(key);

    if (current?.status === "open") {
      return current;
    }

    const shift = {
      ...defaultShift({
        businessId: business.id,
        outletId,
        openedBy: user?.id || null,
        openedByName: user?.name || null,
      }),
      opening_cash: toNumber(openingCash, 0),
      expected_cash: toNumber(openingCash, 0),
    };
    shiftStore.set(key, shift);
    return shift;
  }

  async getShift({ tenantId, outletId = null, user } = {}) {
    const business = await ensureBusiness({ tenantId });
    return this.getCurrentShift({
      businessId: business.id,
      outletId,
      openedBy: user?.id || null,
      openedByName: user?.name || null,
    });
  }

  async closeShift({ tenantId, outletId = null, closingCash = 0, user } = {}) {
    const business = await ensureBusiness({ tenantId });
    const shift = this.getCurrentShift({ businessId: business.id, outletId });
    const report = await this.getCashDrawerReport({ tenantId, outletId, shiftId: shift.id });
    const closedShift = {
      ...shift,
      closed_at: nowIso(),
      closed_by: user?.id || null,
      closed_by_name: user?.name || null,
      closing_cash: toNumber(closingCash, 0),
      expected_cash: report.expected_cash,
      variance: toNumber(closingCash, 0) - report.expected_cash,
      status: "closed",
      report,
    };
    shiftStore.set(getShiftKey({ businessId: business.id, outletId }), closedShift);
    return closedShift;
  }

  async addPayment({ tenantId, invoiceId, payload, user }) {
    const bill = await this.getInvoiceById({ tenantId, invoiceId });
    const payments = normalizePayments([
      ...(bill.payments || []),
      {
        ...payload,
        status:
          payload.status ||
          (["UPI", "Gateway", "Card"].includes(payload.method || payload.payment_method)
            ? "pending_confirmation"
            : "confirmed"),
        received_by: user?.id || null,
        received_by_name: user?.name || null,
      },
    ]);
    const summary = summarizePayments(payments, bill.total);

    return this.updateInvoice({
      tenantId,
      invoiceId,
      payload: {
        payments,
        ...summary,
        payment_gateway_status: payments.some((payment) => payment.status !== "confirmed")
          ? "pending_confirmation"
          : "confirmed",
        updated_at: nowIso(),
      },
    });
  }

  async confirmPayment({ tenantId, invoiceId, paymentId, payload, user }) {
    const bill = await this.getInvoiceById({ tenantId, invoiceId });
    const payments = (bill.payments || []).map((payment) =>
      payment.id === paymentId
        ? {
            ...payment,
            status: "confirmed",
            reference: payload.reference || payload.transaction_id || payment.reference || null,
            gateway: payload.gateway || payment.gateway || null,
            confirmed_at: nowIso(),
            confirmed_by: user?.id || null,
            confirmed_by_name: user?.name || null,
          }
        : payment,
    );
    const summary = summarizePayments(payments, bill.total);

    return this.updateInvoice({
      tenantId,
      invoiceId,
      payload: {
        payments,
        ...summary,
        payment_gateway_status: payments.some((payment) => payment.status !== "confirmed")
          ? "pending_confirmation"
          : "confirmed",
        updated_at: nowIso(),
      },
    });
  }

  async refundInvoice({ tenantId, invoiceId, payload, user }) {
    const bill = await this.getInvoiceById({ tenantId, invoiceId });
    const amount = Math.min(Math.max(0, toNumber(payload.amount, 0)), toNumber(bill.paid_amount, 0));
    const refunds = [
      ...(bill.refunds || []),
      {
        id: `ref_${Date.now()}`,
        amount,
        method: payload.method || "Original Payment",
        reason: payload.reason || "",
        status: payload.status || "approved",
        created_by: user?.id || null,
        created_by_name: user?.name || null,
        created_at: nowIso(),
      },
    ];
    const refundedAmount = refunds.reduce((sum, refund) => sum + toNumber(refund.amount, 0), 0);

    return this.updateInvoice({
      tenantId,
      invoiceId,
      payload: {
        refunds,
        refunded_amount: refundedAmount,
        status: refundedAmount >= toNumber(bill.total, 0) ? "refunded" : "partially_refunded",
        updated_at: nowIso(),
      },
    });
  }

  async requestVoid({ tenantId, invoiceId, reason, user }) {
    return this.updateInvoice({
      tenantId,
      invoiceId,
      payload: {
        void_status: "pending_approval",
        void_reason: reason || "",
        void_requested_by: user?.id || null,
        void_requested_by_name: user?.name || null,
        void_requested_at: nowIso(),
        updated_at: nowIso(),
      },
    });
  }

  async approveVoid({ tenantId, invoiceId, approved = true, user }) {
    return this.updateInvoice({
      tenantId,
      invoiceId,
      payload: {
        status: approved ? "void" : "issued",
        void_status: approved ? "approved" : "rejected",
        void_approved_by: user?.id || null,
        void_approved_by_name: user?.name || null,
        void_approved_at: nowIso(),
        updated_at: nowIso(),
      },
    });
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
    const bills = await this.listInvoices({ tenantId });
    const filteredBills = bills.filter((bill) => {
      if (outletId && bill.outlet_id !== outletId) return false;
      if (shiftId && bill.shift_id !== shiftId) return false;
      return !["void"].includes(bill.status);
    });
    const cashTotal = filteredBills
      .flatMap((bill) => bill.payments || [])
      .filter((payment) => payment.status === "confirmed" && String(payment.method).toLowerCase() === "cash")
      .reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0);
    const nonCashTotal = filteredBills
      .flatMap((bill) => bill.payments || [])
      .filter((payment) => payment.status === "confirmed" && String(payment.method).toLowerCase() !== "cash")
      .reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0);
    const refunds = filteredBills.reduce((sum, bill) => sum + toNumber(bill.refunded_amount, 0), 0);
    const shift = this.getCurrentShift({ businessId: business.id, outletId });

    return {
      business_id: business.id,
      outlet_id: outletId,
      shift_id: shiftId || shift.id,
      opening_cash: shift.opening_cash || 0,
      cash_sales: cashTotal,
      non_cash_sales: nonCashTotal,
      refunds,
      expected_cash: toNumber(shift.opening_cash, 0) + cashTotal - refunds,
      bill_count: filteredBills.length,
      generated_at: nowIso(),
    };
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

    await prisma.bill.delete({
      where: { id: invoiceId },
    });

    return serializeBill(bill);
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
