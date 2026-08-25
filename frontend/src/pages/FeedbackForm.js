import React, { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";

const API_URL = process.env.REACT_APP_BACKEND_URL;

export const FeedbackForm = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackInfo, setFeedbackInfo] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    rating: 5,
    channel: "dine_in",
    comment: "",
    customer_name: "",
    customer_phone: "",
  });

  useEffect(() => {
    const load = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/feedback/form/${token}`);
        setFeedbackInfo(response.data);
        setSubmitted(Boolean(response.data.feedback_received));
      } catch (fetchError) {
        setError(fetchError.response?.data?.detail || "Unable to open feedback form");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API_URL}/api/feedback/form/${token}`, form);
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError.response?.data?.detail || "Unable to submit feedback");
    }
  };

  if (loading) {
    return <div className="cf-feedback-page"><div className="cf-feedback-card">Loading feedback form...</div></div>;
  }

  if (error) {
    return <div className="cf-feedback-page"><div className="cf-feedback-card">{error}</div></div>;
  }

  if (submitted) {
    return (
      <div className="cf-feedback-page">
        <div className="cf-feedback-card">
          <h1>Thanks for your feedback</h1>
          <p>Your response for bill {feedbackInfo?.bill_id} has been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cf-feedback-page">
      <form className="cf-feedback-card" onSubmit={submit}>
        <div className="cf-page__overline">Customer Feedback</div>
        <h1>How was your experience?</h1>
        <p>
          Bill {feedbackInfo?.bill_id} {feedbackInfo?.outlet_name ? `at ${feedbackInfo.outlet_name}` : ""}
        </p>
        <div className="cf-field">
          <label>Rating</label>
          <select className="cf-select" value={form.rating} onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })}>
            <option value={5}>5 - Excellent</option>
            <option value={4}>4 - Good</option>
            <option value={3}>3 - Average</option>
            <option value={2}>2 - Poor</option>
            <option value={1}>1 - Very Poor</option>
          </select>
        </div>
        <div className="cf-field">
          <label>Feedback Channel</label>
          <select className="cf-select" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
            <option value="dine_in">Dine-in app</option>
            <option value="sms">SMS link</option>
          </select>
        </div>
        <div className="cf-field">
          <label>Your Name</label>
          <input className="cf-input" value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} />
        </div>
        <div className="cf-field">
          <label>Phone</label>
          <input className="cf-input" value={form.customer_phone} onChange={(event) => setForm({ ...form, customer_phone: event.target.value })} />
        </div>
        <div className="cf-field">
          <label>Comment</label>
          <textarea className="cf-textarea" value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
        </div>
        <button className="cf-btn cf-btn--primary cf-btn--full" type="submit">Submit Feedback</button>
      </form>
    </div>
  );
};
