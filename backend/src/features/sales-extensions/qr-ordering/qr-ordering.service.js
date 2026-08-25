import prisma from "../../../database/prisma/client.js";
import { serializeOrder, serializeProduct, toPrismaOrderItems } from "../../../database/prisma/helpers.js";
import { createHttpError, createNotFoundError } from "../../../shared/utils/http-error.js";
import { DEFAULT_CUSTOMER_NAME } from "../../../shared/constants/domain.constants.js";
import { orderFulfillmentService } from "../../../services/workflows/order-fulfillment.service.js";
import { createHash, randomBytes } from "node:crypto";
import env from "../../../config/env.js";

const cloneJson = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
};

const phoneVerificationStore = new Map();

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

const createOtp = () => String(Math.floor(100000 + Math.random() * 900000));

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
        id: todaySessionKey(qrCode.tableId),
        table_id: qrCode.tableId,
        status: "active",
        opened_at: new Date().toISOString().slice(0, 10),
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
    return this.serializeContext(qrCode);
  }

  async getMenu({ token, requestMeta = {} }) {
    const qrCode = await this.resolveContext(token);
    await this.recordScan(qrCode, requestMeta);
    const products = await prisma.product.findMany({
      where: {
        businessId: qrCode.businessId,
        active: true,
      },
      include: {
        business: true,
        variations: true,
        addons: true,
        outletLinks: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    const outletId = qrCode.table.meta?.outlet_id || qrCode.table.meta?.outletId || null;

    return {
      ...this.serializeContext(qrCode),
      availability: {
        outlet_id: outletId,
        checked_at: new Date().toISOString(),
      },
      items: products
        .filter((product) => isProductAvailableForQr({ product, outletId }))
        .map(serializeProduct),
    };
  }

  async requestPhoneVerification({ token, phone }) {
    await this.resolveContext(token);
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!/^\d{10}$/.test(normalizedPhone)) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_PHONE_INVALID",
        message: "Enter a valid 10-digit phone number",
      });
    }

    const otp = createOtp();
    const verificationToken = createVerificationToken();
    phoneVerificationStore.set(verificationToken, {
      phone: normalizedPhone,
      otp,
      verified: false,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return {
      accepted: true,
      verification_token: verificationToken,
      expires_in_minutes: 5,
      dev_otp: otp,
    };
  }

  async verifyPhone({ token, verificationToken, otp }) {
    await this.resolveContext(token);
    const record = phoneVerificationStore.get(String(verificationToken || ""));
    if (!record || record.expiresAt < Date.now() || record.otp !== String(otp || "")) {
      throw createHttpError({
        statusCode: 400,
        code: "QR_PHONE_VERIFICATION_FAILED",
        message: "Invalid or expired phone verification code",
      });
    }

    record.verified = true;
    record.verifiedAt = new Date().toISOString();
    phoneVerificationStore.set(verificationToken, record);

    return {
      verified: true,
      phone: record.phone,
      verification_token: verificationToken,
    };
  }

  assertPhoneVerified({ rules, customerPhone, verificationToken }) {
    if (!rules.requirePhoneVerification) return null;
    const record = phoneVerificationStore.get(String(verificationToken || ""));
    if (!record || !record.verified || record.expiresAt < Date.now() || record.phone !== customerPhone) {
      throw createHttpError({
        statusCode: 403,
        code: "QR_PHONE_NOT_VERIFIED",
        message: "Verify the customer phone number before placing the order",
      });
    }

    return {
      phone_verified: true,
      phone_verified_at: record.verifiedAt,
    };
  }

  async createOrder({ token, payload = {} }) {
    const qrCode = await this.resolveContext(token);
    const rules = getQrOrderingRules(qrCode.business.tableManagementSettings);

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

    const productIds = [...new Set(requestedItems.map((item) => item.productId || item.product_id).filter(Boolean))];
    const products = await prisma.product.findMany({
      where: {
        businessId: qrCode.businessId,
        active: true,
        id: { in: productIds },
      },
      include: {
        variations: true,
        addons: true,
        outletLinks: true,
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));

    const normalizedItems = requestedItems.map((item) => {
      const productId = item.productId || item.product_id;
      const product = productById.get(productId);
      const outletId = qrCode.table.meta?.outlet_id || qrCode.table.meta?.outletId || null;
      if (!product || !isProductAvailableForQr({ product, outletId })) {
        throw createHttpError({
          statusCode: 400,
          code: "QR_ORDER_PRODUCT_UNAVAILABLE",
          message: "One or more selected items are no longer available",
        });
      }

      const quantity = Math.max(1, Number(item.quantity || 1));
      const variationId = item.variationId || item.variation_id || null;
      const variation = variationId ? product.variations.find((entry) => entry.id === variationId) : null;
      if (variationId && !variation) {
        throw createHttpError({
          statusCode: 400,
          code: "QR_ORDER_VARIATION_UNAVAILABLE",
          message: "One or more selected item variations are no longer available",
        });
      }

      const addonIds = [...new Set(Array.isArray(item.addonIds || item.addon_ids) ? item.addonIds || item.addon_ids : [])];
      const availableAddonIds = new Set(product.addons.map((addon) => addon.id));
      const invalidAddonIds = addonIds.filter((addonId) => !availableAddonIds.has(addonId));
      if (invalidAddonIds.length) {
        throw createHttpError({
          statusCode: 400,
          code: "QR_ORDER_ADDON_UNAVAILABLE",
          message: "One or more selected add-ons are no longer available",
        });
      }

      const addons = addonIds
        .map((addonId) => product.addons.find((addon) => addon.id === addonId))
        .map((addon) => ({
          id: addon.id,
          name: addon.name,
          price: addon.price,
        }));
      const unitPrice = Number(product.price || 0) + Number(variation?.price || 0) + addons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);

      return {
        productId: product.id,
        name: product.name,
        quantity,
        price: unitPrice,
        variation: variation?.name || null,
        addons,
      };
    });

    const itemTotal = normalizedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const serviceCharge =
      Number(rules.serviceChargeFixed || 0) + Math.round(itemTotal * (Number(rules.serviceChargePercent || 0) / 100));
    const tipAmount = rules.tipsEnabled ? Math.max(0, Number(payload.tip_amount || payload.tipAmount || 0)) : 0;
    const total = itemTotal + serviceCharge + tipAmount;
    const customerName = String(payload.customerName || payload.customer_name || DEFAULT_CUSTOMER_NAME).trim() || DEFAULT_CUSTOMER_NAME;
    const customerPhone = normalizePhoneNumber(payload.customerPhone || payload.customer_phone);
    const notes = String(payload.notes || "").trim();
    const verification = this.assertPhoneVerified({
      rules,
      customerPhone,
      verificationToken: payload.phone_verification_token || payload.phoneVerificationToken,
    });
    const payment = {
      method: payload.payment_method || payload.paymentMethod || (rules.onlinePaymentEnabled ? "online" : "pay_at_counter"),
      status: payload.payment_status || (rules.paymentRequiredBeforeApproval ? "pending_confirmation" : "not_required"),
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
      const trackingToken = await this.createUniqueTrackingToken(tx);
      const created = await tx.order.create({
        data: {
          businessId: qrCode.businessId,
          outletId: payload.outlet_id || payload.outletId || null,
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
            table_session_id: todaySessionKey(qrCode.tableId),
            area_name: qrCode.table.area?.name || null,
            qr_code_id: qrCode.id,
            tracking_token: trackingToken,
            customer_phone: customerPhone || null,
            ...verification,
            notes,
            submitted_at: new Date().toISOString(),
            estimated_prep_minutes: rules.estimatedPrepMinutes,
            subtotal: itemTotal,
            service_charge: serviceCharge,
            tip_amount: tipAmount,
            payment,
            table_meta: cloneJson(qrCode.table.meta, {}),
          },
          items: {
            create: toPrismaOrderItems(normalizedItems),
          },
        },
        include: getOrderInclude(),
      });

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
      const next = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "accepted",
          metadata: {
            ...(order.metadata || {}),
            qr_inbox: false,
            approval_status: "approved",
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

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "qr_rejected",
        metadata: {
          ...(order.metadata || {}),
          qr_inbox: false,
          approval_status: "rejected",
          rejected_at: new Date().toISOString(),
          rejected_by: actor?.id || null,
          rejected_by_name: actor?.name || null,
          reject_reason: reason || "",
        },
      },
      include: getOrderInclude(),
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
        estimated_prep_minutes: serialized.metadata?.estimated_prep_minutes || null,
        payment_status: serialized.metadata?.payment?.status || null,
      },
    };
  }
}

export const qrOrderingService = new QrOrderingService();
