import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { formatCurrency } from "../lib/pos";

const API_URL = (() => {
  const configured = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (typeof window === "undefined") return configured;

  const currentOrigin = window.location.origin.replace(/\/+$/, "");
  const currentHost = window.location.hostname;
  if (configured && configured !== currentOrigin && !configured.includes("vercel.app")) {
    return configured;
  }

  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    return configured || "http://localhost:4001";
  }

  return "https://pos-v1-fwjm.onrender.com";
})();

const unwrap = (response) => response?.data?.data ?? response?.data;

const groupByCategory = (items = []) =>
  items.reduce((groups, item) => {
    const category = item.category || "Menu";
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});

const getSelectedVariation = (item, selection = {}) =>
  (item.variation_options || []).find((variation) => variation.id === selection.variationId) || null;

const getSelectedAddons = (item, selection = {}) => {
  const selectedIds = new Set(selection.addonIds || []);
  return (item.addon_options || []).filter((addon) => selectedIds.has(addon.id));
};

const getConfiguredPrice = (item, selection = {}) =>
  Number(item.price || 0) +
  Number(getSelectedVariation(item, selection)?.price || 0) +
  getSelectedAddons(item, selection).reduce((sum, addon) => sum + Number(addon.price || 0), 0);

const getCartKey = (productId, selection = {}) =>
  [productId, selection.variationId || "", [...(selection.addonIds || [])].sort().join(",")].join("|");

const normalizePhone = (value) => String(value || "").replace(/\D/g, "").slice(0, 10);
const isValidPhone = (value) => /^\d{10}$/.test(String(value || ""));
const getItemTone = (dietaryType = "") => {
  const value = String(dietaryType || "").toLowerCase();
  if (value.includes("non")) return "nonveg";
  if (value.includes("egg")) return "egg";
  if (value.includes("vegan")) return "vegan";
  if (value.includes("veg")) return "veg";
  return "neutral";
};

