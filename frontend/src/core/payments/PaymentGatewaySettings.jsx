import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";

/**
 * Connects the restaurant's own Razorpay account for UPI/card payments at the till. Only the Owner can change it.
 * Secrets are write-only: the server never sends them back.
 */
export const PaymentGatewaySettings = ({ apiUrl, isOwner }) => {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ key_id: "", key_secret: "", webhook_secret: "" });
  const [generated, setGenerated] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${apiUrl}/api/payments/gateway`, { withCredentials: true })
      .then((response) => {
        if (cancelled) return;
        const data = apiData(response);
        setConfig(data);
        setForm((current) => ({ ...current, key_id: data?.key_id || "" }));
      })
      .catch(() => { if (!cancelled) setHidden(true); });
    return () => { cancelled = true; };
  }, [apiUrl]);

  if (hidden || !config) return null;

  const save = async (enabled) => {
    setBusy(true);
    try {
      const payload = { key_id: form.key_id, enabled };
      if (form.key_secret) payload.key_secret = form.key_secret;
      if (form.webhook_secret) payload.webhook_secret = form.webhook_secret;
      const response = await axios.put(`${apiUrl}/api/payments/gateway`, payload, { withCredentials: true });
      setConfig(apiData(response));
      setForm((current) => ({ ...current, key_secret: "", webhook_secret: "" }));
      toast.success(enabled ? "Razorpay is on: UPI and card payments confirm automatically" : "Razorpay settings saved");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save the Razorpay settings"));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (config.webhook_secret_set && !window.confirm("Replace the webhook secret? Paste the new one into Razorpay right away, or confirmations by webhook stop until you do.")) return;
    try {
      const response = await axios.post(`${apiUrl}/api/payments/gateway/webhook-secret`, {}, { withCredentials: true });
      setGenerated(apiData(response)?.webhook_secret || "");
      setConfig((current) => ({ ...current, webhook_secret_set: true }));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not create a webhook secret"));
    }
  };

  return (
    <div className="cf-settings-card" data-testid="razorpay-settings">
      <div className="cf-settings-card__title">
        Online payments (Razorpay) {config.enabled ? <span className="cf-badge cf-badge--green">On{config.mode === "test" ? " · test mode" : ""}</span> : <span className="cf-badge cf-badge--gray">Off</span>}
      </div>
      <p className="cf-card__meta">
        With your own Razorpay account, UPI payments show a QR at the till and card payments get a payment link. They confirm by
        themselves, and refunds go straight back to the customer. Money settles into your Razorpay account.
      </p>
      <div className="cf-field">
        <label htmlFor="rzp-key-id">Key ID</label>
        <input className="cf-input" disabled={!isOwner} id="rzp-key-id" placeholder="rzp_live_..." value={form.key_id} onChange={(event) => setForm({ ...form, key_id: event.target.value.trim() })} />
      </div>
      <div className="cf-field">
        <label htmlFor="rzp-key-secret">Key Secret</label>
        <input autoComplete="off" className="cf-input" disabled={!isOwner} id="rzp-key-secret" placeholder={config.key_secret_set ? "Saved (type to replace)" : "From Razorpay: Account & Settings, API keys"} type="password" value={form.key_secret} onChange={(event) => setForm({ ...form, key_secret: event.target.value })} />
      </div>
      <div className="cf-field">
        <label>Webhook (Razorpay: Account &amp; Settings, then Webhooks)</label>
        <div className="cf-card__meta" style={{ wordBreak: "break-all" }}>URL: {config.webhook_url}</div>
        <div className="cf-card__meta">Events: {config.webhook_events.join(", ")}</div>
        {generated ? (
          <div role="status" style={{ margin: "6px 0" }}>
            <div className="cf-card__meta">Secret (copy it into Razorpay now; it is not shown again):</div>
            <div className="cf-table__mono" style={{ wordBreak: "break-all" }}>{generated}</div>
          </div>
        ) : null}
        {isOwner ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={generate}>{config.webhook_secret_set ? "Replace webhook secret" : "Create webhook secret"}</button>
            <input autoComplete="off" aria-label="Or paste your own webhook secret" className="cf-input" placeholder="…or paste the secret you set in Razorpay" style={{ flex: "1 1 180px" }} type="password" value={form.webhook_secret} onChange={(event) => setForm({ ...form, webhook_secret: event.target.value })} />
          </div>
        ) : null}
      </div>
      {isOwner ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="cf-btn cf-btn--primary" disabled={busy} type="button" onClick={() => save(true)}>{config.enabled ? "Save" : "Check keys & switch on"}</button>
          {config.enabled ? <button className="cf-btn cf-btn--secondary" disabled={busy} type="button" onClick={() => save(false)}>Switch off</button> : null}
        </div>
      ) : <p className="cf-card__meta">Only the Owner can change these settings.</p>}
    </div>
  );
};
