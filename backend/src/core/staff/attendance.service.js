import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { publishChange } from "../../services/realtime/realtime.service.js";

/**
 * Staff attendance: clock in/out, breaks, a shared PIN clock, and manager corrections.
 *
 * Every change to someone's hours is recorded on the entry (who, when, why, previous values); entries are never
 * hard-deleted. One person can have only one open entry: clock actions for a person run under a per-person lock.
 */
const FLAG_OPEN_AFTER_MS = 16 * 60 * 60 * 1000;
const MAX_ENTRY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 93 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const normalizeRole = (role) => String(role || "").trim().toLowerCase().replace(/^system[\s_-]+owner$/, "owner");
const isOwner = (user) => normalizeRole(user?.role) === "owner";
const lockPerson = (tx, userId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${userId}`}))`;

const parseTime = (value, field, { required = true } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) fail(400, "ATTENDANCE_TIME_REQUIRED", `${field} is required`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(400, "ATTENDANCE_TIME_INVALID", `${field} is not a valid time`);
  if (date.getTime() > Date.now() + CLOCK_SKEW_MS) fail(400, "ATTENDANCE_TIME_IN_FUTURE", `${field} cannot be in the future`);
  return date;
};

export const parseRange = (from, to, { defaultDays = 7 } = {}) => {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) fail(400, "RANGE_INVALID", "from and to must be valid times");
  if (end <= start) fail(400, "RANGE_INVALID", "to must be after from");
  if (end - start > MAX_RANGE_MS) fail(400, "RANGE_TOO_LONG", "Choose a period of at most 93 days");
  return { from: start, to: end };
};

const breakList = (entry) => (Array.isArray(entry.breaks) ? entry.breaks : []);
const openBreak = (entry) => breakList(entry).find((row) => !row.end_at) || null;
const breakMs = (entry, now = Date.now()) => breakList(entry).reduce((sum, row) => {
  const end = row.end_at ? Date.parse(row.end_at) : Math.min(now, entry.clockOutAt ? entry.clockOutAt.getTime() : now);
  return sum + Math.max(0, end - Date.parse(row.start_at));
}, 0);
export const workedMs = (entry, now = Date.now()) => {
  const end = entry.clockOutAt ? entry.clockOutAt.getTime() : now;
  return Math.max(0, end - entry.clockInAt.getTime() - breakMs(entry, now));
};
const minutes = (ms) => Math.round(ms / 60000);

export const serializeEntry = (entry, now = Date.now()) => ({
  id: entry.id,
  user_id: entry.userId,
  user_name: entry.userName,
  role: entry.userRole,
  outlet_id: entry.outletId,
  clock_in_at: entry.clockInAt.toISOString(),
  clock_out_at: entry.clockOutAt ? entry.clockOutAt.toISOString() : null,
  breaks: breakList(entry),
  worked_minutes: minutes(workedMs(entry, now)),
  break_minutes: minutes(breakMs(entry, now)),
  open: !entry.clockOutAt,
  on_break: !entry.clockOutAt && Boolean(openBreak(entry)),
  missing_clock_out: !entry.clockOutAt && now - entry.clockInAt.getTime() > FLAG_OPEN_AFTER_MS,
  source: entry.source,
  note: entry.note,
  edits: Array.isArray(entry.edits) ? entry.edits : [],
  deleted: Boolean(entry.deletedAt),
  delete_reason: entry.deleteReason || null,
});

/** Breaks must sit inside the entry, not overlap, and only the last one of an open entry may still be running. */
const normalizeBreaks = (breaks, clockInAt, clockOutAt) => {
  if (breaks === undefined) return undefined;
  if (!Array.isArray(breaks) || breaks.length > 20) fail(400, "BREAKS_INVALID", "breaks must be a list of at most 20");
  const rows = breaks.map((row, index) => {
    const start = parseTime(row?.start_at, `Break ${index + 1} start`);
    const end = parseTime(row?.end_at, `Break ${index + 1} end`, { required: Boolean(clockOutAt) });
    if (end && end <= start) fail(400, "BREAKS_INVALID", `Break ${index + 1} must end after it starts`);
    if (start < clockInAt || (clockOutAt && (end || start) > clockOutAt)) fail(400, "BREAKS_INVALID", `Break ${index + 1} must be inside the shift`);
    return { start, end };
  }).sort((a, b) => a.start - b.start);
  rows.forEach((row, index) => {
    const next = rows[index + 1];
    if (!next) return;
    if (!row.end || row.end > next.start) fail(400, "BREAKS_INVALID", "Breaks cannot overlap, and only the last break may still be running");
  });
  return rows.map((row) => ({ start_at: row.start.toISOString(), end_at: row.end ? row.end.toISOString() : null }));
};

