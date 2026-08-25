import { apiResponse } from "../../shared/utils/apiResponse.js";
import { billingService } from "./billing.service.js";

class BillingController {
  async list(req, res) {
    const data = await billingService.listInvoices({
      tenantId: req.context.tenantId,
      limit: req.query?.limit,
      page: req.query?.page,
      offset: req.query?.offset,
    });
    res.status(200).json(apiResponse({ message: "Invoices fetched successfully", data }));
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
      outletId: req.query?.outlet_id || null,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Current shift fetched successfully", data }));
  }

  async openShift(req, res) {
    const data = await billingService.openShift({
      tenantId: req.context.tenantId,
      outletId: req.body?.outlet_id || null,
      openingCash: req.body?.opening_cash,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Shift opened successfully", data }));
  }

  async closeShift(req, res) {
    const data = await billingService.closeShift({
      tenantId: req.context.tenantId,
      outletId: req.body?.outlet_id || null,
      closingCash: req.body?.closing_cash,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Shift closed successfully", data }));
  }

  async cashDrawer(req, res) {
    const data = await billingService.getCashDrawerReport({
      tenantId: req.context.tenantId,
      outletId: req.query?.outlet_id || null,
      shiftId: req.query?.shift_id || null,
    });
    res.status(200).json(apiResponse({ message: "Cash drawer report fetched successfully", data }));
  }

  async create(req, res) {
    const data = await billingService.createInvoice({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Invoice created successfully", data }));
  }

  async update(req, res) {
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
