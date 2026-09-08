import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";

const intentPrefix = (businessId) => `payment-intent:${encodeURIComponent(businessId)}:`;
const intentKey = (businessId, id) => `${intentPrefix(businessId)}${id}`;

const nowIso = () => new Date().toISOString();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildUpiDeepLink = ({ upiId, payeeName, amount, note, reference }) => {
  if (!upiId) {
    return null;
  }

  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName || "CashFlow POS",
    am: toNumber(amount, 0).toFixed(2),
    cu: "INR",
    tn: note || reference || "POS payment",
  });

  if (reference) {
    params.set("tr", reference);
  }

  return `upi://pay?${params.toString()}`;
};

const serializeIntent = (intent) => ({
  id: intent.id,
  business_id: intent.businessId,
  tenant_id: intent.tenantId,
  provider: intent.provider,
  method: intent.method,
  status: intent.status,
  amount: intent.amount,
  currency: intent.currency,
  reference: intent.reference,
  invoice_id: intent.invoiceId,
  order_id: intent.orderId,
  customer_phone: intent.customerPhone,
  upi_deep_link: intent.upiDeepLink,
  qr_payload: intent.qrPayload,
  provider_payload: intent.providerPayload,
  created_at: intent.createdAt,
  updated_at: intent.updatedAt,
  confirmed_at: intent.confirmedAt,
});

export class PaymentsService {
  constructor(database = prisma) {
    this.database = database;
  }

  async requireScope({ tenantId, businessId } = {}) {
    if (!tenantId || !businessId) {
      throw createHttpError({ statusCode: 403, message: "Payment business scope is required" });
    }
    const business = await this.database.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true } });
    if (!business) {
      throw createHttpError({ statusCode: 403, message: "Invalid payment business scope" });
    }
    return { tenantId, businessId };
  }

  async createIntent({ payload = {}, user = null, publicRequest = false, ...scope } = {}) {
    if (publicRequest) {
      throw createHttpError({ statusCode: 503, code: "PUBLIC_PAYMENTS_NOT_CONFIGURED", message: "Public payments require a configured payment provider and verified order session" });
    }
    const { tenantId, businessId } = await this.requireScope(scope);
    const amount = toNumber(payload.amount, 0);
    if (amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      throw createHttpError({ statusCode: 400, message: "Payment amount must be a positive monetary amount" });
    }
    const invoiceId = payload.invoice_id || payload.invoiceId || null;
    const orderId = payload.order_id || payload.orderId || null;
    for (const [model, id] of [["bill", invoiceId], ["order", orderId]]) {
      if (id && !await this.database[model].findFirst({ where: { id, businessId }, select: { id: true } })) {
        throw createHttpError({ statusCode: 404, message: "Payment invoice or order not found in this business" });
      }
    }
    const method = payload.method || payload.payment_method || "UPI";
    const provider = payload.provider || (method === "UPI" ? "upi_manual" : "manual_gateway");
    const id = `payint_${randomUUID()}`;
    const reference = payload.reference || payload.transaction_reference || id;
    const upiId = payload.upi_id || process.env.UPI_MERCHANT_ID || process.env.UPI_ID || "";
    const upiDeepLink = buildUpiDeepLink({
      upiId,
      payeeName: payload.payee_name || process.env.UPI_PAYEE_NAME || "CashFlow POS",
      amount,
      note: payload.note || payload.description || "POS payment",
      reference,
    });
    const intent = {
      id,
      tenantId,
      businessId,
      provider,
      method,
      status: "pending",
      amount,
      currency: payload.currency || "INR",
      reference,
      invoiceId,
      orderId,
      customerPhone: payload.customer_phone || payload.customerPhone || null,
      upiDeepLink,
      qrPayload: upiDeepLink,
      providerPayload: {
        mode: provider,
        public_request: Boolean(publicRequest),
        created_by: user?.id || null,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      confirmedAt: null,
    };

    await this.database.stateDocument.create({ data: { key: intentKey(businessId, id), data: intent } });
    return serializeIntent(intent);
  }

  async listIntents({ status, ...scope } = {}) {
    const { businessId, tenantId } = await this.requireScope(scope);
    const rows = await this.database.stateDocument.findMany({ where: { key: { startsWith: intentPrefix(businessId) } } });
    return rows.map((row) => row.data)
      .filter((intent) => intent.businessId === businessId && intent.tenantId === tenantId)
      .filter((intent) => !status || intent.status === status)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(serializeIntent);
  }

  async getIntent(intentId, scope = {}) {
    const { businessId, tenantId } = await this.requireScope(scope);
    const row = await this.database.stateDocument.findUnique({ where: { key: intentKey(businessId, intentId) } });
    return row?.data?.businessId === businessId && row.data.tenantId === tenantId ? serializeIntent(row.data) : null;
  }

  async confirmIntent({ intentId, payload = {}, user = null, ...scope }) {
    const { businessId, tenantId } = await this.requireScope(scope);
    const key = intentKey(businessId, intentId);
    const row = await this.database.stateDocument.findUnique({ where: { key } });
    const intent = row?.data;
    if (!intent || intent.businessId !== businessId || intent.tenantId !== tenantId) {
      return null;
    }
    const status = payload.status || "confirmed";
    if (!["confirmed", "failed", "cancelled"].includes(status)) {
      throw createHttpError({ statusCode: 400, message: "Invalid payment confirmation status" });
    }
    if (intent.status !== "pending") {
      if (intent.status === status) return serializeIntent(intent);
      throw createHttpError({ statusCode: 409, message: "Payment already has a final status" });
    }
    intent.status = status;
    intent.reference = payload.reference || payload.transaction_id || payload.utr || intent.reference;
    intent.providerPayload = {
      ...(intent.providerPayload || {}),
      confirmation: payload,
      confirmed_by: user?.id || null,
    };
    intent.confirmedAt = status === "confirmed" ? nowIso() : null;
    intent.updatedAt = nowIso();
    const updated = await this.database.stateDocument.updateMany({
      where: { key, data: { path: ["status"], equals: "pending" } },
      data: { data: intent },
    });
    if (updated.count !== 1) {
      const current = await this.getIntent(intentId, scope);
      if (current?.status === status) return current;
      throw createHttpError({ statusCode: 409, message: "Payment was already updated; refresh before retrying" });
    }
    return serializeIntent(intent);
  }

  recordWebhook({ provider = "unknown", payload = {} } = {}) {
    throw createHttpError({ statusCode: 503, code: "PAYMENT_WEBHOOK_NOT_CONFIGURED", message: "Payment webhooks require a configured provider with signature verification" });
  }
}

export const paymentsService = new PaymentsService();
