import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getApiErrorMessage } from "../lib/apiErrors";
import { hasPermission } from "../lib/pos";

const getLoginErrorMessage = (error) => {
  if (!error?.response) {
    return "Backend server is not reachable. Start the backend and try again.";
  }

  if (error.response.status === 401) {
    return "Invalid email or password.";
  }

  return getApiErrorMessage(error);
};

export const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const user = await login(email, password);
      if (user.profile_required) navigate("/complete-profile");
      else if (user.role === "Manager") navigate("/manager");
      else if (user.role === "Waiter") navigate("/waiter");
      else if (user.role === "Chef") navigate("/chef");
      else if (hasPermission(user, "dashboard")) navigate("/dashboard");
      else if (hasPermission(user, "billing")) navigate("/billing");
      else if (hasPermission(user, "bills")) navigate("/bills");
      else navigate("/login");
    } catch (err) {
      setError(getLoginErrorMessage(err));
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
          <div className="cf-login__tagline">Point of Sale - v1.0</div>

          {error ? (
            <div
              className="cf-login-error"
              data-testid="login-error"
            >
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div className="cf-field">
              <label htmlFor="li-email">Email Address</label>
              <input
                id="li-email"
                className="cf-input"
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email"
                required
              />
            </div>

            <div className="cf-field">
              <label htmlFor="li-pass">Password</label>
              <div className="cf-password-field">
                <input
                  id="li-pass"
                  className="cf-input cf-password-field__input"
                  data-testid="login-password-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="cf-password-field__toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  title={showPassword ? "Hide password" : "Show password"}
                  type="button"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              className="cf-btn cf-btn--primary cf-btn--full cf-btn--large"
              data-testid="login-submit-button"
              disabled={loading}
              type="submit"
            >
              {loading ? "Signing In..." : "Sign In ->"}
            </button>
          </form>

          <p className="cf-login__helper">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
          <p className="cf-login__helper">Each browser tab can keep a separate staff login.</p>
        </div>
      </div>

      <div className="cf-login__right">
        <div className="cf-login__bg" />
        <div className="cf-login__grid" />
        <div className="cf-login__content">
          <div className="cf-login__title">POS</div>
          <div className="cf-login__desc">
            <strong>Billing · Products · Staff</strong>
            <br />
            Complete point-of-sale solution
            <br />
            for retail &amp; small businesses.
          </div>
        </div>
      </div>
    </div>
  );
};
