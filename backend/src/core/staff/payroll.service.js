import prisma from "../../database/prisma/client.js";
import { readState, writeState } from "../../database/prisma/state-store.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { workedMs } from "./attendance.service.js";

/**
 * Payroll and payslips.
 *
 * A monthly run starts as a draft: each payslip is calculated from the pay profile and the month's attendance and can
 * be adjusted (loss-of-pay days, bonuses, TDS, advances). Finalising freezes every figure; after that only payment
 * details are recorded. PF, ESI and professional tax are calculated when switched on for a person; filing returns
 * (ECR, ESI, PT, TDS) is outside this system.
 */
const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const normalizeRole = (role) => String(role || "").trim().toLowerCase().replace(/^system[\s_-]+owner$/, "owner");
const isOwner = (user) => normalizeRole(user?.role) === "owner";

export const DEFAULT_PAYROLL_SETTINGS = {
  pf_employee_percent: 12,
  pf_employer_percent: 12,
  pf_wage_ceiling: 15000,
  pf_limit_to_ceiling: true,
  esi_employee_percent: 0.75,
  esi_employer_percent: 3.25,
  esi_gross_limit: 21000,
  overtime_threshold_hours: 9,
  overtime_multiplier: 2,
  round_net_pay: true,
  // Days are counted in this timezone (India by default).
  utc_offset_minutes: 330,
};
const settingsKey = (businessId) => `payroll-settings:${businessId}`;

const numberIn = (value, min, max, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(400, "PAYROLL_INVALID", `${field} must be between ${min} and ${max}`);
  return number;
};

const lines = (value, field) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) fail(400, "PAYROLL_INVALID", `${field} must be a list of at most 20`);
  return value.map((row) => {
    const name = String(row?.name || "").trim().slice(0, 40);
    if (!name) fail(400, "PAYROLL_INVALID", `Every line in ${field} needs a name`);
    return { name, amount: money(numberIn(row.amount, 0, 10000000, `${field}: ${name}`)) };
  });
};

// ---- amounts in words (Indian numbering: thousand, lakh, crore)
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const underHundred = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const underThousand = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", underHundred(n % 100)].filter(Boolean).join(" ");
const integerWords = (n) => {
  const parts = [];
  let rest = n;
  if (rest >= 10000000) { parts.push(`${integerWords(Math.floor(rest / 10000000))} Crore`); rest %= 10000000; }
  if (rest >= 100000) { parts.push(`${underHundred(Math.floor(rest / 100000))} Lakh`); rest %= 100000; }
  if (rest >= 1000) { parts.push(`${underHundred(Math.floor(rest / 1000))} Thousand`); rest %= 1000; }
  if (rest) parts.push(underThousand(rest));
  return parts.join(" ");
};
export const amountInWords = (amount) => {
  const value = Math.round(Math.abs(Number(amount || 0)) * 100);
  const rupees = Math.floor(value / 100);
  const paise = value % 100;
  return `${integerWords(rupees) || "Zero"} Rupees${paise ? ` and ${underHundred(paise)} Paise` : ""} Only`;
};

// ---- periods
const monthRange = (month, offsetMinutes) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) fail(400, "PAYROLL_MONTH_INVALID", "Choose a month as YYYY-MM");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const from = new Date(Date.UTC(year, monthIndex, 1) - offsetMinutes * 60000);
  const to = new Date(Date.UTC(year, monthIndex + 1, 1) - offsetMinutes * 60000);
  if (from > new Date()) fail(400, "PAYROLL_MONTH_INVALID", "This month has not started yet");
  const label = new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from, to, label, days: new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate() };
};
const localDay = (date, offsetMinutes) => new Date(date.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);

const profileSnapshot = (profile, user) => ({
  pay_type: profile.payType,
  monthly_salary: Number(profile.monthlySalary),
  daily_rate: Number(profile.dailyRate),
  hourly_rate: Number(profile.hourlyRate),
  basic_percent: Number(profile.basicPercent),
  allowances: profile.allowances || [],
  deductions: profile.deductions || [],
  pf_enabled: profile.pfEnabled,
  esi_enabled: profile.esiEnabled,
  professional_tax: Number(profile.professionalTax),
  overtime_eligible: profile.overtimeEligible,
  pan: profile.pan,
  uan: profile.uan,
  esi_number: profile.esiNumber,
  bank_name: profile.bankName,
  bank_account_last4: profile.bankAccountLast4,
  ifsc: profile.ifsc,
  employee_code: user?.bio?.employee_code || null,
  joining_date: user?.bio?.joining_date || null,
  email: user?.email || null,
});

