import React, { useState } from "react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from "recharts";
import { formatCurrency } from "../../lib/pos";
import "./salesVisuals.css";
import { fillSalesDays } from "./salesSeries";

const COLORS = ["#2563eb", "#0d9488", "#d97706", "#9333ea", "#64748b"];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const shortMoney = (value) => Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const dateLabel = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export const Ranking = ({ title, description, rows, money }) => {
  const [expanded, setExpanded] = useState(false);
  const ranked = [...rows].sort((a, b) => number(b.value) - number(a.value));
  const sorted = expanded ? ranked : ranked.slice(0, 6);
  const maximum = Math.max(...sorted.map((row) => number(row.value)), 1);
  return <article className="cf-card cf-card--padded sales-visual">
    <h3>{title}</h3><p className="sales-help">{description}</p>
    {sorted.length ? <ol className="sales-rankings">{sorted.map((row, index) => <li key={`${row.name}-${index}`}>
      <div><span>{index + 1}. {row.name}</span><strong>{money ? money(number(row.value)) : `${number(row.value)} ${number(row.value) === 1 ? 'unit' : 'units'}`}</strong></div>
      <div className="sales-track" aria-hidden="true"><span style={{ width: `${Math.max(0, number(row.value)) / maximum * 100}%` }} /></div>
    </li>)}</ol> : <p className="sales-empty">No sales recorded for this view.</p>}
    {ranked.length > 6 && <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show top 6' : `Show all ${ranked.length}`}</button>}
    {ranked.length > 0 && <p className="sales-help">Showing {sorted.length} of {ranked.length} records in this ranking.</p>}
  </article>;
};

export const SalesVisuals = ({ rows = [], hourly = [], modes = [], showServiceMix = false, products = [], outlets = [], currency, periodLabel, productBasis = "revenue", productDescription = "Top products by sales excluding tax, after refunds, for the selected period.", outletDescription = "Compare sales after refunds, including tax, for the period shown. Unassigned sales may not appear here." }) => {
  const [measure, setMeasure] = useState("sales");
  const money = (value) => formatCurrency(value, currency);
  const daily = fillSalesDays(rows);
  const total = daily.reduce((sum, row) => sum + number(row.sales), 0);
  const bills = daily.reduce((sum, row) => sum + number(row.bills), 0);
  const best = daily.reduce((winner, row) => number(row.sales) > number(winner?.sales) ? row : winner, null);
  const modeTotal = modes.reduce((sum, row) => sum + number(row.sales), 0);
  const value = (amount) => measure === "sales" ? money(amount) : `${amount} bills`;
  return <section className="sales-overview" aria-label="Sales explained">
    <div className="sales-heading"><div><h2>Understand your sales</h2><p>{periodLabel}</p></div><span className="cf-badge cf-badge--blue">Sales after refunds · tax included</span></div>
    <div className="sales-kpis">
      {[["Sales", money(total), "Invoice value after refunds. This is not profit."], ["Bills", bills, "Bills with remaining sales; voids and fully refunded bills excluded."], ["Average bill", money(bills ? total / bills : 0), "Sales divided by bills. Helps you track spend per visit."], ["Best sales day", best ? dateLabel(best.date) : "—", best ? `${money(best.sales)} in sales` : "Record sales to see your strongest day."]].map(([label, amount, help]) => <article className="cf-card cf-card--padded" key={label}><div className="sales-help">{label}</div><strong className="sales-kpi-value">{amount}</strong><p className="sales-help">{help}</p></article>)}
    </div>
    <div className="sales-charts-grid">
      <article className="cf-card cf-card--padded sales-visual">
        <div className="sales-heading"><h3>Sales over time</h3><label>Show <select className="cf-select" aria-label="Trend measure" value={measure} onChange={(event) => setMeasure(event.target.value)}><option value="sales">Sales amount</option><option value="bills">Bill count</option></select></label></div>
        <p className="sales-help">Read left to right to see how business changed. The current day is still in progress.</p>
        {bills ? <div className="sales-chart" role="img" aria-label={`${measure === "sales" ? "Sales" : "Bills"} trend. Exact values are available in the table below.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={daily} margin={{ top: 12, right: 18, bottom: 8, left: 8 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={30} /><YAxis width={65} domain={[0, "auto"]} tickFormatter={shortMoney} allowDecimals={measure === "sales"} /><Tooltip labelFormatter={dateLabel} formatter={(amount) => [value(amount), measure === "sales" ? "Sales" : "Bills"]} /><Line type="linear" dataKey={measure} stroke={COLORS[0]} strokeWidth={3} dot={daily.length < 15} activeDot={{ r: 6 }} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div> : <div className="sales-empty">No sales recorded in this period. Try another date range.</div>}
        <details><summary>View exact daily figures</summary><div className="sales-table-scroll"><table className="cf-table"><thead><tr><th>Date</th><th>Sales</th><th>Bills</th></tr></thead><tbody>{daily.map((row) => <tr key={row.date}><td>{row.date}</td><td>{money(number(row.sales))}</td><td>{number(row.bills)}</td></tr>)}</tbody></table></div></details>
      </article>
      {showServiceMix || modes.length > 0 ? <article className="cf-card cf-card--padded sales-visual"><h3>How customers order</h3><p className="sales-help">Share of sales by service. Larger slices contribute more sales.</p>
        {!modeTotal ? <div className="sales-empty"><div aria-hidden="true" style={{ width: 120, height: 120, border: "22px solid var(--cf-line)", borderRadius: "50%", margin: "0 auto 16px" }} />No sales in this period. Service shares will appear after a bill is recorded.</div> : <>
        <div className="sales-chart sales-chart--donut" role="img" aria-label="Service share of sales"><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie data={modes} dataKey="sales" nameKey="name" innerRadius="55%" outerRadius="85%" isAnimationActive={false}>{modes.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(amount) => money(amount)} /></PieChart></ResponsiveContainer></div>
        <ul className="sales-legend">{modes.map((row, index) => <li key={row.name}><span style={{ color: COLORS[index % COLORS.length] }}>●</span> {row.name}<strong>{money(row.sales)} · {modeTotal ? (row.sales / modeTotal * 100).toFixed(1) : 0}%</strong></li>)}</ul>
        </>}
      </article> : <article className="cf-card cf-card--padded sales-visual"><h3>When customers buy</h3><p className="sales-help">Sales grouped by hour across the selected period, using UTC to match the report dates. Use peaks to plan staffing.</p>
        {hourly.some((row) => number(row.sales) > 0) ? <div className="sales-chart" role="img" aria-label="Sales by hour"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourly} accessibilityLayer><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="label" minTickGap={20} /><YAxis tickFormatter={shortMoney} width={65} /><Tooltip formatter={(amount) => [money(amount), "Sales"]} /><Bar dataKey="sales" fill={COLORS[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <div className="sales-empty">Hourly sales will appear when bills are recorded.</div>}
      </article>}
      <Ranking title="What sells best" description={productDescription} rows={products} money={productBasis === "revenue" ? money : null} />
      <Ranking title="Sales by outlet" description={outletDescription} rows={outlets} money={money} />
    </div>
  </section>;
};
