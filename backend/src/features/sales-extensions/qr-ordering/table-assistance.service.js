import { randomUUID } from "node:crypto";
import prisma from "../../../database/prisma/client.js";
import { qrOrderingService } from "./qr-ordering.service.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { publishChange } from "../../../services/realtime/realtime.service.js";

export const ASSISTANCE_KINDS = { waiter: "Call waiter", water: "Drinking water", cutlery: "Cutlery", tissues: "Tissues", cleaning: "Table cleaning", chair: "Extra chair", other: "Other assistance", bill: "Request bill" };
const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
const prefix = (businessId) => `assistance:${businessId}:`;
const keyFor = (businessId, id) => prefix(businessId) + id;
const manager = (user) => ["Owner", "Manager"].includes(user?.role);
const canServe = (user) => user?.role?.name === "Owner" || user?.permissions?.some((entry) => ["waiter_view", "manager_view"].includes(entry.permission.key));
const visible = (row, outletIds) => !outletIds || outletIds.includes(row.outlet_id);
const isOpen = (row) => ["pending", "accepted"].includes(row.status);
const overdue = (row) => isOpen(row) && Date.now() - Date.parse(row.status === "accepted" ? row.accepted_at : row.created_at) > (row.status === "accepted" ? 5 : 2) * 60000;
const publicRow = (row) => ({ id: row.id, kind: row.kind, label: ASSISTANCE_KINDS[row.kind], status: row.status, created_at: row.created_at, accepted_at: row.accepted_at, resolved_at: row.resolved_at });

const guestContext = async ({ token, sessionKey }) => {
  const qr = await qrOrderingService.resolveContext(token);
  if (!sessionKey || typeof sessionKey !== "string") fail(400, "Reload the menu before requesting assistance");
  const session = await prisma.tableSession.findFirst({ where: { businessId: qr.businessId, tableId: qr.tableId, sessionKey, status: "active" } });
  if (!session) fail(409, "This table session has ended. Reload the menu to start a new session.");
  return { qr, session };
};
const matchesSession = (row, session) => row.session_id === session.id && Date.parse(row.created_at) >= session.openedAt.getTime();

