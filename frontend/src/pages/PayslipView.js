import React, { useEffect, useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { useNavigate, useParams } from "react-router-dom";
import { API_URL } from "../contexts/AuthContext";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency, getStoredUiSettings } from "../lib/pos";
import { formatDateTime } from "../core/staff/staffTime";

const cell = { padding: "4px 8px", borderBottom: "1px solid #e4e7ec", textAlign: "left" };
const money = { ...cell, textAlign: "right", whiteSpace: "nowrap" };
const mask = (value, visible = 4) => (value ? `${"*".repeat(Math.max(0, String(value).length - visible))}${String(value).slice(-visible)}` : "-");

/** A payslip laid out for printing or saving as PDF (browser print). */
export const PayslipView = () => {
  const { payslipId } = useParams();
  const navigate = useNavigate();
  const [slip, setSlip] = useState(null);
  const [error, setError] = useState("");
  const shop = getStoredUiSettings();

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}/api/payroll/payslips/${payslipId}`, { withCredentials: true })
      .then((response) => { if (!cancelled) setSlip(apiData(response) || null); })
      .catch((requestError) => { if (!cancelled) setError(getApiErrorMessage(requestError, "Payslip not found")); });
    return () => { cancelled = true; };
  }, [payslipId]);

  if (error) return <div style={{ padding: 24 }}><p>{error}</p><button className="cf-btn cf-btn--secondary" type="button" onClick={() => navigate(-1)}>Back</button></div>;
  if (!slip) return <div style={{ padding: 24 }}>Loading payslip...</div>;
  const profile = slip.profile || {};
  const rows = Math.max(slip.earnings.length, slip.deductions.length);

  return (
    <div style={{ background: "#fff", color: "#101828", minHeight: "100vh", padding: 16 }} data-testid="payslip">
      <style>{"@media print { .no-print { display: none !important; } body { background: #fff; } }"}</style>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="cf-btn cf-btn--secondary" type="button" onClick={() => navigate(-1)}>Back</button>
        <button className="cf-btn cf-btn--primary" type="button" onClick={() => window.print()}>Print / save PDF</button>
      </div>
      <div style={{ maxWidth: 760, margin: "0 auto", border: "1px solid #d0d5dd", padding: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{shop.shopName || slip.business_name}</h2>
          <div style={{ fontSize: 12 }}>{shop.address}{shop.gst ? ` · GSTIN ${shop.gst}` : ""}</div>
          <h3 style={{ margin: "10px 0 0" }}>Payslip for {slip.period_label}</h3>
          {slip.run_status !== "finalized" ? <div style={{ color: "#b54708", fontSize: 12 }}>{slip.run_status === "void" ? "VOID" : "DRAFT - not final"}</div> : null}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
          <tbody>
            <tr><td style={cell}>Name</td><td style={cell}><b>{slip.user_name}</b></td><td style={cell}>Employee code</td><td style={cell}>{profile.employee_code || "-"}</td></tr>
            <tr><td style={cell}>Role</td><td style={cell}>{slip.role || "-"}</td><td style={cell}>Joining date</td><td style={cell}>{profile.joining_date || "-"}</td></tr>
            <tr><td style={cell}>PAN</td><td style={cell}>{mask(profile.pan)}</td><td style={cell}>UAN</td><td style={cell}>{profile.uan || "-"}</td></tr>
            <tr><td style={cell}>Bank</td><td style={cell}>{profile.bank_name || "-"} {profile.bank_account_last4 ? `A/c ****${profile.bank_account_last4}` : ""}</td><td style={cell}>IFSC</td><td style={cell}>{profile.ifsc || "-"}</td></tr>
            <tr><td style={cell}>Days in month</td><td style={cell}>{slip.days_in_period}</td><td style={cell}>Days worked / loss of pay</td><td style={cell}>{slip.days_present} / {slip.lop_days}</td></tr>
            <tr><td style={cell}>Hours clocked</td><td style={cell}>{slip.hours_worked}</td><td style={cell}>Overtime hours</td><td style={cell}>{slip.overtime_hours}</td></tr>
          </tbody>
        </table>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f2f4f7" }}><th style={cell}>Earnings</th><th style={money}>Amount</th><th style={cell}>Deductions</th><th style={money}>Amount</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, index) => (
              <tr key={index}>
                <td style={cell}>{slip.earnings[index]?.name || ""}</td>
                <td style={money}>{slip.earnings[index] ? formatCurrency(slip.earnings[index].amount) : ""}</td>
                <td style={cell}>{slip.deductions[index]?.name || ""}</td>
                <td style={money}>{slip.deductions[index] ? formatCurrency(slip.deductions[index].amount) : ""}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td style={cell}>Gross earnings</td><td style={money}>{formatCurrency(slip.gross)}</td>
              <td style={cell}>Total deductions</td><td style={money}>{formatCurrency(slip.total_deductions)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 12, padding: 10, background: "#f2f4f7", fontSize: 15 }}>
          <b>Net pay: {formatCurrency(slip.net_pay)}</b>
          <div style={{ fontSize: 12 }}>{slip.net_pay_words}</div>
        </div>
        {slip.employer_contributions.length ? (
          <p style={{ fontSize: 12 }}>Employer also pays: {slip.employer_contributions.map((row) => `${row.name} ${formatCurrency(row.amount)}`).join(", ")} (not deducted from your pay).</p>
        ) : null}
        {slip.tips_paid ? <p style={{ fontSize: 12 }}>Tips paid to you separately this month: {formatCurrency(slip.tips_paid)} (not included above).</p> : null}
        <p style={{ fontSize: 12 }}>
          {slip.paid_at ? `Paid on ${formatDateTime(slip.paid_at)} by ${slip.payment_method}${slip.payment_reference ? ` (ref ${slip.payment_reference})` : ""}.` : "Not paid yet."}
          {" "}This is a computer-generated payslip.
        </p>
      </div>
    </div>
  );
};

export default PayslipView;
