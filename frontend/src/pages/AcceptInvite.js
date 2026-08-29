import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
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

export const AcceptInvite = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios
      .get(`${API_URL}/api/auth/invites/${token}`)
      .then((response) => {
        const data = response.data?.data || response.data;
        setInvite(data);
        setName(data?.email?.split("@")[0] || "");
      })
      .catch((err) => setError(getApiErrorMessage(err, "Invite not found or expired.")))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await axios.post(`${API_URL}/api/auth/invites/${token}/accept`, { name, password });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, "Invite could not be accepted."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cf-login">
      <div className="cf-login__left">
        <div className="cf-login__wrap">
          <div className="cf-login__brand">
            Cash<span>Flow</span>
          </div>
          <div className="cf-login__tagline">Staff Invite</div>

          {loading ? <div className="cf-loading">Loading invite...</div> : null}
          {error ? <div className="cf-login-error">{error}</div> : null}

          {invite ? (
            <form onSubmit={handleSubmit}>
              <div className="cf-card cf-card--padded" style={{ marginBottom: 18 }}>
                <div className="cf-section-title">Invite Details</div>
                <p>{invite.email}</p>
                <p style={{ color: "var(--cf-text-3)", margin: 0 }}>{invite.role}</p>
              </div>
              <div className="cf-field">
                <label htmlFor="invite-name">Name</label>
                <input
                  className="cf-input"
                  id="invite-name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </div>
              <div className="cf-field">
                <label htmlFor="invite-password">Password</label>
                <input
                  className="cf-input"
                  id="invite-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  type="password"
                  value={password}
                />
              </div>
              <button className="cf-btn cf-btn--primary cf-btn--full cf-btn--large" disabled={saving} type="submit">
                {saving ? "Creating Account..." : "Accept Invite"}
              </button>
            </form>
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