export const tableAssistanceService = {
  async guestList({ token, sessionKey }) {
    const { qr, session } = await guestContext({ token, sessionKey });
    const documents = await prisma.stateDocument.findMany({ where: { key: { startsWith: prefix(qr.businessId) }, data: { path: ["session_id"], equals: session.id } }, orderBy: { updatedAt: "desc" } });
    return documents.map((doc) => doc.data).filter((row) => matchesSession(row, session)).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a))).slice(0, 20).map(publicRow);
  },
  async create({ token, sessionKey, payload = {} }) {
    const { qr, session } = await guestContext({ token, sessionKey });
    if (qr.accessMode === "read_only") fail(402, "Table requests are unavailable for this business");
    const outletId = qr.table.meta?.outlet_id || qr.table.meta?.outletId || null;
    if (outletId && !await prisma.outlet.findFirst({ where: { id: outletId, businessId: qr.businessId }, select: { id: true } })) fail(409, "This table's outlet needs to be corrected by the restaurant");
    if (typeof payload.kind !== "string" || !Object.hasOwn(ASSISTANCE_KINDS, payload.kind)) fail(400, "Choose a valid assistance request");
    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    if (note.length > 200) fail(400, "Keep your request within 200 characters");
    if (payload.kind === "other" && !note) fail(400, "Tell us what you need help with");
    const paymentMethod = payload.kind === "bill" ? payload.payment_method || "undecided" : null;
    if (paymentMethod && !["cash", "card", "upi", "undecided"].includes(paymentMethod)) fail(400, "Choose cash, card, UPI or decide later");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assistance:${qr.businessId}:${session.id}`}))`;
      const fresh = await tx.tableSession.findFirst({ where: { id: session.id, status: "active", openedAt: session.openedAt } });
      if (!fresh) fail(409, "This table session has ended. Reload the menu.");
      const docs = await tx.stateDocument.findMany({ where: { key: { startsWith: prefix(qr.businessId) }, data: { path: ["session_id"], equals: session.id } }, orderBy: { updatedAt: "desc" } });
      const rows = docs.map((doc) => doc.data).filter((row) => matchesSession(row, session));
      const duplicate = rows.find((row) => row.kind === payload.kind && isOpen(row));
      if (duplicate) return { request: publicRow(duplicate), duplicate: true };
      const recent = rows.filter((row) => Date.now() - Date.parse(row.created_at) < 5 * 60000);
      if (recent.length >= 8 || rows.some((row) => row.kind === payload.kind && row.resolved_at && Date.now() - Date.parse(row.resolved_at) < 30000)) fail(429, "Your request was received. Please give the team a moment before sending another.");
      const now = new Date().toISOString();
      const row = { id: randomUUID(), business_id: qr.businessId, table_id: qr.tableId, table_name: qr.table.name, area_name: qr.table.area?.name || null,
        outlet_id: outletId, session_id: session.id,
        kind: payload.kind, note, payment_method: paymentMethod, status: "pending", created_at: now, accepted_at: null, resolved_at: null,
        assignee_id: null, assignee_name: null, history: [{ action: "requested", at: now }] };
      await tx.stateDocument.create({ data: { key: keyFor(qr.businessId, row.id), data: row } });
      await publishChange({ businessId: qr.businessId, resource: "table_assistance", action: "created", recordId: row.id, outletId: row.outlet_id }, { tx });
      return { request: publicRow(row), duplicate: false };
    });
  },
  async list({ businessId, outletIds, history = false }) {
    const docs = await prisma.stateDocument.findMany({ where: { key: { startsWith: prefix(businessId) } }, orderBy: { updatedAt: "desc" } });
    const rows = docs.map((doc) => doc.data).filter((row) => row.business_id === businessId && visible(row, outletIds));
    const sessions = await prisma.tableSession.findMany({ where: { businessId, id: { in: [...new Set(rows.map((row) => row.session_id))] } }, select: { id: true, status: true, openedAt: true } });
    const current = new Map(sessions.map((session) => [session.id, session]));
    return rows.map((row) => {
      const session = current.get(row.session_id);
      const expired = isOpen(row) && (!session || session.status !== "active" || !matchesSession(row, session));
      const item = { ...row, label: ASSISTANCE_KINDS[row.kind], status: expired ? "expired" : row.status };
      return { ...item, needs_attention: overdue(item) };
    }).filter((row) => history || isOpen(row)).sort((a, b) => Number(b.needs_attention) - Number(a.needs_attention) || Date.parse(a.created_at) - Date.parse(b.created_at)).slice(history ? -100 : 0);
  },
  async staff({ businessId, outletIds }) {
    const users = await prisma.user.findMany({ where: { businessId, active: true }, select: { id: true, name: true, role: { select: { name: true } }, permissions: { include: { permission: true } }, outletAssignments: { select: { outletId: true } } } });
    return users.filter(canServe).filter((user) => !outletIds || manager({ role: user.role?.name }) || !user.outletAssignments.length || user.outletAssignments.some((assignment) => outletIds.includes(assignment.outletId))).map((user) => ({ id: user.id, name: user.name, all_outlets: manager({ role: user.role?.name }) || !user.outletAssignments.length, outlet_ids: user.outletAssignments.map((entry) => entry.outletId) }));
  },
  async update({ businessId, id, action, assigneeId, user, outletIds }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) fail(404, "Request not found");
    if (!["accept", "assign", "resolve"].includes(action)) fail(400, "Choose accept, assign or resolve");
    return prisma.$transaction(async (tx) => {
      const key = keyFor(businessId, id);
      await tx.$queryRaw`SELECT key FROM "StateDocument" WHERE key=${key} FOR UPDATE`;
      const doc = await tx.stateDocument.findUnique({ where: { key } });
      const row = doc?.data;
      if (!row || row.business_id !== businessId || !visible(row, outletIds)) fail(404, "Request not found");
      if (row.status === "resolved") {
        if (action === "resolve") return row;
        fail(409, "This request has already been resolved");
      }
      const session = await tx.tableSession.findFirst({ where: { id: row.session_id, businessId, status: "active" } });
      if (!session || !matchesSession(row, session)) fail(409, "This table session has ended");
      if (action === "resolve" && row.assignee_id !== user.id && !manager(user)) fail(403, "Only the assigned staff member or a manager can complete this request");
      const targetId = action === "assign" ? assigneeId : user.id;
      let assignee;
      if (action !== "resolve") {
        if (targetId !== user.id && !manager(user)) fail(403, "Only a manager can assign another staff member");
        if (row.assignee_id && row.assignee_id !== user.id && !manager(user)) fail(409, "Another staff member has already accepted this request");
        assignee = await tx.user.findFirst({ where: { id: targetId || "", businessId, active: true }, include: { role: true, permissions: { include: { permission: true } }, outletAssignments: true } });
        if (!canServe(assignee)) fail(400, "Choose active staff with table-service access from this business");
        if (!["Owner", "Manager"].includes(assignee.role.name) && assignee.outletAssignments.length && !assignee.outletAssignments.some((entry) => entry.outletId === row.outlet_id)) fail(400, "This staff member is not assigned to this outlet");
        if (row.assignee_id === targetId && row.status === "accepted") return row;
      }
      const now = new Date().toISOString();
      const next = { ...row, status: action === "resolve" ? "resolved" : "accepted",
        ...(assignee ? { assignee_id: assignee.id, assignee_name: assignee.name, accepted_at: row.accepted_at || now } : { resolved_at: now }),
        history: [...row.history, { action, at: now, actor_id: user.id, actor_name: user.name, ...(assignee ? { assignee_id: assignee.id, assignee_name: assignee.name } : {}) }] };
      await tx.stateDocument.update({ where: { key }, data: { data: next } });
      await publishChange({ businessId, resource: "table_assistance", action, recordId: id, outletId: row.outlet_id }, { tx });
      return next;
    });
  },
};
