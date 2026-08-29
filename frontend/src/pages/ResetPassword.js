import React, { useState } from "react";
import axios from "axios";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../lib/apiErrors";

const API_URL = (() => {
  const configured = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (typeof window === "undefined") return configured;

  const currentOrigin = window.location.origin.replace(/\/+$/, "");
  const currentHost = window.location.hostname;
  if (configured && configured !== currentOrigin && !configured.includes("vercel.app")) {
    return configured;
  }

  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    return configured || "http://localhost:4001";
  }

  return "https://pos-v1-fwjm.onrender.com";
})();

export const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await axios.post(`${API_URL}/api/auth/reset-password`, { token, password });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, "Invalid or expired reset token."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cf-login">
      <div className="cf-login__left">
        <div className="cf-login__wrap">
          <div className="cf-login__brand">
            Cash<span>Flow</span>
          </div>
          <div className="cf-login__tagline">Set New Password</div>

          {error ? <div className="cf-login-error">{error}</div> : null}

          <form onSubmit={handleSubmit}>
            <div className="cf-field">
              <label htmlFor="reset-token">Reset Token</label>
              <input
                className="cf-input"
                id="reset-token"
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste reset token"
                required
                value={token}
              />
            </div>
            <div className="cf-field">
              <label htmlFor="reset-password">New Password</label>
              <input
                className="cf-input"
                id="reset-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                required
                type="password"
                value={password}
              />
            </div>
            <button className="cf-btn cf-btn--primary cf-btn--full cf-btn--large" disabled={loading} type="submit">
              {loading ? "Saving..." : "Reset Password"}
            </button>
          </form>

          <p className="cf-login__helper">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
      <div className="cf-login__right">
        <div className="cf-login__bg" />
        <div className="cf-login__grid" />
      </div>
    </div>
  );
};
