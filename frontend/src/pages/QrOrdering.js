import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { formatCurrency, newClientKey } from "../lib/pos";
import { resolveQrApiBaseUrl } from "../lib/qrUrls";
import { QrBrandHeader, QrChefPicks, QrVideos } from "../components/QrBrand";
import { ProductPhoto } from "../components/ProductPhoto";
import { QrTableAssistance } from "../components/QrTableAssistance";
import { QrItemSheet } from "../components/QrItemSheet";
import { QrCheckout } from "../components/QrCheckout";
import { QrOffers } from "../components/QrOffers";
import { QrGuestFeedback } from "../components/QrGuestFeedback";
import { visitKey, visitOrders, rememberOrder, returnMenuToken, pendingRequest, clearPendingRequest } from "../lib/qrVisit";

const API_URL = resolveQrApiBaseUrl(process.env.REACT_APP_BACKEND_URL);

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

const getSelectedModifiers = (item, selection = {}) => {
  const selectedIds = new Set(selection.modifierIds || []);
  return (item.modifier_groups || []).flatMap((group) => group.options || []).filter((option) => selectedIds.has(option.id));
};

/** Why the current choices cannot be added yet (the server checks the same rules), or "". */
const getChoiceProblem = (item, selection = {}) => {
  const selectedIds = new Set(selection.modifierIds || []);
  const activeIds = new Set((item.modifier_groups || []).flatMap((group) => (group.options || []).filter((option) => option.active !== false).map((option) => option.id)));
  if ([...selectedIds].some((id) => !activeIds.has(id))) return "A selected choice is no longer available. Please choose again.";
  for (const group of item.modifier_groups || []) {
    const count = (group.options || []).filter((option) => selectedIds.has(option.id)).length;
    const min = Number(group.min_select || 0);
    const max = Number(group.max_select || 0);
    if (count < min) return `Choose ${min === 1 ? "one" : `at least ${min}`}: ${group.name}`;
    if (max > 0 && count > max) return `Choose at most ${max}: ${group.name}`;
  }
  return "";
};

const getConfiguredPrice = (item, selection = {}) =>
  Number(item.price || 0) +
  Number(getSelectedVariation(item, selection)?.price || 0) +
  getSelectedAddons(item, selection).reduce((sum, addon) => sum + Number(addon.price || 0), 0) +
  getSelectedModifiers(item, selection).reduce((sum, option) => sum + Number(option.price || 0), 0);

