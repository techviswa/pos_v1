import { randomUUID } from "crypto";

export const SESSION_COOKIE_NAME = "cf_session_id";
export const SESSION_HEADER_NAME = "x-cf-session-id";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: false,
  path: "/",
  maxAge: 1000 * 60 * 60 * 24 * 7,
};

export const SESSION_TTL_MS = SESSION_COOKIE_OPTIONS.maxAge;

export const createSessionId = () => randomUUID();

export const parseCookieHeader = (cookieHeader = "") =>
  String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key) {
        return cookies;
      }

      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});

export const getSessionIdFromRequest = (req) =>
  req?.headers?.[SESSION_HEADER_NAME] ||
  parseCookieHeader(req?.headers?.cookie || "")[SESSION_COOKIE_NAME] ||
  null;