const assertNoOverlap = async (tx, { userId, entryId = null, clockInAt, clockOutAt }) => {
  const clash = await tx.attendanceEntry.findFirst({
    where: {
      userId,
      deletedAt: null,
      ...(entryId ? { id: { not: entryId } } : {}),
      ...(clockOutAt ? { clockInAt: { lt: clockOutAt } } : {}),
      OR: [{ clockOutAt: null }, { clockOutAt: { gt: clockInAt } }],
    },
    select: { id: true },
  });
  if (clash) fail(409, "ATTENDANCE_OVERLAP", "This overlaps another shift for the same person");
};

const validateSpan = (clockInAt, clockOutAt) => {
  if (clockOutAt && clockOutAt <= clockInAt) fail(400, "ATTENDANCE_TIME_INVALID", "Clock-out must be after clock-in");
  if (clockOutAt && clockOutAt - clockInAt > MAX_ENTRY_MS) fail(400, "ATTENDANCE_TOO_LONG", "A single shift cannot be longer than 24 hours");
  if (Date.now() - clockInAt.getTime() > 366 * 24 * 60 * 60 * 1000) fail(400, "ATTENDANCE_TIME_INVALID", "Clock-in is more than a year ago");
};

const loadStaff = async (client, businessId, userId) => {
  const user = await client.user.findFirst({
    where: { id: String(userId || ""), businessId },
    include: { role: true, outletAssignments: { select: { outletId: true } } },
  });
  if (!user) fail(404, "STAFF_NOT_FOUND", "Staff member not found");
  return { ...user, roleName: user.role?.name || null, outletIds: user.outletAssignments.map((row) => row.outletId) };
};

/** The outlet a clock-in belongs to: the one asked for (if this person may work there) or their only outlet. */
const resolveOutlet = async (client, businessId, staff, requestedOutletId) => {
  if (requestedOutletId) {
    const outlet = await client.outlet.findFirst({ where: { id: String(requestedOutletId), businessId }, select: { id: true } });
    if (!outlet) fail(404, "OUTLET_NOT_FOUND", "Outlet not found for this business");
    if (staff.outletIds.length && !staff.outletIds.includes(outlet.id) && !["owner", "manager"].includes(normalizeRole(staff.roleName))) {
      fail(403, "OUTLET_ACCESS_DENIED", `${staff.name} is not assigned to this outlet`);
    }
    return outlet.id;
  }
  return staff.outletIds.length === 1 ? staff.outletIds[0] : null;
};

/** Outlet-restricted staff with the attendance screen see entries of their outlets (or of their outlets' people). */
const entryVisible = (entry, outletScope, scopedUserIds) => {
  if (!outletScope) return true;
  if (entry.outletId) return outletScope.includes(entry.outletId);
  return scopedUserIds.has(entry.userId);
};
const scopedUserIdsFor = async (businessId, outletScope) => {
  if (!outletScope) return new Set();
  const rows = await prisma.userOutletAssignment.findMany({ where: { outletId: { in: outletScope }, user: { businessId } }, select: { userId: true } });
  return new Set(rows.map((row) => row.userId));
};

const notify = (tx, entry, action) => publishChange({ businessId: entry.businessId, resource: "attendance", action, recordId: entry.id, outletId: entry.outletId }, { tx });

const PIN_PATTERN = /^\d{4,6}$/;
const assertStrongPin = (pin) => {
  const value = String(pin ?? "");
  if (!PIN_PATTERN.test(value)) fail(400, "PIN_INVALID", "The PIN must be 4 to 6 digits");
  const digits = [...value].map(Number);
  const allSame = digits.every((digit) => digit === digits[0]);
  const stepping = [1, -1].some((step) => digits.every((digit, index) => index === 0 || digit === (digits[index - 1] + step + 10) % 10));
  if (allSame || stepping) fail(400, "PIN_TOO_SIMPLE", "Choose a PIN that is not a repeated or running sequence of digits");
  return value;
};

