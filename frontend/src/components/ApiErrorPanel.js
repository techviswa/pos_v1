import React from "react";
import { getApiErrorDetails } from "../lib/apiErrors";

export const ApiErrorPanel = ({
  error,
  title,
  message,
  action,
  onRetry,
  onBack,
  compact = false,
}) => {
  const details = error ? getApiErrorDetails(error, message) : {};
  const displayTitle = title || details.title || "Unable to load";
  const displayMessage = message || details.message || "This screen could not load data.";
  const displayAction = action ?? details.action;

  return (
    <div className={`cf-api-error ${compact ? "cf-api-error--compact" : ""}`} role="alert">
      <div className="cf-api-error__eyebrow">
        {details.status ? `Error ${details.status}` : "Connection"}
      </div>
      <h2>{displayTitle}</h2>
      <p>{displayMessage}</p>
      {displayAction ? <div className="cf-api-error__hint">{displayAction}</div> : null}
      <div className="cf-api-error__actions">
        {onBack ? (
          <button className="cf-btn cf-btn--secondary" onClick={onBack} type="button">
            Go Back
          </button>
        ) : null}
        {onRetry ? (
          <button className="cf-btn cf-btn--primary" onClick={onRetry} type="button">
            Try Again
          </button>
        ) : null}
      </div>
    </div>
  );
};
