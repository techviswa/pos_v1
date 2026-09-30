import { Router } from "express";

import { apiResponse } from "../../shared/utils/apiResponse.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { hasEffectivePermission, requireAnyPermission, requireAuth, requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { usersService } from "../users/users.service.js";
import { attendanceService } from "./attendance.service.js";
import { tipsService } from "./tips.service.js";
import { payrollService } from "./payroll.service.js";

const ctx = (req) => ({ businessId: req.context.businessId, outletScope: req.context.outletScope || null });
const send = (res, message, data, statusCode = 200) => res.status(statusCode).json(apiResponse({ message, data }));

/** Outlet-restricted staff look at one of their outlets; everyone else may look business-wide or at any outlet. */
const outletFor = (req) => {
  const scope = req.context.outletScope;
  const requested = req.query.outlet_id ? String(req.query.outlet_id) : null;
  if (!scope) return requested;
  if (requested) return requested; // already checked against the scope by the auth guard
  if (scope.length === 1) return scope[0];
  throw createHttpError({ statusCode: 400, code: "OUTLET_REQUIRED", message: "Choose one of your outlets" });
};

// ---- attendance: /api/attendance
export const attendanceRouter = Router();
const manageAttendance = requirePermission("attendance");

attendanceRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Your hours", await attendanceService.me({ ...ctx(req), user: req.user, from: req.query.from, to: req.query.to }));
}));
for (const [path, action] of [["/clock-in", "clock_in"], ["/clock-out", "clock_out"], ["/break/start", "break_start"], ["/break/end", "break_end"]]) {
  attendanceRouter.post(path, requireAuth, asyncHandler(async (req, res) => {
    const entry = await attendanceService.act({ ...ctx(req), userId: req.user.id, action, outletId: req.body?.outlet_id || null, note: req.body?.note });
    send(res, "Time clock updated", entry, action === "clock_in" ? 201 : 200);
  }));
}
attendanceRouter.get("/team", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Team", await attendanceService.team(ctx(req)));
}));
attendanceRouter.post("/kiosk", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Time clock updated", await attendanceService.kiosk({ ...ctx(req), payload: req.body || {} }));
}));
attendanceRouter.put("/me/pin", requireAuth, asyncHandler(async (req, res) => {
  send(res, "PIN saved", await attendanceService.setOwnPin({ ...ctx(req), user: req.user, password: req.body?.current_password, pin: req.body?.pin }));
}));
attendanceRouter.put("/staff/:userId/pin", requireAnyPermission("attendance", "staff"), asyncHandler(async (req, res) => {
  send(res, "PIN saved", await attendanceService.setStaffPin({ ...ctx(req), actor: req.user, userId: req.params.userId, pin: req.body?.pin ?? null,
    assertActorMayModify: (actor, target) => usersService.assertActorMayModify(actor, target) }));
}));
attendanceRouter.get("/entries", manageAttendance, asyncHandler(async (req, res) => {
  send(res, "Shifts", await attendanceService.listEntries({ ...ctx(req), query: req.query }));
}));
attendanceRouter.get("/summary", manageAttendance, asyncHandler(async (req, res) => {
  send(res, "Hours", await attendanceService.summary({ ...ctx(req), query: req.query }));
}));
attendanceRouter.post("/entries", manageAttendance, asyncHandler(async (req, res) => {
  send(res, "Shift added", await attendanceService.addEntry({ ...ctx(req), actor: req.user, payload: req.body || {} }), 201);
}));
attendanceRouter.put("/entries/:entryId", manageAttendance, asyncHandler(async (req, res) => {
  send(res, "Shift updated", await attendanceService.updateEntry({ ...ctx(req), actor: req.user, entryId: req.params.entryId, payload: req.body || {} }));
}));
attendanceRouter.post("/entries/:entryId/close", manageAttendance, asyncHandler(async (req, res) => {
  send(res, "Shift closed", await attendanceService.closeEntry({ ...ctx(req), actor: req.user, entryId: req.params.entryId, payload: req.body || {} }));
}));
attendanceRouter.delete("/entries/:entryId", manageAttendance, asyncHandler(async (req, res) => {
  send(res, "Shift removed", await attendanceService.deleteEntry({ ...ctx(req), actor: req.user, entryId: req.params.entryId, payload: req.body || {} }));
}));

// ---- tips: /api/tips
export const tipsRouter = Router();
const manageTips = requirePermission("tips");
const businessWideOnly = (req, _res, next) => next(req.context.outletScope
  ? createHttpError({ statusCode: 403, code: "TIPS_BUSINESS_WIDE", message: "Payouts cover every outlet; ask an Owner or Manager" })
  : undefined);

tipsRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Your tips", await tipsService.me({ ...ctx(req), user: req.user, from: req.query.from, to: req.query.to }));
}));
tipsRouter.post("/declare", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Tip recorded", await tipsService.declare({ ...ctx(req), actor: req.user, canManage: hasEffectivePermission(req.user, "tips"), payload: req.body || {} }), 201);
}));
tipsRouter.get("/settings", manageTips, asyncHandler(async (req, res) => {
  send(res, "Tip settings", await tipsService.getSettings(ctx(req)));
}));
tipsRouter.put("/settings", manageTips, businessWideOnly, asyncHandler(async (req, res) => {
  send(res, "Tip settings saved", await tipsService.updateSettings({ ...ctx(req), payload: req.body || {} }));
}));
tipsRouter.get("/summary", manageTips, asyncHandler(async (req, res) => {
  send(res, "Tips", await tipsService.summary({ ...ctx(req), from: req.query.from, to: req.query.to, outletId: outletFor(req) }));
}));
tipsRouter.put("/:tipId/recipient", manageTips, asyncHandler(async (req, res) => {
  send(res, "Tip reassigned", await tipsService.reassign({ ...ctx(req), tipId: req.params.tipId, payload: req.body || {} }));
}));
tipsRouter.post("/:tipId/void", manageTips, asyncHandler(async (req, res) => {
  send(res, "Tip voided", await tipsService.voidTip({ ...ctx(req), actor: req.user, tipId: req.params.tipId, payload: req.body || {} }));
}));
tipsRouter.post("/payouts", manageTips, businessWideOnly, asyncHandler(async (req, res) => {
  send(res, "Tips paid out", await tipsService.payout({ ...ctx(req), actor: req.user, payload: req.body || {} }), 201);
}));
tipsRouter.post("/payouts/:payoutId/void", manageTips, businessWideOnly, asyncHandler(async (req, res) => {
  send(res, "Payout voided", await tipsService.voidPayout({ ...ctx(req), actor: req.user, payoutId: req.params.payoutId, payload: req.body || {} }));
}));

// ---- payroll: /api/payroll
export const payrollRouter = Router();
const managePayroll = requirePermission("payroll");

payrollRouter.get("/my-payslips", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Your payslips", await payrollService.myPayslips({ ...ctx(req), user: req.user }));
}));
payrollRouter.get("/payslips/:payslipId", requireAuth, asyncHandler(async (req, res) => {
  send(res, "Payslip", await payrollService.getPayslip({ ...ctx(req), payslipId: req.params.payslipId, user: req.user, canManage: hasEffectivePermission(req.user, "payroll") }));
}));
payrollRouter.get("/settings", managePayroll, asyncHandler(async (req, res) => send(res, "Payroll settings", await payrollService.getSettings(ctx(req)))));
payrollRouter.put("/settings", managePayroll, asyncHandler(async (req, res) => send(res, "Payroll settings saved", await payrollService.saveSettings({ ...ctx(req), payload: req.body || {} }))));
payrollRouter.get("/profiles", managePayroll, asyncHandler(async (req, res) => send(res, "Pay profiles", await payrollService.listProfiles(ctx(req)))));
payrollRouter.put("/profiles/:userId", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Pay saved", await payrollService.saveProfile({ ...ctx(req), actor: req.user, userId: req.params.userId, payload: req.body || {} }));
}));
payrollRouter.get("/runs", managePayroll, asyncHandler(async (req, res) => send(res, "Payroll runs", await payrollService.listRuns(ctx(req)))));
payrollRouter.post("/runs", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Payroll created", await payrollService.createRun({ ...ctx(req), actor: req.user, payload: req.body || {} }), 201);
}));
payrollRouter.get("/runs/:runId", managePayroll, asyncHandler(async (req, res) => send(res, "Payroll", await payrollService.getRun({ ...ctx(req), runId: req.params.runId }))));
payrollRouter.post("/runs/:runId/refresh", managePayroll, asyncHandler(async (req, res) => send(res, "Payroll recalculated", await payrollService.refreshRun({ ...ctx(req), runId: req.params.runId }))));
payrollRouter.post("/runs/:runId/payslips", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Payslip added", await payrollService.addPayslip({ ...ctx(req), runId: req.params.runId, userId: req.body?.user_id }));
}));
payrollRouter.post("/runs/:runId/finalize", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Payroll finalised", await payrollService.finalize({ ...ctx(req), actor: req.user, runId: req.params.runId }));
}));
payrollRouter.post("/runs/:runId/pay", managePayroll, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.payslip_ids) ? req.body.payslip_ids.map(String) : null;
  send(res, "Marked as paid", await payrollService.markPaid({ ...ctx(req), runId: req.params.runId, payslipIds: ids, payload: req.body || {} }));
}));
payrollRouter.post("/runs/:runId/void", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Payroll voided", await payrollService.voidRun({ ...ctx(req), actor: req.user, runId: req.params.runId, payload: req.body || {} }));
}));
payrollRouter.put("/payslips/:payslipId", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Payslip updated", await payrollService.updatePayslip({ ...ctx(req), actor: req.user, payslipId: req.params.payslipId, payload: req.body || {} }));
}));
payrollRouter.delete("/payslips/:payslipId", managePayroll, asyncHandler(async (req, res) => {
  send(res, "Payslip removed", await payrollService.removePayslip({ ...ctx(req), payslipId: req.params.payslipId }));
}));
