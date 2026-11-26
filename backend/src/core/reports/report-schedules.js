import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import prisma from "../../database/prisma/client.js";
import { runTenantScope } from "../../database/prisma/tenant-context.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Scheduled reports: a report (GST, sales, ...) for the last finished period, emailed to the chosen people.
 * Periods are UTC calendar days, like every report screen: daily = yesterday, weekly = the 7 days up to yesterday
 * (sent on Mondays), monthly = last calendar month (sent on the 1st). Nothing is ever claimed as sent unless the mail
 * server accepted it; without email settings the schedule records "not sent" and "Run now" still downloads the file.
 */
export const REPORT_KEYS = { gst: "GST / tax", sales: "Sales by date", profitability: "Product profitability", hourly: "Hourly sales", staff: "Staff performance", outlets: "Outlet comparison", customers: "Customers" };
export const FREQUENCIES = ["daily", "weekly", "monthly"];
export const FORMATS = ["csv", "json"];
const SEND_HOUR_UTC = 2; // 07:30 in India: yesterday's figures are final by then.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const keyFor = (businessId, id) => `report-schedule:${businessId}:${id}`;
// One record per schedule and period, created before sending: whichever server creates it sends, the others skip.
const claimKey = (businessId, id, period) => `report-schedule:${businessId}:run:${id}:${period.to}`;
const isSchedule = (data) => Boolean(data?.report_key && data?.id && !data?.claim);
const fail = (message, statusCode = 400) => { throw createHttpError({ statusCode, code: "REPORT_SCHEDULE_INVALID", message }); };
const day = (date) => date.toISOString().slice(0, 10);
const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const validateSchedule = (payload = {}) => {
  const reportKey = String(payload.report_key || "");
  if (!Object.hasOwn(REPORT_KEYS, reportKey)) fail("Choose a report");
  const format = String(payload.format || "csv");
  if (!FORMATS.includes(format)) fail("Choose CSV or JSON");
  const frequency = String(payload.frequency || "daily");
  if (!FREQUENCIES.includes(frequency)) fail("Choose daily, weekly or monthly");
  const recipients = [...new Set((Array.isArray(payload.recipients) ? payload.recipients : String(payload.recipients || "").split(/[,;\s]+/))
    .map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length || recipients.length > 10) fail("Enter between 1 and 10 email addresses");
  if (recipients.some((value) => value.length > 254 || !EMAIL.test(value))) fail("One of the email addresses is not valid");
  return { report_key: reportKey, format, frequency, recipients };
};

/** The finished period a run at `now` reports on. */
export const reportPeriod = (frequency, now = new Date()) => {
  const today = startOfUtcDay(now);
  const yesterday = new Date(today.getTime() - 86400000);
  if (frequency === "monthly") {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { from: day(first), to: day(last) };
  }
  if (frequency === "weekly") return { from: day(new Date(today.getTime() - 7 * 86400000)), to: day(yesterday) };
  return { from: day(yesterday), to: day(yesterday) };
};

/** True when the schedule has not yet covered the period that has just finished. */
export const isDue = (schedule, now = new Date()) => {
  if (schedule.active === false || now.getUTCHours() < SEND_HOUR_UTC) return false;
  if (schedule.frequency === "weekly" && now.getUTCDay() !== 1) return false;
  if (schedule.frequency === "monthly" && now.getUTCDate() !== 1) return false;
  return (schedule.last_period?.to || "") < reportPeriod(schedule.frequency, now).to;
};

export const mailConfigured = (config = process.env) => Boolean(config.SMTP_HOST && config.SMTP_FROM);
let transport = null;
export const setReportMailTransport = (value) => { transport = value; };
const sendMail = async ({ to, subject, text, attachment }) => {
  transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT || 587) === 465, requireTLS: true,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
  });
  const result = await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text, attachments: [attachment] });
  if (!result.accepted?.length) throw new Error("The mail server did not accept the report email");
};

