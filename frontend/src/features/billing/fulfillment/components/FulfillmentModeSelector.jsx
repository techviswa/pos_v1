import React from "react";
import { FULFILLMENT_MODES } from "../utils/fulfillmentMode";

export const FulfillmentModeSelector = ({ value, onChange }) => (
  <div className="cf-grid-2" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
    {FULFILLMENT_MODES.map((mode) => {
      const active = value === mode.key;
      return (
        <button
          key={mode.key}
          className="cf-card"
          onClick={() => onChange(mode.key)}
          style={{
            padding: "12px 14px",
            textAlign: "left",
            borderColor: active ? "var(--cf-accent)" : "var(--cf-line)",
            background: active ? "rgba(0, 45, 245, 0.06)" : "var(--cf-panel)",
          }}
          type="button"
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>{mode.label}</div>
        </button>
      );
    })}
  </div>
);
