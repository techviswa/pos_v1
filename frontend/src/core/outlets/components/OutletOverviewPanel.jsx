import React from "react";

import { useUi } from "../../../contexts/UiContext";
import { formatCurrency } from "../../../lib/pos";
import { useActiveOutlet } from "../store/ActiveOutletContext";

export const OutletOverviewPanel = ({
  title = "Select an outlet to continue",
  description = "Choose an outlet to load outlet-specific billing and operational data.",
}) => {
  const { settings } = useUi();
  const { outlets, selectedOutletId, setSelectedOutletId, loading } = useActiveOutlet();

  if (loading) {
    return (
      <div className="cf-card cf-card--padded">
        <div className="cf-card__title">
          <span>{title}</span>
          <span className="cf-card__meta">Loading outlet overview...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cf-card cf-card--padded">
      <div className="cf-card__title">
        <span>{title}</span>
        <span className="cf-card__meta">{description}</span>
      </div>

      <div className="cf-outlet-grid">
        {outlets.length ? (
          outlets.map((outlet) => (
            <button
              className={`cf-outlet-card ${selectedOutletId === outlet.id ? "is-active" : ""}`}
              key={outlet.id}
              onClick={() => setSelectedOutletId(outlet.id)}
              type="button"
            >
              <div className="cf-outlet-card__header">
                <div>
                  <div className="cf-outlet-card__title">{outlet.name}</div>
                  <div className="cf-outlet-card__meta">
                    {outlet.code} {outlet.location ? `· ${outlet.location}` : ""}
                  </div>
                </div>
                <span className={`cf-badge ${outlet.status === "active" ? "cf-badge--green" : "cf-badge--gray"}`}>
                  {outlet.status || "inactive"}
                </span>
              </div>

              <div className="cf-outlet-card__stats">
                <div>
                  <span>Revenue</span>
                  <strong>{formatCurrency(outlet.analytics?.total_sales || 0, settings.currency)}</strong>
                </div>
                <div>
                  <span>Bills</span>
                  <strong>{outlet.analytics?.bill_count || 0}</strong>
                </div>
                <div>
                  <span>Activity</span>
                  <strong>{outlet.analytics?.recent_activity_count || 0}</strong>
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="cf-empty-state">No outlets available for this account.</div>
        )}
      </div>
    </div>
  );
};
