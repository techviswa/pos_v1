import React, { useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
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

export const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    setResetToken("");
    setError("");

    try {
      const response = await axios.post(`${API_URL}/api/auth/forgot-password`, { email });
      const data = response.data?.data || response.data || {};
      setStatus("If this email exists, a password reset request has been accepted.");
      if (data.reset_token) {
        setResetToken(data.reset_token);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
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
          <div className="cf-login__tagline">Password Recovery</div>

          {error ? <div className="cf-login-error">{error}</div> : null}
          {status ? <div className="cf-login-success">{status}</div> : null}

          <form onSubmit={handleSubmit}>
            <div className="cf-field">
              <label htmlFor="forgot-email">Email Address</label>
              <input
                className="cf-input"
                id="forgot-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your account email"
                required
                type="email"
                value={email}
              />
            </div>
            <button className="cf-btn cf-btn--primary cf-btn--full cf-btn--large" disabled={loading} type="submit">
              {loading ? "Sending..." : "Request Reset"}
            </button>
          </form>

          {resetToken ? (
            <div className="cf-card cf-card--padded" style={{ marginTop: 18 }}>
              <div className="cf-section-title">Development Reset Token</div>
              <div className="cf-code-block">{resetToken}</div>
              <Link className="cf-btn cf-btn--secondary cf-btn--full" to={`/reset-password?token=${encodeURIComponent(resetToken)}`}>
                Continue to Reset
              </Link>
            </div>
          ) : null}

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
