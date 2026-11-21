import React, { useEffect, useState } from "react";
import axios from "axios";
import { resolveQrApiBaseUrl } from "../lib/qrUrls";
const API = resolveQrApiBaseUrl(process.env.REACT_APP_BACKEND_URL);
const unwrap = (response) => response?.data?.data ?? response?.data;

export function QrGuestFeedback({ trackingToken }) {
  const [form, setForm] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [overall, setOverall] = useState(""), [food, setFood] = useState(""), [service, setService] = useState(""), [topics, setTopics] = useState([]), [comment, setComment] = useState("");
  const endpoint = `${API}/api/public/qr/orders/${encodeURIComponent(trackingToken)}/feedback`;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { const result = unwrap(await axios.get(endpoint, { timeout: 15000, skipCache: true })); if (active) { setForm((current) => current?.already_submitted ? current : result); setError(""); } }
      catch { if (active) setError("Feedback could not be loaded. Please try again."); }
      finally { pending = false; }
    };
    load();
    const timer = window.setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [endpoint, reload]);
  const score = (label, value, set, required = false) => <label style={{ display: "block", marginBottom: 10 }}>{label}
    <select className="cf-select" value={value} required={required} onChange={(event) => set(event.target.value)}>
      <option value="">{required ? "Choose a rating" : "Optional"}</option>
      {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} / 5 — {({ 5: "Excellent", 4: "Good", 3: "Okay", 2: "Needs improvement", 1: "Poor" })[rating]}</option>)}
    </select>
  </label>;
  const submit = async (event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await axios.post(endpoint, { rating: Number(overall), food_rating: food ? Number(food) : null, service_rating: service ? Number(service) : null, topics, comment }, { timeout: 15000 });
      setForm((current) => ({ ...current, already_submitted: true }));
    } catch (failure) { setError(failure.response?.data?.error?.message || "Could not send feedback. Your text is still here; please retry."); }
    finally { setBusy(false); }
  };
  return <section className="cf-qr-cart" aria-label="Guest feedback" style={{ marginTop: 20 }}>
    <h2>How was your visit?</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></p> : null}
    {!form ? <p>Loading feedback...</p> : form.already_submitted ? <p role="status">Thank you. Your feedback has been received by the restaurant.</p> : !form.eligible ? <p>{form.message}</p> : <form onSubmit={submit}>
      <p>Share an honest review with the restaurant. All ratings are welcome; no reward depends on your score.</p>
      {score("Overall experience", overall, setOverall, true)}
      {score("Food", food, setFood)}{score("Service", service, setService)}
      <fieldset><legend>What would you like to comment on? (optional)</legend>
        {(form.topics || []).map((topic) => <label key={topic} style={{ marginRight: 12 }}><input type="checkbox" checked={topics.includes(topic)} onChange={(event) => setTopics((current) => event.target.checked ? [...current, topic] : current.filter((value) => value !== topic))} />{topic}</label>)}
      </fieldset>
      <label>Your feedback (optional)<textarea className="cf-textarea" rows={3} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <small>{comment.length}/1000. Please leave out private contact or payment details.</small>
      <button className="cf-btn cf-btn--primary" disabled={busy || !overall} type="submit">{busy ? "Sending..." : "Send feedback"}</button>
    </form>}
  </section>;
}
