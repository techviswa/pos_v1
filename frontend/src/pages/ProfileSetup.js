import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import { hasPermission, normalizeStaffBio } from "../lib/pos";

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

const defaultForm = {
  name: "",
  phone: "",
  bio: normalizeStaffBio(),
};

const normalizePhone = (value) => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(-10);
  return digits;
};

const sanitizeTenDigitPhoneInput = (value) => normalizePhone(value).slice(0, 10);

export const ProfileSetup = () => {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name || "",
      phone: user.phone || "",
      bio: normalizeStaffBio(user.bio),
    });
  }, [user]);

  const updateBio = (key, value) => {
    setForm((current) => ({ ...current, bio: { ...current.bio, [key]: value } }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const phoneNumbers = [
      normalizePhone(form.phone),
      normalizePhone(form.bio.emergency_contact_phone),
      normalizePhone(form.bio.emergency_contact_phone_2),
    ].filter(Boolean);
    if (normalizePhone(form.phone).length !== 10) {
      setError("Staff phone must be exactly 10 digits");
      setSaving(false);
      return;
    }
    if (normalizePhone(form.bio.emergency_contact_phone).length !== 10) {
      setError("Emergency contact phone 1 must be exactly 10 digits");
      setSaving(false);
      return;
    }
    if (normalizePhone(form.bio.emergency_contact_phone_2).length !== 10) {
      setError("Emergency contact phone 2 must be exactly 10 digits");
      setSaving(false);
      return;
    }
    if (phoneNumbers.length !== new Set(phoneNumbers).size) {
      setError("Staff phone, emergency contact 1, and emergency contact 2 must all be different");
      setSaving(false);
      return;
    }
    try {
      await axios.put(`${API_URL}/api/staff/me/profile`, form, { withCredentials: true });
      const updatedUser = await checkAuth();
      const nextUser = updatedUser || user;
      if (nextUser?.role === "Manager") navigate("/manager", { replace: true });
      else if (nextUser?.role === "Waiter") navigate("/waiter", { replace: true });
      else if (nextUser?.role === "Chef") navigate("/chef", { replace: true });
      else if (hasPermission(nextUser, "dashboard")) navigate("/dashboard", { replace: true });
      else if (hasPermission(nextUser, "billing")) navigate("/billing", { replace: true });
      else if (hasPermission(nextUser, "bills")) navigate("/bills", { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to save your profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="Complete Your Profile">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Complete Your Bio</h1>
            <p>Fill your full employee profile once before entering your portal. Owners can also review this from Staff Management.</p>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ maxWidth: 960 }}>
          <form onSubmit={handleSubmit}>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Full Name</label>
                <input className="cf-input" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="cf-field">
                <label>Role</label>
                <input className="cf-input" disabled value={user?.role || ""} />
              </div>
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Email</label>
                <input className="cf-input" disabled value={user?.email || ""} />
              </div>
              <div className="cf-field">
                <label>Phone</label>
                <input className="cf-input" inputMode="numeric" maxLength={10} required value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: sanitizeTenDigitPhoneInput(event.target.value) }))} />
              </div>
            </div>

            <div className="cf-section-title">Employee Bio</div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Employee Code</label>
                <input className="cf-input" required value={form.bio.employee_code} onChange={(event) => updateBio("employee_code", event.target.value)} />
              </div>
              <div className="cf-field">
                <label>Joining Date</label>
                <input className="cf-input" required type="date" value={form.bio.joining_date} onChange={(event) => updateBio("joining_date", event.target.value)} />
              </div>
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Date of Birth</label>
                <input className="cf-input" required type="date" value={form.bio.date_of_birth} onChange={(event) => updateBio("date_of_birth", event.target.value)} />
              </div>
              <div className="cf-field">
                <label>Gender</label>
                <select className="cf-select" required value={form.bio.gender} onChange={(event) => updateBio("gender", event.target.value)}>
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Emergency Contact Name</label>
                <input className="cf-input" required value={form.bio.emergency_contact_name} onChange={(event) => updateBio("emergency_contact_name", event.target.value)} />
              </div>
              <div className="cf-field">
                <label>Emergency Contact Phone</label>
                <input className="cf-input" inputMode="numeric" maxLength={10} required value={form.bio.emergency_contact_phone} onChange={(event) => updateBio("emergency_contact_phone", sanitizeTenDigitPhoneInput(event.target.value))} />
              </div>
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Emergency Contact Name 2</label>
                <input className="cf-input" required value={form.bio.emergency_contact_name_2} onChange={(event) => updateBio("emergency_contact_name_2", event.target.value)} />
              </div>
              <div className="cf-field">
                <label>Emergency Contact Phone 2</label>
                <input className="cf-input" inputMode="numeric" maxLength={10} required value={form.bio.emergency_contact_phone_2} onChange={(event) => updateBio("emergency_contact_phone_2", sanitizeTenDigitPhoneInput(event.target.value))} />
              </div>
            </div>

            <div className="cf-field">
              <label>Address</label>
              <textarea className="cf-textarea" required rows={3} value={form.bio.address} onChange={(event) => updateBio("address", event.target.value)} />
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Education</label>
                <input className="cf-input" value={form.bio.education} onChange={(event) => updateBio("education", event.target.value)} />
              </div>
              <div className="cf-field">
                <label>ID Number</label>
                <input className="cf-input" value={form.bio.id_number} onChange={(event) => updateBio("id_number", event.target.value)} />
              </div>
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Shift Timing</label>
                <input className="cf-input" value={form.bio.shift_timing} onChange={(event) => updateBio("shift_timing", event.target.value)} />
              </div>
              <div className="cf-field">
                <label>Notes</label>
                <input className="cf-input" value={form.bio.notes} onChange={(event) => updateBio("notes", event.target.value)} />
              </div>
            </div>

            {error ? (
              <div
                className="cf-card"
                style={{ borderColor: "var(--cf-red)", padding: "12px 14px", marginTop: 24, marginBottom: 16, color: "var(--cf-red)", fontSize: 13 }}
              >
                {error}
              </div>
            ) : null}

            <div className="cf-page__header-actions" style={{ marginTop: 24 }}>
              <button className="cf-btn cf-btn--primary" disabled={saving} type="submit">
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

