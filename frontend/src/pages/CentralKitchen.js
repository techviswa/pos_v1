import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { API_URL } from "../lib/apiUrl";
import { apiData } from "../lib/apiData";
import { formatQuantity } from "../lib/quantity";
import { formatCurrency, hasPermission } from "../lib/pos";
import { useAuth } from "../contexts/AuthContext";
import "./CentralKitchen.css";
import { getApiErrorMessage } from "../lib/apiErrors";

const defaultOutletForm = {
  name: "",
  code: "",
  location: "",
  manager_name: "",
  phone: "",
  status: "Active",
  delivery_window: "",
  notes: "",
};

const defaultPurchaseOrderForm = {
  outlet_id: "",
  priority: "Medium",
  required_by: "",
  notes: "",
  items: [{ inventory_id: "", requested_quantity: "" }],
};

const defaultRestockForm = {
  outlet_id: "",
  inventory_id: "",
  quantity: "",
};

const defaultRouteForm = {
  route_name: "",
  dispatch_date: "",
  driver_name: "",
  vehicle_number: "",
  status: "Scheduled",
  stops: [{ outlet_id: "", eta: "" }],
};

export const CentralKitchen = () => {
  const { user } = useAuth();
  const canManage = ["owner", "manager"].includes(String(user?.role || "").toLowerCase()) && hasPermission(user, "central_kitchen");
  const canInventory = hasPermission(user, "inventory");
  const { selectedOutletId } = useActiveOutlet();
  const scopeRef = useRef(selectedOutletId); scopeRef.current = selectedOutletId;
  const dirtyCosts = useRef(new Set());
  const requestSequence = useRef(0);
  const submittedRequests = useRef({});
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outletSearch, setOutletSearch] = useState("");
  const [transferBusy, setTransferBusy] = useState(null);
  const [limits, setLimits] = useState({ balances: 10, transfers: 10, orders: 8, routes: 8 });
  const moreRows = (name, rows) => <div style={{ padding: 12 }}><small>Showing {Math.min(limits[name], rows.length)} of {rows.length}</small>{rows.length > limits[name] ? <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => setLimits((current) => ({ ...current, [name]: current[name] + 10 }))}>Show more</button> : null}</div>;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState({
    overview: {},
    outlets: [],
    central_inventory: [],
    low_stock_items: [],
    purchase_orders: [],
    route_plans: [],
    outlet_inventory: [],
    restock_logs: [],
  });
  const [costDrafts, setCostDrafts] = useState({});
  const [showOutletDialog, setShowOutletDialog] = useState(false);
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  const [showRestockDialog, setShowRestockDialog] = useState(false);
  const [showRouteDialog, setShowRouteDialog] = useState(false);
  const [outletForm, setOutletForm] = useState(defaultOutletForm);
  const [purchaseOrderForm, setPurchaseOrderForm] = useState(defaultPurchaseOrderForm);
  const [restockForm, setRestockForm] = useState(defaultRestockForm);
  const [routeForm, setRouteForm] = useState(defaultRouteForm);
  const hasLoadedSnapshotRef = useRef(false);
  useEffect(() => {
    setLoading(true); setError(""); hasLoadedSnapshotRef.current = false;
    setSnapshot({ overview: {}, outlets: [], central_inventory: [], low_stock_items: [], purchase_orders: [], route_plans: [], outlet_inventory: [], restock_logs: [] });
  }, [selectedOutletId]);

  const fetchSnapshot = async () => {
    const sequence = ++requestSequence.current;
    try {
      const response = await axios.get(`${API_URL}/api/central-kitchen`, { withCredentials: true, skipCache: true, params: selectedOutletId ? { outlet_id: selectedOutletId } : {} });
      if (scopeRef.current !== selectedOutletId || sequence !== requestSequence.current) return;
      const data = apiData(response);
      setSnapshot(data); setError("");
      setCostDrafts((current) => Object.fromEntries((data.central_inventory || []).map((item) => [item.id, dirtyCosts.current.has(item.id) ? current[item.id] : item.conversion_cost ?? 0])));
      hasLoadedSnapshotRef.current = true;
    } catch (error) {
      if (scopeRef.current === selectedOutletId && sequence === requestSequence.current) setError(getApiErrorMessage(error, "Failed to load central kitchen"));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  useAutoRefresh(fetchSnapshot, { refreshKey: selectedOutletId, intervalMs: 30000, refreshOnFocus: true, liveResources: ["inventory", "outlets", "purchase_orders", "routes"] });

  const inventoryOptions = snapshot.central_inventory || [];
  const submit = async (kind, payload) => {
    const fingerprint = JSON.stringify(payload);
    if (submittedRequests.current[kind]?.fingerprint !== fingerprint) submittedRequests.current[kind] = { fingerprint, id: `request_${Date.now()}_${Math.random().toString(36).slice(2)}` };
    return axios.post(`${API_URL}/api/central-kitchen/${kind}`, { ...payload, request_id: submittedRequests.current[kind].id }, { withCredentials: true });
  };
  const beginSave = () => { if (savingRef.current) return false; savingRef.current = true; setSaving(true); return true; };
  const endSave = () => { savingRef.current = false; setSaving(false); };

  const createOutlet = async (event) => {
    event.preventDefault();
    if (!beginSave()) return;
    try {
      await submit("outlets", outletForm);
      delete submittedRequests.current.outlets;
      toast.success("Outlet added to central kitchen");
      setShowOutletDialog(false);
      setOutletForm(defaultOutletForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to create outlet"));
    } finally { endSave(); }
  };

  const createPurchaseOrder = async (event) => {
    event.preventDefault();
    if (!beginSave()) return;
    try {
      await submit("purchase-orders",
        {
          ...purchaseOrderForm,
          items: purchaseOrderForm.items
            .filter((item) => item.inventory_id && item.requested_quantity)
            .map((item) => ({
              inventory_id: item.inventory_id,
              requested_quantity: Number(item.requested_quantity),
            })),
        }
      );
      delete submittedRequests.current["purchase-orders"];
      toast.success("Purchase order raised");
      setShowPurchaseDialog(false);
      setPurchaseOrderForm(defaultPurchaseOrderForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to create purchase order"));
    } finally { endSave(); }
  };

  const createRestock = async (event) => {
    event.preventDefault();
    if (!beginSave()) return;
    try {
      await submit("restocks", { ...restockForm, quantity: Number(restockForm.quantity) });
      delete submittedRequests.current.restocks;
      toast.success("Transfer requested. Stock becomes available after approval and receipt.");
      setShowRestockDialog(false);
      setRestockForm(defaultRestockForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to request stock transfer"));
    } finally { endSave(); }
  };

  const createRoute = async (event) => {
    event.preventDefault();
    if (!beginSave()) return;
    try {
      await submit("routes", { ...routeForm, stops: routeForm.stops.filter((stop) => stop.outlet_id) });
      delete submittedRequests.current.routes;
      toast.success("Delivery route planned");
      setShowRouteDialog(false);
      setRouteForm(defaultRouteForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to save route plan"));
    } finally { endSave(); }
  };

  const saveConversionCost = async (inventoryId) => {
    if (costDrafts[inventoryId] === "" || !Number.isFinite(Number(costDrafts[inventoryId])) || Number(costDrafts[inventoryId]) < 0) { toast.error("Enter a non-negative unit cost"); return; }
    try {
      await axios.put(
        `${API_URL}/api/inventory/${inventoryId}`,
        { conversion_cost: Number(costDrafts[inventoryId] || 0) },
        { withCredentials: true }
      );
      toast.success("Conversion cost updated");
      dirtyCosts.current.delete(inventoryId);
      fetchSnapshot();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to update conversion cost");
    }
  };

  const updateTransfer = async (id, action) => {
    setTransferBusy(id);
    try { await axios.post(`${API_URL}/api/inventory/transfers/${id}/${action}`, {}, { withCredentials: true }); toast.success(action === "approve" ? "Dispatched from the source store. Awaiting outlet receipt." : "Receipt confirmed. Outlet stock updated."); await fetchSnapshot(); }
    catch (failure) { toast.error(getApiErrorMessage(failure, "Unable to update transfer")); }
    finally { setTransferBusy(null); }
  };

  const updatePoItem = (index, key, value) => {
    const nextItems = [...purchaseOrderForm.items];
    nextItems[index] = { ...nextItems[index], [key]: value };
    setPurchaseOrderForm({ ...purchaseOrderForm, items: nextItems });
  };

  const updateRouteStop = (index, key, value) => {
    const nextStops = [...routeForm.stops];
    nextStops[index] = { ...nextStops[index], [key]: value };
    setRouteForm({ ...routeForm, stops: nextStops });
  };

  if (loading) {
    return (
      <Layout title="Central Kitchen">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading central kitchen...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Central Kitchen">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Central Kitchen Management</h1>
            <p>Manage outlets, raw material stock, purchase orders, conversion costs, and delivery routes from one screen</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" onClick={fetchSnapshot}>Refresh</button>
            {canManage && <button className="cf-btn cf-btn--secondary" onClick={() => setShowOutletDialog(true)}>
              + Add Outlet
            </button>}
            {canManage && <button className="cf-btn cf-btn--secondary" onClick={() => setShowPurchaseDialog(true)}>
              + Purchase Order
            </button>}
            {canManage && <button className="cf-btn cf-btn--secondary" onClick={() => setShowRouteDialog(true)}>
              + Route Plan
            </button>}
            {canManage && canInventory && <button className="cf-btn cf-btn--primary" onClick={() => setShowRestockDialog(true)}>
              + Request stock transfer
            </button>}
          </div>
        </div>

        {error ? <p role="alert">{error} {hasLoadedSnapshotRef.current ? "Showing the last loaded snapshot." : ""} <button className="cf-btn" onClick={fetchSnapshot}>Retry</button></p> : null}
        <p className="cf-card__meta">Stock location: {snapshot.stock_location || "Loading"}. Usage is based on recorded consumption over the last 30 days.</p>
        <div className="cf-metrics">
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/central-kitchen/outlets")} type="button">
            <div className="cf-metric__label">Outlets</div>
            <div className="cf-metric__value">{snapshot.overview.total_outlets || 0}</div>
            <div className="cf-metric__sub">Connected to the central kitchen</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/central-kitchen/purchase-orders")} type="button">
            <div className="cf-metric__label">Open POs</div>
            <div className="cf-metric__value">{snapshot.overview.open_purchase_orders || 0}</div>
            <div className="cf-metric__sub">Demand raised by bakery outlets</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/central-kitchen/routes")} type="button">
            <div className="cf-metric__label">Routes Scheduled</div>
            <div className="cf-metric__value">{snapshot.overview.scheduled_routes || 0}</div>
            <div className="cf-metric__sub">Delivery plans ready for dispatch</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/central-kitchen/stock-value")} type="button">
            <div className="cf-metric__label">{selectedOutletId ? "Outlet stock value" : "Central stock value"}</div>
            <div className="cf-metric__value">{formatCurrency(snapshot.overview.central_inventory_value || 0)}</div>
            <div className="cf-metric__sub">Tracked quantity × location unit cost</div>
          </button>
        </div>

        <div className="cf-kitchen-hero">
          <div className="cf-kitchen-hero__copy">
            <div className="cf-section-title">One kitchen. Every outlet.</div>
            <p>
              Centralize restocking, raw material planning, item conversion costs, and dispatch routes so outlets never
              run out of critical ingredients.
            </p>
          </div>
          <div className="cf-kitchen-hero__meta">
            <button onClick={() => navigate("/central-kitchen/risks")} style={{ background: "transparent", border: 0, padding: 0, textAlign: "left" }} type="button">
              <strong>{snapshot.low_stock_items.length}</strong>
              <span>below reorder level</span>
            </button>
            <button onClick={() => navigate("/central-kitchen/restocks")} style={{ background: "transparent", border: 0, padding: 0, textAlign: "left" }} type="button">
              <strong>{snapshot.overview.restocks_this_week || 0}</strong>
              <span>restocks this week</span>
            </button>
          </div>
        </div>

        <div className="cf-kitchen-grid">
          <div className="cf-card cf-card--padded">
            <div className="cf-section-title">Active outlets</div>
            <input className="cf-input" aria-label="Find outlet" placeholder="Find an outlet" value={outletSearch} onChange={(event) => setOutletSearch(event.target.value)} />
            <div className="cf-kitchen-list">
                {(snapshot.outlets || []).filter((outlet) => `${outlet.name} ${outlet.code}`.toLowerCase().includes(outletSearch.toLowerCase())).map((outlet) => (
                  <div className="cf-kitchen-list__item" key={outlet.id}>
                    <div>
                    <div className="cf-kitchen-list__title">{outlet.name}</div>
                    <div className="cf-kitchen-list__meta">
                      {[outlet.code, outlet.location, outlet.delivery_window].filter(Boolean).join(" · ")}
                    </div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <span>{outlet.inventory_lines || 0} tracked ingredients</span>
                      <span>{outlet.open_purchase_orders || 0} open purchase orders</span>
                      <button
                        className="cf-btn cf-btn--secondary cf-btn--small"
                        onClick={() => navigate(`/outlets/${outlet.id}`)}
                        type="button"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              {!snapshot.outlets.length ? <div className="cf-empty-state">No bakery outlets added yet.</div> : null}
            </div>
          </div>

          <div className="cf-card cf-card--padded">
            <div className="cf-section-title">Below reorder level ({snapshot.low_stock_items.length})</div>
            <p className="cf-card__meta">Alerts use each ingredient's reorder level. A run-out estimate needs recorded usage at the same stock location.</p>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Stock</th>
                  <th>Daily Use</th>
                  <th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.low_stock_items || []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="cf-table__mono">{formatQuantity(item.current_stock, item.unit)}</td>
                    <td className="cf-table__mono">{item.usage_history_available ? formatQuantity(item.avg_daily_consumption, item.unit) : "No usage history"}</td>
                    <td className="cf-table__mono">{item.days_remaining == null ? "No estimate" : `${formatQuantity(item.days_remaining)} days`}</td>
                  </tr>
                ))}
                {!snapshot.low_stock_items.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No reorder alerts among tracked ingredients. Untracked ingredients still need stock setup.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-table-wrap" style={{ marginTop: 24 }}>
          <div className="cf-section-title">{snapshot.stock_location || "Stock"} inventory and unit cost</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Stock</th>
                <th>Reorder</th>
                <th>Unit cost</th>
                <th>Vendor</th>
                {canInventory && snapshot.stock_location === "Central store" ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {inventoryOptions.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td className="cf-table__mono">{item.stock_configured === false ? "Not tracked here" : formatQuantity(item.current_stock, item.unit)}</td>
                  <td className="cf-table__mono">{formatQuantity(item.reorder_level, item.unit)}</td>
                  <td>
                    {snapshot.stock_location !== "Central store" || !canInventory ? <span>{item.conversion_cost == null ? "Not available" : formatCurrency(item.conversion_cost)}</span> : <input
                      className="cf-input"
                      style={{ minWidth: 120 }}
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!canInventory || snapshot.stock_location !== "Central store"}
                      value={snapshot.stock_location === "Central store" ? costDrafts[item.id] ?? 0 : item.conversion_cost ?? 0}
                      onChange={(event) => { dirtyCosts.current.add(item.id); setCostDrafts((current) => ({ ...current, [item.id]: event.target.value })); }}
                    />}
                  </td>
                  <td>{item.vendor || "-"}</td>
                  {canInventory && snapshot.stock_location === "Central store" ? <td>
                    <button disabled={!dirtyCosts.current.has(item.id)} className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => saveConversionCost(item.id)}>
                      Save Cost
                    </button>
                  </td> : null}
                </tr>
              ))}
              {!inventoryOptions.length ? (
                <tr>
                  <td colSpan="6" style={{ color: "var(--cf-text-3)" }}>Add central inventory items first.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="cf-grid-2" style={{ marginTop: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Outlet Inventory Allocation</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Route</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.outlet_inventory || []).slice(0, limits.balances).map((line) => (
                  <tr key={line.id}>
                    <td>{line.outlet_name}</td>
                    <td>{line.inventory_name}</td>
                    <td className="cf-table__mono">{formatQuantity(line.current_stock, line.unit)}</td>
                    <td>{line.route_name || "-"}</td>
                  </tr>
                ))}
                {!snapshot.outlet_inventory.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No outlet allocations yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {moreRows("balances", snapshot.outlet_inventory || [])}
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Stock transfers</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th>Next step</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.restock_logs || []).slice(0, limits.transfers).map((log) => (
                  <tr key={log.id}>
                    <td>{log.outlet_name}</td>
                    <td>{(log.items || []).map((item, index) => <div key={index}>{item.inventory_name || "Ingredient"}: {formatQuantity(item.received_quantity ?? item.approved_quantity ?? item.requested_quantity, item.unit)}</div>)}</td>
                    <td>{({ pending_approval: "Awaiting approval", approved: "Dispatched — awaiting receipt", received: "Received" })[log.status] || log.status}</td>
                    <td>{canInventory && log.status === "pending_approval" ? <button className="cf-btn cf-btn--small" disabled={Boolean(transferBusy)} onClick={() => updateTransfer(log.id, "approve")}>Approve dispatch</button> : canInventory && log.status === "approved" ? <button className="cf-btn cf-btn--small" disabled={Boolean(transferBusy)} onClick={() => updateTransfer(log.id, "receive")}>Confirm received</button> : log.status === "received" ? "Complete" : "Awaiting authorised staff"}</td>
                  </tr>
                ))}
                {!snapshot.restock_logs.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No stock transfers recorded yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {moreRows("transfers", snapshot.restock_logs || [])}
          </div>
        </div>

        <Dialog open={showOutletDialog} onOpenChange={setShowOutletDialog}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Add Outlet</DialogTitle>
            </DialogHeader>
            <form onSubmit={createOutlet}>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Outlet Name</label>
                  <input className="cf-input" required value={outletForm.name} onChange={(event) => setOutletForm({ ...outletForm, name: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Outlet Code</label>
                  <input className="cf-input" required value={outletForm.code} onChange={(event) => setOutletForm({ ...outletForm, code: event.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Location</label>
                  <input className="cf-input" required value={outletForm.location} onChange={(event) => setOutletForm({ ...outletForm, location: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Delivery Window</label>
                  <input className="cf-input" value={outletForm.delivery_window} onChange={(event) => setOutletForm({ ...outletForm, delivery_window: event.target.value })} />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Manager Name</label>
                  <input className="cf-input" value={outletForm.manager_name} onChange={(event) => setOutletForm({ ...outletForm, manager_name: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Phone</label>
                  <input className="cf-input" value={outletForm.phone} onChange={(event) => setOutletForm({ ...outletForm, phone: event.target.value })} />
                </div>
              </div>
              <div className="cf-field">
                <label>Notes</label>
                <textarea className="cf-textarea" value={outletForm.notes} onChange={(event) => setOutletForm({ ...outletForm, notes: event.target.value })} />
              </div>
              <DialogFooter className="cf-dialog-actions">
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowOutletDialog(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="cf-btn cf-btn--primary">Save Outlet</button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showPurchaseDialog} onOpenChange={setShowPurchaseDialog}>
          <DialogContent className="bg-white" style={{ maxWidth: 820 }}>
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Raise Outlet Purchase Order</DialogTitle>
            </DialogHeader>
            <form onSubmit={createPurchaseOrder}>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Outlet</label>
                  <select className="cf-select" required value={purchaseOrderForm.outlet_id} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, outlet_id: event.target.value })}>
                    <option value="">Select outlet</option>
                    {snapshot.outlets.map((outlet) => (
                      <option key={outlet.id} value={outlet.id}>{outlet.name}</option>
                    ))}
                  </select>
                </div>
                <div className="cf-field">
                  <label>Priority</label>
                  <select className="cf-select" value={purchaseOrderForm.priority} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, priority: event.target.value })}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="cf-field">
                <label>Required By</label>
                <input className="cf-input" type="date" value={purchaseOrderForm.required_by} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, required_by: event.target.value })} />
              </div>
              {purchaseOrderForm.items.map((item, index) => (
                <div className="cf-grid-2" key={`po-item-${index}`}>
                  <div className="cf-field">
                    <label>Inventory Item</label>
                    <select className="cf-select" required value={item.inventory_id} onChange={(event) => updatePoItem(index, "inventory_id", event.target.value)}>
                      <option value="">Select ingredient</option>
                      {inventoryOptions.map((inventoryItem) => (
                        <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cf-field">
                    <label>Requested Quantity</label>
                    <input className="cf-input" type="number" min="0.01" step="0.01" required value={item.requested_quantity} onChange={(event) => updatePoItem(index, "requested_quantity", event.target.value)} />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="cf-btn cf-btn--secondary cf-btn--small"
                onClick={() => setPurchaseOrderForm({ ...purchaseOrderForm, items: [...purchaseOrderForm.items, { inventory_id: "", requested_quantity: "" }] })}
              >
                + Add Line
              </button>
              <div className="cf-field" style={{ marginTop: 20 }}>
                <label>Notes</label>
                <textarea className="cf-textarea" value={purchaseOrderForm.notes} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, notes: event.target.value })} />
              </div>
              <DialogFooter className="cf-dialog-actions">
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowPurchaseDialog(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="cf-btn cf-btn--primary">Create PO</button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <div className="cf-grid-2" style={{ marginTop: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Outlet Purchase Orders</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.purchase_orders || []).slice(0, limits.orders).map((order) => (
                  <tr key={order.id}>
                    <td>{order.outlet_name}</td>
                    <td>{order.priority}</td>
                    <td>{order.status}</td>
                    <td className="cf-table__mono">{order.items?.length || 0}</td>
                  </tr>
                ))}
                {!snapshot.purchase_orders.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No purchase orders yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {moreRows("orders", snapshot.purchase_orders || [])}
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Delivery Route Plan</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Dispatch</th>
                  <th>Vehicle</th>
                  <th>Stops</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.route_plans || []).slice(0, limits.routes).map((route) => (
                  <tr key={route.id}>
                    <td>{route.route_name}</td>
                    <td>{route.dispatch_date || "-"}</td>
                    <td>{route.vehicle_number || "-"}</td>
                    <td className="cf-table__mono">{route.stops?.length || 0}</td>
                  </tr>
                ))}
                {!snapshot.route_plans.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No route plans created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {moreRows("routes", snapshot.route_plans || [])}
          </div>
        </div>

        <Dialog open={showRestockDialog} onOpenChange={setShowRestockDialog}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Request stock from central store</DialogTitle>
            </DialogHeader>
            <form onSubmit={createRestock}>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Outlet</label>
                  <select className="cf-select" required value={restockForm.outlet_id} onChange={(event) => setRestockForm({ ...restockForm, outlet_id: event.target.value })}>
                    <option value="">Select outlet</option>
                    {snapshot.outlets.map((outlet) => (
                      <option key={outlet.id} value={outlet.id}>{outlet.name}</option>
                    ))}
                  </select>
                </div>
                <div className="cf-field">
                  <label>Ingredient</label>
                  <select className="cf-select" required value={restockForm.inventory_id} onChange={(event) => setRestockForm({ ...restockForm, inventory_id: event.target.value })}>
                    <option value="">Select ingredient</option>
                    {inventoryOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Quantity</label>
                  <input className="cf-input" type="number" min="0.01" step="0.01" required value={restockForm.quantity} onChange={(event) => setRestockForm({ ...restockForm, quantity: event.target.value })} />
                </div>
              </div>
              <p>Creates a pending transfer. Approve dispatch, then confirm outlet receipt. Plan delivery stops separately under Route Plan.</p>
              <DialogFooter className="cf-dialog-actions">
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowRestockDialog(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="cf-btn cf-btn--primary">Request transfer</button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showRouteDialog} onOpenChange={setShowRouteDialog}>
          <DialogContent className="bg-white" style={{ maxWidth: 860 }}>
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Delivery Route Plan</DialogTitle>
            </DialogHeader>
            <form onSubmit={createRoute}>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Route Name</label>
                  <input className="cf-input" required value={routeForm.route_name} onChange={(event) => setRouteForm({ ...routeForm, route_name: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Dispatch Date</label>
                  <input className="cf-input" type="date" value={routeForm.dispatch_date} onChange={(event) => setRouteForm({ ...routeForm, dispatch_date: event.target.value })} />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Driver</label>
                  <input className="cf-input" value={routeForm.driver_name} onChange={(event) => setRouteForm({ ...routeForm, driver_name: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Vehicle Number</label>
                  <input className="cf-input" value={routeForm.vehicle_number} onChange={(event) => setRouteForm({ ...routeForm, vehicle_number: event.target.value })} />
                </div>
              </div>
              {routeForm.stops.map((stop, index) => (
                <div className="cf-grid-2" key={`stop-${index}`}>
                  <div className="cf-field">
                    <label>Outlet Stop</label>
                    <select className="cf-select" required value={stop.outlet_id} onChange={(event) => updateRouteStop(index, "outlet_id", event.target.value)}>
                      <option value="">Select outlet</option>
                      {snapshot.outlets.map((outlet) => (
                        <option key={outlet.id} value={outlet.id}>{outlet.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cf-field">
                    <label>ETA</label>
                    <input className="cf-input" value={stop.eta} onChange={(event) => updateRouteStop(index, "eta", event.target.value)} placeholder="9:30 AM" />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="cf-btn cf-btn--secondary cf-btn--small"
                onClick={() => setRouteForm({ ...routeForm, stops: [...routeForm.stops, { outlet_id: "", eta: "" }] })}
              >
                + Add Stop
              </button>
              <DialogFooter className="cf-dialog-actions">
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowRouteDialog(false)}>Cancel</button>
                <button type="submit" disabled={saving} className="cf-btn cf-btn--primary">Save Route</button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

