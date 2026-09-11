import nodemailer from "nodemailer";
import { createHttpError } from "../../shared/utils/http-error.js";

export const createAuthMailer = ({ config = process.env, transport } = {}) => {
  const configured = () => Boolean(config.SMTP_HOST && config.SMTP_FROM && config.AUTH_PUBLIC_URL);
  const requireConfigured = () => {
    if (!configured()) throw createHttpError({ statusCode: 503, code: "AUTH_MAIL_NOT_CONFIGURED", message: "Account email delivery is not configured" });
    const url = new URL(config.AUTH_PUBLIC_URL);
    if (url.protocol !== "https:" && !(config.NODE_ENV !== "production" && url.hostname === "localhost")) {
      throw createHttpError({ statusCode: 503, message: "Account email requires a secure public URL" });
    }
  };
  let sender = transport;
  return {
    configured, requireConfigured,
    async send({ email, token, type }) {
      requireConfigured();
      if (!["invite", "password_reset"].includes(type)) throw new Error("Unsupported account email type");
      const link = new URL(type === "invite" ? `/invite/${encodeURIComponent(token)}` : "/reset-password", config.AUTH_PUBLIC_URL);
      if (type === "password_reset") link.searchParams.set("token", token);
      sender ||= nodemailer.createTransport({
        host: config.SMTP_HOST, port: Number(config.SMTP_PORT || 587),
        secure: Number(config.SMTP_PORT || 587) === 465, requireTLS: true,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      });
      const result = await sender.sendMail({ from: config.SMTP_FROM, to: email,
        subject: type === "invite" ? "Your POS invitation" : "Reset your POS password",
        text: `${type === "invite" ? "Accept your invitation" : "Reset your password"}:\n${link.href}\n\nThis link expires and can be used once. If you did not request it, ignore this email.`,
      });
      if (!result.accepted?.length) throw new Error("Account email was not accepted by the mail server");
      return { sent: true };
    },
  };
};

export const authMailer = createAuthMailer();
