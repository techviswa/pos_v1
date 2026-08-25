const paymentIntents = new Map();

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

class PaymentsService {
  createIntent({ payload = {}, user = null, publicRequest = false } = {}) {
    const amount = toNumber(payload.amount, 0);
    const method = payload.method || payload.payment_method || "UPI";
    const provider = payload.provider || (method === "UPI" ? "upi_manual" : "manual_gateway");
    const id = `payint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      provider,
      method,
      status: payload.status || "pending",
      amount,
      currency: payload.currency || "INR",
      reference,
      invoiceId: payload.invoice_id || payload.invoiceId || null,
      orderId: payload.order_id || payload.orderId || null,
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

    paymentIntents.set(id, intent);
    return serializeIntent(intent);
  }

  listIntents({ status } = {}) {
    return [...paymentIntents.values()]
      .filter((intent) => !status || intent.status === status)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(serializeIntent);
  }

  getIntent(intentId) {
    const intent = paymentIntents.get(intentId);
    return intent ? serializeIntent(intent) : null;
  }

  confirmIntent({ intentId, payload = {}, user = null }) {
    const intent = paymentIntents.get(intentId);
    if (!intent) {
      return null;
    }

    intent.status = payload.status || "confirmed";
    intent.reference = payload.reference || payload.transaction_id || payload.utr || intent.reference;
    intent.providerPayload = {
      ...(intent.providerPayload || {}),
      confirmation: payload,
      confirmed_by: user?.id || null,
    };
    intent.confirmedAt = nowIso();
    intent.updatedAt = nowIso();
    paymentIntents.set(intentId, intent);
    return serializeIntent(intent);
  }

  recordWebhook({ provider = "unknown", payload = {} } = {}) {
    const intentId = payload.intent_id || payload.payment_intent_id || payload.reference;
    const intent = intentId ? paymentIntents.get(intentId) : null;

    if (intent) {
      intent.status = payload.status || "confirmed";
      intent.providerPayload = {
        ...(intent.providerPayload || {}),
        webhook_provider: provider,
        webhook_payload: payload,
      };
      intent.confirmedAt = intent.confirmedAt || nowIso();
      intent.updatedAt = nowIso();
      paymentIntents.set(intent.id, intent);
      return serializeIntent(intent);
    }

    return {
      received: true,
      provider,
      matched_intent: false,
      received_at: nowIso(),
    };
  }
}

export const paymentsService = new PaymentsService();
