import React from "react";
import { sanitizeTenDigitPhoneInput } from "../utils/fulfillmentMode";

export const FulfillmentDetailsFields = ({
  orderMeta,
  setOrderMeta,
  billingErrors,
  clearBillingError,
  todayDateValue,
  onSendWhatsApp,
  suggestedTokenNumber,
  hasServiceChoice = true,
}) => {
  const updateField = (field, value, clearErrorField) => {
    if (clearErrorField) clearBillingError(clearErrorField);
    setOrderMeta((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="cf-card cf-card--padded">
      <div className="cf-card__title">
        <span>Customer & handover details</span>
        <span className="cf-card__meta">{hasServiceChoice ? "Select the service, then complete the order details." : "Enter customer and handover details to prepare the bill."}</span>
      </div>
      {billingErrors.form ? <div className="cf-card" style={{ borderColor: "var(--cf-red)", padding: "12px 14px", marginBottom: 16, color: "var(--cf-red)", fontSize: 13 }}>{billingErrors.form}</div> : null}
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Customer Name</label>
          <input className="cf-input" onChange={(event) => updateField("customer_name", event.target.value, "customer_name")} style={billingErrors.customer_name ? { borderColor: "var(--cf-red)" } : undefined} value={orderMeta.customer_name} />
          {billingErrors.customer_name ? <div style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>{billingErrors.customer_name}</div> : null}
        </div>
        <div className="cf-field">
          <label>Phone</label>
          <input className="cf-input" inputMode="numeric" maxLength={10} onChange={(event) => updateField("customer_phone", sanitizeTenDigitPhoneInput(event.target.value), "customer_phone")} style={billingErrors.customer_phone ? { borderColor: "var(--cf-red)" } : undefined} value={orderMeta.customer_phone} />
          {billingErrors.customer_phone ? <div style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>{billingErrors.customer_phone}</div> : null}
        </div>
      </div>

      {orderMeta.fulfillment_mode === "TABLE" ? (
        <div className="cf-grid-2">
          <div className="cf-field">
            <label>Selected Table</label>
            <input className="cf-input" readOnly value={orderMeta.table_label || "Select a table below"} />
            {billingErrors.table_id ? <div style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>{billingErrors.table_id}</div> : null}
          </div>
          <div className="cf-field">
            <label>Guests</label>
            <input
              className="cf-input"
              min="1"
              onChange={(event) => updateField("guests_count", event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              placeholder="2"
              type="number"
              value={orderMeta.guests_count}
            />
          </div>
        </div>
      ) : null}

      {orderMeta.fulfillment_mode === "TOKEN" ? (
        <div className="cf-field">
          <label>Token Number</label>
          <input className="cf-input" inputMode="numeric" onChange={(event) => updateField("token_number", event.target.value.replace(/[^\d]/g, "").slice(0, 4), "token_number")} placeholder={suggestedTokenNumber} value={orderMeta.token_number} />
          {billingErrors.token_number ? <div style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>{billingErrors.token_number}</div> : null}
          <div className="cf-card__meta" style={{ marginTop: 6 }}>Leave it as suggested for the next counter token, or override it manually.</div>
        </div>
      ) : null}

      {orderMeta.fulfillment_mode === "PICKUP" ? (
        <div className="cf-field">
          <label>Pickup Slot</label>
          <div className="cf-grid-2" style={{ gridTemplateColumns: "1.2fr 0.9fr 0.7fr" }}>
            <input className="cf-input" min={todayDateValue()} onChange={(event) => updateField("pickup_date", event.target.value)} type="date" value={orderMeta.pickup_date} />
            <input className="cf-input" onChange={(event) => updateField("pickup_time", event.target.value)} placeholder="07:30" value={orderMeta.pickup_time} />
            <div className="cf-switch-row">
              <button className={`cf-switch-pill ${orderMeta.pickup_meridiem === "AM" ? "is-active" : ""}`} onClick={() => updateField("pickup_meridiem", "AM")} type="button">AM</button>
              <button className={`cf-switch-pill ${orderMeta.pickup_meridiem === "PM" ? "is-active" : ""}`} onClick={() => updateField("pickup_meridiem", "PM")} type="button">PM</button>
            </div>
          </div>
          {billingErrors.pickup_slot ? <div style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>{billingErrors.pickup_slot}</div> : null}
          <div className="cf-card__meta" style={{ marginTop: 6 }}>Pickup orders stay in takeaway pricing but carry a scheduled handover time.</div>
        </div>
      ) : null}

      {orderMeta.fulfillment_mode === "DELIVERY" ? (
        <div className="cf-field">
          <label htmlFor="delivery-address">Delivery address *</label>
          <textarea id="delivery-address" className="cf-textarea" autoComplete="street-address" maxLength={1000} value={orderMeta.delivery_address || ""} onChange={(event) => updateField("delivery_address", event.target.value, "delivery_address")} placeholder="House / building, street, area and postal code" aria-invalid={Boolean(billingErrors.delivery_address)} aria-describedby={billingErrors.delivery_address ? "delivery-address-error" : undefined} />
          {billingErrors.delivery_address ? <div id="delivery-address-error" role="alert" style={{ color: "var(--cf-red)", fontSize: 12 }}>{billingErrors.delivery_address}</div> : null}
        </div>
      ) : null}
      <div className="cf-field">
        <label>Order Notes</label>
        <textarea className="cf-textarea" onChange={(event) => updateField("notes", event.target.value)} placeholder="Packing note, gate number, birthday message..." value={orderMeta.notes} />
      </div>
      <div className="cf-feedback-box__actions">
        <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={onSendWhatsApp} type="button">Send WhatsApp</button>
      </div>
    </div>
  );
};
