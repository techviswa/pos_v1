import React from "react";
import { PERIOD_PRESETS } from "./staffTime";

/** Preset periods plus a custom date range. `value` is { preset, fromDate, toDate }. */
export const PeriodPicker = ({ value, onChange }) => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
    <select aria-label="Period" className="cf-select" style={{ width: "auto" }} value={value.preset} onChange={(event) => onChange({ ...value, preset: event.target.value })}>
      {PERIOD_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
    </select>
    {value.preset === "custom" ? (
      <>
        <input aria-label="From date" className="cf-input" style={{ width: "auto" }} type="date" value={value.fromDate} onChange={(event) => onChange({ ...value, fromDate: event.target.value })} />
        <span>to</span>
        <input aria-label="To date" className="cf-input" style={{ width: "auto" }} type="date" value={value.toDate} onChange={(event) => onChange({ ...value, toDate: event.target.value })} />
      </>
    ) : null}
  </div>
);