class AttendanceService {
  /** Clock-in / clock-out / break for one person. `staff` must already be verified to be allowed to act. */
  async act({ businessId, userId, action, outletId = null, note = null, source = "self" }) {
    if (!["clock_in", "clock_out", "break_start", "break_end"].includes(action)) fail(400, "ATTENDANCE_ACTION_INVALID", "Unknown time-clock action");
    return prisma.$transaction(async (tx) => {
      await lockPerson(tx, userId);
      const staff = await loadStaff(tx, businessId, userId);
      if (!staff.active) fail(403, "STAFF_INACTIVE", "This account is deactivated");
      const open = await tx.attendanceEntry.findFirst({ where: { userId, deletedAt: null, clockOutAt: null }, orderBy: { clockInAt: "desc" } });
      const now = new Date();
      let entry;
      if (action === "clock_in") {
        if (open) fail(409, "ALREADY_CLOCKED_IN", `${staff.name} is already clocked in`);
        entry = await tx.attendanceEntry.create({ data: {
          businessId, userId, userName: staff.name, userRole: staff.roleName,
          outletId: await resolveOutlet(tx, businessId, staff, outletId),
          clockInAt: now, source, note: note ? String(note).slice(0, 300) : null,
        } });
      } else {
        if (!open) fail(409, "NOT_CLOCKED_IN", `${staff.name} is not clocked in`);
        const running = openBreak(open);
        let breaks = breakList(open);
        const data = {};
        if (action === "break_start") {
          if (running) fail(409, "ALREADY_ON_BREAK", `${staff.name} is already on a break`);
          breaks = [...breaks, { start_at: now.toISOString(), end_at: null }];
        } else if (action === "break_end") {
          if (!running) fail(409, "NOT_ON_BREAK", `${staff.name} is not on a break`);
          breaks = breaks.map((row) => (row === running ? { ...row, end_at: now.toISOString() } : row));
        } else {
          // Clocking out ends a running break at the same moment.
          breaks = breaks.map((row) => (row.end_at ? row : { ...row, end_at: now.toISOString() }));
          data.clockOutAt = now;
          if (note) data.note = [open.note, String(note).slice(0, 300)].filter(Boolean).join(" | ");
        }
        entry = await tx.attendanceEntry.update({ where: { id: open.id }, data: { ...data, breaks } });
      }
      await notify(tx, entry, action);
      return serializeEntry(entry);
    });
  }