/** Works out one payslip. Pure: everything it needs is passed in. */
export const calculatePayslip = ({ snapshot, entries, settings, period, lopDays = 0, manualLines = [], tipsPaid = 0 }) => {
  const offset = settings.utc_offset_minutes;
  const closed = entries.filter((entry) => entry.clockOutAt);
  const minutesByDay = new Map();
  for (const entry of closed) {
    const day = localDay(entry.clockInAt, offset);
    minutesByDay.set(day, (minutesByDay.get(day) || 0) + workedMs(entry) / 60000);
  }
  const hoursWorked = [...minutesByDay.values()].reduce((sum, minutes) => sum + minutes, 0) / 60;
  const overtimeHours = snapshot.overtime_eligible
    ? [...minutesByDay.values()].reduce((sum, minutes) => sum + Math.max(0, minutes / 60 - settings.overtime_threshold_hours), 0)
    : 0;
  const daysPresent = minutesByDay.size;
  const lop = numberIn(lopDays, 0, period.days, "Loss-of-pay days");
  const earnings = [];
  const deductions = [];
  const employer = [];
  let basic = 0;

  if (snapshot.pay_type === "monthly") {
    const factor = (period.days - lop) / period.days;
    const earned = money(snapshot.monthly_salary * factor);
    basic = money(earned * (snapshot.basic_percent / 100));
    earnings.push({ name: "Basic", amount: basic });
    if (earned - basic > 0) earnings.push({ name: "Special allowance", amount: money(earned - basic) });
    for (const row of snapshot.allowances) earnings.push({ name: row.name, amount: money(row.amount * factor) });
  } else {
    const wages = snapshot.pay_type === "daily"
      ? money(snapshot.daily_rate * daysPresent)
      : money(snapshot.hourly_rate * Math.max(0, hoursWorked - overtimeHours));
    basic = money(wages * (snapshot.basic_percent / 100));
    earnings.push({
      name: snapshot.pay_type === "daily" ? `Wages (${daysPresent} days x ${snapshot.daily_rate})` : `Wages (${(hoursWorked - overtimeHours).toFixed(2)} h x ${snapshot.hourly_rate})`,
      amount: wages,
    });
    if (daysPresent) for (const row of snapshot.allowances) earnings.push({ name: row.name, amount: money(row.amount) });
  }
  if (overtimeHours > 0) {
    const hourly = snapshot.pay_type === "hourly" ? snapshot.hourly_rate
      : snapshot.pay_type === "daily" ? snapshot.daily_rate / settings.overtime_threshold_hours
        : snapshot.monthly_salary / period.days / settings.overtime_threshold_hours;
    earnings.push({ name: `Overtime (${overtimeHours.toFixed(2)} h x ${settings.overtime_multiplier})`, amount: money(overtimeHours * hourly * settings.overtime_multiplier) });
  }
  for (const row of manualLines.filter((line) => line.kind === "earning")) earnings.push({ name: row.name, amount: money(row.amount) });
  const gross = money(earnings.reduce((sum, row) => sum + row.amount, 0));
  const grossExcludingOvertime = money(gross - earnings.filter((row) => row.name.startsWith("Overtime")).reduce((sum, row) => sum + row.amount, 0));

  if (snapshot.pf_enabled && basic > 0) {
    const pfWages = settings.pf_limit_to_ceiling ? Math.min(basic, settings.pf_wage_ceiling) : basic;
    deductions.push({ name: `PF (${settings.pf_employee_percent}%)`, amount: Math.round(pfWages * settings.pf_employee_percent / 100) });
    employer.push({ name: `PF employer (${settings.pf_employer_percent}%)`, amount: Math.round(pfWages * settings.pf_employer_percent / 100) });
  }
  if (snapshot.esi_enabled && gross > 0 && grossExcludingOvertime <= settings.esi_gross_limit) {
    deductions.push({ name: `ESI (${settings.esi_employee_percent}%)`, amount: Math.ceil(gross * settings.esi_employee_percent / 100) });
    employer.push({ name: `ESI employer (${settings.esi_employer_percent}%)`, amount: Math.ceil(gross * settings.esi_employer_percent / 100) });
  }
  if (snapshot.professional_tax > 0 && gross > 0) deductions.push({ name: "Professional tax", amount: money(snapshot.professional_tax) });
  if (gross > 0) for (const row of snapshot.deductions) deductions.push({ name: row.name, amount: money(row.amount) });
  for (const row of manualLines.filter((line) => line.kind === "deduction")) deductions.push({ name: row.name, amount: money(row.amount) });

  const totalDeductions = money(deductions.reduce((sum, row) => sum + row.amount, 0));
  const net = money(gross - totalDeductions);
  return {
    daysInPeriod: period.days,
    daysPresent,
    lopDays: lop,
    hoursWorked: money(hoursWorked),
    overtimeHours: money(overtimeHours),
    openShifts: entries.length - closed.length,
    earnings: earnings.filter((row) => row.amount !== 0),
    deductions,
    employerContributions: employer,
    gross,
    totalDeductions,
    netPay: settings.round_net_pay ? Math.round(net) : net,
    tipsPaid: money(tipsPaid),
  };
};

