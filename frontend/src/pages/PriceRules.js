import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { hasPermission } from "../lib/pos";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CHANNELS = ["Dine-In", "Takeaway", "Delivery", "QR"];
const TYPES = [
  { key: "percent_off", label: "% off" },
  { key: "amount_off", label: "Amount off" },
  { key: "fixed_price", label: "Fixed price" },
];

const emptyRule = () => ({
  name: "",
  active: true,
  discount_type: "percent_off",
  value: "",
  days_of_week: [],
  start_time: "17:00",
  end_time: "19:00",
  timezone: "Asia/Kolkata",
  channels: [],
  outlet_ids: [],
  product_ids: [],
  categories: [],
  valid_from: "",
  valid_to: "",
});

const toggle = (list, value) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
const describeValue = (rule) =>
  rule.discount_type === "percent_off" ? `${rule.value}% off` : rule.discount_type === "amount_off" ? `${rule.value} off` : `Price ${rule.value}`;
const describeWhen = (rule) => {
  const days = rule.days_of_week?.length ? rule.days_of_week.map((day) => DAYS[day]).join(", ") : "Every day";
  const hours = rule.start_time === rule.end_time ? "all day" : `${rule.start_time}–${rule.end_time}`;
  return `${days}, ${hours}`;
};

export const PriceRules = () => {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "price_rules");
  const [rules, setRules] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [ruleResponse, productResponse, outletResponse] = await Promise.all([
        axios.get(`${API_URL}/api/price-rules`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/products`, { withCredentials: true }),
        axios.get(`${API_URL}/api/outlets`, { withCredentials: true }),
      ]);
      setRules(Array.isArray(ruleResponse.data) ? ruleResponse.data : []);
      setProducts(Array.isArray(productResponse.data) ? productResponse.data : []);
      setOutlets(Array.isArray(outletResponse.data) ? outletResponse.data : outletResponse.data?.items || []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { liveResources: ["products"], refreshOnFocus: true });

  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort();

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = { ...form, value: Number(form.value), valid_from: form.valid_from || null, valid_to: form.valid_to || null };
    try {
      if (form.id) await axios.put(`${API_URL}/api/price-rules/${form.id}`, payload, { withCredentials: true });
      else await axios.post(`${API_URL}/api/price-rules`, payload, { withCredentials: true });
      toast.success("Price rule saved");
      setForm(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save the price rule"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete "${rule.name}"?`)) return;
    try {
      await axios.delete(`${API_URL}/api/price-rules/${rule.id}`, { withCredentials: true });
      toast.success("Price rule deleted");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not delete the price rule"));
    }
  };

  const setActive = async (rule, active) => {
    try {
      await axios.put(`${API_URL}/api/price-rules/${rule.id}`, { active }, { withCredentials: true });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not update the price rule"));
    }
  };

  return (
    <Layout title="Happy Hours & Price Rules">
      <div className="cf-page" data-testid="price-rules-page">
        <div className="cf-page__header">
          <div>
            <h1>Happy Hours & Price Rules</h1>
            <p>Time-based prices applied automatically at billing, on QR menus and on orders. When several rules match an item, the lowest price wins. Rules change the item's base price; paid add-ons and choices keep their own price.</p>
          </div>
          {canEdit ? (
            <div className="cf-page__header-actions">
              <button type="button" className="cf-btn cf-btn--primary" onClick={() => setForm(emptyRule())}>New rule</button>
            </div>
          ) : null}
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        {form ? (
          <form className="cf-card cf-card--padded" onSubmit={save} data-testid="price-rule-form" style={{ display: "grid", gap: 12 }}>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label htmlFor="rule-name">Name</label>
                <input id="rule-name" className="cf-input" required maxLength={80} placeholder="Evening happy hour" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div className="cf-field">
                <label htmlFor="rule-type">Discount</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select id="rule-type" className="cf-select" value={form.discount_type} onChange={(event) => setForm({ ...form, discount_type: event.target.value })}>
                    {TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
                  </select>
                  <input aria-label="Discount value" className="cf-input" required type="number" min="0" step="0.01" max={form.discount_type === "percent_off" ? 100 : undefined} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
                </div>
              </div>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>From / to (local time)</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input aria-label="Start time" className="cf-input" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} />
                  <span>to</span>
                  <input aria-label="End time" className="cf-input" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} />
                </div>
                <div className="cf-card__meta">Same start and end = all day. An end before the start runs past midnight.</div>
              </div>
              <div className="cf-field">
                <label>Days (none = every day)</label>
                <div className="cf-checkbox-row">
                  {DAYS.map((day, index) => (
                    <label key={day}><input type="checkbox" checked={form.days_of_week.includes(index)} onChange={() => setForm({ ...form, days_of_week: toggle(form.days_of_week, index) })} />{day}</label>
                  ))}
                </div>
              </div>
            </div>
            <div className="cf-field">
              <label>Channels (none = all)</label>
              <div className="cf-checkbox-row">
                {CHANNELS.map((channel) => (
                  <label key={channel}><input type="checkbox" checked={form.channels.includes(channel)} onChange={() => setForm({ ...form, channels: toggle(form.channels, channel) })} />{channel === "QR" ? "QR self-ordering" : channel}</label>
                ))}
              </div>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Outlets (none = all)</label>
                <div className="cf-checkbox-row">
                  {outlets.map((outlet) => (
                    <label key={outlet.id}><input type="checkbox" checked={form.outlet_ids.includes(outlet.id)} onChange={() => setForm({ ...form, outlet_ids: toggle(form.outlet_ids, outlet.id) })} />{outlet.name}</label>
                  ))}
                </div>
              </div>
              <div className="cf-field">
                <label>Categories</label>
                <div className="cf-checkbox-row">
                  {categories.map((category) => (
                    <label key={category}><input type="checkbox" checked={form.categories.includes(category)} onChange={() => setForm({ ...form, categories: toggle(form.categories, category) })} />{category}</label>
                  ))}
                </div>
              </div>
            </div>
            <div className="cf-field">
              <label htmlFor="rule-products">Specific items (no items and no categories = whole menu)</label>
              <select id="rule-products" className="cf-select" multiple size={Math.min(8, Math.max(3, products.length))} value={form.product_ids}
                onChange={(event) => setForm({ ...form, product_ids: [...event.target.selectedOptions].map((option) => option.value) })}>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label htmlFor="rule-from">Starts on (optional)</label>
                <input id="rule-from" className="cf-input" type="date" value={(form.valid_from || "").slice(0, 10)} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} />
              </div>
              <div className="cf-field">
                <label htmlFor="rule-to">Ends on (optional)</label>
                <input id="rule-to" className="cf-input" type="date" value={(form.valid_to || "").slice(0, 10)} onChange={(event) => setForm({ ...form, valid_to: event.target.value })} />
              </div>
            </div>
            <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active</label>
            <div className="cf-dialog-actions">
              <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="cf-btn cf-btn--primary" disabled={saving}>{saving ? "Saving..." : "Save rule"}</button>
            </div>
          </form>
        ) : null}

        <div className="cf-card cf-card--padded">
          {rules.length ? (
            <table className="cf-table">
              <thead>
                <tr><th>Rule</th><th>Discount</th><th>When</th><th>Applies to</th><th>Status</th>{canEdit ? <th /> : null}</tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.name}</td>
                    <td>{describeValue(rule)}</td>
                    <td>{describeWhen(rule)}</td>
                    <td>
                      {rule.channels.length ? rule.channels.join(", ") : "All channels"}
                      {" · "}
                      {rule.product_ids.length || rule.categories.length
                        ? [...rule.categories, ...rule.product_ids.map((id) => products.find((product) => product.id === id)?.name || "item")].join(", ")
                        : "Whole menu"}
                      {rule.outlet_ids.length ? ` · ${rule.outlet_ids.map((id) => outlets.find((outlet) => outlet.id === id)?.name || "outlet").join(", ")}` : ""}
                    </td>
                    <td>{!rule.active ? "Off" : rule.running_now ? "Running now" : "Scheduled"}</td>
                    {canEdit ? (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setForm({ ...emptyRule(), ...rule, value: String(rule.value) })}>Edit</button>{" "}
                        <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setActive(rule, !rule.active)}>{rule.active ? "Turn off" : "Turn on"}</button>{" "}
                        <button type="button" className="cf-btn cf-btn--secondary" onClick={() => remove(rule)}>Delete</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No price rules yet.{canEdit ? " Create one to run a happy hour or time-based price." : ""}</p>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default PriceRules;
