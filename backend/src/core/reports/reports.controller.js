import { apiResponse } from "../../shared/utils/apiResponse.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { reportsService, reportSchedules } from "./reports.service.js";

const reportInput = (req) => ({
  tenantId: req.context.tenantId,
  from: req.query?.from,
  to: req.query?.to,
  outletId: req.query?.outlet_id || req.query?.outletId || null,
});

// Schedules cover every outlet, so outlet-restricted staff cannot create, run or change them.
const assertWholeBusiness = (req) => {
  if (req.context?.outletScope) throw createHttpError({ statusCode: 403, code: "OUTLET_RESTRICTED", message: "Scheduled reports cover every outlet; ask an owner or manager" });
};

class ReportsController {
  async overview(req, res) {
    const data = await reportsService.getDashboard(reportInput(req));
    res.status(200).json(apiResponse({ message: "Reports overview fetched successfully", data }));
  }

  async gst(req, res) {
    const data = await reportsService.gstTaxReport(reportInput(req));
    res.status(200).json(apiResponse({ message: "GST report fetched successfully", data }));
  }

  async sales(req, res) {
    const data = await reportsService.salesByDate(reportInput(req));
    res.status(200).json(apiResponse({ message: "Sales by date report fetched successfully", data }));
  }

  async profitability(req, res) {
    const data = await reportsService.productProfitability(reportInput(req));
    res.status(200).json(apiResponse({ message: "Product profitability report fetched successfully", data }));
  }

  async hourly(req, res) {
    const data = await reportsService.hourlySales(reportInput(req));
    res.status(200).json(apiResponse({ message: "Hourly sales report fetched successfully", data }));
  }

  async staff(req, res) {
    const data = await reportsService.staffPerformance(reportInput(req));
    res.status(200).json(apiResponse({ message: "Staff performance report fetched successfully", data }));
  }

  async outlets(req, res) {
    const data = await reportsService.outletComparison(reportInput(req));
    res.status(200).json(apiResponse({ message: "Outlet comparison report fetched successfully", data }));
  }

  async customers(req, res) {
    const data = await reportsService.customerAnalytics(reportInput(req));
    res.status(200).json(apiResponse({ message: "Customer analytics report fetched successfully", data }));
  }

  async export(req, res) {
    const data = await reportsService.exportReport({
      ...reportInput(req),
      key: req.params.reportKey,
      format: req.query?.format || "csv",
    });
    res.setHeader("Content-Type", data.content_type);
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
    res.status(200).send(data.content);
  }

  async listSchedules(req, res) {
    const data = await reportSchedules.list({ businessId: req.context.businessId });
    res.status(200).json(apiResponse({ message: "Scheduled reports fetched successfully", data }));
  }

  async createSchedule(req, res) {
    assertWholeBusiness(req);
    const data = await reportSchedules.create({
      businessId: req.context.businessId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Scheduled report created successfully", data }));
  }

  async runSchedule(req, res) {
    assertWholeBusiness(req);
    const data = await reportSchedules.run({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      scheduleId: req.params.scheduleId,
      deliver: req.body?.send === true,
    });
    res.status(200).json(apiResponse({ message: "Scheduled report run successfully", data }));
  }

  async updateSchedule(req, res) {
    assertWholeBusiness(req);
    const data = await reportSchedules.update({ businessId: req.context.businessId, scheduleId: req.params.scheduleId, payload: req.body || {} });
    res.status(200).json(apiResponse({ message: "Scheduled report updated", data }));
  }

  async deleteSchedule(req, res) {
    assertWholeBusiness(req);
    const data = await reportSchedules.remove({ businessId: req.context.businessId, scheduleId: req.params.scheduleId });
    res.status(200).json(apiResponse({ message: "Scheduled report deleted", data }));
  }
}

export const reportsController = new ReportsController();
