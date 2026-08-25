import React from "react";
import { FulfillmentModeSelector } from "../components/FulfillmentModeSelector";
import { FulfillmentDetailsFields } from "../components/FulfillmentDetailsFields";
import { FulfillmentTablePanel } from "../components/FulfillmentTablePanel";

export const BillingFulfillmentSection = ({
  orderMeta,
  changeFulfillmentMode,
  setOrderMeta,
  billingErrors,
  clearBillingError,
  todayDateValue,
  onSendWhatsApp,
  suggestedTokenNumber,
  sectionRef,
  tableBusy,
  canManageTables,
  tableItems,
  areaItems,
  reservationItems,
  qrOrderingEnabled,
  onSelectTable,
  onReserveTable,
  onUndoReservation,
  onDeleteReservation,
  onCreateTable,
  onUpdateTable,
  onDeleteTable,
  onUpsertTableQrCode,
  onCreateArea,
  onUpdateArea,
  onDeleteArea,
}) => (
  <div className="cf-quick-order-grid" ref={sectionRef}>
    <div style={{ display: "grid", gap: 16 }}>
      <FulfillmentModeSelector onChange={changeFulfillmentMode} value={orderMeta.fulfillment_mode} />
      <FulfillmentDetailsFields
        billingErrors={billingErrors}
        clearBillingError={clearBillingError}
        onSendWhatsApp={onSendWhatsApp}
        orderMeta={orderMeta}
        setOrderMeta={setOrderMeta}
        suggestedTokenNumber={suggestedTokenNumber}
        todayDateValue={todayDateValue}
      />
    </div>
    {orderMeta.fulfillment_mode === "TABLE" ? (
      <FulfillmentTablePanel
        busy={tableBusy}
        canManageTables={canManageTables}
        areaItems={areaItems}
        onCreateArea={onCreateArea}
        onCreateTable={onCreateTable}
        onDeleteArea={onDeleteArea}
        onDeleteTable={onDeleteTable}
        onUpsertTableQrCode={onUpsertTableQrCode}
        onReserveTable={onReserveTable}
        onSelectTable={onSelectTable}
        onDeleteReservation={onDeleteReservation}
        onUndoReservation={onUndoReservation}
        onUpdateArea={onUpdateArea}
        onUpdateTable={onUpdateTable}
        orderMeta={orderMeta}
        reservationItems={reservationItems}
        tableItems={tableItems}
        qrOrderingEnabled={qrOrderingEnabled}
      />
    ) : (
      <div className="cf-card cf-card--padded">
        <div className="cf-card__title">
          <span>
            {orderMeta.fulfillment_mode === "TOKEN"
              ? "Token Queue"
              : orderMeta.fulfillment_mode === "PICKUP"
                ? "Pickup Handover"
                : "Delivery Dispatch"}
          </span>
          <span className="cf-card__meta">
            {orderMeta.fulfillment_mode === "TOKEN"
              ? "Counter token flow stays available."
              : orderMeta.fulfillment_mode === "PICKUP"
                ? "Scheduled handover flow is active."
                : "Dispatch flow keeps customer notes in the bill."}
          </span>
        </div>
        <div className="cf-card__meta" style={{ marginTop: 10 }}>
          {orderMeta.fulfillment_mode === "TOKEN"
            ? "Use the suggested token number to call the customer at the counter."
            : orderMeta.fulfillment_mode === "PICKUP"
              ? "Pickup orders stay scheduled for later collection."
              : "Delivery orders skip in-store handover while keeping customer notes in the bill."}
        </div>
      </div>
    )}
  </div>
);