export const createReportSchedules = ({ reports }) => {
  const read = async (businessId) => (await prisma.stateDocument.findMany({ where: { key: { startsWith: `report-schedule:${businessId}:` } } })).map((row) => row.data).filter(isSchedule);
  const find = async (businessId, id) => {
    const row = await prisma.stateDocument.findUnique({ where: { key: keyFor(businessId, String(id || "")) } });
    if (!row || row.data.business_id !== businessId || !isSchedule(row.data)) fail("Scheduled report not found", 404);
    return row.data;
  };
  const save = (schedule) => prisma.stateDocument.update({ where: { key: keyFor(schedule.business_id, schedule.id) }, data: { data: schedule } });
  const describe = (schedule) => ({ ...schedule, report_name: REPORT_KEYS[schedule.report_key] || schedule.report_key, email_configured: mailConfigured() });

  return {
    async list({ businessId }) {
      return (await read(businessId)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(describe);
    },
    async create({ businessId, payload, user }) {
      const clean = validateSchedule(payload);
      if ((await read(businessId)).length >= 20) fail("A business can keep at most 20 scheduled reports");
      const schedule = { id: `sch_${randomUUID()}`, business_id: businessId, ...clean, active: true,
        created_by: user?.id || null, created_by_name: user?.name || null, created_at: new Date().toISOString(), last_run_at: null, last_status: null, last_period: null };
      await prisma.stateDocument.create({ data: { key: keyFor(businessId, schedule.id), data: schedule } });
      return describe(schedule);
    },
    async update({ businessId, scheduleId, payload }) {
      const schedule = await find(businessId, scheduleId);
      if (typeof payload.active !== "boolean") fail("Choose whether the schedule is active");
      schedule.active = payload.active;
      await save(schedule);
      return describe(schedule);
    },
    async remove({ businessId, scheduleId }) {
      await find(businessId, scheduleId);
      await prisma.stateDocument.delete({ where: { key: keyFor(businessId, scheduleId) } });
      await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `report-schedule:${businessId}:run:${scheduleId}:` } } });
      return { id: scheduleId, deleted: true };
    },
    /** Builds the report for the last finished period; emails it when `deliver` is set and email is configured. */
    async run({ tenantId, businessId, scheduleId, now = new Date(), deliver = false }) {
      const schedule = await find(businessId, scheduleId);
      const period = reportPeriod(schedule.frequency, now);
      let file;
      try {
        file = await reports.exportReport({ tenantId, key: schedule.report_key, format: schedule.format, ...period });
      } catch (error) {
        if (deliver) { Object.assign(schedule, { last_run_at: now.toISOString(), last_status: `failed: ${String(error.message).slice(0, 200)}`, last_period: period }); await save(schedule); }
        throw error;
      }
      let status = "downloaded";
      if (deliver) {
        if (!mailConfigured()) status = "not_sent_email_not_configured";
        else {
          try {
            await sendMail({ to: schedule.recipients.join(", "), subject: `${REPORT_KEYS[schedule.report_key]} report ${period.from === period.to ? period.from : `${period.from} to ${period.to}`}`,
              text: `Attached: ${REPORT_KEYS[schedule.report_key]} report for ${period.from} to ${period.to} (UTC days).`,
              attachment: { filename: file.filename, content: file.content, contentType: file.content_type } });
            status = "emailed";
          } catch (error) {
            status = `failed: ${String(error.message).slice(0, 200)}`;
          }
        }
        Object.assign(schedule, { last_run_at: now.toISOString(), last_status: status, last_period: period });
        await save(schedule);
      }
      return { schedule: describe(schedule), period, status, export: file };
    },
  };
};

/** Background sender: checks every few minutes and sends each due schedule once per period. */
let timer = null;
export const runDueSchedules = async ({ schedules, now = new Date() }) => {
  const rows = await prisma.stateDocument.findMany({ where: { key: { startsWith: "report-schedule:" } } });
  const due = rows.map((row) => row.data).filter((schedule) => isSchedule(schedule) && schedule.business_id && isDue(schedule, now));
  let sent = 0;
  for (const schedule of due) {
    const business = await prisma.business.findUnique({ where: { id: schedule.business_id }, select: { id: true, tenantId: true } });
    if (!business) continue;
    const period = reportPeriod(schedule.frequency, now);
    try {
      await runTenantScope({ businessId: business.id, tenantId: business.tenantId }, async () => {
        try {
          await prisma.stateDocument.create({ data: { key: claimKey(business.id, schedule.id, period), data: { business_id: business.id, schedule_id: schedule.id, period, claim: true, claimed_at: now.toISOString() } } });
        } catch (error) {
          if (error?.code === "P2002") return; // another server already sends this period
          throw error;
        }
        sent += 1;
        await schedules.run({ tenantId: business.tenantId, businessId: business.id, scheduleId: schedule.id, now, deliver: true });
      });
    } catch (error) {
      logger.warn(`Scheduled report ${schedule.id} failed: ${error.message}`);
    }
  }
  return sent;
};
export const startReportScheduler = ({ schedules, intervalMs = 10 * 60000 } = {}) => {
  if (timer || String(process.env.REPORT_SCHEDULER || "").toLowerCase() === "off") return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDueSchedules({ schedules });
    } catch (error) {
      logger.warn(`Report scheduler failed: ${error.message}`);
    } finally { running = false; }
  }, intervalMs);
  timer.unref?.();
};
export const stopReportScheduler = () => { clearInterval(timer); timer = null; };