const serializeProfile = (profile) => profile && ({
  user_id: profile.userId,
  pay_type: profile.payType,
  monthly_salary: Number(profile.monthlySalary),
  daily_rate: Number(profile.dailyRate),
  hourly_rate: Number(profile.hourlyRate),
  basic_percent: Number(profile.basicPercent),
  allowances: profile.allowances || [],
  deductions: profile.deductions || [],
  pf_enabled: profile.pfEnabled,
  esi_enabled: profile.esiEnabled,
  professional_tax: Number(profile.professionalTax),
  overtime_eligible: profile.overtimeEligible,
  pan: profile.pan,
  uan: profile.uan,
  esi_number: profile.esiNumber,
  bank_name: profile.bankName,
  bank_account_last4: profile.bankAccountLast4,
  ifsc: profile.ifsc,
  active: profile.active,
});

const serializePayslip = (slip, run = slip.run) => ({
  id: slip.id,
  run_id: slip.runId,
  period_label: run?.label || null,
  period_from: run?.periodFrom?.toISOString() || null,
  period_to: run?.periodTo?.toISOString() || null,
  run_status: run?.status || null,
  user_id: slip.userId,
  user_name: slip.userName,
  role: slip.role,
  profile: slip.profile,
  days_in_period: slip.daysInPeriod,
  days_present: slip.daysPresent,
  lop_days: Number(slip.lopDays),
  hours_worked: Number(slip.hoursWorked),
  overtime_hours: Number(slip.overtimeHours),
  manual_lines: slip.manualLines || [],
  earnings: slip.earnings || [],
  deductions: slip.deductions || [],
  employer_contributions: slip.employerContributions || [],
  gross: Number(slip.gross),
  total_deductions: Number(slip.totalDeductions),
  net_pay: Number(slip.netPay),
  net_pay_words: amountInWords(slip.netPay),
  tips_paid: Number(slip.tipsPaid),
  paid_at: slip.paidAt ? slip.paidAt.toISOString() : null,
  payment_method: slip.paymentMethod,
  payment_reference: slip.paymentReference,
});

class PayrollService {
  async getSettings({ businessId }) {
    return { ...DEFAULT_PAYROLL_SETTINGS, ...((await readState(settingsKey(businessId), null)) || {}) };
  }

  async saveSettings({ businessId, payload = {} }) {
    const current = await this.getSettings({ businessId });
    const merged = { ...current, ...payload };
    const next = {
      pf_employee_percent: numberIn(merged.pf_employee_percent, 0, 20, "PF employee %"),
      pf_employer_percent: numberIn(merged.pf_employer_percent, 0, 20, "PF employer %"),
      pf_wage_ceiling: numberIn(merged.pf_wage_ceiling, 0, 1000000, "PF wage ceiling"),
      pf_limit_to_ceiling: Boolean(merged.pf_limit_to_ceiling),
      esi_employee_percent: numberIn(merged.esi_employee_percent, 0, 10, "ESI employee %"),
      esi_employer_percent: numberIn(merged.esi_employer_percent, 0, 10, "ESI employer %"),
      esi_gross_limit: numberIn(merged.esi_gross_limit, 0, 1000000, "ESI wage limit"),
      overtime_threshold_hours: numberIn(merged.overtime_threshold_hours, 1, 24, "Overtime after hours per day"),
      overtime_multiplier: numberIn(merged.overtime_multiplier, 1, 5, "Overtime rate multiplier"),
      round_net_pay: Boolean(merged.round_net_pay),
      utc_offset_minutes: numberIn(merged.utc_offset_minutes, -720, 840, "Timezone offset"),
    };
    await writeState(settingsKey(businessId), next);
    return next;
  }

