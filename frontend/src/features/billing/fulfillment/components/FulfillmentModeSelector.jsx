import React from "react";
import { FULFILLMENT_MODES } from "../utils/fulfillmentMode";

export const FulfillmentModeSelector = ({ value, onChange, allowedModes }) => {
  const modes = FULFILLMENT_MODES.filter(mode => allowedModes?.[mode.key] === true);
  if (modes.length < 2) return null;
  return <div className="cf-billing-services" role="group" aria-label="Order service">
    {modes.map((mode) => {
      const active = value === mode.key;
      return (
        <button
          key={mode.key}
          aria-pressed={active}
          title={mode.description}
          className={`cf-btn cf-btn--small ${active ? "cf-btn--primary" : "cf-btn--secondary"}`}
          onClick={() => onChange(mode.key)}
          type="button"
        >
          {mode.label}
        </button>
      );
    })}
  </div>;
};
