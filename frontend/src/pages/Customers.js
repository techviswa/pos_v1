import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency } from "../lib/pos";
import { downloadCsv, formatDateTime } from "../core/staff/staffTime";

const ENTRY_LABELS = { earn: "Earned", redeem: "Used", reverse_earn: "Taken back", reverse_redeem: "Returned", adjust: "Adjusted", expire: "Expired" };
const emptyNew = () => ({ phone: "", name: "", email: "", birthday: "", anniversary: "", marketing_opt_in: false });
const isManager = (user) => ["Owner", "Manager"].includes(user?.role);

/** Customer profiles and the loyalty programme. */
export const Customers = () => {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ search: "", sort: "recent", celebrations: "", inactive_days: "" });
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState({ points: "", reason: "" });
  const [creating, setCreating] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);

  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "")).toString();

  const load = async () => {
    try {
      const [listResponse, statsResponse, settingsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/customers/profiles?${query}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/customers/profiles/stats`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/customers/settings`, { withCredentials: true, skipCache: true }),
      ]);
      setRows(Array.isArray(apiData(listResponse)) ? apiData(listResponse) : []);
      setStats(apiData(statsResponse) || null);
      setSettings(apiData(settingsResponse) || null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { liveResources: ["bills"], refreshOnFocus: true });
  const reloadForQuery = useEffectEvent(() => load());
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (lastQueryRef.current === query) return undefined;
    lastQueryRef.current = query;
    const timer = window.setTimeout(() => reloadForQuery(), 300);
    return () => window.clearTimeout(timer);
  }, [query, reloadForQuery]);

  const open = async (id) => {
    try {
      const response = await axios.get(`${API_URL}/api/customers/profiles/${id}`, { withCredentials: true, skipCache: true });
      const data = apiData(response);
      setSelected(data);
      setEdit({ name: data.name, phone: data.phone || "", email: data.email || "", birthday: data.birthday || "", anniversary: data.anniversary || "",
        gender: data.gender || "", notes: data.notes || "", tags: (data.tags || []).join(", "), marketing_opt_in: data.marketing_opt_in });
      setAdjust({ points: "", reason: "" });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not open the customer"));
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      await axios.put(`${API_URL}/api/customers/profiles/${selected.id}`, {
        ...edit, tags: edit.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      }, { withCredentials: true });
      toast.success("Customer saved");
      await Promise.all([open(selected.id), load()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save the customer"));
    }
  };

  const saveAdjust = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API_URL}/api/customers/profiles/${selected.id}/points`, { points: Number(adjust.points), reason: adjust.reason }, { withCredentials: true });
      toast.success("Points adjusted");
      await Promise.all([open(selected.id), load()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not adjust points"));
    }
  };

  const erase = async () => {
    const reason = window.prompt(`Erase ${selected.name}'s personal data? Bills keep their amounts, points are forfeited. This cannot be undone. Reason (e.g. customer request by email):`);
    if (!reason) return;
    try {
      await axios.post(`${API_URL}/api/customers/profiles/${selected.id}/erase`, { reason }, { withCredentials: true });
      toast.success("Personal data erased");
      setSelected(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not erase the data"));
    }
  };

  const createCustomer = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/api/customers/profiles`, creating, { withCredentials: true });
      toast.success("Customer added");
      setCreating(null);
      await load();
      await open(apiData(response)?.id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not add the customer"));
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.put(`${API_URL}/api/customers/settings`, settingsForm, { withCredentials: true });
      setSettings(apiData(response));
      setSettingsForm(null);
      toast.success("Loyalty and gift card rules saved");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save the rules"));
    }
  };

  const exportCsv = () => downloadCsv("customers.csv", [
    ["Name", "Phone", "Email", "Visits", "Total spent", "Points", "Last visit", "Birthday", "Anniversary", "Tags", "Marketing consent"],
    ...rows.map((row) => [row.name, row.phone, row.email, row.visit_count, row.total_spent, row.loyalty_points, row.last_visit_at, row.birthday, row.anniversary, row.tags.join("; "), row.marketing_opt_in ? "yes" : "no"]),
  ]);

  const loyalty = settings?.loyalty;
  const setting = (group, key, value) => setSettingsForm((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));

  return (
    <Layout title="Customers">
      <div className="cf-page" data-testid="customers-page">
        <div className="cf-page__header">
          <div>
            <h1>Customers &amp; Loyalty</h1>
            <p>
              Every bill with a phone number builds the guest's profile.
              {loyalty?.enabled ? ` Guests earn ${loyalty.earn_percent}% back as points (1 point = ${formatCurrency(loyalty.point_value)}), usable for up to ${loyalty.max_redeem_percent}% of a bill${loyalty.expiry_months ? `, valid ${loyalty.expiry_months} months` : ""}.` : " The loyalty programme is switched off."}
            </p>
          </div>
          <div className="cf-page__header-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="cf-btn cf-btn--secondary" disabled={!rows.length} type="button" onClick={exportCsv}>Export CSV</button>
            {isManager(user) && settings ? <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setSettingsForm(settings)}>Programme rules</button> : null}
            <button className="cf-btn cf-btn--primary" type="button" onClick={() => setCreating(emptyNew())}>Add customer</button>
          </div>
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        <div className="cf-metrics">
          <div className="cf-metric"><div className="cf-metric__label">Customers</div><div className="cf-metric__value">{stats?.customers ?? "-"}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Came back</div><div className="cf-metric__value">{stats?.repeat_customers ?? "-"}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Points held by guests</div><div className="cf-metric__value">{stats?.outstanding_points ?? "-"}</div><div className="cf-metric__sub">worth {formatCurrency(stats?.outstanding_points_value)}</div></div>
        </div>

        {settingsForm ? (
          <form className="cf-card cf-card--padded" onSubmit={saveSettings} style={{ display: "grid", gap: 10, marginTop: 12 }} data-testid="loyalty-settings">
            <strong>Loyalty programme</strong>
            <label><input checked={settingsForm.loyalty.enabled} type="checkbox" onChange={(event) => setting("loyalty", "enabled", event.target.checked)} /> Programme is on</label>
            <div className="cf-grid-2">
              {[["earn_percent", "Points back (% of the bill before tax)"], ["point_value", "Value of 1 point (₹)"], ["min_bill_amount", "Smallest bill that earns (₹)"],
                ["min_redeem_points", "Fewest points that can be used"], ["max_redeem_percent", "Points can pay up to (% of bill)"], ["expiry_months", "Points expire after (months, 0 = never)"]].map(([key, label]) => (
                <div className="cf-field" key={key}>
                  <label htmlFor={`loyalty-${key}`}>{label}</label>
                  <input className="cf-input" id={`loyalty-${key}`} min="0" step="any" type="number" value={settingsForm.loyalty[key]} onChange={(event) => setting("loyalty", key, event.target.value)} />
                </div>
              ))}
            </div>
            <strong>Gift cards</strong>
            <div className="cf-grid-2">
              {[["expiry_months", "Valid for (months, 0 = never)"], ["min_value", "Smallest card (₹)"], ["max_value", "Largest card (₹)"]].map(([key, label]) => (
                <div className="cf-field" key={key}>
                  <label htmlFor={`gift-${key}`}>{label}</label>
                  <input className="cf-input" id={`gift-${key}`} min="0" step="any" type="number" value={settingsForm.gift_cards[key]} onChange={(event) => setting("gift_cards", key, event.target.value)} />
                </div>
              ))}
            </div>
            <p className="cf-card__meta">Points are used as a discount before GST. Gift cards are not taxed when sold; GST is charged on the bill they pay.</p>
            <div className="cf-dialog-actions">
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setSettingsForm(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary" type="submit">Save rules</button>
            </div>
          </form>
        ) : null}

        {creating ? (
          <form className="cf-card cf-card--padded" onSubmit={createCustomer} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <strong>Add a customer</strong>
            <div className="cf-grid-2">
              <input aria-label="Phone" className="cf-input" inputMode="tel" placeholder="Phone" required value={creating.phone} onChange={(event) => setCreating({ ...creating, phone: event.target.value })} />
              <input aria-label="Name" className="cf-input" placeholder="Name" required value={creating.name} onChange={(event) => setCreating({ ...creating, name: event.target.value })} />
              <input aria-label="Email" className="cf-input" placeholder="Email (optional)" type="email" value={creating.email} onChange={(event) => setCreating({ ...creating, email: event.target.value })} />
              <label className="cf-card__meta">Birthday <input className="cf-input" type="date" value={creating.birthday} onChange={(event) => setCreating({ ...creating, birthday: event.target.value })} /></label>
            </div>
            <label><input checked={creating.marketing_opt_in} type="checkbox" onChange={(event) => setCreating({ ...creating, marketing_opt_in: event.target.checked })} /> Agrees to receive offers</label>
            <div className="cf-dialog-actions">
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setCreating(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary" type="submit">Add</button>
            </div>
          </form>
        ) : null}

        <div className="cf-card cf-card--padded" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input aria-label="Search customers" className="cf-input" placeholder="Search name, phone or email" style={{ flex: "2 1 200px" }} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <select aria-label="Sort" className="cf-select" style={{ width: "auto" }} value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
            <option value="recent">Last visit</option>
            <option value="spend">Highest spend</option>
            <option value="visits">Most visits</option>
            <option value="points">Most points</option>
            <option value="name">Name</option>
          </select>
          <select aria-label="Show" className="cf-select" style={{ width: "auto" }} value={filters.celebrations || (filters.inactive_days ? `i${filters.inactive_days}` : "")}
            onChange={(event) => {
              const value = event.target.value;
              setFilters({ ...filters, celebrations: value.startsWith("c") ? value.slice(1) : "", inactive_days: value.startsWith("i") ? value.slice(1) : "" });
            }}>
            <option value="">Everyone</option>
            <option value="c7">Birthday/anniversary in 7 days</option>
            <option value="c30">Birthday/anniversary in 30 days</option>
            <option value="i30">Not seen for 30 days</option>
            <option value="i90">Not seen for 90 days</option>
          </select>
        </div>

        <div className="cf-grid-2" style={{ alignItems: "start", marginTop: 12 }}>
          <div className="cf-card cf-card--padded" style={{ overflowX: "auto" }}>
            {rows.length ? (
              <table className="cf-table">
                <thead><tr><th>Customer</th><th>Visits</th><th>Spent</th><th>Points</th><th>Last visit</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} onClick={() => open(row.id)} style={{ cursor: "pointer", background: selected?.id === row.id ? "var(--cf-surface-2, #f2f4f7)" : undefined }}>
                      <td>
                        <b>{row.name}</b><div className="cf-card__meta">{row.phone}</div>
                        {row.birthday_in_days !== null && row.birthday_in_days <= 7 ? <span className="cf-badge cf-badge--amber">Birthday {row.birthday_in_days ? `in ${row.birthday_in_days}d` : "today"}</span> : null}
                        {row.anniversary_in_days !== null && row.anniversary_in_days <= 7 ? <span className="cf-badge cf-badge--amber">Anniversary {row.anniversary_in_days ? `in ${row.anniversary_in_days}d` : "today"}</span> : null}
                      </td>
                      <td>{row.visit_count}</td>
                      <td>{formatCurrency(row.total_spent)}</td>
                      <td>{row.loyalty_points}</td>
                      <td>{formatDateTime(row.last_visit_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="cf-card__meta">No customers match.</p>}
          </div>

          {selected ? (
            <div className="cf-card cf-card--padded" data-testid="customer-profile">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <h2 style={{ margin: 0 }}>{selected.name}</h2>
                <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setSelected(null)}>Close</button>
              </div>
              <p className="cf-card__meta">
                {selected.visit_count} visits · spent {formatCurrency(selected.total_spent)} · average {formatCurrency(selected.average_spend)} · since {formatDateTime(selected.first_visit_at)}
              </p>
              <div className="cf-metrics">
                <div className="cf-metric"><div className="cf-metric__label">Points</div><div className="cf-metric__value">{selected.loyalty_points}</div>
                  {selected.next_points_expiry ? <div className="cf-metric__sub">some expire {formatDateTime(selected.next_points_expiry)}</div> : null}</div>
              </div>

              <form onSubmit={saveProfile} style={{ display: "grid", gap: 8, marginTop: 12 }}>
                <div className="cf-grid-2">
                  <input aria-label="Name" className="cf-input" required value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} />
                  <input aria-label="Phone" className="cf-input" value={edit.phone} onChange={(event) => setEdit({ ...edit, phone: event.target.value })} />
                  <input aria-label="Email" className="cf-input" placeholder="Email" type="email" value={edit.email} onChange={(event) => setEdit({ ...edit, email: event.target.value })} />
                  <select aria-label="Gender" className="cf-select" value={edit.gender} onChange={(event) => setEdit({ ...edit, gender: event.target.value })}>
                    <option value="">Gender (optional)</option><option>Female</option><option>Male</option><option>Other</option>
                  </select>
                  <label className="cf-card__meta">Birthday <input className="cf-input" type="date" value={edit.birthday} onChange={(event) => setEdit({ ...edit, birthday: event.target.value })} /></label>
                  <label className="cf-card__meta">Anniversary <input className="cf-input" type="date" value={edit.anniversary} onChange={(event) => setEdit({ ...edit, anniversary: event.target.value })} /></label>
                </div>
                <input aria-label="Tags" className="cf-input" placeholder="Tags, comma separated (e.g. VIP, vegetarian)" value={edit.tags} onChange={(event) => setEdit({ ...edit, tags: event.target.value })} />
                <textarea aria-label="Notes" className="cf-input" placeholder="Notes: preferences, allergies..." rows={2} value={edit.notes} onChange={(event) => setEdit({ ...edit, notes: event.target.value })} />
                <label><input checked={edit.marketing_opt_in} type="checkbox" onChange={(event) => setEdit({ ...edit, marketing_opt_in: event.target.checked })} /> Agrees to receive offers</label>
                <div className="cf-card__meta">
                  {selected.marketing_opt_in && selected.marketing_consent_at ? `Agreed on ${formatDateTime(selected.marketing_consent_at)}. ` : ""}
                  {!selected.marketing_opt_in && selected.marketing_opt_out_at ? `Withdrew on ${formatDateTime(selected.marketing_opt_out_at)} (e.g. replied STOP); only tick again if they ask.` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="cf-btn cf-btn--primary" type="submit">Save</button>
                  {isManager(user) ? <button className="cf-btn cf-btn--secondary" type="button" onClick={erase}>Erase personal data</button> : null}
                </div>
              </form>

              <form onSubmit={saveAdjust} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <input aria-label="Points to add or remove" className="cf-input" placeholder="+/- points" required step="1" style={{ flex: "1 1 90px" }} type="number" value={adjust.points} onChange={(event) => setAdjust({ ...adjust, points: event.target.value })} />
                <input aria-label="Reason" className="cf-input" placeholder="Reason" required style={{ flex: "2 1 150px" }} value={adjust.reason} onChange={(event) => setAdjust({ ...adjust, reason: event.target.value })} />
                <button className="cf-btn cf-btn--secondary" type="submit">Adjust points</button>
              </form>

              {selected.favourites.length ? (
                <p className="cf-card__meta" style={{ marginTop: 12 }}>Usually orders: {selected.favourites.map((item) => `${item.name} (${item.quantity})`).join(", ")}</p>
              ) : null}
              {selected.gift_cards.length ? (
                <p className="cf-card__meta">Gift cards: {selected.gift_cards.map((card) => `${card.code} ${formatCurrency(card.balance)} ${card.status}`).join(" · ")}</p>
              ) : null}

              <div className="cf-page__overline" style={{ marginTop: 12 }}>Points history</div>
              <table className="cf-table">
                <tbody>
                  {selected.loyalty_history.slice(0, 30).map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.created_at)}</td>
                      <td>{ENTRY_LABELS[entry.type] || entry.type}{entry.note ? <div className="cf-card__meta">{entry.note}{entry.created_by_name ? ` · ${entry.created_by_name}` : ""}</div> : null}</td>
                      <td style={{ color: entry.points < 0 ? "var(--cf-red)" : undefined }}>{entry.points > 0 ? `+${entry.points}` : entry.points}</td>
                      <td>{entry.balance_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="cf-page__overline" style={{ marginTop: 12 }}>Bills</div>
              <table className="cf-table">
                <tbody>
                  {selected.bills.slice(0, 30).map((bill) => (
                    <tr key={bill.id}>
                      <td>{formatDateTime(bill.created_at)}</td>
                      <td>{bill.invoice_number || bill.id}</td>
                      <td>{formatCurrency(bill.total)}</td>
                      <td>{bill.status}{bill.points_earned ? ` · +${bill.points_earned} pts` : ""}{bill.points_redeemed ? ` · -${bill.points_redeemed} pts` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
};

export default Customers;
