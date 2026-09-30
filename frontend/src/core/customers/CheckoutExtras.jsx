import React, { useState } from "react";
import axios from "axios";
import { apiData } from "../../lib/apiData";
import { formatCurrency } from "../../lib/pos";
import { getApiErrorMessage } from "../../lib/apiErrors";

/**
 * Checkout extras: who the customer is, paying part of the bill with loyalty points, and paying with a gift card.
 * The server re-checks everything; this shows the cashier what will happen.
 */
export const CheckoutExtras = ({
  apiUrl, currency, offline, loyaltyInfo, lookingUp, redeem, onRedeemChange, maxRedeemPoints, giftPay, onGiftPayChange, total,
  marketingOptIn, onMarketingOptInChange,
}) => {
  const [checking, setChecking] = useState(false);
  const [giftError, setGiftError] = useState("");
  const loyalty = loyaltyInfo?.loyalty;
  const customer = loyaltyInfo?.customer;

  const checkCard = async () => {
    setGiftError("");
    setChecking(true);
    try {
      const response = await axios.get(`${apiUrl}/api/customers/gift-cards/lookup`, { params: { code: giftPay.code }, withCredentials: true });
      const card = apiData(response);
      if (card.status !== "active") {
        setGiftError(card.status === "pending_payment" ? "This card's payment is not confirmed yet." : `This card is ${card.status}.`);
        onGiftPayChange({ ...giftPay, card: null, amount: "" });
      } else {
        onGiftPayChange({ ...giftPay, card, amount: String(Math.min(card.balance, total)) });
      }
    } catch (error) {
      setGiftError(getApiErrorMessage(error, "Gift card not found"));
      onGiftPayChange({ ...giftPay, card: null, amount: "" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="cf-field" data-testid="checkout-extras">
      <label>Customer &amp; loyalty</label>
      {lookingUp ? <div className="cf-card__meta">Looking up the customer...</div> : null}
      {!lookingUp && loyaltyInfo && !loyaltyInfo.found ? (
        <div className="cf-card__meta">New customer: a profile is created with this bill{loyalty?.enabled ? ` and they earn ${loyalty.earn_percent}% back in points` : ""}.</div>
      ) : null}
      {customer ? (
        <div className="cf-card__meta" data-testid="customer-summary">
          <b>{customer.name}</b> · {customer.visit_count} visit{customer.visit_count === 1 ? "" : "s"}
          {loyalty?.enabled ? ` · ${customer.loyalty_points} points (${formatCurrency(customer.loyalty_points * loyalty.point_value, currency)})` : ""}
          {customer.birthday_in_days === 0 ? " · Birthday today!" : customer.birthday_in_days !== null && customer.birthday_in_days <= 7 ? ` · Birthday in ${customer.birthday_in_days} days` : ""}
          {customer.anniversary_in_days === 0 ? " · Anniversary today!" : ""}
          {customer.tags?.length ? ` · ${customer.tags.join(", ")}` : ""}
          {customer.notes ? <div>Note: {customer.notes}</div> : null}
        </div>
      ) : null}
      {customer && loyalty?.enabled && loyaltyInfo.redeemable_points > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              checked={redeem.enabled}
              disabled={offline || maxRedeemPoints < loyalty.min_redeem_points}
              type="checkbox"
              onChange={(event) => onRedeemChange({ enabled: event.target.checked, points: event.target.checked ? String(maxRedeemPoints) : "" })}
            />
            Use points
          </label>
          {redeem.enabled ? (
            <input
              aria-label="Points to use"
              className="cf-input"
              max={maxRedeemPoints}
              min={loyalty.min_redeem_points}
              step="1"
              style={{ width: 110 }}
              type="number"
              value={redeem.points}
              onChange={(event) => onRedeemChange({ ...redeem, points: event.target.value })}
            />
          ) : null}
          <span className="cf-card__meta">
            {maxRedeemPoints < loyalty.min_redeem_points
              ? `Needs at least ${loyalty.min_redeem_points} points and a bigger bill`
              : `Up to ${maxRedeemPoints} points on this bill (max ${loyalty.max_redeem_percent}%)`}
          </span>
        </div>
      ) : null}

      {loyaltyInfo && !customer?.marketing_opt_in ? (
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontWeight: 400 }}>
          <input checked={marketingOptIn} type="checkbox" onChange={(event) => onMarketingOptInChange(event.target.checked)} />
          Customer agrees to receive offers on WhatsApp/SMS (ask them first)
        </label>
      ) : null}

      <label style={{ marginTop: 10 }}>Gift card</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          aria-label="Gift card code"
          autoComplete="off"
          className="cf-input"
          disabled={offline}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          style={{ flex: "2 1 160px", textTransform: "uppercase" }}
          value={giftPay.code}
          onChange={(event) => { setGiftError(""); onGiftPayChange({ code: event.target.value, card: null, amount: "" }); }}
        />
        {giftPay.card ? (
          <>
            <input
              aria-label="Amount from gift card"
              className="cf-input"
              max={Math.min(giftPay.card.balance, total)}
              min="0.01"
              step="0.01"
              style={{ flex: "1 1 90px" }}
              type="number"
              value={giftPay.amount}
              onChange={(event) => onGiftPayChange({ ...giftPay, amount: event.target.value })}
            />
            <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => onGiftPayChange({ code: "", card: null, amount: "" })}>Remove</button>
          </>
        ) : (
          <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={offline || checking || giftPay.code.replace(/[^A-Za-z0-9]/g, "").length !== 16} type="button" onClick={checkCard}>
            {checking ? "Checking..." : "Check"}
          </button>
        )}
      </div>
      {giftPay.card ? <div className="cf-card__meta">Card {giftPay.card.code}: {formatCurrency(giftPay.card.balance, currency)} available. The rest of the bill is paid with the method below.</div> : null}
      {giftError ? <div style={{ color: "var(--cf-red)", fontSize: 12 }}>{giftError}</div> : null}
      {offline ? <div className="cf-card__meta">Points and gift cards need a connection.</div> : null}
    </div>
  );
};