  async me({ businessId, user, from, to }) {
    const range = parseRange(from, to);
    const [entries, open] = await Promise.all([
      prisma.attendanceEntry.findMany({ where: { businessId, userId: user.id, deletedAt: null, clockInAt: { gte: range.from, lt: range.to } }, orderBy: { clockInAt: "desc" } }),
      prisma.attendanceEntry.findFirst({ where: { businessId, userId: user.id, deletedAt: null, clockOutAt: null }, orderBy: { clockInAt: "desc" } }),
    ]);
    const now = Date.now();
    const staff = await prisma.user.findFirst({ where: { id: user.id, businessId }, select: { clockPinHash: true } });
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      open_entry: open ? serializeEntry(open, now) : null,
      entries: entries.map((entry) => serializeEntry(entry, now)),
      worked_minutes: minutes(entries.reduce((sum, entry) => sum + workedMs(entry, now), 0)),
      has_pin: Boolean(staff?.clockPinHash),
    };
  }

  /** Active staff and whether they are on the clock. Used by the shared clock, tip recipients and shift swaps. */
  async team({ businessId, outletScope = null }) {
    const users = await prisma.user.findMany({
      where: { businessId, active: true },
      include: { role: true, outletAssignments: { select: { outletId: true } } },
      orderBy: { name: "asc" },
    });
    const open = await prisma.attendanceEntry.findMany({ where: { businessId, deletedAt: null, clockOutAt: null } });
    const openByUser = new Map(open.map((entry) => [entry.userId, entry]));
    return users
      .filter((user) => {
        if (!outletScope) return true;
        const assigned = user.outletAssignments.map((row) => row.outletId);
        return !assigned.length || assigned.some((id) => outletScope.includes(id));
      })
      .map((user) => {
        const entry = openByUser.get(user.id);
        return {
          id: user.id,
          name: user.name,
          role: user.role?.name || null,
          active: user.active,
          assigned_outlet_ids: user.outletAssignments.map((row) => row.outletId),
          has_pin: Boolean(user.clockPinHash),
          clocked_in: Boolean(entry),
          on_break: Boolean(entry && openBreak(entry)),
          clock_in_at: entry ? entry.clockInAt.toISOString() : null,
          outlet_id: entry?.outletId || null,
        };
      });
  }

  /** Shared time clock: a person picks their name and enters their PIN on any signed-in till. */
  async kiosk({ businessId, outletScope = null, payload = {} }) {
    const userId = String(payload.user_id || "");
    const staff = await loadStaff(prisma, businessId, userId);
    if (outletScope && staff.outletIds.length && !staff.outletIds.some((id) => outletScope.includes(id))) {
      fail(403, "OUTLET_ACCESS_DENIED", `${staff.name} does not work at this till's outlet`);
    }
    await this.verifyPin({ businessId, userId: staff.id, pin: payload.pin });
    const entry = await this.act({ businessId, userId: staff.id, action: payload.action, outletId: payload.outlet_id || null, note: payload.note, source: "pin" });
    return { ...entry, user_name: staff.name };
  }

  async verifyPin({ businessId, userId, pin }) {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`clock-pin:${userId}`}))`;
      const user = await tx.user.findFirst({ where: { id: userId, businessId }, select: { clockPinHash: true, clockPinFailures: true, clockPinLockedUntil: true, active: true } });
      if (!user || !user.active) return { error: [403, "STAFF_INACTIVE", "This account cannot use the time clock"] };
      if (!user.clockPinHash) return { error: [400, "PIN_NOT_SET", "No time-clock PIN is set for this person. Set one on the Time Clock screen or ask a manager."] };
      if (user.clockPinLockedUntil && user.clockPinLockedUntil > new Date()) {
        return { error: [423, "PIN_LOCKED", "Too many wrong PINs. Try again in a few minutes or ask a manager."] };
      }
      if (!PIN_PATTERN.test(String(pin ?? "")) || !verifyPassword(String(pin), user.clockPinHash)) {
        const failures = user.clockPinFailures + 1;
        const locked = failures >= PIN_MAX_FAILURES;
        await tx.user.update({ where: { id: userId }, data: locked
          ? { clockPinFailures: 0, clockPinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) }
          : { clockPinFailures: failures } });
        return { error: locked ? [423, "PIN_LOCKED", "Too many wrong PINs. Try again in 15 minutes or ask a manager."] : [401, "PIN_WRONG", "Wrong PIN"] };
      }
      if (user.clockPinFailures || user.clockPinLockedUntil) {
        await tx.user.update({ where: { id: userId }, data: { clockPinFailures: 0, clockPinLockedUntil: null } });
      }
      return { ok: true };
    });
    // The failure counter is committed before the error is raised.
    if (outcome.error) fail(...outcome.error);
  }

  async setOwnPin({ businessId, user, password, pin }) {
    const row = await prisma.user.findFirst({ where: { id: user.id, businessId }, select: { passwordHash: true } });
    if (!row || !verifyPassword(String(password || ""), row.passwordHash)) fail(400, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect");
    const value = assertStrongPin(pin);
    await prisma.user.update({ where: { id: user.id }, data: { clockPinHash: hashPassword(value), clockPinFailures: 0, clockPinLockedUntil: null } });
    return { has_pin: true };
  }

  /** A manager sets or clears someone's PIN (e.g. a new starter, or a locked-out PIN). */
  async setStaffPin({ businessId, actor, userId, pin, assertActorMayModify }) {
    const staff = await loadStaff(prisma, businessId, userId);
    assertActorMayModify(actor, { role: { name: staff.roleName } });
    const clear = pin === null || pin === "";
    await prisma.user.update({ where: { id: staff.id }, data: {
      clockPinHash: clear ? null : hashPassword(assertStrongPin(pin)),
      clockPinFailures: 0,
      clockPinLockedUntil: null,
    } });
    return { user_id: staff.id, has_pin: !clear };
  }

  // ---- manager views (attendance permission)

  async listEntries({ businessId, outletScope = null, query = {} }) {
    const range = parseRange(query.from, query.to);
    const where = {
      businessId,
      clockInAt: { gte: range.from, lt: range.to },
      ...(query.include_deleted === "true" ? {} : { deletedAt: null }),
      ...(query.user_id ? { userId: String(query.user_id) } : {}),
      ...(query.outlet_id ? { outletId: String(query.outlet_id) } : {}),
    };
    const [entries, scopedUserIds] = await Promise.all([
      prisma.attendanceEntry.findMany({ where, orderBy: { clockInAt: "desc" }, take: 2000 }),
      scopedUserIdsFor(businessId, outletScope),
    ]);
    const now = Date.now();
    return entries.filter((entry) => entryVisible(entry, outletScope, scopedUserIds)).map((entry) => serializeEntry(entry, now));
  }

  async summary({ businessId, outletScope = null, query = {} }) {
    const entries = await this.listEntries({ businessId, outletScope, query: { ...query, include_deleted: "false" } });
    const byUser = new Map();
    for (const entry of entries) {
      const key = entry.user_id || `name:${entry.user_name}`;
      const row = byUser.get(key) || { user_id: entry.user_id, name: entry.user_name, role: entry.role, entries: 0, worked_minutes: 0,
        break_minutes: 0, open_entries: 0, missing_clock_out: 0, edited_entries: 0, days: new Set() };
      row.entries += 1;
      row.worked_minutes += entry.worked_minutes;
      row.break_minutes += entry.break_minutes;
      row.open_entries += entry.open ? 1 : 0;
      row.missing_clock_out += entry.missing_clock_out ? 1 : 0;
      row.edited_entries += entry.edits.length ? 1 : 0;
      row.days.add(entry.clock_in_at.slice(0, 10));
      byUser.set(key, row);
    }
    const staff = [...byUser.values()].map(({ days, ...row }) => ({ ...row, days_worked: days.size }))
      .sort((a, b) => b.worked_minutes - a.worked_minutes);
    return {
      staff,
      totals: {
        worked_minutes: staff.reduce((sum, row) => sum + row.worked_minutes, 0),
        entries: entries.length,
        open_entries: staff.reduce((sum, row) => sum + row.open_entries, 0),
        missing_clock_out: staff.reduce((sum, row) => sum + row.missing_clock_out, 0),
      },
    };
  }

  async loadEntryForEdit(tx, { businessId, entryId, actor, outletScope }) {
    const found = await tx.attendanceEntry.findFirst({ where: { id: String(entryId), businessId, deletedAt: null }, select: { userId: true } });
    if (!found) fail(404, "ATTENDANCE_NOT_FOUND", "Shift not found");
    // Lock the person first, then read the entry as it is now (a clock-out may have just happened).
    await lockPerson(tx, found.userId || String(entryId));
    const entry = await tx.attendanceEntry.findFirst({ where: { id: String(entryId), businessId, deletedAt: null } });
    if (!entry) fail(404, "ATTENDANCE_NOT_FOUND", "Shift not found");
    const scopedUserIds = await scopedUserIdsFor(businessId, outletScope);
    if (!entryVisible(entry, outletScope, scopedUserIds)) fail(403, "OUTLET_ACCESS_DENIED", "You do not have access to this outlet");
    if (entry.userId === actor?.id && !isOwner(actor)) fail(403, "ATTENDANCE_SELF_EDIT", "Ask another manager to change your own hours");
    return entry;
  }

  requireReason(payload) {
    const reason = String(payload?.reason || "").trim();
    if (!reason) fail(400, "REASON_REQUIRED", "Give a reason for changing someone's hours");
    return reason.slice(0, 300);
  }

  editRecord(actor, reason, action, before = null) {
    return { at: new Date().toISOString(), by: actor?.id || null, by_name: actor?.name || null, reason, action, before };
  }

  async addEntry({ businessId, actor, outletScope = null, payload = {} }) {
    const reason = this.requireReason(payload);
    const staff = await loadStaff(prisma, businessId, payload.user_id);
    if (staff.id === actor?.id && !isOwner(actor)) fail(403, "ATTENDANCE_SELF_EDIT", "Ask another manager to add your own hours");
    const clockInAt = parseTime(payload.clock_in_at, "Clock-in");
    const clockOutAt = parseTime(payload.clock_out_at, "Clock-out");
    validateSpan(clockInAt, clockOutAt);
    const breaks = normalizeBreaks(payload.breaks || [], clockInAt, clockOutAt);
    return prisma.$transaction(async (tx) => {
      await lockPerson(tx, staff.id);
      const outletId = await resolveOutlet(tx, businessId, staff, payload.outlet_id || null);
      if (outletScope && !(outletId ? outletScope.includes(outletId) : staff.outletIds.some((id) => outletScope.includes(id)))) {
        fail(403, "OUTLET_ACCESS_DENIED", "You do not have access to this outlet");
      }
      await assertNoOverlap(tx, { userId: staff.id, clockInAt, clockOutAt });
      const entry = await tx.attendanceEntry.create({ data: {
        businessId, userId: staff.id, userName: staff.name, userRole: staff.roleName, outletId, clockInAt, clockOutAt,
        breaks, source: "manager", note: payload.note ? String(payload.note).slice(0, 300) : null,
        edits: [this.editRecord(actor, reason, "added")],
      } });
      await notify(tx, entry, "added");
      return serializeEntry(entry);
    });
  }

  async updateEntry({ businessId, actor, outletScope = null, entryId, payload = {} }) {
    const reason = this.requireReason(payload);
    return prisma.$transaction(async (tx) => {
      const current = await this.loadEntryForEdit(tx, { businessId, entryId, actor, outletScope });
      const clockInAt = payload.clock_in_at !== undefined ? parseTime(payload.clock_in_at, "Clock-in") : current.clockInAt;
      let clockOutAt = current.clockOutAt;
      if (payload.clock_out_at !== undefined) {
        clockOutAt = parseTime(payload.clock_out_at, "Clock-out", { required: Boolean(current.clockOutAt) });
      }
      validateSpan(clockInAt, clockOutAt);
      const breaks = normalizeBreaks(payload.breaks !== undefined ? payload.breaks : breakList(current), clockInAt, clockOutAt);
      let outletId = current.outletId;
      if (payload.outlet_id !== undefined) {
        const staff = current.userId ? await loadStaff(tx, businessId, current.userId) : { outletIds: [], roleName: current.userRole, name: current.userName };
        outletId = payload.outlet_id ? await resolveOutlet(tx, businessId, staff, payload.outlet_id) : null;
        if (outletScope && outletId && !outletScope.includes(outletId)) fail(403, "OUTLET_ACCESS_DENIED", "You do not have access to this outlet");
      }
      if (current.userId) await assertNoOverlap(tx, { userId: current.userId, entryId: current.id, clockInAt, clockOutAt });
      const before = { clock_in_at: current.clockInAt.toISOString(), clock_out_at: current.clockOutAt?.toISOString() || null,
        breaks: breakList(current), outlet_id: current.outletId, note: current.note };
      const entry = await tx.attendanceEntry.update({ where: { id: current.id }, data: {
        clockInAt, clockOutAt, breaks, outletId,
        ...(payload.note !== undefined ? { note: payload.note ? String(payload.note).slice(0, 300) : null } : {}),
        edits: [...(Array.isArray(current.edits) ? current.edits : []), this.editRecord(actor, reason, "edited", before)],
      } });
      await notify(tx, entry, "edited");
      return serializeEntry(entry);
    });
  }

  /** Close a shift someone forgot to clock out of. */
  async closeEntry({ businessId, actor, outletScope = null, entryId, payload = {} }) {
    const reason = this.requireReason(payload);
    return prisma.$transaction(async (tx) => {
      const current = await this.loadEntryForEdit(tx, { businessId, entryId, actor, outletScope });
      if (current.clockOutAt) fail(409, "ALREADY_CLOCKED_OUT", "This shift is already closed");
      const clockOutAt = payload.clock_out_at ? parseTime(payload.clock_out_at, "Clock-out") : new Date();
      validateSpan(current.clockInAt, clockOutAt);
      const breaks = breakList(current).map((row) => {
        if (row.end_at) return row;
        return { ...row, end_at: new Date(Math.max(Date.parse(row.start_at), clockOutAt.getTime())).toISOString() };
      });
      if (breaks.some((row) => Date.parse(row.start_at) > clockOutAt.getTime())) fail(400, "BREAKS_INVALID", "Clock-out must be after the last break started");
      const entry = await tx.attendanceEntry.update({ where: { id: current.id }, data: {
        clockOutAt, breaks,
        edits: [...(Array.isArray(current.edits) ? current.edits : []), this.editRecord(actor, reason, "closed", { clock_out_at: null })],
      } });
      await notify(tx, entry, "closed");
      return serializeEntry(entry);
    });
  }

  async deleteEntry({ businessId, actor, outletScope = null, entryId, payload = {} }) {
    const reason = this.requireReason(payload);
    return prisma.$transaction(async (tx) => {
      const current = await this.loadEntryForEdit(tx, { businessId, entryId, actor, outletScope });
      const entry = await tx.attendanceEntry.update({ where: { id: current.id }, data: {
        deletedAt: new Date(), deletedById: actor?.id || null, deleteReason: reason,
        edits: [...(Array.isArray(current.edits) ? current.edits : []), this.editRecord(actor, reason, "deleted")],
      } });
      await notify(tx, entry, "deleted");
      return serializeEntry(entry);
    });
  }
}

export const attendanceService = new AttendanceService();
