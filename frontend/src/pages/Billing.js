import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatCurrency, hasPermission, newClientKey } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { formatScheduledSlot, getTrackingLine } from "../core/billing/utils/orderTracking";
import { OutletOverviewPanel } from "../core/outlets/components/OutletOverviewPanel";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { CashierSettlement } from "../core/billing/components/CashierSettlement";
import { CheckoutExtras } from "../core/customers/CheckoutExtras";
import { RazorpayCollect } from "../core/payments/RazorpayCollect";
import { applyUnsyncedStock, canQueueOffline, isNetworkFailure, queueOfflineBill } from "../core/offline/offlineQueue";
import { loadOfflineData, saveOfflineData, setOfflineScope } from "../lib/offlineCache";
import { BillingFulfillmentSection } from "../features/billing/fulfillment/pages/BillingFulfillmentSection";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";
import { useBillingFulfillment } from "../features/billing/fulfillment/store/useBillingFulfillment";
import {
  sanitizeTenDigitPhoneInput,
} from "../features/billing/fulfillment/utils/fulfillmentMode";

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
const LOW_STOCK_THRESHOLD = 3;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mergeInventoryCatalog = (centralInventory = [], outletInventory = []) => {
  const merged = new Map(
    (centralInventory || []).map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        unit: item.unit,
        current_stock: toNumber(item.current_stock, 0),
      },
    ]),
  );

  (outletInventory || []).forEach((item) => {
    const inventoryId = item.inventory_id;
    if (!inventoryId) return;

    const current = merged.get(inventoryId) || {
      id: inventoryId,
      name: item.inventory_name,
      unit: item.unit,
      current_stock: toNumber(item.central_stock, 0),
    };
    const hasExplicitOutletConfig = item.id && !String(item.id).startsWith("virtual_");
    const useOutletStock = hasExplicitOutletConfig && item.enabled !== false;

    merged.set(inventoryId, {
      ...current,
      name: current.name || item.inventory_name,
      unit: current.unit || item.unit,
      current_stock: useOutletStock
        ? toNumber(item.stock, current.current_stock)
        : toNumber(item.central_stock, current.current_stock),
    });
  });

  return Array.from(merged.values());
};

const CATEGORY_CUSTOMIZATION_PROFILES = [
  {
    enabled: true,
    match: ["coffee", "beverage", "drink", "tea"],
    removeOptions: ["No sugar", "No ice", "No milk", "No cream"],
    notePlaceholder: "Less sweet, extra hot, light ice...",
  },
  {
    enabled: true,
    match: ["cake", "bakery", "dessert", "pastry"],
    removeOptions: ["No cream", "No frosting", "No nuts", "No syrup"],
    notePlaceholder: "Birthday message, no candles, serve chilled...",
  },
  {
    enabled: true,
    match: ["sandwich", "pizza", "burger", "snack"],
    removeOptions: ["No onion", "No tomato", "No cheese", "No mayo"],
    notePlaceholder: "Cut into halves, extra toasted, pack separately...",
  },
];

const getCustomizationProfile = (product) => {
  if (product?.removal_options?.length) {
    return {
      enabled: true,
      removeOptions: product.removal_options,
      notePlaceholder: "Any other customer instruction...",
    };
  }
  const category = product?.category || "";
  const normalized = String(category || "").toLowerCase();
  return (
    CATEGORY_CUSTOMIZATION_PROFILES.find((profile) =>
      profile.match.some((keyword) => normalized.includes(keyword))
    ) || {
      enabled: false,
      removeOptions: [],
      notePlaceholder: "Any other customer instruction...",
    }
  );
};

const todayDateValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeRemovalTokens = (removals = []) =>
  removals
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/^(no|without|less)\s+/i, "").trim());

const normalizeCustomizationToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^extra\s+/i, "")
    .replace(/^no\s+/i, "")
    .replace(/^without\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

const getApiErrorMessage = (error, fallbackMessage) =>
  error?.response?.data?.error?.message ||
  error?.response?.data?.message ||
  error?.response?.data?.detail ||
  fallbackMessage;

const hasConflictingCustomization = (addonNames = [], removalNames = []) => {
  const addonTokens = addonNames.map(normalizeCustomizationToken).filter(Boolean);
  const removalTokens = removalNames.map(normalizeCustomizationToken).filter(Boolean);
  return addonTokens.some((token) => removalTokens.includes(token));
};

const recipeLineRemoved = (line, removals = []) => {
  const ingredientName = String(line?.ingredient_name || "").trim().toLowerCase();
  if (!ingredientName) return false;
  return removals.some((token) => ingredientName === token || ingredientName.includes(token));
};

const summarizeRecipeLines = (recipeLines = [], multiplier = 1) =>
  recipeLines.reduce((summary, line) => {
    if (!line?.inventory_id) return summary;
    const current = summary[line.inventory_id] || {
      inventory_id: line.inventory_id,
      ingredient_name: line.ingredient_name,
      unit: line.unit,
      quantity: 0,
    };
    current.quantity += Number(line.quantity || 0) * Number(multiplier || 0);
    summary[line.inventory_id] = current;
    return summary;
  }, {});

export const Billing = () => {
  const { user } = useAuth();
  const { settings } = useUi();
  const { selectedOutlet, selectedOutletId } = useActiveOutlet();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [tableData, setTableData] = useState({ items: [], summary: {}, settings: {}, areas: [] });
  const [tableReservations, setTableReservations] = useState({ items: [] });
  const [tableBusy, setTableBusy] = useState(false);
  const [inventoryCatalog, setInventoryCatalog] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const checkoutKeyRef = useRef({ signature: "", key: "" });
  const [cart, setCart] = useState({});
  const [payment, setPayment] = useState(settings.paymentMethods[0] || "Cash");
  const [receipt, setReceipt] = useState(null);
  // Set when the menu shown is the copy saved on this device, because the server cannot be reached.
  const [offlineMenuSavedAt, setOfflineMenuSavedAt] = useState(null);
  const [paymentIntent, setPaymentIntent] = useState(null);
  const [customizingProduct, setCustomizingProduct] = useState(null);
  const [customization, setCustomization] = useState({ variation: "", addons: [], removals: [], customNote: "", modifiers: [] });
  const [discount, setDiscount] = useState({ label: "", type: "none", value: "" });
  // A tip is paid with the bill but is not taxed; it goes to one person or to the shared pool.
  const [tip, setTip] = useState({ amount: "", staffId: "" });
  const [tipTeam, setTipTeam] = useState([]);
  // The customer behind the phone number, their points, and an optional gift card payment.
  const [loyaltyInfo, setLoyaltyInfo] = useState(null);
  const [lookingUpCustomer, setLookingUpCustomer] = useState(false);
  const [redeem, setRedeem] = useState({ enabled: false, points: "" });
  const [giftPay, setGiftPay] = useState({ code: "", card: null, amount: "" });
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  // Whether this business collects UPI/card payments through its own Razorpay account.
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [billingErrors, setBillingErrors] = useState({});
  const [loadError, setLoadError] = useState(null);
  const hasLoadedProductsRef = useRef(false);
  const lastFetchedMenuContextRef = useRef("");
  const fulfillmentSectionRef = useRef(null);
  const {
    orderMeta,
    setOrderMeta,
    suggestedTokenNumber,
    pickupSlotValue,
    menuChannel,
    fulfillmentLabel,
    changeFulfillmentMode,
    resetOrderMeta,
    hydrateFromOrder,
  } = useBillingFulfillment(recentOrders);
  const menuContextKey = `${menuChannel}|${selectedOutletId || "all-outlets"}`;
  const canManageTables = hasPermission(user, "qr_management") || hasPermission(user, "reservations");
  const customerPhoneDigits = String(orderMeta.customer_phone || "").replace(/\D/g, "");

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}/api/payments/gateway/status`, { withCredentials: true })
      .then((response) => { if (!cancelled) setGatewayEnabled(Boolean(apiData(response)?.enabled)); })
      .catch(() => { if (!cancelled) setGatewayEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setRedeem({ enabled: false, points: "" });
    setMarketingOptIn(false);
    if (customerPhoneDigits.length !== 10) {
      setLoyaltyInfo(null);
      setLookingUpCustomer(false);
      return undefined;
    }
    let cancelled = false;
    setLookingUpCustomer(true);
    const timer = window.setTimeout(() => {
      axios.get(`${API_URL}/api/customers/lookup`, { params: { phone: customerPhoneDigits }, withCredentials: true })
        .then((response) => { if (!cancelled) setLoyaltyInfo(apiData(response) || null); })
        .catch(() => { if (!cancelled) setLoyaltyInfo(null); })
        .finally(() => { if (!cancelled) setLookingUpCustomer(false); });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerPhoneDigits]);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}/api/attendance/team`, { withCredentials: true })
      .then((response) => {
        const team = apiData(response) || [];
        if (cancelled || !Array.isArray(team)) return;
        setTipTeam(team);
        saveOfflineData("tip-team", team);
      })
      .catch(() => {
        const saved = loadOfflineData("tip-team");
        if (!cancelled && Array.isArray(saved?.data)) setTipTeam(saved.data);
      });
    return () => { cancelled = true; };
  }, []);

  const refreshTableData = async () => {
    try {
      const data = await fulfillmentService.fetchTableManagement({ force: true, includeHistory: true });
      setTableData(data.tables || { items: [], summary: {}, settings: {}, areas: [] });
      setTableReservations(data.reservations || { items: [] });
    } catch (error) {
      setTableData({ items: [], summary: {}, settings: {}, areas: [] });
      setTableReservations({ items: [] });
      if (error?.response?.status !== 403) {
        toast.error(getApiErrorMessage(error, "Failed to load table availability"));
      }
    }
  };

  const fetchProducts = async () => {
    if (!selectedOutletId) {
      setProducts([]);
      setRecentOrders([]);
      setTableData({ items: [], summary: {}, settings: {}, areas: [] });
      setTableReservations({ items: [] });
      setInventoryCatalog([]);
      hasLoadedProductsRef.current = false;
      lastFetchedMenuContextRef.current = "";
      setLoading(false);
      return;
    }

    try {
      const [productsResponse, billsResponse, tableResponse] = await Promise.all([
        axios.get(`${API_URL}/api/products`, {
          withCredentials: true,
          params: {
            channel: menuChannel,
            outlet_id: selectedOutletId,
          },
        }),
        axios.get(`${API_URL}/api/bills`, {
          withCredentials: true,
          params: { limit: 50, outlet_id: selectedOutletId },
        }),
        fulfillmentService.fetchTableManagement({ includeHistory: true }).catch(() => null),
      ]);
      setProducts(applyUnsyncedStock(productsResponse.data));
      setRecentOrders(billsResponse.data || []);
      if (tableResponse) {
        setTableData(tableResponse.tables || { items: [], summary: {}, settings: {}, areas: [] });
        setTableReservations(tableResponse.reservations || { items: [] });
      }
      setOfflineMenuSavedAt(null);
      try {
        const [centralInventoryResponse, outletInventoryResponse] = await Promise.all([
          axios.get(`${API_URL}/api/inventory`, { withCredentials: true }).catch(() => ({ data: { items: [] } })),
          axios.get(`${API_URL}/api/outlets/${selectedOutletId}/inventory`, {
            withCredentials: true,
          }).catch(() => ({ data: [] })),
        ]);
        setInventoryCatalog(
          mergeInventoryCatalog(
            centralInventoryResponse.data?.items || [],
            outletInventoryResponse.data || [],
          ),
        );
      } catch (inventoryError) {
        setInventoryCatalog([]);
      }
      hasLoadedProductsRef.current = true;
      lastFetchedMenuContextRef.current = menuContextKey;
      setLoadError(null);
      // Keep a copy of this outlet's menu so the till can still sell after a reload with no connection.
      setOfflineScope(user);
      saveOfflineData(`billing:${selectedOutletId}:${menuChannel}`, {
        products: productsResponse.data,
        tableData: tableResponse?.tables || null,
        tableReservations: tableResponse?.reservations || null,
      });
    } catch (error) {
      if (!hasLoadedProductsRef.current) {
        setOfflineScope(user);
        const snapshot = isNetworkFailure(error) ? loadOfflineData(`billing:${selectedOutletId}:${menuChannel}`) : null;
        if (snapshot?.data?.products) {
          setProducts(applyUnsyncedStock(snapshot.data.products));
          if (snapshot.data.tableData) setTableData(snapshot.data.tableData);
          if (snapshot.data.tableReservations) setTableReservations(snapshot.data.tableReservations);
          setRecentOrders([]);
          setOfflineMenuSavedAt(snapshot.savedAt);
          hasLoadedProductsRef.current = true;
          lastFetchedMenuContextRef.current = menuContextKey;
          setLoadError(null);
        } else {
          setLoadError(error);
          toast.error(getApiErrorMessage(error, "Failed to load billing data"));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Another terminal selling the last units changes what can be sold here.
  useAutoRefresh(fetchProducts, { liveResources: ["products", "inventory", "bills"] });

  const refreshMenuForOrderContext = useEffectEvent(() => {
    if (loading || !hasLoadedProductsRef.current || lastFetchedMenuContextRef.current === menuContextKey) return;
    fetchProducts();
  });

  useEffect(() => {
    refreshMenuForOrderContext();
  }, [loading, menuContextKey, refreshMenuForOrderContext]);

  useEffect(() => {
    if (!settings.paymentMethods.includes(payment)) {
      setPayment(settings.paymentMethods[0] || "Cash");
    }
  }, [payment, settings.paymentMethods]);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category).filter(Boolean))],
    [products]
  );

  const visibleProducts = useMemo(() => {
    return products
      .filter((product) => {
        const matchesActive = product.active !== false;
        const matchesSearch = !search || product.name.toLowerCase().includes(search.toLowerCase());
        const matchesCategory = !category || product.category === category;
        return matchesActive && matchesSearch && matchesCategory;
      })
      .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
  }, [products, search, category]);
  const inventoryStockById = useMemo(
    () => Object.fromEntries((inventoryCatalog || []).map((item) => [item.id, Number(item.current_stock || 0)])),
    [inventoryCatalog]
  );
  const cartEntries = Object.values(cart);
  const buildConfiguredRecipeLines = (product, variationName = "", addonNames = [], removalNames = []) => {
    const variationOption = (product?.variation_options || []).find((item) => item.name === variationName);
    const addonOptions = (product?.addon_options || []).filter((item) => addonNames.includes(item.name));
    const removalTokens = normalizeRemovalTokens(removalNames);
    return [
      ...(product?.recipe_lines || []),
      ...(variationOption?.recipe_lines || []),
      ...addonOptions.flatMap((item) => item.recipe_lines || []),
    ].filter((line) => !recipeLineRemoved(line, removalTokens));
  };
  const cartIngredientDemand = useMemo(
    () =>
      cartEntries.reduce((summary, entry) => {
        const demand = summarizeRecipeLines(
          buildConfiguredRecipeLines(
            entry.product,
            entry.variation || "",
            entry.addons || [],
            entry.removals || []
          ),
          entry.quantity
        );
        Object.values(demand).forEach((line) => {
          const bucket = summary[line.inventory_id] || { ...line, quantity: 0 };
          bucket.quantity += Number(line.quantity || 0);
          summary[line.inventory_id] = bucket;
        });
        return summary;
      }, {}),
    [cartEntries]
  );
  const cartProductCounts = useMemo(
    () =>
      cartEntries.reduce((counts, entry) => {
        counts[entry.product.id] = (counts[entry.product.id] || 0) + entry.quantity;
        return counts;
      }, {}),
    [cartEntries]
  );
  const getIngredientShortages = (recipeLines = [], multiplier = 1, existingDemand = cartIngredientDemand) => {
    const demand = summarizeRecipeLines(recipeLines, multiplier);
    return Object.values(demand).filter((line) => {
      const availableStock = Number(inventoryStockById[line.inventory_id] || 0);
      const reservedStock = Number(existingDemand[line.inventory_id]?.quantity || 0);
      return availableStock < reservedStock + Number(line.quantity || 0);
    });
  };
  const getConfiguredAvailability = (product, variationName = "", addonNames = [], removalNames = [], extraQuantity = 1) => {
    const recipeLines = buildConfiguredRecipeLines(product, variationName, addonNames, removalNames);
    const reservedProductUnits = Number(cartProductCounts[product.id] || 0);
    const ingredientShortages = getIngredientShortages(recipeLines, extraQuantity);
    const productShortage = Number(product.stock || 0) < reservedProductUnits + extraQuantity;
    return {
      recipeLines,
      ingredientShortages,
      productShortage,
      blockedReason: productShortage
        ? "Finished goods stock is fully reserved in this bill"
        : ingredientShortages.length
          ? `Low ingredient stock: ${ingredientShortages[0].ingredient_name}`
          : "",
    };
  };
  const getProductIngredientWarning = (product) => {
    if ((product?.variation_options || []).length) {
      const variationWarnings = (product.variation_options || [])
        .map((option) => getConfiguredAvailability(product, option.name, [], []).ingredientShortages || [])
        .flat();
      const uniqueNames = [...new Set(variationWarnings.map((line) => line.ingredient_name).filter(Boolean))];
      return uniqueNames;
    }
    return (getConfiguredAvailability(product).ingredientShortages || [])
      .map((line) => line.ingredient_name)
      .filter(Boolean);
  };
  const customizationItemWarning = customizingProduct
    ? getConfiguredAvailability(
        customizingProduct,
        customization.variation,
        customization.addons,
        customization.removals
      ).ingredientShortages || []
    : [];
  const customizationWarningNames = [...new Set(customizationItemWarning.map((line) => line.ingredient_name).filter(Boolean))];
  const subtotal = cartEntries.reduce((sum, entry) => sum + (entry.unitPrice || entry.product.price) * entry.quantity, 0);
  const discountValue = Math.max(0, Number(discount.value || 0));
  const discountAmount = useMemo(() => {
    if (discount.type === "percent") {
      return Math.min(subtotal, subtotal * (discountValue / 100));
    }
    if (discount.type === "fixed") {
      return Math.min(subtotal, discountValue);
    }
    return 0;
  }, [discount.type, discountValue, subtotal]);
  const loyaltyRules = loyaltyInfo?.loyalty;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  // Points pay at most the configured share of the bill (after the staff discount), and never more than they hold.
  const maxRedeemPoints = loyaltyInfo?.customer && loyaltyRules?.enabled
    ? Math.max(0, Math.min(loyaltyInfo.customer.loyalty_points, Math.floor((Math.round(afterDiscount * loyaltyRules.max_redeem_percent) / 100) / loyaltyRules.point_value)))
    : 0;
  const redeemPoints = redeem.enabled ? Math.max(0, Math.min(maxRedeemPoints, Math.floor(Number(redeem.points) || 0))) : 0;
  const loyaltyDiscount = redeemPoints && loyaltyRules ? Math.min(afterDiscount, Math.round(redeemPoints * loyaltyRules.point_value * 100) / 100) : 0;
  const taxableSubtotal = Math.max(0, afterDiscount - loyaltyDiscount);
  const tax = Math.round(taxableSubtotal * (settings.taxRate / 100) * 100) / 100;
  const tipAmount = Math.max(0, Math.round(Number(tip.amount || 0) * 100) / 100) || 0;
  const tipStaffName = tip.staffId ? tipTeam.find((member) => member.id === tip.staffId)?.name || "" : "";
  const total = taxableSubtotal + tax + tipAmount;
  const giftAmount = giftPay.card
    ? Math.max(0, Math.round(Math.min(Number(giftPay.amount) || 0, giftPay.card.balance, total) * 100) / 100)
    : 0;
  const quickOrders = useMemo(() => recentOrders.slice(0, 6), [recentOrders]);
  const canApplyDiscount = user?.role === "Owner" || user?.role === "Manager";
  const printableOfferTitle = String(settings.receiptOfferTitle || "").trim();
  const printableOfferMessage = String(settings.receiptOfferMessage || "").trim();
  const customizationProfile = useMemo(
    () => getCustomizationProfile(customizingProduct),
    [customizingProduct]
  );
  const buildCartKey = (productId, variation, addons, removals, customNote, modifiers = []) =>
    `${productId}::${variation || "base"}::${(addons || []).slice().sort().join("|")}::${(removals || []).slice().sort().join("|")}::${(customNote || "").trim()}::${(modifiers || []).slice().sort().join("|")}`;

  const clearBillingError = (field) => {
    setBillingErrors((current) => {
      if (!current[field] && !current.form) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      delete next.form;
      return next;
    });
  };

  const getBillingValidationErrors = () => {
    const nextErrors = {};
    let shouldShowFormError = false;
    if (orderMeta.fulfillment_mode === "TABLE" && !orderMeta.table_id) {
      nextErrors.table_id = "Select a table before billing.";
      shouldShowFormError = true;
    }
    if (!orderMeta.customer_name.trim()) {
      nextErrors.customer_name = "Enter customer name before billing.";
      shouldShowFormError = true;
    }
    if (!orderMeta.customer_phone.trim()) {
      nextErrors.customer_phone = "Enter customer phone before billing.";
      shouldShowFormError = true;
    } else if (sanitizeTenDigitPhoneInput(orderMeta.customer_phone).length !== 10) {
      nextErrors.customer_phone = "Customer phone must be exactly 10 digits.";
      shouldShowFormError = true;
    }
    if (orderMeta.fulfillment_mode === "TOKEN" && !String(orderMeta.token_number || "").trim()) {
      nextErrors.token_number = "Add a token number before billing.";
      shouldShowFormError = true;
    }
    if (orderMeta.fulfillment_mode === "PICKUP" && !pickupSlotValue) {
      nextErrors.pickup_slot = "Add a valid pickup date and time before billing.";
      shouldShowFormError = true;
    }
    if (shouldShowFormError) {
      nextErrors.form = "Complete the required order details before generating the bill.";
    }
    return nextErrors;
  };

  const selectTable = (table) => {
    if (!table) {
      setOrderMeta((current) => ({
        ...current,
        table_id: "",
        table_label: "",
        reservation_id: "",
      }));
      clearBillingError("table_id");
      return;
    }

    setOrderMeta((current) => ({
      ...current,
      table_id: table.id,
      table_label: table.name,
      reservation_id: table.current_reservation?.id || "",
      guests_count:
        current.guests_count || table.current_reservation?.guests_count
          ? String(current.guests_count || table.current_reservation?.guests_count || "")
          : "",
      customer_name: current.customer_name || table.current_reservation?.customer_name || "",
      customer_phone: current.customer_phone || table.current_reservation?.customer_phone || "",
    }));
    clearBillingError("table_id");
  };

  const runTableAction = async (action, successMessage) => {
    setTableBusy(true);
    try {
      const result = await action();
      await refreshTableData();
      if (successMessage) {
        toast.success(successMessage);
      }
      return result;
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Table action failed"));
      throw error;
    } finally {
      setTableBusy(false);
    }
  };

  const createTableRecord = async (payload) =>
    runTableAction(() => fulfillmentService.createTable(payload), "Table created");

  const updateTableRecord = async (tableId, payload) =>
    runTableAction(() => fulfillmentService.updateTable(tableId, payload), "Table updated");

  const deleteTableRecord = async (tableId) =>
    runTableAction(async () => {
      await fulfillmentService.deleteTable(tableId);
      if (orderMeta.table_id === tableId) {
        selectTable(null);
      }
    }, "Table deleted");

  const upsertTableQrCode = async (tableId, payload = {}) =>
    runTableAction(() => fulfillmentService.upsertTableQrCode(tableId, payload), payload.rotate ? "Table QR rotated" : "Table QR ready");

  const createAreaRecord = async (payload) =>
    runTableAction(() => fulfillmentService.createArea(payload), "Category created");

  const updateAreaRecord = async (areaId, payload) =>
    runTableAction(() => fulfillmentService.updateArea(areaId, payload), "Category updated");

  const deleteAreaRecord = async (areaId) =>
    runTableAction(() => fulfillmentService.deleteArea(areaId), "Category deleted");

  const reserveSelectedTable = async (table, options = {}) =>
    runTableAction(async () => {
      const reservationFor = options.reservation_for || options.reservationFor || null;
      const reservation = await fulfillmentService.reserveTable({
        table_id: table.id,
        customer_name: orderMeta.customer_name || null,
        customer_phone: orderMeta.customer_phone || null,
        guests_count: orderMeta.guests_count || null,
        notes: orderMeta.notes || null,
        reservation_for: reservationFor,
        status: options.status || (reservationFor ? "reserved" : "occupied"),
        source: options.source || "manual",
        meta: options.meta || {},
      });
      setOrderMeta((current) => ({
        ...current,
        table_id: table.id,
        table_label: table.name,
        reservation_id: reservation.id,
      }));
      return reservation;
    }, options.reservation_for || options.reservationFor ? `Scheduled ${table.name}` : `Reserved ${table.name}`);

  const undoReservation = async (reservationId) =>
    runTableAction(async () => {
      await fulfillmentService.undoReservation(reservationId);
      if (orderMeta.reservation_id === reservationId) {
        setOrderMeta((current) => ({
          ...current,
          reservation_id: "",
        }));
      }
    }, "Table released");

  const deleteReservation = async (reservationId) =>
    runTableAction(async () => {
      await fulfillmentService.deleteReservation(reservationId);
      if (orderMeta.reservation_id === reservationId) {
        setOrderMeta((current) => ({
          ...current,
          reservation_id: "",
        }));
      }
    }, "Reservation deleted");

  // Checks each choice group's minimum and maximum, as the server will.
  const getModifierProblem = (product, modifierIds) => {
    for (const group of product.modifier_groups || []) {
      const count = (group.options || []).filter((option) => modifierIds.includes(option.id)).length;
      const min = Number(group.min_select || 0);
      const max = Number(group.max_select || 0);
      if (count < min) return `Choose ${min === 1 ? "one" : `at least ${min}`} for "${group.name}"`;
      if (max > 0 && count > max) return `Choose at most ${max} for "${group.name}"`;
    }
    return "";
  };

  const addConfiguredItemToCart = (product, variationName = "", addonNames = [], removalNames = [], customNote = "", modifierIds = []) => {
    const modifierProblem = getModifierProblem(product, modifierIds);
    if (modifierProblem) {
      toast.error(modifierProblem);
      return false;
    }
    const chosenOptions = (product.modifier_groups || []).flatMap((group) => group.options || []).filter((option) => modifierIds.includes(option.id));
    if (hasConflictingCustomization(addonNames, removalNames)) {
      toast.error("You cannot select an add-on and remove the same ingredient together");
      return false;
    }

    const variationOption = (product.variation_options || []).find((item) => item.name === variationName);
    const addonOptions = (product.addon_options || []).filter((item) => addonNames.includes(item.name));
    const availability = getConfiguredAvailability(product, variationName, addonNames, removalNames);
    if (availability.blockedReason) {
      toast.error(availability.blockedReason);
      return false;
    }
    const unitPrice =
      Number(product.price || 0) +
      Number(variationOption?.price || 0) +
      addonOptions.reduce((sum, item) => sum + Number(item.price || 0), 0) +
      chosenOptions.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const detailParts = [
      variationName,
      chosenOptions.length ? `(${chosenOptions.map((option) => option.name).join(", ")})` : "",
      addonNames.length ? `+ ${addonNames.join(", ")}` : "",
      removalNames.length ? removalNames.join(", ") : "",
      customNote.trim(),
    ].filter(Boolean);
    const displayNameParts = [product.name, ...detailParts];
    const cartKey = buildCartKey(product.id, variationName, addonNames, removalNames, customNote, modifierIds);

    setCart((current) => {
      const existing = current[cartKey];
      const nextQty = Math.min((existing?.quantity || 0) + 1, product.stock);
      return {
        ...current,
        [cartKey]: {
          key: cartKey,
          product,
          quantity: nextQty,
          unitPrice,
          variation: variationName || null,
          addons: addonNames,
          removals: removalNames,
          customNote: customNote.trim() || null,
          modifiers: modifierIds,
          displayName: displayNameParts.join(" "),
        },
      };
    });
    return true;
  };

  const addToCart = (product) => {
    const profile = getCustomizationProfile(product);
    if ((product.variation_options || []).length || (product.addon_options || []).length || (product.modifier_groups || []).length || profile.removeOptions.length || profile.enabled) {
      const firstAvailableVariation = (product.variation_options || []).find(
        (option) => !getConfiguredAvailability(product, option.name, [], []).blockedReason
      );
      setCustomizingProduct(product);
      setCustomization({
        variation: firstAvailableVariation?.name || product.variation_options?.[0]?.name || "",
        addons: [],
        removals: [],
        customNote: "",
        // Pre-select the first option of required single-choice groups; staff can change it.
        modifiers: (product.modifier_groups || [])
          .filter((group) => Number(group.min_select) === 1 && Number(group.max_select) === 1 && group.options?.length)
          .map((group) => group.options[0].id),
      });
      return;
    }
    addConfiguredItemToCart(product);
  };

  const changeQty = (productId, delta) => {
    setCart((current) => {
      const existing = current[productId];
      if (!existing) return current;
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      if (delta > 0) {
        if (nextQty > Number(existing.product?.stock || 0)) {
          toast.error("Finished goods stock limit reached");
          return current;
        }
        const nextEntries = Object.values(current).map((entry) =>
          entry.key === productId ? { ...entry, quantity: nextQty } : entry
        );
        const nextDemand = nextEntries.reduce((summary, entry) => {
          const demand = summarizeRecipeLines(
            buildConfiguredRecipeLines(
              entry.product,
              entry.variation || "",
              entry.addons || [],
              entry.removals || []
            ),
            entry.quantity
          );
          Object.values(demand).forEach((line) => {
            const bucket = summary[line.inventory_id] || { ...line, quantity: 0 };
            bucket.quantity += Number(line.quantity || 0);
            summary[line.inventory_id] = bucket;
          });
          return summary;
        }, {});
        const shortage = Object.values(nextDemand).find(
          (line) => Number(inventoryStockById[line.inventory_id] || 0) < Number(line.quantity || 0)
        );
        if (shortage) {
          toast.error(`${shortage.ingredient_name} is low in stock`);
          return current;
        }
      }
      return {
        ...current,
        [productId]: { ...existing, quantity: nextQty },
      };
    });
  };

  const clearCart = () => setCart({});

  const loadOrder = (order) => {
    const nextCart = {};
    (order.items || []).forEach((item) => {
      const product = products.find((candidate) => candidate.id === item.id) || {
        id: item.id,
        name: item.name,
        price: item.price,
        category: "Custom",
        stock: item.quantity,
      };
      const addons = item.addons || [];
      const removals = item.removed_ingredients || [];
      const variation = item.variation || null;
      const customNote = item.custom_note || "";
      const modifiers = (item.modifiers?.options || []).map((option) => option.option_id).filter(Boolean);
      const key = buildCartKey(item.id, variation, addons, removals, customNote, modifiers);
      nextCart[key] = {
        key,
        product,
        quantity: item.quantity,
        unitPrice: item.price,
        variation,
        addons,
        removals,
        customNote,
        modifiers,
        displayName: item.name,
      };
    });
    setCart(nextCart);
    hydrateFromOrder(order);
    toast.success(`Loaded order ${order.id}`);
  };

  const normalizePhoneForWhatsApp = (value) => {
    const digits = (value || "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.startsWith("91") ? digits : `91${digits}`;
  };

  const buildWhatsAppMessage = () => {
    const parts = [
      `Hello ${orderMeta.customer_name || "there"},`,
      `your ${settings.shopName} ${orderMeta.order_type.toLowerCase()} order is noted.`,
      fulfillmentLabel ? `${fulfillmentLabel}` : "",
      pickupSlotValue ? `Pickup: ${formatScheduledSlot(pickupSlotValue)}` : "",
      cartEntries.length ? `Items: ${cartEntries.map(({ product, quantity }) => `${product.name} x${quantity}`).join(", ")}` : "",
      orderMeta.notes ? `Notes: ${orderMeta.notes}` : "",
    ].filter(Boolean);
    return parts.join(" ");
  };

  const openWhatsApp = (phone, message) => {
    const normalized = normalizePhoneForWhatsApp(phone);
    if (!normalized) {
      toast.error("Enter a customer phone number first");
      return;
    }
    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const generateBill = async () => {
    if (!cartEntries.length) {
      toast.error("Cart is empty");
      return;
    }
    if (giftPay.code.trim() && !giftPay.card) {
      toast.error("Check the gift card or remove it");
      return;
    }
    if (redeem.enabled && redeemPoints < (loyaltyRules?.min_redeem_points || 0)) {
      toast.error(`At least ${loyaltyRules?.min_redeem_points} points are needed to redeem`);
      return;
    }
    const nextErrors = getBillingValidationErrors();
    if (Object.keys(nextErrors).length) {
      setBillingErrors(nextErrors);
      window.requestAnimationFrame(() => {
        fulfillmentSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      return;
    }

    let activeReservationId = orderMeta.reservation_id || "";

    try {
      if (orderMeta.fulfillment_mode === "TABLE" && orderMeta.table_id) {
        const selectedTable = (tableData.items || []).find((table) => table.id === orderMeta.table_id);

        if (!selectedTable) {
          toast.error("Select a valid table before billing");
          return;
        }

        if (selectedTable.current_reservation?.id) {
          activeReservationId = selectedTable.current_reservation.id;
          if ((selectedTable.current_reservation.status || "").toLowerCase() === "reserved") {
            await fulfillmentService.confirmReservation(activeReservationId);
          }
        } else {
          const reservation = await fulfillmentService.reserveTable({
            table_id: selectedTable.id,
            customer_name: orderMeta.customer_name || null,
            customer_phone: orderMeta.customer_phone || null,
            guests_count: orderMeta.guests_count || null,
            notes: orderMeta.notes || null,
            status: "occupied",
          });
          activeReservationId = reservation.id;
        }

        await refreshTableData();
      }
    } catch (error) {
      if (!isNetworkFailure(error)) {
        toast.error(getApiErrorMessage(error, "Unable to lock the table for this bill"));
        return;
      }
      // Offline: the bill can still be taken; the table status is updated once the connection returns.
    }

    const nextOrderMeta = {
      ...orderMeta,
      reservation_id: activeReservationId,
    };

    const payload = {
      items: cartEntries.map(({ product, quantity, unitPrice, variation, addons, removals, customNote, displayName, modifiers }) => ({
        id: product.id,
        modifiers: modifiers || [],
        name: displayName || product.name,
        quantity,
        price: unitPrice || product.price,
        base_product_name: product.name,
        variation: variation || null,
        addons: addons || [],
        removed_ingredients: removals || [],
        custom_note: customNote || null,
      })),
      subtotal,
      tax,
      total,
      payment_type: payment,
      menu_channel: menuChannel,
      outlet_id: selectedOutletId || null,
      order_type: nextOrderMeta.order_type,
      service_mode: nextOrderMeta.fulfillment_mode,
      table_id: nextOrderMeta.fulfillment_mode === "TABLE" ? nextOrderMeta.table_id || null : null,
      reservation_id: nextOrderMeta.fulfillment_mode === "TABLE" ? nextOrderMeta.reservation_id || null : null,
      table_label: nextOrderMeta.fulfillment_mode === "TABLE" ? nextOrderMeta.table_label || null : null,
      token_number: nextOrderMeta.fulfillment_mode === "TOKEN" ? nextOrderMeta.token_number || suggestedTokenNumber : null,
      pickup_slot: nextOrderMeta.fulfillment_mode === "PICKUP" ? pickupSlotValue || null : null,
      fulfillment_label:
        nextOrderMeta.fulfillment_mode === "TABLE"
          ? `Table ${nextOrderMeta.table_label || ""}`.trim()
          : fulfillmentLabel,
      guests_count: nextOrderMeta.fulfillment_mode === "TABLE" ? Number(nextOrderMeta.guests_count || 0) || null : null,
      customer_name: nextOrderMeta.customer_name || null,
      customer_phone: nextOrderMeta.customer_phone || null,
      notes: nextOrderMeta.notes || null,
      discount_label: discount.type !== "none" ? (discount.label.trim() || "Discount") : null,
      discount_type: discount.type !== "none" ? discount.type : null,
      discount_value: discount.type !== "none" ? discountValue : 0,
      discount_amount: discount.type !== "none" ? discountAmount : 0,
      printable_offer_title: printableOfferTitle || null,
      printable_offer_message: printableOfferMessage || null,
      tip_amount: tipAmount,
      tip_staff_id: tipAmount > 0 && tip.staffId ? tip.staffId : null,
      ...(redeemPoints ? { loyalty_redeem_points: redeemPoints } : {}),
      ...(marketingOptIn ? { marketing_opt_in: true } : {}),
      ...(giftAmount > 0 ? { payments: [{ method: "Gift Card", gift_card_code: giftPay.code, amount: giftAmount }] } : {}),
    };

    // One key per distinct checkout: a double tap or a retry after a timeout returns the original bill.
    const checkoutSignature = JSON.stringify([payload.items, payload.discount_type, payload.discount_value, payload.payment_type, payload.outlet_id, payload.table_id, payload.tip_amount, payload.tip_staff_id, payload.loyalty_redeem_points, payload.payments, payload.customer_phone]);
    if (checkoutKeyRef.current.signature !== checkoutSignature) checkoutKeyRef.current = { signature: checkoutSignature, key: newClientKey() };
    payload.client_request_id = checkoutKeyRef.current.key;

    try {
      const response = await axios.post(`${API_URL}/api/bills`, payload, { withCredentials: true });
      const generatedBill = response.data?.data || response.data;
      let nextPaymentIntent = null;
      const amountOwed = Number(generatedBill.due_amount ?? generatedBill.total);
      if (gatewayEnabled && ["UPI", "Card"].includes(payment) && amountOwed > 0) {
        // Razorpay: a UPI QR on screen, or a payment link for cards; either confirms itself.
        try {
          const intentResponse = await axios.post(`${API_URL}/api/payments/intents`, {
            provider: "razorpay", razorpay_mode: payment === "Card" ? "link" : "qr", method: payment, amount: amountOwed,
            invoice_id: generatedBill.id, customer_phone: nextOrderMeta.customer_phone || undefined, note: `Bill ${generatedBill.invoice_number || generatedBill.id}`,
          }, { withCredentials: true });
          nextPaymentIntent = apiData(intentResponse);
        } catch (paymentError) {
          toast.error(getApiErrorMessage(paymentError, "Bill created, but the Razorpay payment request could not be made; take the payment another way"));
        }
      } else if (payment === "UPI") {
        try {
          const intentResponse = await axios.post(
            `${API_URL}/api/payments/intents`,
            {
              method: "UPI",
              // Only what is still owed after a gift card.
              amount: Number(generatedBill.due_amount ?? generatedBill.total),
              currency: "INR",
              invoice_id: generatedBill.id,
              customer_phone: nextOrderMeta.customer_phone,
              note: `Bill ${generatedBill.id}`,
            },
            { withCredentials: true },
          );
          nextPaymentIntent = intentResponse.data?.data || intentResponse.data;
        } catch (paymentError) {
          toast.error(getApiErrorMessage(paymentError, "Bill created, but UPI payment request could not be generated"));
        }
      }
      checkoutKeyRef.current = { signature: "", key: "" };
      setPaymentIntent(nextPaymentIntent);
      setReceipt({
        ...generatedBill,
        subtotal: generatedBill.subtotal,
        taxableSubtotal: Math.max(0, Number(generatedBill.subtotal || 0) - Number(generatedBill.discount_amount || 0)),
        tax: generatedBill.tax,
        total: generatedBill.total,
        payment,
        discountLabel: generatedBill.discount_label || payload.discount_label,
        discountType: generatedBill.discount_type || payload.discount_type,
        discountValue: generatedBill.discount_value ?? payload.discount_value,
        discountAmount: generatedBill.discount_amount ?? payload.discount_amount,
        tipAmount: Number(generatedBill.tip_amount || 0),
        loyaltyDiscount: Number(generatedBill.loyalty_discount || 0),
        loyaltyPointsRedeemed: Number(generatedBill.loyalty_redeem_points || 0),
        loyaltyPointsEarned: Number(generatedBill.loyalty_points_earned || 0),
        loyaltyBalance: generatedBill.loyalty_balance_after,
        giftCardPaid: (generatedBill.payments || []).filter((row) => row.method === "Gift Card").reduce((sum, row) => sum + Number(row.amount || 0), 0),
        tipStaffName: generatedBill.tip_staff_name || "",
        printableOfferTitle,
        printableOfferMessage,
        orderMeta: nextOrderMeta,
        feedbackLink: generatedBill.feedback_link || `${window.location.origin}/feedback/${generatedBill.feedback_token}`,
        dateLabel: new Date().toLocaleDateString("en-IN"),
        timeLabel: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });
      clearCart();
      resetOrderMeta();
      setDiscount({ label: "", type: "none", value: "" });
      setTip({ amount: "", staffId: "" });
      setRedeem({ enabled: false, points: "" });
      setGiftPay({ code: "", card: null, amount: "" });
      setBillingErrors({});
      fetchProducts();
      toast.success(`Bill ${generatedBill.id} generated`);
    } catch (error) {
      if (!isNetworkFailure(error)) {
        toast.error(getApiErrorMessage(error, "Failed to generate bill"));
        return;
      }
      // No connection: keep a cash/due bill on this device and sync it later with the same checkout id,
      // so it can never be recorded twice. Card/UPI need the server to confirm the payment.
      if (redeemPoints || giftAmount) {
        toast.error("No connection. Points and gift cards need the server; remove them to take the bill offline.");
        return;
      }
      if (!["Cash", "Due"].includes(payment) || !canQueueOffline()) {
        toast.error(`No connection. ${payment} payments need the server; take cash or try again when back online.`);
        return;
      }
      const provisionalId = `OFFLINE-${payload.client_request_id.slice(0, 8).toUpperCase()}`;
      try {
        queueOfflineBill({ payload, summary: { label: provisionalId, total: formatCurrency(total, settings.currency) } });
      } catch (queueError) {
        toast.error(queueError.message || "Could not save the bill on this device");
        return;
      }
      checkoutKeyRef.current = { signature: "", key: "" };
      setPaymentIntent(null);
      setReceipt({
        id: provisionalId,
        offline: true,
        items: payload.items,
        subtotal,
        tax,
        total,
        payment,
        discountLabel: payload.discount_label,
        discountType: payload.discount_type,
        discountValue: payload.discount_value,
        discountAmount: payload.discount_amount,
        tipAmount,
        tipStaffName,
        printableOfferTitle,
        printableOfferMessage,
        orderMeta: nextOrderMeta,
        feedbackLink: "",
        dateLabel: new Date().toLocaleDateString("en-IN"),
        timeLabel: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });
      clearCart();
      resetOrderMeta();
      setDiscount({ label: "", type: "none", value: "" });
      setTip({ amount: "", staffId: "" });
      setRedeem({ enabled: false, points: "" });
      setGiftPay({ code: "", card: null, amount: "" });
      setBillingErrors({});
      // The list already excludes earlier offline sales; take this bill's units off too.
      setProducts((current) => (current || []).map((product) => {
        const sold = payload.items.filter((item) => item.id === product.id).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        return sold ? { ...product, stock: Math.max(0, Number(product.stock || 0) - sold) } : product;
      }));
      toast.warning(`Offline: bill ${provisionalId} saved on this device and will sync when the connection returns.`);
    }
  };

  if (loading) {
    return (
      <Layout billingMode title="Billing">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading billing...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!selectedOutletId) {
    return (
      <Layout billingMode title="Billing">
        <div className="cf-page">
          <OutletOverviewPanel
            description="Billing stays outlet-specific. Pick an outlet to load its menu, bills, and stock position."
          />
        </div>
      </Layout>
    );
  }

  if (loadError && !hasLoadedProductsRef.current) {
    return (
      <Layout billingMode title="Billing">
        <div className="cf-page">
          <ApiErrorPanel error={loadError} onRetry={fetchProducts} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout billingMode title={selectedOutlet ? `Billing · ${selectedOutlet.name}` : "Billing"}>
      {offlineMenuSavedAt || user?.offline ? (
        <div role="status" className="cf-offline-banner" style={{ padding: "8px 12px", background: "#fff3cd", color: "#332700", borderRadius: 6, margin: "0 0 8px" }}>
          Offline till: cash and due bills are saved on this device and sync automatically.
          {offlineMenuSavedAt ? ` Menu and stock as of ${new Date(offlineMenuSavedAt).toLocaleString("en-IN")}.` : ""}
        </div>
      ) : null}
      {["Owner", "Manager", "Cashier"].includes(user?.role) && !user?.offline && <CashierSettlement key={selectedOutletId} apiUrl={API_URL} outletId={selectedOutletId} />}
      <div className="cf-billing" data-testid="billing-page">
        <div className="cf-billing__products">
          {user?.assigned_outlets?.length ? (
            <div className="cf-page__overline" style={{ marginBottom: 12 }}>
              Outlet Rights: {user.assigned_outlets.map((outlet) => outlet.name).join(", ")}
            </div>
          ) : null}
          <BillingFulfillmentSection
            billingErrors={billingErrors}
            changeFulfillmentMode={(mode) => {
              clearBillingError("table_id");
              clearBillingError("token_number");
              clearBillingError("pickup_slot");
              changeFulfillmentMode(mode);
            }}
            canManageTables={canManageTables}
            clearBillingError={clearBillingError}
            areaItems={tableData.areas || []}
            onCreateArea={createAreaRecord}
            onCreateTable={createTableRecord}
            onDeleteArea={deleteAreaRecord}
            onDeleteTable={deleteTableRecord}
            onUpsertTableQrCode={upsertTableQrCode}
            onDeleteReservation={deleteReservation}
            onReserveTable={reserveSelectedTable}
            onSelectTable={selectTable}
            onSendWhatsApp={() => openWhatsApp(orderMeta.customer_phone, buildWhatsAppMessage())}
            onUndoReservation={undoReservation}
            onUpdateArea={updateAreaRecord}
            onUpdateTable={updateTableRecord}
            orderMeta={orderMeta}
            qrOrderingEnabled={Boolean(tableData.settings?.capabilities?.qrOrderingEnabled)}
            reservationItems={tableReservations.items || []}
            sectionRef={fulfillmentSectionRef}
            setOrderMeta={setOrderMeta}
            suggestedTokenNumber={suggestedTokenNumber}
            tableBusy={tableBusy}
            tableItems={tableData.items || []}
            todayDateValue={todayDateValue}
          />
          <div className="cf-billing__toolbar">
            <div className="cf-billing__toolbar-title">Select Products</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="cf-search"
                data-testid="product-search-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search..."
                style={{ width: 160 }}
                value={search}
              />
              <select className="cf-select" onChange={(event) => setCategory(event.target.value)} style={{ width: 140 }} value={category}>
                <option value="">All</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cf-product-grid">
            {visibleProducts.map((product) => (
              (() => {
                const lowIngredientWarning = getProductIngredientWarning(product);
                const hasLowIngredientWarning = lowIngredientWarning.length > 0;
                return (
              <button
                key={product.id}
                className={`cf-product-card ${Number(product.stock || 0) <= Number(cartProductCounts[product.id] || 0) || product.active === false ? "is-disabled" : ""}`}
                data-testid={`product-card-${product.id}`}
                disabled={Number(product.stock || 0) <= Number(cartProductCounts[product.id] || 0) || product.active === false}
                onClick={() => addToCart(product)}
                style={
                  hasLowIngredientWarning && Number(product.stock || 0) > Number(cartProductCounts[product.id] || 0) && product.active !== false
                    ? { border: "1px solid #f79009", background: "#fffaeb" }
                    : undefined
                }
                type="button"
                title={
                  product.active === false
                    ? `${product.name} is disabled and cannot be added to the bill`
                    : Number(product.stock || 0) <= Number(cartProductCounts[product.id] || 0)
                      ? `${product.name} has no stock left for this bill`
                      : hasLowIngredientWarning
                        ? `${product.name} has low ingredients: ${lowIngredientWarning.join(", ")}`
                        : `Add ${product.name}`
                }
              >
                <div className="cf-product-card__top">
                  <div className="cf-product-card__cat">
                    {product.category || "Other"}
                    <span className={`cf-badge ${product.dietary_type === "Non Veg" ? "cf-badge--red" : "cf-badge--green"}`} style={{ marginLeft: 6 }}>
                      {product.dietary_type || "Veg"}
                    </span>
                  </div>
                  {cartProductCounts[product.id] ? (
                    <span className="cf-product-card__count">In bill: {cartProductCounts[product.id]}</span>
                  ) : product.active === false ? (
                    <span className="cf-product-card__count cf-product-card__count--warn">Disabled</span>
                  ) : Number(product.stock || 0) <= Number(cartProductCounts[product.id] || 0) ? (
                    <span className="cf-product-card__count cf-product-card__count--warn">Out of stock</span>
                  ) : hasLowIngredientWarning ? (
                    <span className="cf-product-card__count cf-product-card__count--warn">Low ingredients</span>
                  ) : null}
                </div>
                <div className="cf-product-card__name">{product.name}</div>
                <div className="cf-product-card__price">
                  {product.price_rule && Number(product.list_price) > Number(product.price) ? (
                    <>
                      <s style={{ opacity: 0.6, marginRight: 4 }}>{formatCurrency(product.list_price, settings.currency)}</s>
                      {formatCurrency(product.price, settings.currency)}
                      <span className="cf-badge cf-badge--amber" style={{ marginLeft: 4 }} title={product.price_rule.name}>{product.price_rule.name}</span>
                    </>
                  ) : formatCurrency(product.price, settings.currency)}
                  {product.is_combo ? <span className="cf-badge cf-badge--blue" style={{ marginLeft: 4 }}>Combo</span> : null}
                </div>
                {(product.variation_options?.length || product.addon_options?.length) ? (
                  <div className="cf-product-card__cat" style={{ marginTop: 6 }}>
                    {(product.variation_options?.length || 0) ? `${product.variation_options.length} variations` : ""}
                    {(product.variation_options?.length && product.addon_options?.length) ? " · " : ""}
                    {(product.addon_options?.length || 0) ? `${product.addon_options.length} add-ons` : ""}
                  </div>
                ) : null}
                <div className={`cf-product-card__stock ${product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD ? "is-low" : ""}`}>
                  {product.active === false
                    ? "Disabled for billing"
                    : Number(product.stock || 0) <= Number(cartProductCounts[product.id] || 0)
                    ? "Unavailable for billing"
                    : hasLowIngredientWarning
                    ? `Low ingredients: ${lowIngredientWarning.slice(0, 2).join(", ")}`
                    : product.stock <= LOW_STOCK_THRESHOLD
                      ? `Only ${product.stock} left`
                      : `Stock: ${product.stock}`}
                </div>
              </button>
                );
              })()
            ))}
          </div>

          <div className="cf-card cf-card--padded" style={{ marginTop: 24 }}>
            <div className="cf-card__title">
              <span>Recent Order Queue</span>
              <span className="cf-card__meta">Reload a recent order to avoid goof-ups</span>
            </div>
            <div className="cf-kitchen-list">
              {quickOrders.length ? (
                quickOrders.map((order) => (
                  <div className="cf-kitchen-list__item" key={order.id}>
                    <div>
                      <div className="cf-kitchen-list__title">{order.customer_name || order.id}</div>
                      <div className="cf-kitchen-list__meta">
                        {(order.order_type || "Dine-In")} {order.table_label ? `· ${order.table_label}` : ""} · {(order.items || []).map((item) => item.name).join(", ")}
                      </div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <span>{formatCurrency(order.total, settings.currency)}</span>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => loadOrder(order)} type="button">
                        Load
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="cf-empty-state">No recent orders yet.</div>
              )}
            </div>
          </div>

        </div>

        <div className="cf-billing__sidebar">
          <div className="cf-cart__header">
            <span className="cf-cart__title">Cart</span>
            <span className="cf-cart__count" id="cart-count">
              {cartEntries.length} item{cartEntries.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="cf-cart__scroll">
            {!cartEntries.length ? (
              <div className="cf-cart__empty">
                <span>Cart is empty</span>
              </div>
            ) : (
              cartEntries.map(({ key, product, quantity, unitPrice, displayName, variation, addons }) => (
                <div className="cf-cart__item" data-testid={`cart-item-${product.id}`} key={key}>
                  <div className="cf-cart__item-main">
                    <div className="cf-cart__item-name">{displayName || product.name}</div>
                    <div className="cf-cart__item-cat">
                      {product.category || "Other"}
                      {variation ? ` · ${variation}` : ""}
                      {addons?.length ? ` · ${addons.join(", ")}` : ""}
                    </div>
                  </div>
                  <div className="cf-cart__qty">
                    <button className="cf-cart__qty-btn" onClick={() => changeQty(key, -1)} type="button">
                      -
                    </button>
                    <span className="cf-cart__qty-num">{quantity}</span>
                    <button className="cf-cart__qty-btn" onClick={() => changeQty(key, 1)} type="button">
                      +
                    </button>
                  </div>
                  <div className="cf-cart__item-total">{formatCurrency((unitPrice || product.price) * quantity, settings.currency)}</div>
                </div>
              ))
            )}
          </div>

          <div className="cf-cart__footer">
            <div className="cf-cart__line">
              <span>Subtotal</span>
              <span id="cart-sub">{formatCurrency(subtotal, settings.currency)}</span>
            </div>
            {canApplyDiscount ? (
              <div className="cf-field" style={{ marginTop: 12 }}>
                <label>Discount / Offer</label>
                <input
                  className="cf-input"
                  placeholder="Label for print, e.g. Owner Offer"
                  value={discount.label}
                  onChange={(event) => setDiscount((current) => ({ ...current, label: event.target.value }))}
                />
                <div className="cf-grid-2" style={{ marginTop: 8 }}>
                  <select
                    className="cf-select"
                    value={discount.type}
                    onChange={(event) =>
                      setDiscount((current) => ({
                        ...current,
                        type: event.target.value,
                        value: event.target.value === "none" ? "" : current.value,
                      }))
                    }
                  >
                    <option value="none">No discount</option>
                    <option value="fixed">Fixed amount</option>
                    <option value="percent">Percentage</option>
                  </select>
                  <input
                    className="cf-input"
                    disabled={discount.type === "none"}
                    min="0"
                    placeholder={discount.type === "percent" ? "10" : "100"}
                    type="number"
                    value={discount.value}
                    onChange={(event) => setDiscount((current) => ({ ...current, value: event.target.value }))}
                  />
                </div>
                <div className="cf-card__meta" style={{ marginTop: 8 }}>
                  Applied discount: {formatCurrency(discountAmount, settings.currency)}
                </div>
              </div>
            ) : null}
            {discountAmount > 0 ? (
              <div className="cf-cart__line">
                <span>{discount.label.trim() || "Discount"}</span>
                <span>-{formatCurrency(discountAmount, settings.currency)}</span>
              </div>
            ) : null}
            <div className="cf-cart__line">
              <span id="cart-tax-label">Tax ({settings.taxRate}%)</span>
              <span id="cart-tax">{formatCurrency(tax, settings.currency)}</span>
            </div>
            {loyaltyDiscount > 0 ? (
              <div className="cf-cart__line">
                <span>Points ({redeemPoints})</span>
                <span>-{formatCurrency(loyaltyDiscount, settings.currency)}</span>
              </div>
            ) : null}
            <CheckoutExtras
              apiUrl={API_URL}
              currency={settings.currency}
              giftPay={giftPay}
              lookingUp={lookingUpCustomer}
              loyaltyInfo={loyaltyInfo}
              maxRedeemPoints={maxRedeemPoints}
              offline={Boolean(user?.offline || offlineMenuSavedAt)}
              redeem={redeem}
              total={total}
              marketingOptIn={marketingOptIn}
              onGiftPayChange={setGiftPay}
              onMarketingOptInChange={setMarketingOptIn}
              onRedeemChange={setRedeem}
            />
            <div className="cf-field" data-testid="tip-field">
              <label htmlFor="cart-tip">Tip (not taxed)</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input
                  className="cf-input"
                  id="cart-tip"
                  inputMode="decimal"
                  min="0"
                  placeholder="0"
                  step="0.01"
                  style={{ flex: "1 1 80px" }}
                  type="number"
                  value={tip.amount}
                  onChange={(event) => setTip((current) => ({ ...current, amount: event.target.value }))}
                />
                {[5, 10].map((percent) => (
                  <button
                    className="cf-btn cf-btn--secondary cf-btn--small"
                    disabled={!taxableSubtotal}
                    key={percent}
                    type="button"
                    onClick={() => setTip((current) => ({ ...current, amount: String(Math.round(taxableSubtotal * percent) / 100) }))}
                  >
                    {percent}%
                  </button>
                ))}
                <select
                  aria-label="Tip goes to"
                  className="cf-select"
                  style={{ flex: "1 1 140px" }}
                  value={tip.staffId}
                  onChange={(event) => setTip((current) => ({ ...current, staffId: event.target.value }))}
                >
                  <option value="">Shared tip pool</option>
                  {tipTeam.map((member) => (
                    <option key={member.id} value={member.id}>{member.name} ({member.role})</option>
                  ))}
                </select>
              </div>
            </div>
            {tipAmount > 0 ? (
              <div className="cf-cart__line">
                <span>Tip{tipStaffName ? ` for ${tipStaffName}` : " (pool)"}</span>
                <span>{formatCurrency(tipAmount, settings.currency)}</span>
              </div>
            ) : null}
            <div className="cf-cart__line cf-cart__line--total">
              <span>Total</span>
              <strong id="cart-total">{formatCurrency(total, settings.currency)}</strong>
            </div>
            {giftAmount > 0 ? (
              <div className="cf-cart__line">
                <span>Gift card pays / rest by {payment}</span>
                <span>{formatCurrency(giftAmount, settings.currency)} / {formatCurrency(Math.max(0, total - giftAmount), settings.currency)}</span>
              </div>
            ) : null}
            <div className="cf-field">
              <label>Payment Method</label>
              <select className="cf-select" id="cart-payment" onChange={(event) => setPayment(event.target.value)} value={payment}>
                {settings.paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <button className="cf-btn cf-btn--primary cf-btn--full" onClick={generateBill} type="button">
              Generate Bill -&gt;
            </button>
          </div>
        </div>
      </div>

      <Dialog onOpenChange={() => setReceipt(null)} open={Boolean(receipt)}>
        <DialogContent className="bg-white" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">Receipt</DialogTitle>
          </DialogHeader>
          {receipt ? (
            <div className="cf-receipt">
              <div className="cf-receipt__shop">{settings.shopName}</div>
              <div className="cf-receipt__meta">
                GST: {settings.gst}
                <br />
                {settings.address}
                <br />
                {settings.phone}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--cf-text-2)", fontSize: 10, marginBottom: 8 }}>
                <span>
                  Bill: <b>{receipt.id}</b>
                </span>
                <span>
                  {receipt.dateLabel} {receipt.timeLabel}
                </span>
              </div>
              {receipt.offline ? (
                <div role="note" style={{ border: "1px dashed var(--cf-text-2)", padding: 6, fontSize: 11, margin: "6px 0" }}>
                  Provisional receipt taken offline. The tax invoice number is issued when this bill syncs.
                  <br />
                  Kitchen: this order is not on the kitchen screen until it syncs. Print this receipt and hand it to the kitchen.
                </div>
              ) : null}
              <div style={{ color: "var(--cf-text-2)", fontSize: 10, marginBottom: 10 }}>
                {getTrackingLine({ ...receipt.orderMeta, pickup_slot: receipt.orderMeta?.pickup_slot })}
                {receipt.orderMeta?.customer_name ? ` · ${receipt.orderMeta.customer_name}` : ""}
              </div>
              {receipt.orderMeta?.notes ? (
                <div style={{ color: "var(--cf-text-2)", fontSize: 10, marginBottom: 10 }}>
                  Notes: <b>{receipt.orderMeta.notes}</b>
                </div>
              ) : null}
              <hr className="cf-receipt__divider" />
              {receipt.items.map((item, index) => (
                <div className="cf-receipt__row" key={`${item.id}-${index}`}>
                  <span>{item.name} x{item.quantity}</span>
                  <span>{formatCurrency(item.price * item.quantity, settings.currency)}</span>
                </div>
              ))}
              <div className="cf-receipt__summary">
                <div className="cf-receipt__row">
                  <span>Subtotal</span>
                  <span>{formatCurrency(receipt.subtotal, settings.currency)}</span>
                </div>
                {receipt.discountAmount > 0 ? (
                  <div className="cf-receipt__row">
                    <span>{receipt.discountLabel || "Discount"}</span>
                    <span>-{formatCurrency(receipt.discountAmount, settings.currency)}</span>
                  </div>
                ) : null}
                {receipt.loyaltyDiscount > 0 ? (
                  <div className="cf-receipt__row">
                    <span>Loyalty points ({receipt.loyaltyPointsRedeemed})</span>
                    <span>-{formatCurrency(receipt.loyaltyDiscount, settings.currency)}</span>
                  </div>
                ) : null}
                <div className="cf-receipt__row">
                  <span>Tax ({settings.taxRate}%)</span>
                  <span>{formatCurrency(receipt.tax, settings.currency)}</span>
                </div>
                {receipt.tipAmount > 0 ? (
                  <div className="cf-receipt__row">
                    <span>Tip{receipt.tipStaffName ? ` (${receipt.tipStaffName})` : ""}</span>
                    <span>{formatCurrency(receipt.tipAmount, settings.currency)}</span>
                  </div>
                ) : null}
                <div className="cf-receipt__grand">
                  <span>TOTAL</span>
                  <span>{formatCurrency(receipt.total, settings.currency)}</span>
                </div>
                <div style={{ color: "var(--cf-text-2)", fontSize: 10, marginTop: 8 }}>
                  Payment: <b>{receipt.giftCardPaid > 0 ? `Gift card ${formatCurrency(receipt.giftCardPaid, settings.currency)}${receipt.total - receipt.giftCardPaid > 0 ? ` + ${receipt.payment}` : ""}` : receipt.payment}</b>
                </div>
                {receipt.loyaltyPointsEarned > 0 || receipt.loyaltyBalance !== null && receipt.loyaltyBalance !== undefined ? (
                  <div style={{ color: "var(--cf-text-2)", fontSize: 10 }}>
                    {receipt.loyaltyPointsEarned > 0 ? `Points earned: ${receipt.loyaltyPointsEarned}. ` : ""}
                    {receipt.loyaltyBalance !== null && receipt.loyaltyBalance !== undefined ? `Points balance: ${receipt.loyaltyBalance}` : ""}
                  </div>
                ) : null}
                {paymentIntent?.razorpay ? (
                  <RazorpayCollect
                    apiUrl={API_URL}
                    currency={settings.currency}
                    customerPhone={receipt.orderMeta?.customer_phone || receipt.customer_phone}
                    intent={paymentIntent}
                    onIntentChange={setPaymentIntent}
                  />
                ) : paymentIntent ? (
                  <div className="cf-payment-intent">
                    <div className="cf-page__overline" style={{ marginBottom: 8 }}>UPI Payment Request</div>
                    <div className="cf-table__mono">Ref: {paymentIntent.reference}</div>
                    {paymentIntent.upi_deep_link ? (
                      <a className="cf-btn cf-btn--primary cf-btn--full cf-btn--small" href={paymentIntent.upi_deep_link}>
                        Open UPI App
                      </a>
                    ) : (
                      <div className="cf-card__meta">Set UPI_MERCHANT_ID in backend env to generate a UPI app link.</div>
                    )}
                  </div>
                ) : null}
              </div>
              {receipt.printableOfferTitle || receipt.printableOfferMessage ? (
                <div className="cf-receipt__offer">
                  {receipt.printableOfferTitle ? <div className="cf-receipt__offer-title">{receipt.printableOfferTitle}</div> : null}
                  {receipt.printableOfferMessage ? <div>{receipt.printableOfferMessage}</div> : null}
                </div>
              ) : null}
              <div className="cf-receipt__footer">{settings.footer}</div>
              <hr className="cf-receipt__divider" />
              <div className="cf-feedback-box">
                <div className="cf-page__overline" style={{ marginBottom: 10 }}>Customer Feedback</div>
                <p className="cf-feedback-box__text">This feedback link is meant to stay on the printed receipt only. It is not sent separately by SMS or WhatsApp.</p>
                {receipt.feedbackLink && !receipt.offline ? (
                  <img
                    alt="Feedback QR code"
                    className="cf-feedback-box__qr"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(receipt.feedbackLink)}`}
                  />
                ) : null}
                <input className="cf-input" readOnly value={receipt.feedbackLink} />
                <div className="cf-feedback-box__status">
                  Print this bill to share the feedback link with the customer.
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={() => setCustomizingProduct(null)} open={Boolean(customizingProduct)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">
              {customizingProduct ? `Customize ${customizingProduct.name}` : "Customize"}
            </DialogTitle>
          </DialogHeader>
          {customizingProduct ? (
            <div>
              {customizationWarningNames.length ? (
                <div
                  className="cf-card"
                  style={{
                    marginBottom: 16,
                    padding: "12px 14px",
                    borderColor: "#f79009",
                    background: "#fffaeb",
                    color: "#b54708",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Low ingredient stock for this item: {customizationWarningNames.join(", ")}
                </div>
              ) : null}
              {(customizingProduct.variation_options || []).length ? (
                <div className="cf-field">
                  <label>Variation</label>
                  <select className="cf-select" value={customization.variation} onChange={(event) => setCustomization({ ...customization, variation: event.target.value })}>
                    {(customizingProduct.variation_options || []).map((option) => (
                      <option
                        disabled={Boolean(getConfiguredAvailability(customizingProduct, option.name, customization.addons, customization.removals).blockedReason)}
                        key={option.name}
                        value={option.name}
                      >
                        {option.name} ({formatCurrency(Number(customizingProduct.price || 0) + Number(option.price || 0), settings.currency)})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {(customizingProduct.addon_options || []).length ? (
                <div className="cf-field">
                  <label>Add-ons</label>
                  <div className="cf-checkbox-row">
                    {customizingProduct.addon_options.map((option) => {
                      const addonChecked = customization.addons.includes(option.name);
                      const nextAddonSelection = addonChecked
                        ? customization.addons.filter((item) => item !== option.name)
                        : [...customization.addons, option.name];
                      const hasConflict = hasConflictingCustomization(nextAddonSelection, customization.removals);
                      const currentSelectionWarningNames = [...new Set(
                        (
                          getConfiguredAvailability(
                            customizingProduct,
                            customization.variation,
                            customization.addons,
                            customization.removals
                          ).ingredientShortages || []
                        )
                          .map((line) => line.ingredient_name)
                          .filter(Boolean)
                      )];
                      const nextSelectionWarningNames = [...new Set(
                        (
                          getConfiguredAvailability(
                            customizingProduct,
                            customization.variation,
                            nextAddonSelection,
                            customization.removals
                          ).ingredientShortages || []
                        )
                          .map((line) => line.ingredient_name)
                          .filter(Boolean)
                      )];
                      const addonSpecificWarnings = nextSelectionWarningNames.filter(
                        (name) => !currentSelectionWarningNames.includes(name)
                      );
                      const addonBlockedReason = addonChecked
                        ? ""
                        : hasConflict
                          ? "Conflicts with a selected remove option"
                          : "";
                      return (
                        <label key={option.name}>
                          <input
                            type="checkbox"
                            disabled={Boolean(addonBlockedReason)}
                            checked={addonChecked}
                            onChange={(event) =>
                              setCustomization((current) => ({
                                ...current,
                                addons: event.target.checked
                                  ? [...current.addons, option.name]
                                  : current.addons.filter((item) => item !== option.name),
                              }))
                            }
                          />
                          {option.name} (+{formatCurrency(option.price, settings.currency)})
                          {addonBlockedReason ? ` - ${addonBlockedReason}` : ""}
                          {!addonBlockedReason && addonSpecificWarnings.length ? ` - Extra low stock: ${addonSpecificWarnings.join(", ")}` : ""}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {customizationProfile.removeOptions.length ? (
                <div className="cf-field">
                  <label>Skip Common Ingredients</label>
                  <div className="cf-checkbox-row">
                    {customizationProfile.removeOptions.map((option) => (
                      <label key={option}>
                        <input
                          type="checkbox"
                          disabled={
                            !customization.removals.includes(option) &&
                            hasConflictingCustomization(customization.addons, [...customization.removals, option])
                          }
                          checked={customization.removals.includes(option)}
                          onChange={(event) =>
                            setCustomization((current) => ({
                              ...current,
                              removals: event.target.checked
                                ? [...current.removals, option]
                                : current.removals.filter((item) => item !== option),
                            }))
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {(customizingProduct.modifier_groups || []).map((group) => {
                const single = Number(group.max_select) === 1;
                const min = Number(group.min_select || 0);
                const max = Number(group.max_select || 0);
                const hint = single ? (min ? "choose 1" : "optional, choose 1") : `${min ? `at least ${min}` : "optional"}${max ? `, up to ${max}` : ""}`;
                return (
                  <div className="cf-field" key={group.id} data-testid={`modifier-group-${group.id}`}>
                    <label>{group.name} <span className="cf-card__meta">({hint})</span></label>
                    <div className="cf-checkbox-row">
                      {(group.options || []).filter((option) => option.active !== false).map((option) => {
                        const selected = (customization.modifiers || []).includes(option.id);
                        const groupSelected = (customization.modifiers || []).filter((id) => group.options.some((entry) => entry.id === id));
                        const toggleOption = () => setCustomization((current) => {
                          const currentIds = current.modifiers || [];
                          if (single) {
                            const others = currentIds.filter((id) => !group.options.some((entry) => entry.id === id));
                            return { ...current, modifiers: selected && !min ? others : [...others, option.id] };
                          }
                          return { ...current, modifiers: selected ? currentIds.filter((id) => id !== option.id) : [...currentIds, option.id] };
                        });
                        return (
                          <label key={option.id}>
                            <input
                              type={single ? "radio" : "checkbox"}
                              name={`modifier-${group.id}`}
                              checked={selected}
                              disabled={!single && !selected && max > 0 && groupSelected.length >= max}
                              onChange={toggleOption}
                            />
                            {option.name}{Number(option.price) ? ` (+${formatCurrency(option.price, settings.currency)})` : ""}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="cf-field">
                <label>Extra Instruction</label>
                <textarea
                  className="cf-textarea"
                  placeholder={customizationProfile.notePlaceholder}
                  value={customization.customNote}
                  onChange={(event) => setCustomization((current) => ({ ...current, customNote: event.target.value }))}
                />
              </div>
              <div className="cf-dialog-actions">
                <button className="cf-btn cf-btn--secondary" onClick={() => setCustomizingProduct(null)} type="button">
                  Cancel
                </button>
                <button
                  className="cf-btn cf-btn--primary"
                  onClick={() => {
                    const added = addConfiguredItemToCart(
                      customizingProduct,
                      customization.variation,
                      customization.addons,
                      customization.removals,
                      customization.customNote,
                      customization.modifiers || []
                    );
                    if (added) {
                      setCustomizingProduct(null);
                    }
                  }}
                  type="button"
                >
                  Add to Cart
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