export const QrOrdering = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState({});
  const [selections, setSelections] = useState({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submittedOrder, setSubmittedOrder] = useState(null);
  const [verificationToken, setVerificationToken] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    axios
      .get(`${API_URL}/api/public/qr/${token}/menu`)
      .then((response) => {
        if (!active) return;
        const data = unwrap(response);
        setContext({ business: data.business, table: data.table, qr: data.qr, ordering: data.ordering });
        setMenuItems(data.items || []);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.response?.data?.error?.message || "This QR ordering link is not available.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const categories = useMemo(() => Object.keys(groupByCategory(menuItems)), [menuItems]);
  const filteredMenuItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return menuItems.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      const matchesSearch =
        !normalizedSearch ||
        [item.name, item.category, item.dietary_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, menuItems, searchTerm]);
  const groupedMenu = useMemo(() => groupByCategory(filteredMenuItems), [filteredMenuItems]);
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const total = cartItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  const orderingRules = context?.ordering || {};
  const phoneRequired = Boolean(orderingRules.require_customer_phone);
  const phoneVerificationRequired = Boolean(orderingRules.require_phone_verification);
  const serviceCharge =
    Number(orderingRules.service_charge_fixed || 0) +
    Math.round(total * (Number(orderingRules.service_charge_percent || 0) / 100));
  const normalizedTipAmount = orderingRules.tips_enabled ? Math.max(0, Number(tipAmount || 0)) : 0;
  const payableTotal = total + serviceCharge + normalizedTipAmount;
  const minOrderTotal = Number(orderingRules.min_order_total || 0);
  let orderBlockedReason = "";
  if (orderingRules.paused) {
    orderBlockedReason = "Ordering is paused for this table.";
  } else if (phoneRequired && !isValidPhone(customerPhone)) {
    orderBlockedReason = "Enter a valid 10-digit phone number.";
  } else if (phoneVerificationRequired && !phoneVerified) {
    orderBlockedReason = "Verify your phone number before placing the order.";
  } else if (orderingRules.payment_required_before_approval) {
    orderBlockedReason = "Online payment confirmation is not connected yet for this restaurant.";
  } else if (minOrderTotal && payableTotal < minOrderTotal) {
    orderBlockedReason = `Minimum order value is ${formatCurrency(minOrderTotal)}.`;
  }

  useEffect(() => {
    setPhoneVerified(false);
    setVerificationToken("");
    setOtp("");
  }, [customerPhone]);

  const setProductSelection = (productId, patch) => {
    setSelections((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || {}),
        ...patch,
      },
    }));
  };

  const toggleAddon = (productId, addonId) => {
    setSelections((current) => {
      const selection = current[productId] || {};
      const addonIds = new Set(selection.addonIds || []);
      if (addonIds.has(addonId)) addonIds.delete(addonId);
      else addonIds.add(addonId);
      return {
        ...current,
        [productId]: {
          ...selection,
          addonIds: [...addonIds],
        },
      };
    });
  };

  const updateQuantity = (item, delta) => {
    const selection = selections[item.id] || {};
    const cartKey = getCartKey(item.id, selection);
    const variation = getSelectedVariation(item, selection);
    const addons = getSelectedAddons(item, selection);

    setCart((current) => {
      const nextQuantity = Math.max(0, Number(current[cartKey]?.quantity || 0) + delta);
      const next = { ...current };
      if (nextQuantity) {
        next[cartKey] = {
          key: cartKey,
          product_id: item.id,
          name: item.name,
          quantity: nextQuantity,
          price: getConfiguredPrice(item, selection),
          variation_id: variation?.id || null,
          variation: variation?.name || null,
          addon_ids: addons.map((addon) => addon.id),
          addons,
        };
      } else {
        delete next[cartKey];
      }
      return next;
    });
  };

  const requestPhoneVerification = async () => {
    if (!isValidPhone(customerPhone)) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }

    setVerificationBusy(true);
    setError("");
    try {
      const response = await axios.post(`${API_URL}/api/public/qr/${token}/phone-verification`, {
        phone: customerPhone,
      });
      const data = unwrap(response);
      setVerificationToken(data.verification_token || "");
      if (data.dev_otp && process.env.NODE_ENV !== "production") {
        setOtp(data.dev_otp);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || "Unable to send verification code right now.");
    } finally {
      setVerificationBusy(false);
    }
  };

  const verifyPhone = async () => {
    if (!verificationToken || !otp) {
      setError("Enter the verification code.");
      return;
    }

    setVerificationBusy(true);
    setError("");
    try {
      await axios.post(`${API_URL}/api/public/qr/${token}/phone-verification/verify`, {
        verification_token: verificationToken,
        otp,
      });
      setPhoneVerified(true);
    } catch (requestError) {
      setPhoneVerified(false);
      setError(requestError.response?.data?.error?.message || "Unable to verify this code.");
    } finally {
      setVerificationBusy(false);
    }
  };

  const submitOrder = async () => {
    if (orderBlockedReason) {
      setError(orderBlockedReason);
      return;
    }

    if (!cartItems.length) {
      setError("Add at least one item before placing the order.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await axios.post(`${API_URL}/api/public/qr/${token}/orders`, {
        customer_name: customerName,
        customer_phone: customerPhone,
        notes,
        items: cartItems.map((item) => ({
          product_id: item.product_id,
          variation_id: item.variation_id,
          addon_ids: item.addon_ids,
          quantity: item.quantity,
        })),
        tip_amount: normalizedTipAmount,
        phone_verification_token: verificationToken || undefined,
      });
      setSubmittedOrder(unwrap(response));
      setCart({});
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || "Unable to place the order right now.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="cf-qr-page">
        <div className="cf-qr-shell">
          <div className="cf-qr-loading-card">
            <div className="cf-loading__spinner" />
            <strong>Loading menu</strong>
            <span>Getting today&apos;s available items...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && !context) {
    return (
      <div className="cf-qr-page">
        <div className="cf-qr-shell">
          <ApiErrorPanel
            action="Ask restaurant staff to regenerate the QR code or check whether QR ordering is enabled for this table."
            message={error}
            title="Ordering unavailable"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cf-qr-page">
      <div className="cf-qr-shell">
        <header className="cf-qr-header">
          <div>
            <div className="cf-page__overline">QR Ordering</div>
            <h1>{context?.business?.name || "Menu"}</h1>
            <p>
              {context?.table?.area_name ? `${context.table.area_name} | ` : ""}
              {context?.table?.name ? `Table ${context.table.name}` : "Table order"}
            </p>
          </div>
        </header>

        {context?.ordering ? (
          <div className={context.ordering.paused ? "cf-qr-error" : "cf-qr-success"}>
            <strong>{context.ordering.paused ? "Ordering is paused" : "Ordering is open"}</strong>
            <span>
              {context.ordering.estimated_prep_minutes ? `${context.ordering.estimated_prep_minutes} min prep` : "Prep time varies"}
              {context.ordering.min_order_total ? ` | Minimum ${formatCurrency(context.ordering.min_order_total)}` : ""}
              {context.ordering.require_customer_phone ? " | Phone required" : ""}
              {context.ordering.require_restaurant_approval ? " | Staff approval before kitchen" : ""}
            </span>
          </div>
        ) : null}

        {submittedOrder ? (
          <div className="cf-qr-success">
            <strong>Order sent to the restaurant.</strong>
            <span>Order #{submittedOrder.id?.slice(-6) || "received"} is waiting for staff review.</span>
            {submittedOrder.tracking_token ? (
              <a href={`/qr/orders/${submittedOrder.tracking_token}`}>Track this order</a>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="cf-qr-error">{error}</div> : null}

        <main className="cf-qr-layout">
          <section className="cf-qr-menu">
            <div className="cf-qr-menu-tools">
              <input
                className="cf-input"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search menu"
                value={searchTerm}
              />
              <div className="cf-qr-category-tabs">
                <button className={activeCategory === "all" ? "is-active" : ""} onClick={() => setActiveCategory("all")} type="button">
                  All
                </button>
                {categories.map((category) => (
                  <button
                    className={activeCategory === category ? "is-active" : ""}
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    type="button"
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
            {Object.entries(groupedMenu).map(([category, items]) => (
              <div className="cf-qr-category" key={category}>
                <h2>{category}</h2>
                {items.map((item) => {
                  const selection = selections[item.id] || {};
                  const cartKey = getCartKey(item.id, selection);
                  const quantity = Number(cart[cartKey]?.quantity || 0);
                  const displayPrice = getConfiguredPrice(item, selection);
                  return (
                    <div className="cf-qr-menu-item" key={item.id}>
                      <div>
                        <div className="cf-qr-menu-item__title-row">
                          <strong>{item.name}</strong>
                          <span className={`cf-food-pill cf-food-pill--${getItemTone(item.dietary_type)}`}>
                            {item.dietary_type || "Item"}
                          </span>
                        </div>
                        {item.description ? <span>{item.description}</span> : null}
                        {item.variation_options?.length ? (
                          <select
                            className="cf-select"
                            value={selection.variationId || ""}
                            onChange={(event) => setProductSelection(item.id, { variationId: event.target.value || null })}
                          >
                            <option value="">Regular</option>
                            {item.variation_options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name} {Number(option.price || 0) ? `+ ${formatCurrency(option.price)}` : ""}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {item.addon_options?.length ? (
                          <div className="cf-qr-options">
                            {item.addon_options.map((addon) => (
                              <label key={addon.id}>
                                <input
                                  checked={(selection.addonIds || []).includes(addon.id)}
                                  onChange={() => toggleAddon(item.id, addon.id)}
                                  type="checkbox"
                                />
                                {addon.name} {Number(addon.price || 0) ? `+ ${formatCurrency(addon.price)}` : ""}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="cf-qr-menu-item__actions">
                        <span>{formatCurrency(displayPrice)}</span>
                        {quantity ? (
                          <div className="cf-qr-qty-control">
                            <button type="button" onClick={() => updateQuantity(item, -1)} disabled={!quantity}>
                              -
                            </button>
                            <b>{quantity}</b>
                            <button type="button" onClick={() => updateQuantity(item, 1)}>
                              +
                            </button>
                          </div>
                        ) : (
                          <button className="cf-qr-add-btn" type="button" onClick={() => updateQuantity(item, 1)}>
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {!filteredMenuItems.length ? (
              <div className="cf-qr-empty">No menu items match your search.</div>
            ) : null}
          </section>

          <aside className="cf-qr-cart">
            <div className="cf-qr-cart__header">
              <h2>Your Order</h2>
              <span>{cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} items</span>
            </div>
            {cartItems.length ? (
              cartItems.map((item) => (
                <div className="cf-qr-cart__row" key={item.key}>
                  <span>
                    {item.name} x {item.quantity}
                    {item.variation ? ` (${item.variation})` : ""}
                    {item.addons?.length ? (
                      <small>{item.addons.map((addon) => `${addon.name} + ${formatCurrency(addon.price)}`).join(", ")}</small>
                    ) : null}
                  </span>
                  <strong>
                    {formatCurrency(Number(item.price || 0) * item.quantity)}
                    <small>{formatCurrency(item.price)} each</small>
                  </strong>
                </div>
              ))
            ) : (
              <div className="cf-qr-cart__empty">Add items from the menu.</div>
            )}
            <div className="cf-qr-cart__total">
              <span>Items</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            {serviceCharge ? (
              <div className="cf-qr-cart__total cf-qr-cart__total--muted">
                <span>Service charge</span>
                <strong>{formatCurrency(serviceCharge)}</strong>
              </div>
            ) : null}
            {orderingRules.tips_enabled ? (
              <input
                className="cf-input"
                min="0"
                placeholder="Tip optional"
                type="number"
                value={tipAmount}
                onChange={(event) => setTipAmount(event.target.value)}
              />
            ) : null}
            <div className="cf-qr-cart__total">
              <span>Total</span>
              <strong>{formatCurrency(payableTotal)}</strong>
            </div>
            <input className="cf-input" placeholder="Name optional" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            <input
              className="cf-input"
              inputMode="numeric"
              maxLength="10"
              pattern="[0-9]{10}"
              placeholder={phoneRequired ? "10-digit phone required" : "Phone optional"}
              type="tel"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(normalizePhone(event.target.value))}
            />
            {phoneVerificationRequired ? (
              <div className="cf-qr-verification">
                <button className="cf-btn cf-btn--secondary" disabled={verificationBusy || !isValidPhone(customerPhone)} onClick={requestPhoneVerification} type="button">
                  {verificationToken ? "Resend Code" : "Send Code"}
                </button>
                <input
                  className="cf-input"
                  inputMode="numeric"
                  maxLength="6"
                  placeholder="OTP code"
                  value={otp}
                  onChange={(event) => setOtp(String(event.target.value || "").replace(/\D/g, "").slice(0, 6))}
                />
                <button className="cf-btn cf-btn--secondary" disabled={verificationBusy || !verificationToken || phoneVerified} onClick={verifyPhone} type="button">
                  {phoneVerified ? "Verified" : "Verify"}
                </button>
              </div>
            ) : null}
            <textarea className="cf-textarea" placeholder="Table notes optional" value={notes} onChange={(event) => setNotes(event.target.value)} />
            {orderBlockedReason && cartItems.length ? <div className="cf-card__meta">{orderBlockedReason}</div> : null}
            <button className="cf-btn cf-btn--primary" disabled={submitting || !cartItems.length || Boolean(orderBlockedReason)} onClick={submitOrder} type="button">
              {submitting ? "Sending..." : "Place Order"}
            </button>
          </aside>
        </main>
      </div>
    </div>
  );
};

export const QrOrderTracking = () => {
  const { trackingToken } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);

  useEffect(() => {
    let active = true;
    const loadOrder = async ({ initial = false } = {}) => {
      if (initial) setLoading(true);
      setError("");
      try {
        const response = await axios.get(`${API_URL}/api/public/qr/orders/${trackingToken}`);
        if (!active) return;
        setOrder(unwrap(response));
      } catch (requestError) {
        if (!active) return;
        setError(requestError.response?.data?.error?.message || "This order tracking link is not available.");
      } finally {
        if (active && initial) setLoading(false);
      }
    };

    loadOrder({ initial: true });
    const intervalId = window.setInterval(() => loadOrder(), 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [trackingToken]);

  if (loading) {
    return (
      <div className="cf-qr-page">
        <div className="cf-qr-shell">
          <div className="cf-card__meta">Loading order...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cf-qr-page">
        <div className="cf-qr-shell">
          <div className="cf-qr-title">Order unavailable</div>
          <div className="cf-card__meta">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cf-qr-page">
      <div className="cf-qr-shell">
        <header className="cf-qr-header">
          <div>
            <div className="cf-page__overline">Order Tracking</div>
            <h1>Order #{order?.id?.slice(-6) || "received"}</h1>
            <p>{order?.metadata?.table_name ? `Table ${order.metadata.table_name}` : "QR order"}</p>
          </div>
        </header>
        <div className="cf-qr-success">
          <strong>Status: {String(order?.status || "pending").toUpperCase()}</strong>
          <span>
            {order?.tracking?.approval_status === "pending"
              ? "Waiting for restaurant approval before it goes to the kitchen."
              : order?.metadata?.estimated_prep_minutes
              ? `Estimated prep time: ${order.metadata.estimated_prep_minutes} minutes`
              : "The restaurant has received your order."}
          </span>
        </div>
        <div className="cf-qr-tracking-steps">
          {["pending", "approved", "preparing", "ready", "completed"].map((step) => {
            const approvalStatus = order?.tracking?.approval_status || "";
            const orderStatus = String(order?.status || "");
            const active =
              approvalStatus === step ||
              orderStatus.includes(step) ||
              (step === "approved" && ["accepted", "preparing", "ready", "completed"].includes(orderStatus));
            return (
              <div className={active ? "is-active" : ""} key={step}>
                <b>{step}</b>
              </div>
            );
          })}
        </div>
        <aside className="cf-qr-cart">
          <h2>Order Items</h2>
          {(order?.items || []).map((item) => (
            <div className="cf-qr-cart__row" key={item.id}>
              <span>
                {item.name} x {item.quantity}
                {item.variation ? ` (${item.variation})` : ""}
                {item.addons?.length ? (
                  <small>{item.addons.map((addon) => `${addon.name} + ${formatCurrency(addon.price)}`).join(", ")}</small>
                ) : null}
              </span>
              <strong>
                {formatCurrency(Number(item.price || 0) * Number(item.quantity || 1))}
                <small>{formatCurrency(item.price)} each</small>
              </strong>
            </div>
          ))}
          <div className="cf-qr-cart__total">
            <span>Total</span>
            <strong>{formatCurrency(order?.total || 0)}</strong>
          </div>
        </aside>
      </div>
    </div>
  );
};

