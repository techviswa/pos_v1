import prisma from "../../../database/prisma/client.js";
import { serializeOrder, serializeProduct, toPrismaOrderItems } from "../../../database/prisma/helpers.js";
import { createHttpError, createNotFoundError } from "../../../shared/utils/http-error.js";
import { DEFAULT_CUSTOMER_NAME } from "../../../shared/constants/domain.constants.js";
import { orderFulfillmentService } from "../../../services/workflows/order-fulfillment.service.js";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { saasService } from "../../../core/saas/saas.service.js";
import { resolveTrustedItems } from "../../../core/orders/order-pricing.js";
import { availability, effectiveBase, loadActiveRules, pricingInclude } from "../../../core/menu/menu-pricing.js";
import { comboAvailableStock } from "../../../core/menu/menu-structure.service.js";
import { smsService } from "../../../services/sms/sms.service.js";
import { publishChange } from "../../../services/realtime/realtime.service.js";
import { readState, writeState } from "../../../database/prisma/state-store.js";
import env from "../../../config/env.js";

const cloneJson = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
};


const isQrOrderingEnabled = (settings) =>
  Boolean(settings?.capabilities?.qrOrderingEnabled);

const getQrOrderingRules = (settings) => {
  const capabilities = settings?.capabilities || {};
  const reservationRules = settings?.reservationRules || {};
  const qrRules = reservationRules.qrOrderingRules || capabilities.qrOrderingRules || {};

  return {
    orderingPaused: Boolean(qrRules.orderingPaused || capabilities.qrOrderingPaused),
    requireCustomerPhone: Boolean(qrRules.requireCustomerPhone || capabilities.qrRequireCustomerPhone),
    minOrderTotal: Math.max(0, Number(qrRules.minOrderTotal || capabilities.qrMinOrderTotal || 0)),
    estimatedPrepMinutes: Math.max(0, Number(qrRules.estimatedPrepMinutes || capabilities.qrEstimatedPrepMinutes || 20)),
    requireRestaurantApproval: qrRules.requireRestaurantApproval !== false,
    requirePhoneVerification: Boolean(qrRules.requirePhoneVerification || capabilities.qrRequirePhoneVerification),
    serviceChargePercent: Math.max(0, Number(qrRules.serviceChargePercent || capabilities.qrServiceChargePercent || 0)),
    serviceChargeFixed: Math.max(0, Number(qrRules.serviceChargeFixed || capabilities.qrServiceChargeFixed || 0)),
    tipsEnabled: qrRules.tipsEnabled !== false,
    onlinePaymentEnabled: Boolean(qrRules.onlinePaymentEnabled || capabilities.qrOnlinePaymentEnabled),
    paymentRequiredBeforeApproval: Boolean(qrRules.paymentRequiredBeforeApproval || capabilities.qrPaymentRequiredBeforeApproval),
    publicBaseUrl: qrRules.publicBaseUrl || capabilities.qrPublicBaseUrl || env.qrOrdering.publicBaseUrl,
  };
};

const createTrackingToken = () => randomBytes(24).toString("base64url");

const hashIp = (ipAddress) => {
  if (!ipAddress) return null;
  return createHash("sha256").update(String(ipAddress)).digest("hex");
};

const normalizePhoneNumber = (value) => String(value || "").replace(/\D/g, "");

