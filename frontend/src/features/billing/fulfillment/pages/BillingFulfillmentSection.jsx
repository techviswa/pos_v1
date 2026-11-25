import React from "react";
import { FulfillmentModeSelector } from "../components/FulfillmentModeSelector";
import { FulfillmentDetailsFields } from "../components/FulfillmentDetailsFields";
import { FulfillmentTablePanel } from "../components/FulfillmentTablePanel";
import { buildScheduledDateTime, getTrackingLine, FULFILLMENT_MODES } from "../utils/fulfillmentMode";

export const BillingFulfillmentSection = ({
  orderMeta,
  allowedModes,
  hasCartItems = false,
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
  outletItems,
  activeOutletId,
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
}) => {
  const modes = FULFILLMENT_MODES.filter(mode => allowedModes?.[mode.key] === true);
  if (!allowedModes) return <p role="status">Loading order setup…</p>;
  if (!modes.length) return <p role="alert">Ordering is currently unavailable for this business. Contact your administrator.</p>;
  if (!allowedModes[orderMeta.fulfillment_mode]) return <div ref={sectionRef}>
    {!hasCartItems ? <p role="status">Preparing order setup…</p> : <>
      <p role="alert">The available order setup has changed. Review it before continuing. Your cart has been kept.</p>
      {modes.length === 1
        ? <button className="cf-btn cf-btn--secondary" type="button" onClick={() => changeFulfillmentMode(modes[0].key)}>Update order setup</button>
        : <FulfillmentModeSelector onChange={changeFulfillmentMode} value={orderMeta.fulfillment_mode} allowedModes={allowedModes} />}
    </>}
  </div>;
  return (
  <div className="cf-quick-order-grid" ref={sectionRef}>
    <div style={{ display: "grid", gap: 16 }}>
      <FulfillmentModeSelector onChange={changeFulfillmentMode} value={orderMeta.fulfillment_mode} allowedModes={allowedModes} />
      <FulfillmentDetailsFields
        hasServiceChoice={modes.length > 1}
        billingErrors={billingErrors}
        clearBillingError={clearBillingError}
        onSendWhatsApp={onSendWhatsApp}
        orderMeta={orderMeta}
        setOrderMeta={setOrderMeta}
        suggestedTokenNumber={suggestedTokenNumber}
        todayDateValue={todayDateValue}
      />
      {orderMeta.fulfillment_mode !== "TABLE" && <p className="cf-card__meta" aria-live="polite" style={{ margin: 0, overflowWrap: "anywhere" }}>
        {getTrackingLine({ ...orderMeta, pickup_slot: buildScheduledDateTime(orderMeta.pickup_date, orderMeta.pickup_time, orderMeta.pickup_meridiem) })}
      </p>}
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
        outletItems={outletItems}
        activeOutletId={activeOutletId}
      />
    ) : null}
  </div>
  );
};
