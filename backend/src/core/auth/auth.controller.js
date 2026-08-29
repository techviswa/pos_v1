import { createHttpError } from "../../shared/utils/http-error.js";
import { apiResponse } from "../../shared/utils/apiResponse.js";
import { authService } from "./auth.service.js";
import {
  getSessionIdFromRequest,
  SESSION_COOKIE_NAME,
  getSessionCookieOptions,
} from "./auth-session.js";

class AuthController {
  async login(req, res) {
    const data = await authService.login({
      email: req.body?.email,
      password: req.body?.password,
    });

    if (!data) {
      throw createHttpError({ statusCode: 401, message: "Invalid email or password" });
    }

    res.cookie(SESSION_COOKIE_NAME, data.sessionId, getSessionCookieOptions());
    res.status(200).json(
      apiResponse({
        message: "Login successful",
        data: {
          user: data.user,
          session_id: data.sessionId,
        },
      }),
    );
  }

  async me(req, res) {
    const data = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });
    if (!data) {
      res.status(200).json(apiResponse({ message: "No authenticated user", data: null }));
      return;
    }
    res.status(200).json(apiResponse({ message: "Authenticated user fetched successfully", data }));
  }

  async refresh(req, res) {
    const data = await authService.refreshSession({
      sessionId: getSessionIdFromRequest(req),
    });
    if (!data) {
      throw createHttpError({ statusCode: 401, message: "Authentication required" });
    }
    res.cookie(SESSION_COOKIE_NAME, getSessionIdFromRequest(req), getSessionCookieOptions());
    res.status(200).json(apiResponse({ message: "Session refreshed successfully", data }));
  }

  async session(req, res) {
    const data = await authService.getSessionInfo({
      sessionId: getSessionIdFromRequest(req),
    });
    res.status(200).json(apiResponse({ message: "Session fetched successfully", data }));
  }

  async logout(req, res) {
    const data = await authService.logout({
      sessionId: getSessionIdFromRequest(req),
    });
    res.clearCookie(SESSION_COOKIE_NAME, {
      ...getSessionCookieOptions(),
      maxAge: undefined,
    });
    res.status(200).json(apiResponse({ message: "Logout successful", data }));
  }

  async forgotPassword(req, res) {
    const data = await authService.requestPasswordReset({
      email: req.body?.email,
    });
    res.status(202).json(apiResponse({ message: "Password reset request accepted", data }));
  }

  async resetPassword(req, res) {
    const data = await authService.resetPassword({
      token: req.body?.token,
      password: req.body?.password,
    });

    if (!data) {
      throw createHttpError({ statusCode: 400, message: "Invalid or expired reset token" });
    }

    res.status(200).json(apiResponse({ message: "Password reset successfully", data }));
  }

  async createInvite(req, res) {
    const data = await authService.createInvite({
      businessId: req.context.businessId,
      email: req.body?.email,
      role: req.body?.role,
      invitedBy: req.user?.id,
    });

    if (!data) {
      throw createHttpError({ statusCode: 400, message: "Valid invite email is required" });
    }

    res.status(201).json(apiResponse({ message: "Invite created successfully", data }));
  }

  async getInvite(req, res) {
    const data = await authService.getInvite({
      token: req.params.token,
    });

    if (!data) {
      throw createHttpError({ statusCode: 404, message: "Invite not found or expired" });
    }

    res.status(200).json(apiResponse({ message: "Invite fetched successfully", data }));
  }

  async acceptInvite(req, res) {
    const data = await authService.acceptInvite({
      token: req.params.token,
      name: req.body?.name,
      password: req.body?.password,
    });

    if (!data) {
      throw createHttpError({ statusCode: 400, message: "Invalid or expired invite" });
    }

    res.status(201).json(apiResponse({ message: "Invite accepted successfully", data }));
  }
}

export const authController = new AuthController();