const todaySessionKey = (tableId) => `qrs_${tableId}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

const createOtp = () => String(randomInt(100000, 1000000));

const safeCodeMatch = (expected, supplied) => {
  const a = Buffer.from(String(expected ?? ""));
  const b = Buffer.from(String(supplied ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
};

const MAX_VERIFICATION_ATTEMPTS = 5;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_CODES_PER_PHONE = 3; // per OTP_TTL_MS window, per business
const otpKey = (verificationToken) => `qr-otp:${verificationToken}`;
const otpRateKey = (businessId, phone) => `qr-otp-rate:${businessId}:${phone}`;
// Only an HMAC of the code is stored, keyed with a server secret, so someone who can read the database still
// cannot recover or brute-force pending codes offline.
const otpSecret = () =>
  process.env.OTP_SECRET || (env.auth.jwtSecret !== "change-me" ? env.auth.jwtSecret : "") ||
  createHash("sha256").update(`${env.database.url}|qr-otp`).digest("hex");
const hashOtp = (verificationToken, otp) => createHmac("sha256", otpSecret()).update(`${verificationToken}:${String(otp ?? "")}`).digest("hex");

const createVerificationToken = () => randomBytes(18).toString("base64url");

const isWithinSchedule = (schedule = []) => {
  if (!Array.isArray(schedule) || !schedule.length) return true;
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return schedule.some((slot) => {
    const days = (slot.days || []).map((entry) => String(entry).toLowerCase());
    const [startHour = 0, startMinute = 0] = String(slot.start || "00:00").split(":").map(Number);
    const [endHour = 23, endMinute = 59] = String(slot.end || "23:59").split(":").map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    return (!days.length || days.includes(day)) && currentMinutes >= start && currentMinutes <= end;
  });
};

const isProductAvailableForQr = ({ product, outletId }) => {
  const channelSettings = product.channelSettings || {};
  const qrSettings = channelSettings.qr || channelSettings.qr_ordering || {};
  if (qrSettings.enabled === false) return false;
  if (!isWithinSchedule(qrSettings.schedule || qrSettings.availability_schedule || [])) return false;

  if (!outletId) return true;
  const outletLinks = product.outletLinks || [];
  if (!outletLinks.length) return true;
  return outletLinks.some((link) => link.outletId === outletId && link.enabled !== false);
};

const getOrderInclude = () => ({
  business: true,
  items: true,
});

class QrOrderingService {
  async ensureTableSession({ qrCode, customer = {}, tx = prisma }) {
    const sessionKey = todaySessionKey(qrCode.tableId);
    const existing = await tx.tableSession.findUnique({
      where: { sessionKey },
    });

    const nextMetadata = {
      ...(existing?.metadata || {}),
      qr_code_id: qrCode.id,
      table_name: qrCode.table.name,
      area_name: qrCode.table.area?.name || null,
      last_seen_at: new Date().toISOString(),
      scan_count: Number(existing?.metadata?.scan_count || 0) + 1,
    };

    if (existing) {
      return tx.tableSession.update({
        where: { id: existing.id },
        data: {
          status: existing.status === "closed" ? "active" : existing.status,
          customerName: customer.name || existing.customerName || null,
          customerPhone: customer.phone || existing.customerPhone || null,
          metadata: nextMetadata,
          closedAt: null,
        },
      });
    }

    return tx.tableSession.create({
      data: {
        businessId: qrCode.businessId,
        tableId: qrCode.tableId,
        qrCodeId: qrCode.id,
        sessionKey,
        source: "qr",
        status: "active",
        customerName: customer.name || null,
        customerPhone: customer.phone || null,
        metadata: nextMetadata,
      },
    });
  }

  async resolveContext(token) {
    const qrCode = await prisma.tableQrCode.findUnique({
      where: { token },
      include: {
        business: {
          include: {
            tableManagementSettings: true,
          },
        },
        table: {
          include: {
            area: true,
          },
        },
      },
    });

    if (!qrCode || !qrCode.active) {
      throw createNotFoundError("QR code", { token });
    }

    const access = await saasService.getAccessMode(qrCode.businessId);
    if (access.mode === "blocked") {
      throw createHttpError({ statusCode: 403, code: "TENANT_SUSPENDED", message: "Ordering is unavailable for this business" });
    }
    qrCode.accessMode = access.mode;

    if (!qrCode.table || qrCode.table.active === false) {
      throw createHttpError({
        statusCode: 409,
        code: "TABLE_QR_DISABLED",
        message: "Ordering is currently disabled for this table",
      });
    }

    if (!isQrOrderingEnabled(qrCode.business.tableManagementSettings)) {
      throw createHttpError({
        statusCode: 409,
        code: "QR_ORDERING_DISABLED",
        message: "QR ordering is currently disabled for this business",
      });
    }

    return qrCode;
  }

  serializeContext(qrCode) {
    const settings = qrCode.business.tableManagementSettings;
    const rules = getQrOrderingRules(settings);

    return {
      business: {
        id: qrCode.business.id,
        name: qrCode.business.name,
      },
      table: {
        id: qrCode.table.id,
        name: qrCode.table.name,
        code: qrCode.table.code || null,
        seats: qrCode.table.seats,
        area_name: qrCode.table.area?.name || null,
      },
      qr: {
        token: qrCode.token,
        active: qrCode.active,
        scan_count: qrCode.scanCount || 0,
        last_scanned_at: qrCode.lastScannedAt ? qrCode.lastScannedAt.toISOString() : null,
        public_url: `${rules.publicBaseUrl.replace(/\/$/, "")}/qr/${qrCode.token}`,
      },
      ordering: {
        paused: rules.orderingPaused,
        require_customer_phone: rules.requireCustomerPhone,
        require_phone_verification: rules.requirePhoneVerification,
        require_restaurant_approval: rules.requireRestaurantApproval,
        min_order_total: rules.minOrderTotal,
        estimated_prep_minutes: rules.estimatedPrepMinutes,
        online_payment_enabled: rules.onlinePaymentEnabled,
        payment_required_before_approval: rules.paymentRequiredBeforeApproval,
        tips_enabled: rules.tipsEnabled,
        service_charge_percent: rules.serviceChargePercent,
        service_charge_fixed: rules.serviceChargeFixed,
        public_base_url: rules.publicBaseUrl,
      },
      table_session: {
        id: qrCode.currentTableSession?.id || todaySessionKey(qrCode.tableId),
        session_key: qrCode.currentTableSession?.sessionKey || todaySessionKey(qrCode.tableId),
        table_id: qrCode.tableId,
        status: qrCode.currentTableSession?.status || "active",
        opened_at: qrCode.currentTableSession?.openedAt
          ? qrCode.currentTableSession.openedAt.toISOString()
          : new Date().toISOString(),
      },
    };
  }

  async createUniqueTrackingToken(tx = prisma) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const trackingToken = createTrackingToken();
      const existing = await tx.order.findUnique({ where: { trackingToken } });
      if (!existing) return trackingToken;
    }

    throw createHttpError({
      statusCode: 503,
      code: "QR_ORDER_TRACKING_TOKEN_FAILED",
      message: "Unable to create an order tracking link. Please try again.",
    });
  }

  async recordScan(qrCode, requestMeta = {}) {
    await prisma.$transaction([
      prisma.tableQrCode.update({
        where: { id: qrCode.id },
        data: {
          scanCount: { increment: 1 },
          lastScannedAt: new Date(),
        },
      }),
      prisma.tableQrScanEvent.create({
        data: {
          qrCodeId: qrCode.id,
          businessId: qrCode.businessId,
          tableId: qrCode.tableId,
          userAgent: requestMeta.userAgent || null,
          referrer: requestMeta.referrer || null,
          ipHash: hashIp(requestMeta.ipAddress),
        },
      }),
    ]);
  }

  async getSession({ token }) {
    const qrCode = await this.resolveContext(token);
    const currentTableSession = await this.ensureTableSession({ qrCode });
    return this.serializeContext({ ...qrCode, currentTableSession });
  }

  async getMenu({ token, requestMeta = {} }) {
    const qrCode = await this.resolveContext(token);
    const [, currentTableSession] = await Promise.all([
      this.recordScan(qrCode, requestMeta),
      this.ensureTableSession({ qrCode }),
    ]);
    const outletId = qrCode.table.meta?.outlet_id || qrCode.table.meta?.outletId || null;
    const [products, rules] = await Promise.all([
      prisma.product.findMany({
        where: {
          businessId: qrCode.businessId,
          active: true,
        },
        include: {
          business: true,
          ...pricingInclude(outletId),
          comboComponents: { include: { component: { select: { id: true, name: true, stock: true } } } },
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      loadActiveRules(prisma, qrCode.businessId),
    ]);
    const at = new Date();

    return {
      ...this.serializeContext({ ...qrCode, currentTableSession }),
      availability: {
        outlet_id: outletId,
        checked_at: new Date().toISOString(),
      },
      items: products
        .filter((product) => isProductAvailableForQr({ product, outletId }))
        .filter((product) => availability(product, { outletLink: product.outletLinks?.[0] || null, channel: "Dine-In" }).available)
        .map((product) => {
          const priced = effectiveBase(product, { outletLink: product.outletLinks?.[0] || null, channel: "Dine-In", salesChannel: "QR", outletId, at, rules });
          const comboStock = comboAvailableStock(product);
          return {
            ...serializeProduct(product),
            ...(comboStock === null ? {} : { stock: comboStock }),
            base_price: product.price,
            list_price: priced.listPrice,
            price: priced.price,
            price_rule: priced.rule ? { id: priced.rule.id, name: priced.rule.name } : null,
          };
        }),
    };
  }

  async requestPhoneVerification({ token, phone }) {
    const qrCode = await this.resolveContext(token);
    // The code must reach the customer's phone. Without an SMS provider it is only ever shown in development;
    // in production the request fails closed instead of pretending to verify anyone.
    const canSend = smsService.configured();
    if (!canSend && env.nodeEnv === "production") {
      throw createHttpError({
        statusCode: 501,
        code: "QR_PHONE_VERIFICATION_UNAVAILABLE",
        message: "Phone verification is not available. Ask the restaurant to disable it or take the order at the counter.",
      });
    }
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!/^\d{10}$/.test(normalizedPhone)) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_PHONE_INVALID",
        message: "Enter a valid 10-digit phone number",
      });
    }

    // Limit codes per phone so the endpoint cannot be used to flood a number with SMS.
    const now = Date.now();
    // Expired codes and counters are removed as new ones are issued.
    await prisma.stateDocument.deleteMany({
      where: { updatedAt: { lt: new Date(now - 2 * OTP_TTL_MS) }, OR: [{ key: { startsWith: "qr-otp:" } }, { key: { startsWith: "qr-otp-rate:" } }] },
    });
    const rate = await readState(otpRateKey(qrCode.businessId, normalizedPhone));
    const recent = (rate?.sent_at || []).filter((at) => now - at < OTP_TTL_MS);
    if (recent.length >= MAX_CODES_PER_PHONE) {
      throw createHttpError({ statusCode: 429, code: "QR_VERIFICATION_RATE_LIMITED", message: "Too many codes requested for this number. Try again in a few minutes." });
    }

    const otp = createOtp();
    const verificationToken = createVerificationToken();
    await writeState(otpKey(verificationToken), {
      business_id: qrCode.businessId,
      phone: normalizedPhone,
      otp_hash: hashOtp(verificationToken, otp),
      attempts: 0,
      verified: false,
      expires_at: now + OTP_TTL_MS,
    });
    await writeState(otpRateKey(qrCode.businessId, normalizedPhone), { sent_at: [...recent, now] });

    if (canSend) {
      const businessName = qrCode.business?.name || "your restaurant";
      await smsService.send({ to: normalizedPhone, message: `${otp} is your ${businessName} order verification code. It expires in 5 minutes.` });
    }

    return {
      accepted: true,
      verification_token: verificationToken,
      expires_in_minutes: OTP_TTL_MS / 60000,
      delivery: canSend ? "sms" : "development",
      // Development only, when nothing can be sent. Production never returns a code.
      ...(!canSend && env.nodeEnv !== "production" ? { dev_otp: otp } : {}),
    };
  }

  async verifyPhone({ token, verificationToken, otp }) {
    const qrCode = await this.resolveContext(token);
    const key = otpKey(String(verificationToken || "").slice(0, 64));
    // Row lock: concurrent guesses are counted one at a time, so the attempt limit cannot be raced.
    const record = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT key FROM "StateDocument" WHERE key = ${key} FOR UPDATE`;
      const current = await readState(key, null, tx);
      if (!current || current.business_id !== qrCode.businessId || current.expires_at < Date.now()
        || current.attempts >= MAX_VERIFICATION_ATTEMPTS) return null;
      const matches = safeCodeMatch(current.otp_hash, hashOtp(verificationToken, otp));
      const next = matches
        ? { ...current, attempts: current.attempts + 1, verified: true, verified_at: new Date().toISOString() }
        : { ...current, attempts: current.attempts + 1 };
      await writeState(key, next, tx);
      return matches ? next : null;
    });
    if (!record) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_PHONE_VERIFICATION_FAILED",
        message: "Invalid or expired phone verification code",
      });
    }

    return {
      verified: true,
      phone: record.phone,
      verification_token: verificationToken,
    };
  }

  async assertPhoneVerified({ rules, customerPhone, verificationToken, businessId }) {
    if (!rules.requirePhoneVerification) return null;
    const record = await readState(otpKey(String(verificationToken || "").slice(0, 64)));
    if (!record || !record.verified || record.business_id !== businessId || record.expires_at < Date.now() || record.phone !== customerPhone) {
      throw createHttpError({
        statusCode: 403,
        code: "QR_PHONE_NOT_VERIFIED",
        message: "Verify the customer phone number before placing the order",
      });
    }

    return {
      phone_verified: true,
      phone_verified_at: record.verified_at,
    };
  }

  async createOrder({ token, payload = {} }) {
    const qrCode = await this.resolveContext(token);
    const rules = getQrOrderingRules(qrCode.business.tableManagementSettings);

    if (qrCode.accessMode === "read_only") {
      throw createHttpError({ statusCode: 402, code: "SUBSCRIPTION_INACTIVE", message: "Ordering is unavailable for this business" });
    }

    if (rules.orderingPaused) {
      throw createHttpError({
        statusCode: 409,
        code: "QR_ORDERING_PAUSED",
        message: "Ordering is temporarily paused for this table",
      });
    }

    const requestedItems = Array.isArray(payload.items) ? payload.items : [];
    if (!requestedItems.length) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_ORDER_ITEMS_REQUIRED",
        message: "At least one menu item is required",
      });
    }

    const outletId = qrCode.table.meta?.outlet_id || qrCode.table.meta?.outletId || null;
    const productIds = [...new Set(requestedItems.map((item) => item.productId || item.product_id).filter(Boolean))];
    // QR-specific availability (QR channel switch and schedule) is checked first, then the shared price engine
    // validates variations, add-ons and modifier choices and prices every line as billing will.
    const qrProducts = await prisma.product.findMany({
      where: { businessId: qrCode.businessId, active: true, id: { in: productIds } },
      include: { outletLinks: outletId ? { where: { outletId } } : true },
    });
    const qrAvailable = new Set(qrProducts.filter((product) => isProductAvailableForQr({ product, outletId })).map((product) => product.id));
    for (const item of requestedItems) {
      if (!qrAvailable.has(item.productId || item.product_id)) {
        throw createHttpError({
          statusCode: 400,
          code: "QR_ORDER_PRODUCT_UNAVAILABLE",
          message: "One or more selected items are no longer available",
        });
      }
    }
    let normalizedItems;
    try {
      normalizedItems = await resolveTrustedItems({
        client: prisma,
        businessId: qrCode.businessId,
        outletId,
        channel: "Dine-In",
        salesChannel: "QR",
        items: requestedItems.map((item) => ({
          productId: item.productId || item.product_id,
          quantity: item.quantity,
          ...(item.variationId || item.variation_id ? { variation: { id: item.variationId || item.variation_id } } : {}),
          addons: (Array.isArray(item.addonIds || item.addon_ids) ? item.addonIds || item.addon_ids : []).map((id) => ({ id })),
          modifiers: Array.isArray(item.modifierOptionIds || item.modifier_option_ids) ? item.modifierOptionIds || item.modifier_option_ids : [],
        })),
      });
    } catch (error) {
      // Guests see a plain message; the code still says what was wrong.
      if (error?.statusCode === 400) {
        throw createHttpError({ statusCode: 400, code: error.code, message: error.message.includes("not available") ? "One or more selected items are no longer available" : error.message });
      }
      throw error;
    }
    normalizedItems = normalizedItems.map((item) => {
      const product = qrProducts.find((entry) => entry.id === item.productId);
      return { ...item, name: item.name || product?.name || "Item" };
    });

    const itemTotal = normalizedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const serviceCharge =
      Number(rules.serviceChargeFixed || 0) + Math.round(itemTotal * (Number(rules.serviceChargePercent || 0)) ) / 100;
    const requestedTip = Number(payload.tip_amount || payload.tipAmount || 0);
    if (!Number.isFinite(requestedTip) || requestedTip < 0 || requestedTip > Math.max(10000, itemTotal)) {
      throw createHttpError({ statusCode: 400, code: "QR_TIP_INVALID", message: "Tip amount is not valid" });
    }
    const tipAmount = rules.tipsEnabled ? Math.round(requestedTip * 100) / 100 : 0;
    const total = itemTotal + serviceCharge + tipAmount;
    const customerName = String(payload.customerName || payload.customer_name || DEFAULT_CUSTOMER_NAME).trim() || DEFAULT_CUSTOMER_NAME;
    const customerPhone = normalizePhoneNumber(payload.customerPhone || payload.customer_phone);
    const notes = String(payload.notes || "").trim().slice(0, 500);
    const clientRequestId = String(payload.client_request_id || payload.clientRequestId || "").trim().slice(0, 80);
    const verification = await this.assertPhoneVerified({
      businessId: qrCode.businessId,
      rules,
      customerPhone,
      verificationToken: payload.phone_verification_token || payload.phoneVerificationToken,
    });
    const payment = {
      method: payload.payment_method || payload.paymentMethod || (rules.onlinePaymentEnabled ? "online" : "pay_at_counter"),
      status: rules.paymentRequiredBeforeApproval ? "pending_confirmation" : "not_required",
      reference: payload.payment_reference || payload.paymentReference || null,
      amount: total,
      tip_amount: tipAmount,
      service_charge: serviceCharge,
    };

    if (rules.paymentRequiredBeforeApproval && payment.status !== "confirmed") {
      throw createHttpError({
        statusCode: 402,
        code: "QR_PAYMENT_CONFIRMATION_REQUIRED",
        message: "Confirm online payment before submitting this QR order",
      });
    }

    if (rules.requireCustomerPhone && !/^\d{10}$/.test(customerPhone)) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_ORDER_PHONE_REQUIRED",
        message: "Enter a valid 10-digit phone number",
      });
    }

    if (rules.minOrderTotal && total < rules.minOrderTotal) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_ORDER_MINIMUM_NOT_MET",
        message: `Minimum order value is ${rules.minOrderTotal}`,
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      // A double tap or network retry carries the same key and must not create a second order (or a second kitchen ticket).
      if (clientRequestId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qr-order:${qrCode.businessId}:${clientRequestId}`}))`;
        const earlier = await tx.order.findFirst({
          where: {
            businessId: qrCode.businessId,
            channel: "qr",
            createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
            metadata: { path: ["client_request_id"], equals: clientRequestId },
          },
          include: getOrderInclude(),
        });
        if (earlier) return earlier;
      }
      const trackingToken = await this.createUniqueTrackingToken(tx);
      const tableSession = await this.ensureTableSession({
        qrCode,
        customer: {
          name: customerName,
          phone: customerPhone || null,
        },
        tx,
      });
      const created = await tx.order.create({
        data: {
          businessId: qrCode.businessId,
          outletId: qrCode.table.meta?.outlet_id || qrCode.table.meta?.outletId || null,
          trackingToken,
          customerName,
          channel: "qr",
          total,
          status: rules.requireRestaurantApproval ? "qr_pending_approval" : "accepted",
          metadata: {
            source: "qr_ordering",
            qr_inbox: true,
            approval_status: rules.requireRestaurantApproval ? "pending" : "approved",
            table_id: qrCode.tableId,
            table_name: qrCode.table.name,
            table_session_id: tableSession.id,
            table_session_key: tableSession.sessionKey,
            table_session_status: tableSession.status,
            area_name: qrCode.table.area?.name || null,
            qr_code_id: qrCode.id,
            tracking_token: trackingToken,
            customer_phone: customerPhone || null,
            client_request_id: clientRequestId || null,
            ...verification,
            notes,
            submitted_at: new Date().toISOString(),
            estimated_prep_minutes: rules.estimatedPrepMinutes,
            subtotal: itemTotal,
            service_charge: serviceCharge,
            tip_amount: tipAmount,
            payment,
            order_lifecycle: rules.requireRestaurantApproval
              ? "waiting_for_restaurant_approval"
              : "sent_to_kitchen",
            table_meta: cloneJson(qrCode.table.meta, {}),
          },
          items: {
            create: toPrismaOrderItems(normalizedItems),
          },
        },
        include: getOrderInclude(),
      });

      await publishChange({ businessId: qrCode.businessId, resource: "qr_orders", action: "created", recordId: created.id, outletId: created.outletId }, { tx });

      if (!rules.requireRestaurantApproval) {
        await orderFulfillmentService.handleOrderCreated({
          tenantId: qrCode.business.tenantId,
          businessId: qrCode.businessId,
          orderId: created.id,
          tx,
        });
      }

      return created;
    });

    return serializeOrder(order);
  }

  async listInbox({ tenantId, businessId, status = "pending" }) {
    const whereStatus =
      status === "all"
        ? {}
        : { status: status === "pending" ? "qr_pending_approval" : `qr_${status}` };
    const orders = await prisma.order.findMany({
      where: {
        businessId,
        channel: "qr",
        ...whereStatus,
      },
      include: getOrderInclude(),
      orderBy: { createdAt: "desc" },
    });

    return {
      tenantId,
      items: orders.map(serializeOrder),
    };
  }

  async approveOrder({ tenantId, businessId, orderId, actor }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, businessId, channel: "qr" },
      include: getOrderInclude(),
    });
    if (!order) throw createNotFoundError("QR order", { orderId });

    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({ where: { id: order.id, businessId, status: "qr_pending_approval" }, data: { status: "accepted" } });
      if (!claimed.count) throw createHttpError({ statusCode: 409, message: "QR order has already been reviewed" });
      const next = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "accepted",
          metadata: {
            ...(order.metadata || {}),
            qr_inbox: false,
            approval_status: "approved",
            order_lifecycle: "sent_to_kitchen",
            approved_at: new Date().toISOString(),
            approved_by: actor?.id || null,
            approved_by_name: actor?.name || null,
          },
        },
        include: getOrderInclude(),
      });

      await orderFulfillmentService.handleOrderCreated({
        tenantId,
        businessId,
        orderId: order.id,
        tx,
      });
      await publishChange({ businessId, resource: "qr_orders", action: "approved", recordId: order.id, outletId: order.outletId }, { tx });

      return next;
    });

    return serializeOrder(updated);
  }

  async rejectOrder({ businessId, orderId, reason, actor }) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, businessId, channel: "qr" },
      include: getOrderInclude(),
    });
    if (!order) throw createNotFoundError("QR order", { orderId });

    // Only a still-pending order can be rejected; an approved one is already in the kitchen.
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({ where: { id: order.id, businessId, status: "qr_pending_approval" }, data: { status: "qr_rejected" } });
      if (!claimed.count) throw createHttpError({ statusCode: 409, message: "QR order has already been reviewed" });
      await publishChange({ businessId, resource: "qr_orders", action: "rejected", recordId: order.id, outletId: order.outletId }, { tx });
      return tx.order.update({
      where: { id: order.id },
      data: {
        status: "qr_rejected",
        metadata: {
          ...(order.metadata || {}),
          qr_inbox: false,
          approval_status: "rejected",
          order_lifecycle: "rejected_by_restaurant",
          rejected_at: new Date().toISOString(),
          rejected_by: actor?.id || null,
          rejected_by_name: actor?.name || null,
          reject_reason: String(reason || "").slice(0, 500),
        },
      },
      include: getOrderInclude(),
      });
    });

    return serializeOrder(updated);
  }

  async getOrderByTrackingToken({ trackingToken }) {
    const order = await prisma.order.findUnique({
      where: { trackingToken },
      include: getOrderInclude(),
    });

    if (!order || order.channel !== "qr") {
      throw createNotFoundError("QR order", { trackingToken });
    }

    const serialized = serializeOrder(order);
    return {
      ...serialized,
      tracking: {
        status: serialized.status,
        approval_status: serialized.metadata?.approval_status || null,
        table_session_id: serialized.metadata?.table_session_id || null,
        table_session_key: serialized.metadata?.table_session_key || null,
        lifecycle: serialized.metadata?.order_lifecycle || null,
        estimated_prep_minutes: serialized.metadata?.estimated_prep_minutes || null,
        payment_status: serialized.metadata?.payment?.status || null,
      },
    };
  }
}

export const qrOrderingService = new QrOrderingService();