const getCartKey = (productId, selection = {}) =>
  [productId, selection.variationId || "", [...(selection.addonIds || [])].sort().join(","), [...(selection.modifierIds || [])].sort().join(","), selection.kitchenNote || ""].join("|");

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
  const [reload, setReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const orderKeyRef = useRef({ signature: "", key: "" });
  const [error, setError] = useState("");
  const [context, setContext] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState("");
  const [offersOnly, setOffersOnly] = useState(false);
  const [menuNotice, setMenuNotice] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState({});
  const [selections, setSelections] = useState({});
  const [activeItemId, setActiveItemId] = useState(null);
  const activeItem = menuItems.find((item) => item.id === activeItemId);
  const openItem = (item) => {
    setSelections((current) => ({ ...current, [item.id]: { variationId: null, addonIds: [], modifierIds: [], kitchenNote: "" } }));
    setActiveItemId(item.id);
  };
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submittedOrder, setSubmittedOrder] = useState(null);
  const [previousOrders, setPreviousOrders] = useState([]);
  const [verificationToken, setVerificationToken] = useState("");
  const [codeSentNotice, setCodeSentNotice] = useState("");
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
        setContext({ business: data.business, table: data.table, qr: data.qr, ordering: data.ordering, table_session: data.table_session, brand: data.brand || null });
        setMenuItems(data.items || []);
        setPreviousOrders(visitOrders(visitKey(token, data.table_session)));
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
  }, [token, reload]);

  useEffect(() => {
    let active = true, busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const data = unwrap(await axios.get(`${API_URL}/api/public/qr/${token}/menu`, { params: { refresh: "1" }, timeout: 15000 }));
        if (active) { setMenuItems(data.items || []); setMenuNotice(""); }
      } catch { if (active) setMenuNotice("Menu refresh is delayed. Availability and prices will be checked when you order."); }
      finally { busy = false; }
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
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
      return matchesCategory && matchesSearch && (!dietaryFilter || item.dietary_type === dietaryFilter) && (!offersOnly || (item.price_rule && Number(item.list_price) > Number(item.price) && item.qr_availability?.available !== false));
    });
  }, [activeCategory, menuItems, searchTerm, dietaryFilter, offersOnly]);
  const groupedMenu = useMemo(() => groupByCategory(filteredMenuItems), [filteredMenuItems]);
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const total = cartItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  const orderingRules = context?.ordering || {};
  const phoneRequired = Boolean(orderingRules.require_customer_phone);
  const phoneVerificationRequired = Boolean(orderingRules.require_phone_verification);
  const serviceCharge =
    Number(orderingRules.service_charge_fixed || 0) +
    Math.round(total * Number(orderingRules.service_charge_percent || 0)) / 100; // to the paisa, as the server charges it
  const normalizedTipAmount = orderingRules.tips_enabled ? Math.max(0, Number(tipAmount || 0)) : 0;
  const payableTotal = total + serviceCharge + normalizedTipAmount;
  // GST is added on items + service charge when the bill is issued (a tip is not taxed); show the guest the estimate.
  const taxRate = Math.max(0, Number(orderingRules.tax_rate || 0));
  const estimatedTax = Math.round((total + serviceCharge) * taxRate) / 100;
  const estimatedTotal = Math.round((payableTotal + estimatedTax) * 100) / 100;
  const minOrderTotal = Number(orderingRules.min_order_total || 0);
  let orderBlockedReason = "";
  if (orderingRules.paused) {
    orderBlockedReason = "Ordering is paused for this table.";
  } else if (phoneRequired && !isValidPhone(customerPhone)) {
    orderBlockedReason = "Enter a valid 10-digit phone number.";
  } else if (phoneVerificationRequired && !phoneVerified) {
    orderBlockedReason = "Verify your phone number before placing the order.";
  } else if (orderingRules.payment_required_before_approval) {
    orderBlockedReason = "This restaurant requires payment before approval. Please ask staff to take this order; QR checkout is available after the final bill is issued.";
  } else if (minOrderTotal && payableTotal < minOrderTotal) {
    orderBlockedReason = `Minimum order value is ${formatCurrency(minOrderTotal)}.`;
  }
  for (const line of cartItems) {
    const current = menuItems.find((item) => item.id === line.product_id);
    if (!current || current.qr_availability?.available === false) { orderBlockedReason = `${line.name} is no longer available. Remove it from your order.`; break; }
    const selection = { variationId: line.variation_id, addonIds: line.addon_ids, modifierIds: line.modifier_option_ids };
    const staleChoice = getChoiceProblem(current, selection) ||
      (line.variation_id && !(current.variation_options || []).some((option) => option.id === line.variation_id)) ||
      (line.addon_ids || []).some((id) => !(current.addon_options || []).some((option) => option.id === id));
    const quantity = cartItems.filter((item) => item.product_id === line.product_id).reduce((sum, item) => sum + item.quantity, 0);
    if (staleChoice || Math.abs(getConfiguredPrice(current, selection) - line.price) > 0.005 || (current.qr_availability?.max_quantity != null && quantity > current.qr_availability.max_quantity)) {
      orderBlockedReason = `${line.name} has changed. Remove it and add it again to review the latest choices, price and availability.`; break;
    }
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

  const toggleModifier = (item, group, optionId) => {
    setSelections((current) => {
      const selection = current[item.id] || {};
      const chosen = new Set(selection.modifierIds || []);
      const single = Number(group.max_select) === 1;
      if (chosen.has(optionId)) {
        if (!(single && Number(group.min_select) >= 1)) chosen.delete(optionId);
      } else {
        if (single) (group.options || []).forEach((option) => chosen.delete(option.id));
        chosen.add(optionId);
      }
      return { ...current, [item.id]: { ...selection, modifierIds: [...chosen] } };
    });
  };

  const updateQuantity = (item, delta) => {
    const selection = selections[item.id] || {};
    if (delta > 0) {
      const count = Object.values(cart).filter((line) => line.product_id === item.id).reduce((sum, line) => sum + line.quantity, 0);
      if (item.qr_availability?.available === false || (item.qr_availability?.max_quantity != null && count + delta > item.qr_availability.max_quantity)) {
        setError("This item is sold out or its available quantity has been reached."); return false;
      }
      const problem = getChoiceProblem(item, selection);
      if (problem) {
        setError(problem);
        return false;
      }
      setError("");
    }
    const cartKey = getCartKey(item.id, selection);
    const variation = getSelectedVariation(item, selection);
    const addons = getSelectedAddons(item, selection);
    const modifiers = getSelectedModifiers(item, selection);

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
          modifier_option_ids: modifiers.map((option) => option.id),
          modifiers,
          kitchen_note: selection.kitchenNote || "",
          offer_name: item.price_rule?.name || null,
          offer_saving: Math.max(0, Number(item.list_price || item.price) - Number(item.price)),
        };
      } else {
        delete next[cartKey];
      }
      return next;
    });
    return true;
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
      setCodeSentNotice(data.delivery === "sms" ? `Code sent by SMS to ${customerPhone}.` : "");
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

    // Same cart => same key, so a retry after a timeout cannot place the order twice. A changed cart gets a new key.
    const currentVisit = visitKey(token, context?.table_session);
    const signature = JSON.stringify([currentVisit, cartItems, normalizedTipAmount, notes, customerName, customerPhone]);
    if (orderKeyRef.current.signature !== signature) orderKeyRef.current = pendingRequest(currentVisit, signature, newClientKey);

    setSubmitting(true);
    setError("");
    try {
      const response = await axios.post(`${API_URL}/api/public/qr/${token}/orders`, {
        client_request_id: orderKeyRef.current.key,
        table_session_key: context?.table_session?.session_key,
        table_session_opened_at: context?.table_session?.opened_at,
        customer_name: customerName,
        customer_phone: customerPhone,
        notes,
        items: cartItems.map((item) => ({
          product_id: item.product_id,
          variation_id: item.variation_id,
          addon_ids: item.addon_ids,
          modifier_option_ids: item.modifier_option_ids || [],
          quantity: item.quantity,
          kitchen_note: item.kitchen_note,
          quoted_unit_price: item.price,
        })),
        tip_amount: normalizedTipAmount,
        phone_verification_token: verificationToken || undefined,
      });
      const createdOrder = unwrap(response);
      setSubmittedOrder(createdOrder);
      setPreviousOrders(rememberOrder(visitKey(token, context?.table_session), token, createdOrder));
      clearPendingRequest(currentVisit);
      orderKeyRef.current = { signature: "", key: "" };
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
            onRetry={() => setReload((value) => value + 1)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cf-qr-page">
      <div className="cf-qr-shell">
        {context?.brand ? <QrBrandHeader brand={context.brand} title={context.business?.name || "Menu"} overline="Order from your table"
          detail={`${context.table?.area_name ? `${context.table.area_name} | ` : ""}${context.table?.name ? `Table ${context.table.name}` : "Table order"}`} /> : <header className="cf-qr-header">
          <div>
            <div className="cf-page__overline">QR Ordering</div>
            <h1>{context?.business?.name || "Menu"}</h1>
            <p>
              {context?.table?.area_name ? `${context.table.area_name} | ` : ""}
              {context?.table?.name ? `Table ${context.table.name}` : "Table order"}
            </p>
          </div>
        </header>}
        <QrTableAssistance token={token} sessionKey={context?.table_session?.session_key} />

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
            <span>Order #{submittedOrder.id?.slice(-6) || "received"}{submittedOrder.metadata?.approval_status === "pending" ? " is waiting for staff review." : " has been accepted."} You can add another round below.</span>
            {submittedOrder.tracking_token ? (
              <a href={`/qr/orders/${submittedOrder.tracking_token}`}>Track this order</a>
            ) : null}
          </div>
        ) : null}

        {previousOrders.length ? (
          <section className="cf-qr-cart" aria-label="Your orders this visit">
            <h2>Your orders this visit</h2>
            <p>Each round is sent separately. Track a round to see its latest kitchen status.</p>
            {previousOrders.map((entry) => <p key={entry.id}><a href={`/qr/orders/${entry.tracking_token}`}>Track order #{entry.id?.slice(-6)}</a></p>)}
          </section>
        ) : null}
        {error ? <div className="cf-qr-error">{error}</div> : null}
        {menuNotice ? <p role="status">{menuNotice}</p> : null}
        <p className="cf-card__meta">Have an allergy? Check the item's food information and speak to staff.</p>

        <QrChefPicks brand={context?.brand} items={menuItems} onOpen={openItem} />
        <QrVideos brand={context?.brand} />
        <QrOffers items={menuItems} offersOnly={offersOnly} onToggle={() => { setOffersOnly((value) => !value); setActiveCategory("all"); setSearchTerm(""); }} />
        <main className="cf-qr-layout">
          <section className="cf-qr-menu">
            <div className="cf-qr-menu-tools">
              <label>Food preference <select className="cf-select" value={dietaryFilter} onChange={(event) => setDietaryFilter(event.target.value)}>
                <option value="">All food types</option>
                {[...new Set(menuItems.map((item) => item.dietary_type).filter(Boolean))].map((type) => <option key={type} value={type}>{type}</option>)}
              </select></label>
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
                  const quantity = Object.values(cart).filter((line) => line.product_id === item.id).reduce((sum, line) => sum + line.quantity, 0);
                  return (
                    <div className="cf-qr-menu-item" key={item.id}>
                      <div className="cf-qr-menu-item__summary">
                        <button type="button" className="cf-qr-menu-item__preview" aria-label={`View ${item.name} details`} onClick={() => openItem(item)}>
                          <ProductPhoto source={item.image_url} name={item.name} size={72} />
                          <span><strong>{item.name}</strong><span className={`cf-food-pill cf-food-pill--${getItemTone(item.dietary_type)}`}>{item.dietary_type || "Item"}</span></span>
                        </button>
                        {item.description ? <p className="cf-qr-menu-item__description">{item.description}</p> : null}
                      </div>
                      <div className="cf-qr-menu-item__actions">
                        <span>{item.price_rule && Number(item.list_price) > Number(item.price) ? <s style={{ opacity: 0.6, marginRight: 4 }}>{formatCurrency(item.list_price)}</s> : null}{formatCurrency(item.price)}</span>
                        {item.price_rule ? <small>{item.price_rule.name}</small> : null}
                        <button className="cf-qr-add-btn" disabled={item.qr_availability?.available === false} type="button" onClick={() => openItem(item)}>{item.qr_availability?.available === false ? "Sold out" : "Add"}</button>
                        {quantity > 0 ? <small>{quantity} in your order</small> : null}
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

          {activeItem ? <QrItemSheet key={activeItem.id} item={activeItem} selection={selections[activeItem.id] || {}}
            price={getConfiguredPrice(activeItem, selections[activeItem.id] || {})}
            problem={getChoiceProblem(activeItem, selections[activeItem.id] || {})}
            remaining={activeItem.qr_availability?.max_quantity == null ? Infinity : Math.max(0, activeItem.qr_availability.max_quantity - Object.values(cart).filter((line) => line.product_id === activeItem.id).reduce((sum, line) => sum + line.quantity, 0))}
            onSelection={(patch) => setProductSelection(activeItem.id, patch)} onAddon={(id) => toggleAddon(activeItem.id, id)}
            onModifier={(group, id) => toggleModifier(activeItem, group, id)}
            onClose={() => setActiveItemId(null)} onAdd={(quantity) => { if (updateQuantity(activeItem, quantity)) setActiveItemId(null); }} /> : null}
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
                    {item.modifiers?.length ? <small>Choices: {item.modifiers.map((option) => option.name).join(", ")}</small> : null}
                    {item.kitchen_note ? <small>Kitchen request: {item.kitchen_note}</small> : null}
                    {item.offer_name ? <small>Offer applied: {item.offer_name}</small> : null}
                    <button type="button" onClick={() => setCart((current) => { const next = { ...current }; delete next[item.key]; return next; })}>Remove</button>
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
              <span>Items (offers already included)</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            {cartItems.some((item) => item.offer_saving > 0) ? <p className="cf-card__meta">Offer savings already included: {formatCurrency(cartItems.reduce((sum, item) => sum + Math.round(Number(item.offer_saving || 0) * 100) * item.quantity, 0) / 100)}</p> : null}
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
            {estimatedTax > 0 ? (
              <div className="cf-qr-cart__total cf-qr-cart__total--muted" data-testid="qr-estimated-tax">
                <span>GST ({taxRate}%)</span>
                <strong>{formatCurrency(estimatedTax)}</strong>
              </div>
            ) : null}
            <div className="cf-qr-cart__total">
              <span>{estimatedTax > 0 ? "Estimated total" : "Total"}</span>
              <strong>{formatCurrency(estimatedTotal)}</strong>
            </div>
            {estimatedTax > 0 ? <p className="cf-card__meta">Your final bill comes from the restaurant and may differ if loyalty points or offers apply.</p> : null}
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
                {codeSentNotice && !phoneVerified ? <div className="cf-card__meta" role="status">{codeSentNotice}</div> : null}
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
  const menuToken = returnMenuToken(trackingToken);

  useEffect(() => {
    let active = true;
    let busy = false;
    setOrder(null);
    const loadOrder = async ({ initial = false } = {}) => {
      if (busy || (!initial && document.hidden)) return;
      busy = true;
      if (initial) setLoading(true);
      try {
        const response = await axios.get(`${API_URL}/api/public/qr/orders/${trackingToken}`, { timeout: 15000, params: { _t: Date.now() } });
        if (!active) return;
        setOrder(unwrap(response));
        setError("");
      } catch (requestError) {
        if (!active) return;
        setError(requestError.response?.data?.error?.message || "This order tracking link is not available.");
      } finally {
        busy = false;
        if (active && initial) setLoading(false);
      }
    };

    loadOrder({ initial: true });
    const intervalId = window.setInterval(() => loadOrder(), 5000);
    const refresh = () => loadOrder();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
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

  if (error && !order) {
    return (
      <div className="cf-qr-page">
        <div className="cf-qr-shell">
          <div className="cf-qr-title">Order unavailable</div>
          <div className="cf-card__meta">{error}</div>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
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
        {error ? <p role="status">Connection interrupted. Showing the last received status; reconnecting automatically.</p> : null}
        {menuToken ? <a className="cf-button" href={`/qr/${encodeURIComponent(menuToken)}`}>Add another round / return to menu</a> : null}
        <div className="cf-qr-success">
          <strong>Status: {String(order?.tracking?.status || order?.status || "pending").toUpperCase()}</strong>
          <span>
            {["rejected", "cancelled"].includes(order?.tracking?.status)
              ? "This order will not be prepared. Please speak to the restaurant team if you need help."
              : order?.tracking?.approval_status === "pending"
              ? "Waiting for restaurant approval before it goes to the kitchen."
              : order?.metadata?.estimated_prep_minutes
              ? `Estimated prep time: ${order.metadata.estimated_prep_minutes} minutes`
              : "The restaurant has received your order."}
          </span>
        </div>
        <div className="cf-qr-tracking-steps">
          {["pending", "accepted", "preparing", "ready", "completed"].map((step, index, steps) => {
            const status = order?.tracking?.status || order?.status;
            const active = index <= steps.indexOf(status);
            return (
              <div className={active ? "is-active" : ""} key={step}>
                <b>{({ pending: "Sent", accepted: "Accepted", preparing: "Preparing", ready: "Ready", completed: "Served" })[step]}</b>
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
            <span>Order total (before GST)</span>
            <strong>{formatCurrency(order?.total || 0)}</strong>
          </div>
        </aside>
        <QrCheckout key={trackingToken} trackingToken={trackingToken} />
        <QrGuestFeedback key={`feedback-${trackingToken}`} trackingToken={trackingToken} />
      </div>
    </div>
  );
};

