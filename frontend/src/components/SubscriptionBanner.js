import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { apiData } from "../lib/apiData";

const MESSAGES = {
  past_due: "Your Taskoora payment did not go through. Everything still works while it is retried.",
  expired: "Your Taskoora plan has expired. Your data is safe and viewable, but new bills and changes are paused.",
  cancelled: "Your Taskoora plan is cancelled. Your data is safe and viewable, but new bills and changes are paused.",
};

/** Tells the Owner (and Managers) when the Taskoora plan needs paying. Checked once per page load. */
export const SubscriptionBanner = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const canSee = ["Owner", "Manager"].includes(user?.role) && !user?.offline;

  useEffect(() => {
    if (!canSee) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/api/saas/me`, { withCredentials: true })
      .then((response) => { if (!cancelled) setStatus(apiData(response)?.subscription?.status || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canSee]);

  if (!canSee || !MESSAGES[status]) return null;
  return (
    <div role="alert" data-testid="subscription-banner" style={{ background: "#fef3f2", color: "#b42318", padding: "8px 16px", fontSize: 13 }}>
      {MESSAGES[status]}{" "}
      {user.role === "Owner" ? <Link to="/plan" style={{ fontWeight: 600 }}>Pay now</Link> : "Ask the Owner to pay on the Plan & Billing screen."}
    </div>
  );
};
