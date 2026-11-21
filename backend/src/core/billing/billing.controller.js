import { apiResponse } from "../../shared/utils/apiResponse.js";
import { isAdminCoreSyncRequest, createSyncEnvelope } from "../sync/sync-contract.js";
import { billingService } from "./billing.service.js";
import { assertOutletAllowed, filterByOutletScope } from "../../shared/middleware/outletScope.js";
import { getBillOutletId } from "./bill-analytics.utils.js";
import { reverseBillStock } from "./stock-reversal.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";

const shiftOutlet = (req, value) => {
  if (value) { assertOutletAllowed(req, value); return value; }
  const scope = req.context?.outletScope;
  if (!scope) return null;
  if (scope.length === 1) return scope[0];
  throw createHttpError({ statusCode: 400, code: "OUTLET_REQUIRED", message: "Select an outlet for cashier settlement" });
};

class BillingController {
  async reverseStock(req, res) {
    const data = await reverseBillStock({ tenantId: req.context.tenantId, invoiceId: req.params.invoiceId, user: req.user, payload: req.body });
    res.status(200).json(apiResponse({ message: "Unused ingredient stock restored", data }));
  }
  async list(req, res) {
    const outlet = req.query?.outlet_id;
    if (outlet !== undefined && (typeof outlet !== 'string' || !outlet)) throw createHttpError({ statusCode: 400, message: 'Select a valid outlet' });
    if (outlet) assertOutletAllowed(req, outlet);
    const paged = req.query?.paged === 'true';
    const pageSize = 25;
    const page = Number(req.query?.page || 1);
    if (paged && (!Number.isSafeInteger(page) || page < 1 || page > 1000000)) throw createHttpError({ statusCode: 400, message: 'Use a valid history page' });
    const data = filterByOutletScope(req, await billingService.listInvoices({
      tenantId: req.context.tenantId,
      limit: paged ? pageSize + 1 : req.query?.limit,
      page: paged ? undefined : req.query?.page,
      offset: paged ? (page - 1) * pageSize : req.query?.offset,
      outletIds: outlet ? [outlet] : req.context?.outletScope,
      from: req.query?.date, to: req.query?.date,
      createdBy: paged && req.user?.role === 'Waiter' ? req.user.id : null,
      query: paged ? req.query : {},
    }), (bill) => getBillOutletId(bill));
    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "bills",
          data,
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
        }),
      );
    }
    res.status(200).json(apiResponse({ message: "Invoices fetched successfully", data: paged ? { items: data.slice(0, pageSize), has_more: data.length > pageSize, page } : data }));
  }

  async getById(req, res) {
    const data = await billingService.getInvoiceById({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
    });
    res.status(200).json(apiResponse({ message: "Invoice fetched successfully", data }));
  }

  async summary(req, res) {
    const data = await billingService.getBillingSummary({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Billing summary fetched successfully", data }));
  }

  async nextInvoice(req, res) {
    const data = await billingService.getNextInvoicePreview({
      tenantId: req.context.tenantId,
      outletCode: req.query?.outlet_code || req.query?.outletCode,
    });
    res.status(200).json(apiResponse({ message: "Next invoice number fetched successfully", data }));
  }

  async currentShift(req, res) {
    const data = await billingService.getShift({
      tenantId: req.context.tenantId,
      outletId: shiftOutlet(req, req.query?.outlet_id),
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Current shift fetched successfully", data }));
  }

  async openShift(req, res) {
    const data = await billingService.openShift({
      tenantId: req.context.tenantId,
      outletId: shiftOutlet(req, req.body?.outlet_id),
      openingCash: req.body?.opening_cash,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Shift opened successfully", data }));
  }

  async closeShift(req, res) {
    const data = await billingService.closeShift({
      tenantId: req.context.tenantId,
      outletId: shiftOutlet(req, req.body?.outlet_id),
      closingCash: req.body?.closing_cash,
      shiftId: req.body?.shift_id,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Shift closed successfully", data }));
  }

  async cashDrawer(req, res) {
    const data = await billingService.getCashDrawerReport({
      tenantId: req.context.tenantId,
      outletId: shiftOutlet(req, req.query?.outlet_id),
      shiftId: req.query?.shift_id || null,
    });
    res.status(200).json(apiResponse({ message: "Cash drawer report fetched successfully", data }));
  }

  async shiftHistory(req, res) {
    if (req.query?.outlet_id) assertOutletAllowed(req, req.query.outlet_id);
    const data = await billingService.getShiftHistory({ tenantId: req.context.tenantId, outletId: req.query?.outlet_id || null, outletIds: req.context.outletScope, query: req.query });
    res.status(200).json(apiResponse({ message: "Settlement history fetched", data }));
  }

  async create(req, res) {
    const data = await billingService.createInvoice({
      tenantId: req.context.tenantId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Invoice created successfully", data }));
  }

  async update(req, res) {
    const protectedFields = ["payments", "refunds", "refunded_amount", "paid_amount", "status", "void_status", "invoice_number", "invoice_sequence", "items", "total", "subtotal", "tax", "discount_amount", "discount_type", "discount_value", "gst_rate"];
    if (protectedFields.some((key) => Object.hasOwn(req.body || {}, key))) {
      throw createHttpError({ statusCode: 409, message: "Issued invoice financial fields are immutable. Use payment, refund, or void actions." });
    }
    const data = await billingService.updateInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Invoice updated successfully", data }));
  }

  async addPayment(req, res) {
    const data = await billingService.addPayment({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      payload: req.body,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Payment added successfully", data }));
  }

  async confirmPayment(req, res) {
    const data = await billingService.confirmPayment({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      paymentId: req.params.paymentId,
      payload: req.body,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Payment confirmed successfully", data }));
  }

  async refund(req, res) {
    const data = await billingService.refundInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      payload: req.body,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Refund recorded successfully", data }));
  }

  async requestVoid(req, res) {
    const data = await billingService.requestVoid({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      reason: req.body?.reason,
      user: req.user,
    });
    res.status(202).json(apiResponse({ message: "Void request submitted successfully", data }));
  }

  async approveVoid(req, res) {
    const data = await billingService.approveVoid({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      approved: req.body?.approved !== false,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Void approval updated successfully", data }));
  }

  async gstInvoice(req, res) {
    const data = await billingService.getGstInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      settings: {
        gstin: req.query?.gstin,
      },
    });
    res.status(200).json(apiResponse({ message: "GST invoice fetched successfully", data }));
  }

  async receiptPrint(req, res) {
    const data = await billingService.getReceiptPrintPayload({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      settings: {
        printer_type: req.query?.printer_type,
        copies: req.query?.copies,
        auto_print: String(req.query?.auto_print || "").toLowerCase() === "true",
        cash_drawer_kick: String(req.query?.cash_drawer_kick || "").toLowerCase() === "true",
        gstin: req.query?.gstin,
      },
    });
    res.status(200).json(apiResponse({ message: "Receipt print payload fetched successfully", data }));
  }

  async delete(req, res) {
    const data = await billingService.deleteInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
    });
    res.status(200).json(apiResponse({ message: "Invoice deleted successfully", data }));
  }
}

export const billingController = new BillingController();
