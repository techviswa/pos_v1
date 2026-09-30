import React, { useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency } from "../lib/pos";
import { downloadCsv, formatDateTime } from "../core/staff/staffTime";

const lastMonth = () => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const emptyProfile = { pay_type: "monthly", monthly_salary: "", daily_rate: "", hourly_rate: "", basic_percent: 50, allowances: [], deductions: [],
  pf_enabled: false, esi_enabled: false, professional_tax: 0, overtime_eligible: false, pan: "", uan: "", esi_number: "", bank_name: "", bank_account: "", ifsc: "", active: true };
const LinesEditor = ({ label, value, onChange }) => (
  <div className="cf-field">
    <label>{label}</label>
    {value.map((row, index) => (
      <div key={index} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        <input aria-label={`${label} name`} className="cf-input" placeholder="Name" style={{ flex: 2 }} value={row.name} onChange={(event) => onChange(value.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))} />
        <input aria-label={`${label} amount`} className="cf-input" min="0" step="0.01" style={{ flex: 1 }} type="number" value={row.amount} onChange={(event) => onChange(value.map((entry, i) => (i === index ? { ...entry, amount: event.target.value } : entry)))} />
        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>×</button>
      </div>
    ))}
    <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => onChange([...value, { name: "", amount: "" }])}>Add line</button>
  </div>
);

