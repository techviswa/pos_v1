import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { qrOrderingService } from "./qr-ordering.service.js";

class QrOrderingController {
  async getSession(req, res) {
    const data = await qrOrderingService.getSession({ token: req.params.token });
    res.status(200).json(apiResponse({ message: "QR ordering session fetched successfully", data }));
  }

  async getMenu(req, res) {
    const data = await qrOrderingService.getMenu({
      token: req.params.token,
      requestMeta: {
        userAgent: req.get("user-agent"),
        referrer: req.get("referer"),
        ipAddress: req.ip,
      },
    });
    res.status(200).json(apiResponse({ message: "QR ordering menu fetched successfully", data }));
  }

  async requestPhoneVerification(req, res) {
    const data = await qrOrderingService.requestPhoneVerification({
      token: req.params.token,
      phone: req.body?.phone || req.body?.customer_phone,
    });
    res.status(202).json(apiResponse({ message: "Phone verification code created successfully", data }));
  }

  async verifyPhone(req, res) {
    const data = await qrOrderingService.verifyPhone({
      token: req.params.token,
      verificationToken: req.body?.verification_token || req.body?.verificationToken,
      otp: req.body?.otp,
    });
    res.status(200).json(apiResponse({ message: "Phone verified successfully", data }));
  }

  async createOrder(req, res) {
    const data = await qrOrderingService.createOrder({ token: req.params.token, payload: req.body });
    res.status(201).json(apiResponse({ message: "QR order submitted successfully", data }));
  }

  async getOrder(req, res) {
    const data = await qrOrderingService.getOrderByTrackingToken({ trackingToken: req.params.trackingToken });
    res.status(200).json(apiResponse({ message: "QR order tracking fetched successfully", data }));
  }

  async inbox(req, res) {
    const data = await qrOrderingService.listInbox({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      status: req.query?.status || "pending",
    });
    res.status(200).json(apiResponse({ message: "QR order inbox fetched successfully", data }));
  }

  async approve(req, res) {
    const data = await qrOrderingService.approveOrder({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      orderId: req.params.orderId,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "QR order approved and sent to kitchen", data }));
  }

  async reject(req, res) {
    const data = await qrOrderingService.rejectOrder({
      businessId: req.context.businessId,
      orderId: req.params.orderId,
      reason: req.body?.reason,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "QR order rejected successfully", data }));
  }
}

export const qrOrderingController = new QrOrderingController();