  async listProfiles({ businessId }) {
    const users = await prisma.user.findMany({ where: { businessId }, include: { role: true, payProfile: true }, orderBy: { name: "asc" } });
    return users.map((user) => ({ user_id: user.id, name: user.name, role: user.role?.name || null, active: user.active, profile: serializeProfile(user.payProfile) }));
  }

  async saveProfile({ businessId, actor, userId, payload = {} }) {
    const user = await prisma.user.findFirst({ where: { id: String(userId), businessId }, include: { role: true, payProfile: true } });
    if (!user) fail(404, "STAFF_NOT_FOUND", "Staff member not found");
    if (user.id === actor?.id && !isOwner(actor)) fail(403, "PAYROLL_SELF_EDIT", "Ask the Owner to change your own pay");
    if (normalizeRole(user.role?.name) === "owner" && !isOwner(actor)) fail(403, "PAYROLL_FORBIDDEN", "Only an Owner can set an Owner's pay");
    const payType = payload.pay_type ?? user.payProfile?.payType;
    if (!["monthly", "daily", "hourly"].includes(payType)) fail(400, "PAYROLL_INVALID", "Pay type must be monthly, daily or hourly");
    const text = (value, pattern, field, transform = (v) => v) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      const clean = transform(String(value).trim());
      if (!pattern.test(clean)) fail(400, "PAYROLL_INVALID", `${field} is not valid`);
      return clean;
    };
    const data = {
      payType,
      ...(payload.monthly_salary !== undefined ? { monthlySalary: money(numberIn(payload.monthly_salary, 0, 10000000, "Monthly salary")) } : {}),
      ...(payload.daily_rate !== undefined ? { dailyRate: money(numberIn(payload.daily_rate, 0, 1000000, "Daily rate")) } : {}),
      ...(payload.hourly_rate !== undefined ? { hourlyRate: money(numberIn(payload.hourly_rate, 0, 100000, "Hourly rate")) } : {}),
      ...(payload.basic_percent !== undefined ? { basicPercent: numberIn(payload.basic_percent, 0, 100, "Basic %") } : {}),
      ...(payload.professional_tax !== undefined ? { professionalTax: money(numberIn(payload.professional_tax, 0, 2500, "Professional tax")) } : {}),
      ...(payload.pf_enabled !== undefined ? { pfEnabled: Boolean(payload.pf_enabled) } : {}),
      ...(payload.esi_enabled !== undefined ? { esiEnabled: Boolean(payload.esi_enabled) } : {}),
      ...(payload.overtime_eligible !== undefined ? { overtimeEligible: Boolean(payload.overtime_eligible) } : {}),
      ...(payload.active !== undefined ? { active: Boolean(payload.active) } : {}),
      ...(payload.bank_name !== undefined ? { bankName: payload.bank_name ? String(payload.bank_name).slice(0, 60) : null } : {}),
    };
    const allowances = lines(payload.allowances, "Allowances");
    if (allowances) data.allowances = allowances;
    const deductions = lines(payload.deductions, "Deductions");
    if (deductions) data.deductions = deductions;
    const pan = text(payload.pan, /^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN", (v) => v.toUpperCase());
    if (pan !== undefined) data.pan = pan;
    const uan = text(payload.uan, /^\d{12}$/, "UAN");
    if (uan !== undefined) data.uan = uan;
    const esiNumber = text(payload.esi_number, /^\d{10,17}$/, "ESI number");
    if (esiNumber !== undefined) data.esiNumber = esiNumber;
    const ifsc = text(payload.ifsc, /^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC", (v) => v.toUpperCase());
    if (ifsc !== undefined) data.ifsc = ifsc;
    // Only the last four digits of a bank account are kept.
    const account = text(payload.bank_account, /^\d{4,20}$/, "Bank account number", (v) => v.replace(/\s/g, ""));
    if (account !== undefined) data.bankAccountLast4 = account ? account.slice(-4) : null;
    const profile = await prisma.payProfile.upsert({
      where: { userId: user.id },
      create: { businessId, userId: user.id, ...data },
      update: data,
    });
    return serializeProfile(profile);
  }

  async listRuns({ businessId }) {
    const runs = await prisma.payrollRun.findMany({ where: { businessId }, include: { payslips: true }, orderBy: { periodFrom: "desc" }, take: 36 });
    return runs.map((run) => this.serializeRun(run));
  }

  serializeRun(run) {
    const slips = run.payslips || [];
    return {
      id: run.id,
      label: run.label,
      period_from: run.periodFrom.toISOString(),
      period_to: run.periodTo.toISOString(),
      status: run.status,
      note: run.note,
      created_by_name: run.createdByName,
      finalized_at: run.finalizedAt ? run.finalizedAt.toISOString() : null,
      void_reason: run.voidReason,
      totals: {
        employees: slips.length,
        gross: money(slips.reduce((sum, slip) => sum + Number(slip.gross), 0)),
        deductions: money(slips.reduce((sum, slip) => sum + Number(slip.totalDeductions), 0)),
        net_pay: money(slips.reduce((sum, slip) => sum + Number(slip.netPay), 0)),
        employer_contributions: money(slips.reduce((sum, slip) => sum + (slip.employerContributions || []).reduce((total, row) => total + Number(row.amount || 0), 0), 0)),
        paid: slips.filter((slip) => slip.paidAt).length,
      },
      payslips: slips.map((slip) => serializePayslip(slip, run)).sort((a, b) => a.user_name.localeCompare(b.user_name)),
    };
  }

  async loadRun(tx, { businessId, runId, statuses }) {
    const run = await tx.payrollRun.findFirst({ where: { id: String(runId), businessId }, include: { payslips: true } });
    if (!run) fail(404, "PAYROLL_RUN_NOT_FOUND", "Payroll run not found");
    if (statuses && !statuses.includes(run.status)) fail(409, "PAYROLL_RUN_LOCKED", `This payroll is ${run.status}`);
    return run;
  }

  /** (Re)calculates one draft payslip from the current profile and attendance. */
  async computeFor(tx, { run, user, profile, settings, lopDays = 0, manualLines = [] }) {
    const period = { days: Math.round((run.periodTo - run.periodFrom) / 86400000) };
    const [entries, payouts] = await Promise.all([
      tx.attendanceEntry.findMany({ where: { businessId: run.businessId, userId: user.id, deletedAt: null, clockInAt: { gte: run.periodFrom, lt: run.periodTo } } }),
      tx.tipPayout.findMany({ where: { businessId: run.businessId, userId: user.id, voidedAt: null, createdAt: { gte: run.periodFrom, lt: run.periodTo } } }),
    ]);
    const snapshot = profileSnapshot(profile, user);
    const result = calculatePayslip({ snapshot, entries, settings, period, lopDays, manualLines,
      tipsPaid: payouts.reduce((sum, payout) => sum + Number(payout.amount), 0) });
    return {
      userName: user.name, role: user.role?.name || null, profile: { ...snapshot, open_shifts: result.openShifts },
      daysInPeriod: result.daysInPeriod, daysPresent: result.daysPresent, lopDays: result.lopDays, hoursWorked: result.hoursWorked,
      overtimeHours: result.overtimeHours, manualLines, earnings: result.earnings, deductions: result.deductions,
      employerContributions: result.employerContributions, gross: result.gross, totalDeductions: result.totalDeductions,
      netPay: result.netPay, tipsPaid: result.tipsPaid,
    };
  }

  async createRun({ businessId, actor, payload = {} }) {
    const settings = await this.getSettings({ businessId });
    const period = monthRange(payload.month, settings.utc_offset_minutes);
    const run = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${businessId}`}))`;
      const existing = await tx.payrollRun.findFirst({ where: { businessId, periodFrom: period.from, status: { not: "void" } } });
      if (existing) fail(409, "PAYROLL_RUN_EXISTS", `Payroll for ${period.label} already exists`);
      const created = await tx.payrollRun.create({ data: {
        businessId, periodFrom: period.from, periodTo: period.to, label: period.label, note: payload.note ? String(payload.note).slice(0, 300) : null,
        createdById: actor?.id || null, createdByName: actor?.name || null,
      } });
      const users = await tx.user.findMany({ where: { businessId, active: true, payProfile: { active: true } }, include: { role: true, payProfile: true } });
      for (const user of users) {
        const data = await this.computeFor(tx, { run: created, user, profile: user.payProfile, settings });
        await tx.payslip.create({ data: { businessId, runId: created.id, userId: user.id, ...data } });
      }
      return created;
    });
    return this.getRun({ businessId, runId: run.id });
  }

  async getRun({ businessId, runId }) {
    return this.serializeRun(await this.loadRun(prisma, { businessId, runId }));
  }

  /** Recalculate every draft payslip (after attendance or pay changes), keeping manual lines and LOP days. */
  async refreshRun({ businessId, runId }) {
    const settings = await this.getSettings({ businessId });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${runId}`}))`;
      const run = await this.loadRun(tx, { businessId, runId, statuses: ["draft"] });
      for (const slip of run.payslips) {
        const user = slip.userId ? await tx.user.findUnique({ where: { id: slip.userId }, include: { role: true, payProfile: true } }) : null;
        if (!user?.payProfile) { await tx.payslip.delete({ where: { id: slip.id } }); continue; }
        const data = await this.computeFor(tx, { run, user, profile: user.payProfile, settings, lopDays: Number(slip.lopDays), manualLines: slip.manualLines || [] });
        await tx.payslip.update({ where: { id: slip.id }, data });
      }
    });
    return this.getRun({ businessId, runId });
  }

  async addPayslip({ businessId, runId, userId }) {
    const settings = await this.getSettings({ businessId });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${runId}`}))`;
      const run = await this.loadRun(tx, { businessId, runId, statuses: ["draft"] });
      const user = await tx.user.findFirst({ where: { id: String(userId), businessId }, include: { role: true, payProfile: true } });
      if (!user) fail(404, "STAFF_NOT_FOUND", "Staff member not found");
      if (!user.payProfile) fail(400, "PAY_PROFILE_REQUIRED", `Set ${user.name}'s pay first`);
      if (run.payslips.some((slip) => slip.userId === user.id)) fail(409, "PAYSLIP_EXISTS", `${user.name} is already in this payroll`);
      const data = await this.computeFor(tx, { run, user, profile: user.payProfile, settings });
      await tx.payslip.create({ data: { businessId, runId: run.id, userId: user.id, ...data } });
    });
    return this.getRun({ businessId, runId });
  }

  async loadSlip(tx, { businessId, payslipId }) {
    const slip = await tx.payslip.findFirst({ where: { id: String(payslipId), businessId }, include: { run: true } });
    if (!slip) fail(404, "PAYSLIP_NOT_FOUND", "Payslip not found");
    return slip;
  }

  async updatePayslip({ businessId, actor, payslipId, payload = {} }) {
    const settings = await this.getSettings({ businessId });
    return prisma.$transaction(async (tx) => {
      const found = await this.loadSlip(tx, { businessId, payslipId });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${found.runId}`}))`;
      const slip = await this.loadSlip(tx, { businessId, payslipId });
      if (slip.run.status !== "draft") fail(409, "PAYROLL_RUN_LOCKED", "This payroll is finalised");
      if (slip.userId === actor?.id && !isOwner(actor)) fail(403, "PAYROLL_SELF_EDIT", "Ask the Owner to change your own payslip");
      const manualLines = payload.manual_lines !== undefined
        ? (() => {
          if (!Array.isArray(payload.manual_lines) || payload.manual_lines.length > 20) fail(400, "PAYROLL_INVALID", "At most 20 extra lines");
          return payload.manual_lines.map((row) => {
            if (!["earning", "deduction"].includes(row?.kind)) fail(400, "PAYROLL_INVALID", "Each extra line is an earning or a deduction");
            const [line] = lines([row], "Extra lines");
            if (!line.amount) fail(400, "PAYROLL_INVALID", `${line.name} needs an amount`);
            return { kind: row.kind, ...line };
          });
        })()
        : slip.manualLines || [];
      const lopDays = payload.lop_days !== undefined ? payload.lop_days : Number(slip.lopDays);
      const user = slip.userId ? await tx.user.findUnique({ where: { id: slip.userId }, include: { role: true, payProfile: true } }) : null;
      if (!user?.payProfile) fail(400, "PAY_PROFILE_REQUIRED", "This person no longer has a pay profile");
      const data = await this.computeFor(tx, { run: slip.run, user, profile: user.payProfile, settings, lopDays, manualLines });
      const updated = await tx.payslip.update({ where: { id: slip.id }, data, include: { run: true } });
      return serializePayslip(updated);
    });
  }

  async removePayslip({ businessId, payslipId }) {
    return prisma.$transaction(async (tx) => {
      const slip = await this.loadSlip(tx, { businessId, payslipId });
      if (slip.run.status !== "draft") fail(409, "PAYROLL_RUN_LOCKED", "This payroll is finalised");
      await tx.payslip.delete({ where: { id: slip.id } });
      return { removed: true };
    });
  }

  /** Final recalculation, then every figure is frozen. */
  async finalize({ businessId, actor, runId }) {
    await this.refreshRun({ businessId, runId });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${runId}`}))`;
      const run = await this.loadRun(tx, { businessId, runId, statuses: ["draft"] });
      if (!run.payslips.length) fail(400, "PAYROLL_EMPTY", "There are no payslips in this payroll");
      const negative = run.payslips.find((slip) => Number(slip.netPay) < 0);
      if (negative) fail(400, "PAYROLL_NEGATIVE_NET", `Deductions are more than ${negative.userName}'s pay`);
      const open = run.payslips.find((slip) => slip.profile?.open_shifts);
      if (open) fail(409, "PAYROLL_OPEN_SHIFTS", `${open.userName} has shifts without a clock-out this month. Close them on the Attendance screen first.`);
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: "finalized", finalizedAt: new Date(), finalizedById: actor?.id || null } });
    });
    return this.getRun({ businessId, runId });
  }

  async markPaid({ businessId, payslipIds, runId, payload = {} }) {
    const method = String(payload.method || "Bank transfer").trim().slice(0, 30);
    const reference = payload.reference ? String(payload.reference).trim().slice(0, 80) : null;
    await prisma.$transaction(async (tx) => {
      const run = await this.loadRun(tx, { businessId, runId, statuses: ["finalized"] });
      const targets = run.payslips.filter((slip) => (payslipIds ? payslipIds.includes(slip.id) : true) && !slip.paidAt);
      if (payslipIds && !targets.length) fail(409, "PAYSLIP_ALREADY_PAID", "Already marked as paid");
      for (const slip of targets) {
        await tx.payslip.update({ where: { id: slip.id }, data: { paidAt: new Date(), paymentMethod: method, paymentReference: reference } });
      }
    });
    return this.getRun({ businessId, runId });
  }

  async voidRun({ businessId, actor, runId, payload = {} }) {
    if (!isOwner(actor)) fail(403, "OWNER_REQUIRED", "Only an Owner can void a payroll");
    const reason = String(payload.reason || "").trim();
    if (!reason) fail(400, "REASON_REQUIRED", "Give a reason");
    await prisma.$transaction(async (tx) => {
      const run = await this.loadRun(tx, { businessId, runId, statuses: ["draft", "finalized"] });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 300) } });
    });
    return this.getRun({ businessId, runId });
  }

  /** Staff see their own finalised payslips. */
  async myPayslips({ businessId, user }) {
    const slips = await prisma.payslip.findMany({
      where: { businessId, userId: user.id, run: { status: "finalized" } },
      include: { run: true }, orderBy: { run: { periodFrom: "desc" } },
    });
    return slips.map((slip) => serializePayslip(slip));
  }

  async getPayslip({ businessId, payslipId, user, canManage }) {
    const slip = await this.loadSlip(prisma, { businessId, payslipId });
    const own = slip.userId === user.id && slip.run.status === "finalized";
    if (!canManage && !own) fail(404, "PAYSLIP_NOT_FOUND", "Payslip not found");
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
    return { ...serializePayslip(slip), business_name: business?.name || "" };
  }
}

export const payrollService = new PayrollService();