/** Monthly payroll: pay profiles, payslips from attendance, adjustments, finalising and payment. */
export const Payroll = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState("runs");
  const [runs, setRuns] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [month, setMonth] = useState(lastMonth());
  const [openRunId, setOpenRunId] = useState(null);
  const [slipEdit, setSlipEdit] = useState(null);
  const [profileEdit, setProfileEdit] = useState(null);
  const [addUserId, setAddUserId] = useState("");

  const load = async () => {
    try {
      const [runsResponse, profilesResponse, settingsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/payroll/runs`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/payroll/profiles`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/payroll/settings`, { withCredentials: true, skipCache: true }),
      ]);
      setRuns(Array.isArray(apiData(runsResponse)) ? apiData(runsResponse) : []);
      setProfiles(Array.isArray(apiData(profilesResponse)) ? apiData(profilesResponse) : []);
      setSettings(apiData(settingsResponse) || null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { refreshOnFocus: true });

  const run = runs.find((entry) => entry.id === openRunId) || null;
  const act = async (request, success, failure) => {
    try {
      await request();
      toast.success(success);
      await load();
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, failure));
      return false;
    }
  };

  const createRun = () => act(async () => {
    const response = await axios.post(`${API_URL}/api/payroll/runs`, { month }, { withCredentials: true });
    setOpenRunId(apiData(response)?.id);
  }, "Payroll drafted from attendance", "Could not start the payroll");

  const saveSlip = async (event) => {
    event.preventDefault();
    const done = await act(() => axios.put(`${API_URL}/api/payroll/payslips/${slipEdit.id}`, {
      lop_days: Number(slipEdit.lop_days || 0),
      manual_lines: slipEdit.manual_lines.filter((row) => row.name && Number(row.amount)).map((row) => ({ ...row, amount: Number(row.amount) })),
    }, { withCredentials: true }), "Payslip updated", "Could not update the payslip");
    if (done) setSlipEdit(null);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    const { user_id: userId, name, ...rest } = profileEdit;
    const payload = { ...rest, allowances: rest.allowances.filter((row) => row.name).map((row) => ({ ...row, amount: Number(row.amount || 0) })),
      deductions: rest.deductions.filter((row) => row.name).map((row) => ({ ...row, amount: Number(row.amount || 0) })) };
    for (const key of ["monthly_salary", "daily_rate", "hourly_rate", "basic_percent", "professional_tax"]) payload[key] = Number(payload[key] || 0);
    if (!payload.bank_account) delete payload.bank_account;
    const done = await act(() => axios.put(`${API_URL}/api/payroll/profiles/${userId}`, payload, { withCredentials: true }), `Pay saved for ${name}`, "Could not save the pay");
    if (done) setProfileEdit(null);
  };

  const saveSettings = (event) => {
    event.preventDefault();
    act(() => axios.put(`${API_URL}/api/payroll/settings`, settings, { withCredentials: true }), "Payroll rules saved", "Could not save the rules");
  };

  const bankSheet = () => downloadCsv(`payroll-${run.label.replace(/\s/g, "-")}.csv`, [
    ["Name", "Role", "Bank", "Account (last 4)", "IFSC", "Gross", "Deductions", "Net pay", "Paid"],
    ...run.payslips.map((slip) => [slip.user_name, slip.role, slip.profile?.bank_name, slip.profile?.bank_account_last4, slip.profile?.ifsc, slip.gross, slip.total_deductions, slip.net_pay, slip.paid_at ? "yes" : "no"]),
  ]);

  const tabButton = (key, label) => (
    <button className={`cf-btn ${tab === key ? "cf-btn--primary" : "cf-btn--secondary"}`} type="button" onClick={() => setTab(key)}>{label}</button>
  );

  return (
    <Layout title="Payroll">
      <div className="cf-page" data-testid="payroll-page">
        <div className="cf-page__header">
          <div>
            <h1>Payroll</h1>
            <p>Payslips are drafted from each person's pay and the month's attendance. Adjust loss-of-pay days, bonuses, TDS or advances, then finalise: figures are frozen and staff can see their payslip on the Time Clock screen. PF, ESI and professional tax are calculated here; filing the returns is done outside this system.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {tabButton("runs", "Monthly payroll")}
          {tabButton("profiles", "Staff pay")}
          {tabButton("rules", "Rules")}
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        {tab === "runs" ? (
          <>
            <div className="cf-card cf-card--padded" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input aria-label="Month" className="cf-input" style={{ width: "auto" }} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              <button className="cf-btn cf-btn--primary" type="button" onClick={createRun}>Start payroll for this month</button>
              <span className="cf-card__meta">Only people with pay set on the Staff pay tab are included.</span>
            </div>

            <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
              {runs.length ? (
                <table className="cf-table">
                  <thead><tr><th>Month</th><th>Status</th><th>People</th><th>Gross</th><th>Net pay</th><th>Employer PF/ESI</th><th>Paid</th><th /></tr></thead>
                  <tbody>
                    {runs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.label}</td>
                        <td>{entry.status}{entry.void_reason ? <div className="cf-card__meta">{entry.void_reason}</div> : null}</td>
                        <td>{entry.totals.employees}</td>
                        <td>{formatCurrency(entry.totals.gross)}</td>
                        <td>{formatCurrency(entry.totals.net_pay)}</td>
                        <td>{formatCurrency(entry.totals.employer_contributions)}</td>
                        <td>{entry.totals.paid}/{entry.totals.employees}</td>
                        <td><button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setOpenRunId(openRunId === entry.id ? null : entry.id)}>{openRunId === entry.id ? "Hide" : "Open"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="cf-card__meta">No payroll yet.</p>}
            </div>

            {run ? (
              <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }} data-testid="payroll-run">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <strong>{run.label} · {run.status}</strong>
                  {run.status === "draft" ? (
                    <>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => act(() => axios.post(`${API_URL}/api/payroll/runs/${run.id}/refresh`, {}, { withCredentials: true }), "Recalculated from the latest attendance and pay", "Could not recalculate")}>Recalculate</button>
                      <select aria-label="Add person" className="cf-select" style={{ width: "auto" }} value={addUserId} onChange={(event) => setAddUserId(event.target.value)}>
                        <option value="">Add a person...</option>
                        {profiles.filter((row) => row.profile && !run.payslips.some((slip) => slip.user_id === row.user_id)).map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}
                      </select>
                      {addUserId ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => act(() => axios.post(`${API_URL}/api/payroll/runs/${run.id}/payslips`, { user_id: addUserId }, { withCredentials: true }).then(() => setAddUserId("")), "Added", "Could not add")}>Add</button> : null}
                      <button className="cf-btn cf-btn--primary cf-btn--small" type="button" onClick={() => {
                        if (window.confirm(`Finalise ${run.label}? Figures will be frozen and staff will see their payslips.`)) act(() => axios.post(`${API_URL}/api/payroll/runs/${run.id}/finalize`, {}, { withCredentials: true }), "Payroll finalised", "Could not finalise");
                      }}>Finalise</button>
                    </>
                  ) : null}
                  {run.status === "finalized" ? (
                    <button className="cf-btn cf-btn--primary cf-btn--small" type="button" onClick={() => {
                      const reference = window.prompt("Mark every unpaid payslip as paid by bank transfer. Batch/UTR reference (optional):", "");
                      if (reference !== null) act(() => axios.post(`${API_URL}/api/payroll/runs/${run.id}/pay`, { method: "Bank transfer", reference }, { withCredentials: true }), "Marked as paid", "Could not mark as paid");
                    }}>Mark all paid</button>
                  ) : null}
                  <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={bankSheet}>Bank sheet (CSV)</button>
                  {user?.role === "Owner" && run.status !== "void" ? (
                    <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                      const reason = window.prompt(`Void the ${run.label} payroll? Staff will no longer see these payslips. Reason:`);
                      if (reason) act(() => axios.post(`${API_URL}/api/payroll/runs/${run.id}/void`, { reason }, { withCredentials: true }), "Payroll voided", "Could not void");
                    }}>Void</button>
                  ) : null}
                </div>
                <table className="cf-table">
                  <thead><tr><th>Person</th><th>Days / LOP</th><th>Hours (OT)</th><th>Gross</th><th>Deductions</th><th>Net pay</th><th /></tr></thead>
                  <tbody>
                    {run.payslips.map((slip) => (
                      <tr key={slip.id}>
                        <td>{slip.user_name}<div className="cf-card__meta">{slip.role} · {slip.profile?.pay_type}</div>
                          {slip.profile?.open_shifts ? <span className="cf-badge cf-badge--amber">{slip.profile.open_shifts} shift(s) without clock-out</span> : null}</td>
                        <td>{slip.days_present} / {slip.lop_days}</td>
                        <td>{slip.hours_worked} ({slip.overtime_hours})</td>
                        <td>{formatCurrency(slip.gross)}</td>
                        <td>{formatCurrency(slip.total_deductions)}</td>
                        <td><b>{formatCurrency(slip.net_pay)}</b>{slip.paid_at ? <div className="cf-card__meta">paid {formatDateTime(slip.paid_at)}</div> : null}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <Link className="cf-btn cf-btn--secondary cf-btn--small" to={`/payslips/${slip.id}`}>View</Link>{" "}
                          {run.status === "draft" ? (
                            <>
                              <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setSlipEdit({ id: slip.id, name: slip.user_name, lop_days: slip.lop_days, manual_lines: slip.manual_lines })}>Adjust</button>{" "}
                              <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                                if (window.confirm(`Leave ${slip.user_name} out of this payroll?`)) act(() => axios.delete(`${API_URL}/api/payroll/payslips/${slip.id}`, { withCredentials: true }), "Removed", "Could not remove");
                              }}>Remove</button>
                            </>
                          ) : null}
                          {run.status === "finalized" && !slip.paid_at ? (
                            <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                              const reference = window.prompt(`Paid ${slip.user_name} ${formatCurrency(slip.net_pay)}. Reference (UTR/cheque, optional):`, "");
                              if (reference !== null) act(() => axios.post(`${API_URL}/api/payroll/runs/${run.id}/pay`, { payslip_ids: [slip.id], method: "Bank transfer", reference }, { withCredentials: true }), "Marked as paid", "Could not mark as paid");
                            }}>Mark paid</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {slipEdit ? (
                  <form className="cf-card cf-card--padded" onSubmit={saveSlip} style={{ display: "grid", gap: 8, marginTop: 12 }} data-testid="payslip-adjust">
                    <strong>Adjust {slipEdit.name}</strong>
                    <label className="cf-card__meta">Loss-of-pay days (unpaid absence; monthly pay only)
                      <input className="cf-input" min="0" step="0.5" type="number" value={slipEdit.lop_days} onChange={(event) => setSlipEdit({ ...slipEdit, lop_days: event.target.value })} />
                    </label>
                    {slipEdit.manual_lines.map((row, index) => (
                      <div key={index} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <select aria-label="Line type" className="cf-select" style={{ flex: "1 1 110px" }} value={row.kind} onChange={(event) => setSlipEdit({ ...slipEdit, manual_lines: slipEdit.manual_lines.map((entry, i) => (i === index ? { ...entry, kind: event.target.value } : entry)) })}>
                          <option value="earning">Earning</option><option value="deduction">Deduction</option>
                        </select>
                        <input aria-label="Line name" className="cf-input" placeholder="e.g. Bonus, TDS, Advance" style={{ flex: "2 1 150px" }} value={row.name} onChange={(event) => setSlipEdit({ ...slipEdit, manual_lines: slipEdit.manual_lines.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)) })} />
                        <input aria-label="Line amount" className="cf-input" min="0" step="0.01" style={{ flex: "1 1 90px" }} type="number" value={row.amount} onChange={(event) => setSlipEdit({ ...slipEdit, manual_lines: slipEdit.manual_lines.map((entry, i) => (i === index ? { ...entry, amount: event.target.value } : entry)) })} />
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setSlipEdit({ ...slipEdit, manual_lines: slipEdit.manual_lines.filter((_, i) => i !== index) })}>×</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setSlipEdit({ ...slipEdit, manual_lines: [...slipEdit.manual_lines, { kind: "earning", name: "", amount: "" }] })}>Add line</button>
                      <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setSlipEdit(null)}>Cancel</button>
                      <button className="cf-btn cf-btn--primary" type="submit">Save</button>
                    </div>
                  </form>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "profiles" ? (
          <div className="cf-grid-2" style={{ alignItems: "start" }}>
            <div className="cf-card cf-card--padded" style={{ overflowX: "auto" }}>
              <table className="cf-table">
                <thead><tr><th>Staff</th><th>Pay</th><th /></tr></thead>
                <tbody>
                  {profiles.map((row) => (
                    <tr key={row.user_id}>
                      <td>{row.name}<div className="cf-card__meta">{row.role}{row.active ? "" : " · inactive"}</div></td>
                      <td>{!row.profile ? "Not set" : row.profile.pay_type === "monthly" ? `${formatCurrency(row.profile.monthly_salary)}/month` : row.profile.pay_type === "daily" ? `${formatCurrency(row.profile.daily_rate)}/day` : `${formatCurrency(row.profile.hourly_rate)}/hour`}
                        {row.profile && !row.profile.active ? " · paused" : ""}</td>
                      <td><button className="cf-btn cf-btn--secondary cf-btn--small" disabled={row.user_id === user?.id && user?.role !== "Owner"} type="button"
                        onClick={() => setProfileEdit({ ...emptyProfile, ...(row.profile || {}), bank_account: "", pan: row.profile?.pan || "", uan: row.profile?.uan || "", esi_number: row.profile?.esi_number || "", ifsc: row.profile?.ifsc || "", bank_name: row.profile?.bank_name || "", user_id: row.user_id, name: row.name })}>
                        {row.profile ? "Edit" : "Set pay"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {profileEdit ? (
              <form className="cf-card cf-card--padded" onSubmit={saveProfile} style={{ display: "grid", gap: 8 }} data-testid="pay-profile-form">
                <strong>Pay for {profileEdit.name}</strong>
                <div className="cf-grid-2">
                  <label className="cf-card__meta">Paid
                    <select className="cf-select" value={profileEdit.pay_type} onChange={(event) => setProfileEdit({ ...profileEdit, pay_type: event.target.value })}>
                      <option value="monthly">Monthly salary</option><option value="daily">Per day worked</option><option value="hourly">Per hour clocked</option>
                    </select>
                  </label>
                  {profileEdit.pay_type === "monthly" ? <label className="cf-card__meta">Monthly salary (₹)<input className="cf-input" min="0" required step="0.01" type="number" value={profileEdit.monthly_salary} onChange={(event) => setProfileEdit({ ...profileEdit, monthly_salary: event.target.value })} /></label> : null}
                  {profileEdit.pay_type === "daily" ? <label className="cf-card__meta">Per day (₹)<input className="cf-input" min="0" required step="0.01" type="number" value={profileEdit.daily_rate} onChange={(event) => setProfileEdit({ ...profileEdit, daily_rate: event.target.value })} /></label> : null}
                  {profileEdit.pay_type === "hourly" ? <label className="cf-card__meta">Per hour (₹)<input className="cf-input" min="0" required step="0.01" type="number" value={profileEdit.hourly_rate} onChange={(event) => setProfileEdit({ ...profileEdit, hourly_rate: event.target.value })} /></label> : null}
                  <label className="cf-card__meta">Basic share of pay (%) for PF<input className="cf-input" max="100" min="0" type="number" value={profileEdit.basic_percent} onChange={(event) => setProfileEdit({ ...profileEdit, basic_percent: event.target.value })} /></label>
                  <label className="cf-card__meta">Professional tax per month (₹)<input className="cf-input" max="2500" min="0" type="number" value={profileEdit.professional_tax} onChange={(event) => setProfileEdit({ ...profileEdit, professional_tax: event.target.value })} /></label>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label><input checked={profileEdit.pf_enabled} type="checkbox" onChange={(event) => setProfileEdit({ ...profileEdit, pf_enabled: event.target.checked })} /> PF</label>
                  <label><input checked={profileEdit.esi_enabled} type="checkbox" onChange={(event) => setProfileEdit({ ...profileEdit, esi_enabled: event.target.checked })} /> ESI</label>
                  <label><input checked={profileEdit.overtime_eligible} type="checkbox" onChange={(event) => setProfileEdit({ ...profileEdit, overtime_eligible: event.target.checked })} /> Overtime paid</label>
                  <label><input checked={profileEdit.active} type="checkbox" onChange={(event) => setProfileEdit({ ...profileEdit, active: event.target.checked })} /> Include in payroll</label>
                </div>
                <LinesEditor label="Fixed monthly allowances" value={profileEdit.allowances} onChange={(allowances) => setProfileEdit({ ...profileEdit, allowances })} />
                <LinesEditor label="Fixed monthly deductions" value={profileEdit.deductions} onChange={(deductions) => setProfileEdit({ ...profileEdit, deductions })} />
                <div className="cf-grid-2">
                  <input aria-label="PAN" className="cf-input" maxLength={10} placeholder="PAN" value={profileEdit.pan} onChange={(event) => setProfileEdit({ ...profileEdit, pan: event.target.value.toUpperCase() })} />
                  <input aria-label="UAN" className="cf-input" inputMode="numeric" maxLength={12} placeholder="UAN (PF)" value={profileEdit.uan} onChange={(event) => setProfileEdit({ ...profileEdit, uan: event.target.value })} />
                  <input aria-label="ESI number" className="cf-input" inputMode="numeric" placeholder="ESI number" value={profileEdit.esi_number} onChange={(event) => setProfileEdit({ ...profileEdit, esi_number: event.target.value })} />
                  <input aria-label="Bank name" className="cf-input" placeholder="Bank name" value={profileEdit.bank_name} onChange={(event) => setProfileEdit({ ...profileEdit, bank_name: event.target.value })} />
                  <input aria-label="Bank account" className="cf-input" inputMode="numeric" placeholder={profileEdit.bank_account_last4 ? `Account ****${profileEdit.bank_account_last4} (type to change)` : "Bank account number"} value={profileEdit.bank_account} onChange={(event) => setProfileEdit({ ...profileEdit, bank_account: event.target.value })} />
                  <input aria-label="IFSC" className="cf-input" maxLength={11} placeholder="IFSC" value={profileEdit.ifsc} onChange={(event) => setProfileEdit({ ...profileEdit, ifsc: event.target.value.toUpperCase() })} />
                </div>
                <p className="cf-card__meta">Only the last 4 digits of the bank account are stored.</p>
                <div className="cf-dialog-actions">
                  <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setProfileEdit(null)}>Cancel</button>
                  <button className="cf-btn cf-btn--primary" type="submit">Save pay</button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "rules" && settings ? (
          <form className="cf-card cf-card--padded" onSubmit={saveSettings} style={{ display: "grid", gap: 8 }} data-testid="payroll-rules">
            <div className="cf-grid-2">
              {[["pf_employee_percent", "PF employee %"], ["pf_employer_percent", "PF employer %"], ["pf_wage_ceiling", "PF wage ceiling (₹)"],
                ["esi_employee_percent", "ESI employee %"], ["esi_employer_percent", "ESI employer %"], ["esi_gross_limit", "ESI applies up to monthly wages of (₹)"],
                ["overtime_threshold_hours", "Overtime after hours per day"], ["overtime_multiplier", "Overtime pay multiplier"]].map(([key, label]) => (
                <label className="cf-card__meta" key={key}>{label}
                  <input className="cf-input" step="any" type="number" value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.value })} />
                </label>
              ))}
            </div>
            <label><input checked={settings.pf_limit_to_ceiling} type="checkbox" onChange={(event) => setSettings({ ...settings, pf_limit_to_ceiling: event.target.checked })} /> Calculate PF on at most the wage ceiling</label>
            <label><input checked={settings.round_net_pay} type="checkbox" onChange={(event) => setSettings({ ...settings, round_net_pay: event.target.checked })} /> Round net pay to the nearest rupee</label>
            <p className="cf-card__meta">Defaults follow current EPF (12% / ₹15,000 ceiling) and ESI (0.75% / 3.25% up to ₹21,000) rates. Check them with your accountant; changes apply to payrolls calculated afterwards.</p>
            <div><button className="cf-btn cf-btn--primary" type="submit">Save rules</button></div>
          </form>
        ) : null}
      </div>
    </Layout>
  );
};

export default Payroll;
