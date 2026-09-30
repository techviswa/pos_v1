import React, { useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency } from "../lib/pos";
import { formatDateTime } from "../core/staff/staffTime";

const KIND_LABELS = { one_time: "One-time", birthday: "Birthday greetings", anniversary: "Anniversary greetings", winback: "Win back lapsed guests" };
const STATUS_BADGE = { sending: "cf-badge--blue", active: "cf-badge--green", completed: "cf-badge--gray", scheduled: "cf-badge--amber", cancelled: "cf-badge--gray", paused: "cf-badge--gray", draft: "cf-badge--gray" };
const SKIP_LABELS = { no_consent: "no consent", weekly_limit: "weekly limit", opted_out: "replied STOP", cancelled: "cancelled", campaign_stopped: "campaign stopped" };
const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fromClock = (value) => { const [h, m] = String(value).split(":").map(Number); return h * 60 + m; };
const emptyAudience = { tags: "", min_visits: "", min_spent: "", min_points: "", inactive_days: "", active_within_days: "", birthday_this_month: false, winback_days: "" };
const audiencePayload = (audience) => ({
  ...Object.fromEntries(Object.entries(audience).filter(([key, value]) => key !== "tags" && value !== "" && value !== false)),
  tags: String(audience.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
});
const placeholders = (channel, body) => (channel === "whatsapp"
  ? new Set([...String(body).matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1])).size
  : (String(body).match(/\{#var#\}/gi) || []).length);
const emptyTemplate = () => ({ channel: "whatsapp", name: "", whatsapp_template_name: "", language: "en", dlt_template_id: "", provider_template_id: "", body: "", variables: [] });

const AudienceFields = ({ value, onChange, kind }) => (
  <div className="cf-grid-2">
    <input aria-label="Tags" className="cf-input" placeholder="Only these tags (comma separated)" value={value.tags} onChange={(event) => onChange({ ...value, tags: event.target.value })} />
    <input aria-label="Minimum visits" className="cf-input" min="0" placeholder="At least N visits" type="number" value={value.min_visits} onChange={(event) => onChange({ ...value, min_visits: event.target.value })} />
    <input aria-label="Minimum spend" className="cf-input" min="0" placeholder="Spent at least ₹" type="number" value={value.min_spent} onChange={(event) => onChange({ ...value, min_spent: event.target.value })} />
    <input aria-label="Minimum points" className="cf-input" min="0" placeholder="Holding at least N points" type="number" value={value.min_points} onChange={(event) => onChange({ ...value, min_points: event.target.value })} />
    {kind === "winback" ? (
      <input aria-label="Days since last visit" className="cf-input" min="1" placeholder="Send N days after the last visit (default 30)" type="number" value={value.winback_days} onChange={(event) => onChange({ ...value, winback_days: event.target.value })} />
    ) : kind === "one_time" ? (
      <>
        <input aria-label="Not seen for days" className="cf-input" min="1" placeholder="Not seen for N days" type="number" value={value.inactive_days} onChange={(event) => onChange({ ...value, inactive_days: event.target.value })} />
        <input aria-label="Visited within days" className="cf-input" min="1" placeholder="Visited in the last N days" type="number" value={value.active_within_days} onChange={(event) => onChange({ ...value, active_within_days: event.target.value })} />
        <label><input checked={value.birthday_this_month} type="checkbox" onChange={(event) => onChange({ ...value, birthday_this_month: event.target.checked })} /> Birthday this month</label>
      </>
    ) : null}
  </div>
);

/** WhatsApp and SMS promotions to guests who agreed to receive them. */
export const Marketing = () => {
  const [tab, setTab] = useState("campaigns");
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [templateForm, setTemplateForm] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
  const [secrets, setSecrets] = useState({});
  const [automationForm, setAutomationForm] = useState(null);
  const [testForm, setTestForm] = useState({ template_id: "", phone: "" });

  const load = async () => {
    try {
      const [overviewResponse, campaignsResponse, templatesResponse, settingsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/marketing/overview`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/marketing/campaigns`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/marketing/templates`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/marketing/settings`, { withCredentials: true, skipCache: true }),
      ]);
      setOverview(apiData(overviewResponse) || null);
      setCampaigns(Array.isArray(apiData(campaignsResponse)) ? apiData(campaignsResponse) : []);
      setTemplates(Array.isArray(apiData(templatesResponse)) ? apiData(templatesResponse) : []);
      setSettings(apiData(settingsResponse) || null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { intervalMs: 15000, refreshOnFocus: true });

  const act = async (request, success, failure) => {
    try {
      const result = await request();
      if (success) toast.success(success);
      await load();
      return result || true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, failure));
      return false;
    }
  };
  const openReport = async (id) => {
    try {
      const response = await axios.get(`${API_URL}/api/marketing/campaigns/${id}`, { withCredentials: true, skipCache: true });
      setReport(apiData(response) || null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not open the campaign"));
    }
  };
  const runPreview = async (form) => {
    try {
      const response = await axios.post(`${API_URL}/api/marketing/preview`, { template_id: form.template_id, kind: form.kind, audience: audiencePayload(form.audience) }, { withCredentials: true });
      setPreview(apiData(response) || null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not preview"));
    }
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    const done = await act(() => axios.post(`${API_URL}/api/marketing/campaigns`, { name: draft.name, template_id: draft.template_id, kind: "one_time", audience: audiencePayload(draft.audience) }, { withCredentials: true }),
      "Campaign saved as draft. Send it now or schedule it from the list.", "Could not save the campaign");
    if (done) { setDraft(null); setPreview(null); }
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    const url = templateForm.id ? `${API_URL}/api/marketing/templates/${templateForm.id}` : `${API_URL}/api/marketing/templates`;
    const done = await act(() => axios[templateForm.id ? "put" : "post"](url, templateForm, { withCredentials: true }), "Template saved", "Could not save the template");
    if (done) setTemplateForm(null);
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const payload = {
      ...settingsForm,
      ...(secrets.whatsapp_access_token ? { whatsapp_access_token: secrets.whatsapp_access_token } : {}),
      ...(secrets.whatsapp_app_secret ? { whatsapp_app_secret: secrets.whatsapp_app_secret } : {}),
    };
    const smsSecrets = Object.fromEntries(Object.entries(secrets).filter(([key, value]) => key.startsWith("sms_") && value).map(([key, value]) => [key.slice(4), value]));
    if (Object.keys(smsSecrets).length) payload.sms_credentials = smsSecrets;
    const done = await act(() => axios.put(`${API_URL}/api/marketing/settings`, payload, { withCredentials: true }), "Marketing settings saved", "Could not save the settings");
    if (done) { setSettingsForm(null); setSecrets({}); }
  };

  const saveAutomation = async (event) => {
    event.preventDefault();
    const payload = { name: KIND_LABELS[automationForm.kind], kind: automationForm.kind, template_id: automationForm.template_id, send_hour: Number(automationForm.send_hour), audience: audiencePayload(automationForm.audience) };
    const done = await act(() => axios.post(`${API_URL}/api/marketing/campaigns`, payload, { withCredentials: true }), "Automation created (paused). Switch it on when ready.", "Could not create the automation");
    if (done) setAutomationForm(null);
  };

  const oneTime = campaigns.filter((campaign) => campaign.kind === "one_time");
  const automations = campaigns.filter((campaign) => campaign.kind !== "one_time");
  const tabButton = (key, label) => <button className={`cf-btn ${tab === key ? "cf-btn--primary" : "cf-btn--secondary"}`} type="button" onClick={() => setTab(key)}>{label}</button>;
  const templateOptions = (channelFilter) => templates.filter((template) => !channelFilter || template.channel === channelFilter)
    .map((template) => <option key={template.id} value={template.id}>{template.name} ({template.channel === "whatsapp" ? "WhatsApp" : "SMS"})</option>);
  const counts = (row) => ["queued", "sent", "delivered", "read", "failed", "skipped"].filter((key) => row.counts?.[key]).map((key) => `${key} ${row.counts[key]}`).join(" · ") || "-";

  return (
    <Layout title="Marketing">
      <div className="cf-page" data-testid="marketing-page">
        <div className="cf-page__header">
          <div>
            <h1>Marketing</h1>
            <p>
              WhatsApp and SMS offers go only to guests who agreed to receive them (tick "agrees to offers" at the till or on their profile).
              A guest replying STOP is removed at once. Messages are sent between {settings ? `${toClock(settings.send_window_start)} and ${toClock(settings.send_window_end)}` : "10:00 and 21:00"},
              at most {settings?.weekly_cap ?? 2} per person per week.
            </p>
          </div>
        </div>
        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        <div className="cf-metrics">
          <div className="cf-metric"><div className="cf-metric__label">Agreed to offers</div><div className="cf-metric__value">{overview?.opted_in ?? "-"}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Replied STOP / withdrew</div><div className="cf-metric__value">{overview?.opted_out ?? "-"}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">WhatsApp</div><div className="cf-metric__value">{overview?.whatsapp_connected ? "Connected" : "Not connected"}</div><div className="cf-metric__sub">{overview?.sent_last_30_days?.whatsapp || 0} sent in 30 days</div></div>
          <div className="cf-metric"><div className="cf-metric__label">SMS</div><div className="cf-metric__value">{overview?.sms_connected ? "Connected" : "Not connected"}</div><div className="cf-metric__sub">{overview?.sent_last_30_days?.sms || 0} sent in 30 days</div></div>
        </div>

        <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
          {tabButton("campaigns", "Campaigns")}
          {tabButton("automations", "Automations")}
          {tabButton("templates", "Templates")}
          {tabButton("settings", "Accounts & rules")}
        </div>

        {tab === "campaigns" ? (
          <>
            <div className="cf-card cf-card--padded">
              {!draft ? (
                <button className="cf-btn cf-btn--primary" disabled={!templates.length} type="button" onClick={() => { setDraft({ name: "", template_id: templates[0]?.id || "", kind: "one_time", audience: { ...emptyAudience } }); setPreview(null); }}>
                  New campaign
                </button>
              ) : (
                <form onSubmit={saveDraft} style={{ display: "grid", gap: 8 }} data-testid="campaign-form">
                  <div className="cf-grid-2">
                    <input aria-label="Campaign name" className="cf-input" placeholder="Campaign name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    <select aria-label="Template" className="cf-select" required value={draft.template_id} onChange={(event) => { setDraft({ ...draft, template_id: event.target.value }); setPreview(null); }}>{templateOptions()}</select>
                  </div>
                  <AudienceFields kind="one_time" value={draft.audience} onChange={(audience) => { setDraft({ ...draft, audience }); setPreview(null); }} />
                  {preview ? (
                    <div className="cf-card cf-card--padded" role="status">
                      <b>{preview.recipients}</b> of {preview.opted_in_customers} guests who agreed to offers match · estimated cost {formatCurrency(preview.estimated_cost)}
                      {preview.sms_segments ? ` · ${preview.sms_segments} SMS part(s) each` : ""}
                      <div className="cf-card__meta" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{preview.sample_text}</div>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="cf-btn cf-btn--secondary" type="button" onClick={() => runPreview(draft)}>Preview audience</button>
                    <button className="cf-btn cf-btn--secondary" type="button" onClick={() => { setDraft(null); setPreview(null); }}>Cancel</button>
                    <button className="cf-btn cf-btn--primary" type="submit">Save draft</button>
                  </div>
                </form>
              )}
              {!templates.length ? <p className="cf-card__meta">Add a template first (Templates tab).</p> : null}
            </div>

            <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
              {oneTime.length ? (
                <table className="cf-table">
                  <thead><tr><th>Campaign</th><th>Status</th><th>Delivery</th><th /></tr></thead>
                  <tbody>
                    {oneTime.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}<div className="cf-card__meta">{row.channel === "whatsapp" ? "WhatsApp" : "SMS"} · {row.template_name}{row.scheduled_at ? ` · ${formatDateTime(row.scheduled_at)}` : ""}</div></td>
                        <td><span className={`cf-badge ${STATUS_BADGE[row.status] || ""}`}>{row.status}</span></td>
                        <td className="cf-card__meta">{counts(row)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {["draft", "scheduled"].includes(row.status) ? (
                            <>
                              <button className="cf-btn cf-btn--primary cf-btn--small" type="button" onClick={() => {
                                if (window.confirm(`Send "${row.name}" now to everyone in its audience?`)) act(() => axios.post(`${API_URL}/api/marketing/campaigns/${row.id}/schedule`, {}, { withCredentials: true }), "Sending started", "Could not send");
                              }}>Send now</button>{" "}
                              <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                                const when = window.prompt("Send at (YYYY-MM-DD HH:MM, your local time):", "");
                                if (!when) return;
                                const at = new Date(when.replace(" ", "T"));
                                if (Number.isNaN(at.getTime())) { toast.error("Use the format YYYY-MM-DD HH:MM"); return; }
                                act(() => axios.post(`${API_URL}/api/marketing/campaigns/${row.id}/schedule`, { send_at: at.toISOString() }, { withCredentials: true }), "Campaign scheduled", "Could not schedule");
                              }}>Schedule</button>{" "}
                            </>
                          ) : null}
                          {["draft", "scheduled", "sending"].includes(row.status) ? (
                            <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                              if (window.confirm(`Cancel "${row.name}"? Messages not yet sent are dropped.`)) act(() => axios.post(`${API_URL}/api/marketing/campaigns/${row.id}/cancel`, {}, { withCredentials: true }), "Campaign cancelled", "Could not cancel");
                            }}>Cancel</button>
                          ) : null}{" "}
                          <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => openReport(row.id)}>Report</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="cf-card__meta">No campaigns yet.</p>}
            </div>
          </>
        ) : null}

        {tab === "automations" ? (
          <div className="cf-card cf-card--padded" style={{ overflowX: "auto" }}>
            <p className="cf-card__meta">Automations run every day at the chosen hour (inside the sending window): birthday and anniversary wishes on the day, and a message N days after a guest's last visit.</p>
            {automations.length ? (
              <table className="cf-table">
                <thead><tr><th>Automation</th><th>Status</th><th>Sends at</th><th>Delivery</th><th /></tr></thead>
                <tbody>
                  {automations.map((row) => (
                    <tr key={row.id}>
                      <td>{KIND_LABELS[row.kind]}<div className="cf-card__meta">{row.template_name}{row.last_run_on ? ` · last ran ${row.last_run_on}` : ""}</div></td>
                      <td><span className={`cf-badge ${STATUS_BADGE[row.status] || ""}`}>{row.status}</span></td>
                      <td>{String(row.send_hour ?? 11).padStart(2, "0")}:00</td>
                      <td className="cf-card__meta">{counts(row)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => act(() => axios.post(`${API_URL}/api/marketing/campaigns/${row.id}/automation`, { active: row.status !== "active" }, { withCredentials: true }), row.status === "active" ? "Paused" : "Switched on", "Could not update")}>
                          {row.status === "active" ? "Pause" : "Switch on"}
                        </button>{" "}
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => openReport(row.id)}>Report</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {automationForm ? (
              <form onSubmit={saveAutomation} style={{ display: "grid", gap: 8, marginTop: 12 }} data-testid="automation-form">
                <div className="cf-grid-2">
                  <select aria-label="Automation type" className="cf-select" value={automationForm.kind} onChange={(event) => setAutomationForm({ ...automationForm, kind: event.target.value })}>
                    {["birthday", "anniversary", "winback"].map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                  </select>
                  <select aria-label="Template" className="cf-select" required value={automationForm.template_id} onChange={(event) => setAutomationForm({ ...automationForm, template_id: event.target.value })}>{templateOptions()}</select>
                  <label className="cf-card__meta">Send at hour (local)
                    <input className="cf-input" max="23" min="0" type="number" value={automationForm.send_hour} onChange={(event) => setAutomationForm({ ...automationForm, send_hour: event.target.value })} />
                  </label>
                </div>
                <AudienceFields kind={automationForm.kind} value={automationForm.audience} onChange={(audience) => setAutomationForm({ ...automationForm, audience })} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setAutomationForm(null)}>Cancel</button>
                  <button className="cf-btn cf-btn--primary" type="submit">Create</button>
                </div>
              </form>
            ) : (
              <button className="cf-btn cf-btn--primary" disabled={!templates.length} style={{ marginTop: 12 }} type="button"
                onClick={() => setAutomationForm({ kind: "birthday", template_id: templates[0]?.id || "", send_hour: 11, audience: { ...emptyAudience } })}>New automation</button>
            )}
          </div>
        ) : null}

        {tab === "templates" ? (
          <div className="cf-grid-2" style={{ alignItems: "start" }}>
            <div className="cf-card cf-card--padded" style={{ overflowX: "auto" }}>
              <p className="cf-card__meta">
                WhatsApp: create and get the template approved in Meta Business Manager, then enter its exact name here with the same text ({"{{1}}"}, {"{{2}}"}...).
                SMS: register the text on your DLT portal (use {"{#var#}"} for each variable) and enter its DLT template id.
              </p>
              <table className="cf-table">
                <tbody>
                  {templates.map((template) => (
                    <tr key={template.id}>
                      <td>{template.name}<div className="cf-card__meta">{template.channel === "whatsapp" ? `WhatsApp · ${template.whatsapp_template_name} (${template.language})` : `SMS · DLT ${template.dlt_template_id}`}</div>
                        <div className="cf-card__meta" style={{ whiteSpace: "pre-wrap" }}>{template.body}</div></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setTemplateForm({ ...emptyTemplate(), ...template, whatsapp_template_name: template.whatsapp_template_name || "", dlt_template_id: template.dlt_template_id || "", provider_template_id: template.provider_template_id || "" })}>Edit</button>{" "}
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                          if (window.confirm(`Delete template "${template.name}"?`)) act(() => axios.delete(`${API_URL}/api/marketing/templates/${template.id}`, { withCredentials: true }), "Template deleted", "Could not delete");
                        }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="cf-btn cf-btn--primary" style={{ marginTop: 8 }} type="button" onClick={() => setTemplateForm(emptyTemplate())}>New template</button>
            </div>
            {templateForm ? (
              <form className="cf-card cf-card--padded" onSubmit={saveTemplate} style={{ display: "grid", gap: 8 }} data-testid="template-form">
                <div className="cf-grid-2">
                  <select aria-label="Channel" className="cf-select" disabled={Boolean(templateForm.id)} value={templateForm.channel} onChange={(event) => setTemplateForm({ ...templateForm, channel: event.target.value })}>
                    <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option>
                  </select>
                  <input aria-label="Template label" className="cf-input" placeholder="Label (for you)" required value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })} />
                  {templateForm.channel === "whatsapp" ? (
                    <>
                      <input aria-label="WhatsApp template name" className="cf-input" placeholder="Approved template name, e.g. weekend_offer" required value={templateForm.whatsapp_template_name} onChange={(event) => setTemplateForm({ ...templateForm, whatsapp_template_name: event.target.value.toLowerCase() })} />
                      <input aria-label="Language code" className="cf-input" placeholder="Language code (en, en_US, hi)" required value={templateForm.language} onChange={(event) => setTemplateForm({ ...templateForm, language: event.target.value })} />
                    </>
                  ) : (
                    <>
                      <input aria-label="DLT template id" className="cf-input" inputMode="numeric" placeholder="DLT template id" required value={templateForm.dlt_template_id} onChange={(event) => setTemplateForm({ ...templateForm, dlt_template_id: event.target.value })} />
                      <input aria-label="Provider template id" className="cf-input" placeholder="MSG91 template id (only for MSG91)" value={templateForm.provider_template_id} onChange={(event) => setTemplateForm({ ...templateForm, provider_template_id: event.target.value })} />
                    </>
                  )}
                </div>
                <textarea aria-label="Message text" className="cf-input" maxLength={1024} placeholder={templateForm.channel === "whatsapp" ? "Hi {{1}}, you have {{2}} points at {{3}}!" : "Hi {#var#}, 20% off this weekend at {#var#}. -BRAND"} required rows={4}
                  value={templateForm.body} onChange={(event) => {
                    const count = placeholders(templateForm.channel, event.target.value);
                    const variables = Array.from({ length: count }, (_, index) => templateForm.variables[index] || { source: "field", value: "first_name" });
                    setTemplateForm({ ...templateForm, body: event.target.value, variables });
                  }} />
                {templateForm.variables.map((row, index) => (
                  <div key={index} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="cf-card__meta" style={{ width: 90 }}>Placeholder {index + 1}</span>
                    <select aria-label={`Placeholder ${index + 1} source`} className="cf-select" style={{ flex: "1 1 120px" }} value={row.source}
                      onChange={(event) => setTemplateForm({ ...templateForm, variables: templateForm.variables.map((entry, i) => (i === index ? { source: event.target.value, value: event.target.value === "field" ? "first_name" : "" } : entry)) })}>
                      <option value="field">Customer detail</option><option value="text">Fixed text</option>
                    </select>
                    {row.source === "field" ? (
                      <select aria-label={`Placeholder ${index + 1} field`} className="cf-select" style={{ flex: "2 1 150px" }} value={row.value}
                        onChange={(event) => setTemplateForm({ ...templateForm, variables: templateForm.variables.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)) })}>
                        {Object.entries(overview?.fields || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    ) : (
                      <input aria-label={`Placeholder ${index + 1} text`} className="cf-input" maxLength={60} required style={{ flex: "2 1 150px" }} value={row.value}
                        onChange={(event) => setTemplateForm({ ...templateForm, variables: templateForm.variables.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)) })} />
                    )}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setTemplateForm(null)}>Cancel</button>
                  <button className="cf-btn cf-btn--primary" type="submit">Save template</button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "settings" && settings ? (
          <div className="cf-grid-2" style={{ alignItems: "start" }}>
            {!settingsForm ? (
              <div className="cf-card cf-card--padded">
                <p>WhatsApp: {settings.whatsapp_enabled ? "on" : "off"}{settings.whatsapp_phone_number_id ? ` · number ID ${settings.whatsapp_phone_number_id}` : ""}</p>
                <p>SMS: {settings.sms_enabled ? "on" : "off"}{settings.sms_provider ? ` · ${settings.sms_provider}` : ""}{settings.sms_sender_id ? ` · sender ${settings.sms_sender_id}` : ""}</p>
                <p className="cf-card__meta">Webhook for Meta (callback URL): {settings.webhooks.whatsapp_webhook} · verify token: {settings.whatsapp_verify_token}</p>
                <p className="cf-card__meta">SMS delivery reports: {settings.webhooks.sms_status}<br />SMS replies (STOP): {settings.webhooks.sms_inbound}</p>
                <button className="cf-btn cf-btn--primary" type="button" onClick={() => setSettingsForm({
                  whatsapp_enabled: settings.whatsapp_enabled, whatsapp_phone_number_id: settings.whatsapp_phone_number_id || "", whatsapp_business_account_id: settings.whatsapp_business_account_id || "",
                  sms_enabled: settings.sms_enabled, sms_provider: settings.sms_provider || "", sms_sender_id: settings.sms_sender_id || "", sms_dlt_entity_id: settings.sms_dlt_entity_id || "",
                  send_window_start: settings.send_window_start, send_window_end: settings.send_window_end, weekly_cap: settings.weekly_cap,
                  whatsapp_cost_per_message: settings.whatsapp_cost_per_message, sms_cost_per_message: settings.sms_cost_per_message,
                })}>Edit accounts &amp; rules</button>
              </div>
            ) : (
              <form className="cf-card cf-card--padded" onSubmit={saveSettings} style={{ display: "grid", gap: 8 }} data-testid="marketing-settings">
                <strong>WhatsApp Business (Meta Cloud API)</strong>
                <label><input checked={settingsForm.whatsapp_enabled} type="checkbox" onChange={(event) => setSettingsForm({ ...settingsForm, whatsapp_enabled: event.target.checked })} /> Send over WhatsApp</label>
                <div className="cf-grid-2">
                  <input aria-label="Phone number ID" className="cf-input" inputMode="numeric" placeholder="Phone number ID" value={settingsForm.whatsapp_phone_number_id} onChange={(event) => setSettingsForm({ ...settingsForm, whatsapp_phone_number_id: event.target.value })} />
                  <input aria-label="Business account ID" className="cf-input" inputMode="numeric" placeholder="WhatsApp business account ID" value={settingsForm.whatsapp_business_account_id} onChange={(event) => setSettingsForm({ ...settingsForm, whatsapp_business_account_id: event.target.value })} />
                  <input aria-label="Access token" autoComplete="off" className="cf-input" placeholder={settings.whatsapp_access_token_set ? "Access token (stored; type to replace)" : "Permanent access token"} type="password" value={secrets.whatsapp_access_token || ""} onChange={(event) => setSecrets({ ...secrets, whatsapp_access_token: event.target.value })} />
                  <input aria-label="App secret" autoComplete="off" className="cf-input" placeholder={settings.whatsapp_app_secret_set ? "App secret (stored; type to replace)" : "App secret (to verify callbacks)"} type="password" value={secrets.whatsapp_app_secret || ""} onChange={(event) => setSecrets({ ...secrets, whatsapp_app_secret: event.target.value })} />
                </div>
                <strong>SMS (DLT registered)</strong>
                <label><input checked={settingsForm.sms_enabled} type="checkbox" onChange={(event) => setSettingsForm({ ...settingsForm, sms_enabled: event.target.checked })} /> Send over SMS</label>
                <div className="cf-grid-2">
                  <select aria-label="SMS provider" className="cf-select" value={settingsForm.sms_provider} onChange={(event) => setSettingsForm({ ...settingsForm, sms_provider: event.target.value })}>
                    <option value="">Choose provider</option><option value="msg91">MSG91</option><option value="twilio">Twilio</option><option value="webhook">Other gateway (webhook)</option>
                  </select>
                  <input aria-label="Sender ID" className="cf-input" maxLength={11} placeholder="Sender ID / header (e.g. SPICER)" value={settingsForm.sms_sender_id} onChange={(event) => setSettingsForm({ ...settingsForm, sms_sender_id: event.target.value })} />
                  <input aria-label="DLT entity ID" className="cf-input" inputMode="numeric" placeholder="DLT entity (PE) ID" value={settingsForm.sms_dlt_entity_id} onChange={(event) => setSettingsForm({ ...settingsForm, sms_dlt_entity_id: event.target.value })} />
                  {settingsForm.sms_provider === "msg91" ? (
                    <input aria-label="MSG91 auth key" autoComplete="off" className="cf-input" placeholder={settings.sms_credentials_set?.auth_key ? "Auth key (stored; type to replace)" : "MSG91 auth key"} type="password" value={secrets.sms_auth_key || ""} onChange={(event) => setSecrets({ ...secrets, sms_auth_key: event.target.value })} />
                  ) : null}
                  {settingsForm.sms_provider === "twilio" ? (
                    <>
                      <input aria-label="Twilio account SID" className="cf-input" placeholder={settings.sms_credentials_set?.account_sid || "Account SID"} value={secrets.sms_account_sid || ""} onChange={(event) => setSecrets({ ...secrets, sms_account_sid: event.target.value })} />
                      <input aria-label="Twilio auth token" autoComplete="off" className="cf-input" placeholder={settings.sms_credentials_set?.auth_token ? "Auth token (stored)" : "Auth token"} type="password" value={secrets.sms_auth_token || ""} onChange={(event) => setSecrets({ ...secrets, sms_auth_token: event.target.value })} />
                      <input aria-label="Twilio from" className="cf-input" placeholder={settings.sms_credentials_set?.from || "From number or sender"} value={secrets.sms_from || ""} onChange={(event) => setSecrets({ ...secrets, sms_from: event.target.value })} />
                      <input aria-label="Messaging service SID" className="cf-input" placeholder={settings.sms_credentials_set?.messaging_service_sid || "Messaging service SID (optional)"} value={secrets.sms_messaging_service_sid || ""} onChange={(event) => setSecrets({ ...secrets, sms_messaging_service_sid: event.target.value })} />
                    </>
                  ) : null}
                  {settingsForm.sms_provider === "webhook" ? (
                    <>
                      <input aria-label="Gateway URL" className="cf-input" placeholder={settings.sms_credentials_set?.url || "https://your-gateway/send"} value={secrets.sms_url || ""} onChange={(event) => setSecrets({ ...secrets, sms_url: event.target.value })} />
                      <input aria-label="Gateway token" autoComplete="off" className="cf-input" placeholder={settings.sms_credentials_set?.token ? "Bearer token (stored)" : "Bearer token (optional)"} type="password" value={secrets.sms_token || ""} onChange={(event) => setSecrets({ ...secrets, sms_token: event.target.value })} />
                    </>
                  ) : null}
                </div>
                <strong>Rules</strong>
                <div className="cf-grid-2">
                  <label className="cf-card__meta">Send from<input className="cf-input" max="21:00" min="09:00" type="time" value={toClock(settingsForm.send_window_start)} onChange={(event) => setSettingsForm({ ...settingsForm, send_window_start: fromClock(event.target.value) })} /></label>
                  <label className="cf-card__meta">Until<input className="cf-input" max="21:00" min="09:00" type="time" value={toClock(settingsForm.send_window_end)} onChange={(event) => setSettingsForm({ ...settingsForm, send_window_end: fromClock(event.target.value) })} /></label>
                  <label className="cf-card__meta">Most messages per guest per week<input className="cf-input" max="14" min="1" type="number" value={settingsForm.weekly_cap} onChange={(event) => setSettingsForm({ ...settingsForm, weekly_cap: Number(event.target.value) })} /></label>
                  <label className="cf-card__meta">WhatsApp cost per message (₹)<input className="cf-input" min="0" step="0.01" type="number" value={settingsForm.whatsapp_cost_per_message} onChange={(event) => setSettingsForm({ ...settingsForm, whatsapp_cost_per_message: event.target.value })} /></label>
                  <label className="cf-card__meta">SMS cost per message (₹)<input className="cf-input" min="0" step="0.01" type="number" value={settingsForm.sms_cost_per_message} onChange={(event) => setSettingsForm({ ...settingsForm, sms_cost_per_message: event.target.value })} /></label>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="cf-btn cf-btn--secondary" type="button" onClick={() => { setSettingsForm(null); setSecrets({}); }}>Cancel</button>
                  <button className="cf-btn cf-btn--primary" type="submit">Save</button>
                </div>
              </form>
            )}
            <form className="cf-card cf-card--padded" onSubmit={(event) => {
              event.preventDefault();
              act(async () => { const response = await axios.post(`${API_URL}/api/marketing/test`, testForm, { withCredentials: true }); toast.success(`Sent: ${apiData(response)?.text || ""}`); }, null, "Test message failed");
            }} style={{ display: "grid", gap: 8 }} data-testid="marketing-test">
              <strong>Send a test to your phone</strong>
              <select aria-label="Test template" className="cf-select" required value={testForm.template_id} onChange={(event) => setTestForm({ ...testForm, template_id: event.target.value })}>
                <option value="">Choose template</option>{templateOptions()}
              </select>
              <input aria-label="Test phone" className="cf-input" inputMode="tel" placeholder="Your phone number" required value={testForm.phone} onChange={(event) => setTestForm({ ...testForm, phone: event.target.value })} />
              <button className="cf-btn cf-btn--secondary" type="submit">Send test</button>
            </form>
          </div>
        ) : null}

        {report ? (
          <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }} data-testid="campaign-report">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{report.name} · {report.status}</strong>
              <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setReport(null)}>Close</button>
            </div>
            <div className="cf-metrics" style={{ marginTop: 8 }}>
              {["sent", "delivered", "read", "failed", "skipped", "queued"].map((key) => (
                <div className="cf-metric" key={key}><div className="cf-metric__label">{key}</div><div className="cf-metric__value">{report.counts?.[key] || 0}</div></div>
              ))}
            </div>
            <p className="cf-card__meta">
              Estimated cost {formatCurrency(report.estimated_cost)} · {report.attribution.customers_returned} guest(s) came back within {report.attribution.window_days} days:
              {" "}{report.attribution.visits} visit(s), {formatCurrency(report.attribution.revenue)}
            </p>
            <table className="cf-table">
              <thead><tr><th>Guest</th><th>Run</th><th>Status</th><th>Sent</th></tr></thead>
              <tbody>
                {report.messages.map((row) => (
                  <tr key={row.id}>
                    <td>{row.customer_name}<div className="cf-card__meta">{row.phone}</div></td>
                    <td>{row.run === "once" ? "-" : row.run}</td>
                    <td>{row.status}{row.skip_reason ? ` (${SKIP_LABELS[row.skip_reason] || row.skip_reason})` : ""}{row.error ? <div className="cf-card__meta">{row.error}</div> : null}</td>
                    <td>{formatDateTime(row.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Marketing;
