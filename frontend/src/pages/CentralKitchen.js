import React, { useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

const API_URL = process.env.REACT_APP_BACKEND_URL;

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
  route_name: "",
  eta: "",
  note: "",
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

  const fetchSnapshot = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/central-kitchen`, { withCredentials: true });
      setSnapshot(response.data);
      setCostDrafts(
        Object.fromEntries((response.data.central_inventory || []).map((item) => [item.id, item.conversion_cost ?? 0]))
      );
      hasLoadedSnapshotRef.current = true;
    } catch (error) {
      if (!hasLoadedSnapshotRef.current) {
        toast.error(error.response?.data?.detail || "Failed to load central kitchen");
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchSnapshot);

  const inventoryOptions = snapshot.central_inventory || [];

  const createOutlet = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API_URL}/api/central-kitchen/outlets`, outletForm, { withCredentials: true });
      toast.success("Outlet added to central kitchen");
      setShowOutletDialog(false);
      setOutletForm(defaultOutletForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to create outlet");
    }
  };

  const createPurchaseOrder = async (event) => {
    event.preventDefault();
    try {
      await axios.post(
        `${API_URL}/api/central-kitchen/purchase-orders`,
        {
          ...purchaseOrderForm,
          items: purchaseOrderForm.items
            .filter((item) => item.inventory_id && item.requested_quantity)
            .map((item) => ({
              inventory_id: item.inventory_id,
              requested_quantity: Number(item.requested_quantity),
            })),
        },
        { withCredentials: true }
      );
      toast.success("Purchase order raised");
      setShowPurchaseDialog(false);
      setPurchaseOrderForm(defaultPurchaseOrderForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to create purchase order");
    }
  };

  const createRestock = async (event) => {
    event.preventDefault();
    try {
      await axios.post(
        `${API_URL}/api/central-kitchen/restocks`,
        { ...restockForm, quantity: Number(restockForm.quantity) },
        { withCredentials: true }
      );
      toast.success("Outlet restocked from central kitchen");
      setShowRestockDialog(false);
      setRestockForm(defaultRestockForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to restock outlet");
    }
  };

  const createRoute = async (event) => {
    event.preventDefault();
    try {
      await axios.post(
        `${API_URL}/api/central-kitchen/routes`,
        { ...routeForm, stops: routeForm.stops.filter((stop) => stop.outlet_id) },
        { withCredentials: true }
      );
      toast.success("Delivery route planned");
      setShowRouteDialog(false);
      setRouteForm(defaultRouteForm);
      fetchSnapshot();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save route plan");
    }
  };

  const saveConversionCost = async (inventoryId) => {
    try {
      await axios.put(
        `${API_URL}/api/inventory/${inventoryId}`,
        { conversion_cost: Number(costDrafts[inventoryId] || 0) },
        { withCredentials: true }
      );
      toast.success("Conversion cost updated");
      fetchSnapshot();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to update conversion cost");
    }
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
            <button className="cf-btn cf-btn--secondary" onClick={() => setShowOutletDialog(true)}>
              + Add Outlet
            </button>
            <button className="cf-btn cf-btn--secondary" onClick={() => setShowPurchaseDialog(true)}>
              + Purchase Order
            </button>
            <button className="cf-btn cf-btn--secondary" onClick={() => setShowRouteDialog(true)}>
              + Route Plan
            </button>
            <button className="cf-btn cf-btn--primary" onClick={() => setShowRestockDialog(true)}>
              + Restock Outlet
            </button>
          </div>
        </div>

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
            <div className="cf-metric__label">Kitchen Stock Value</div>
            <div className="cf-metric__value">₹{snapshot.overview.central_inventory_value || 0}</div>
            <div className="cf-metric__sub">Based on central conversion cost</div>
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
              <span>ingredients at risk</span>
            </button>
            <button onClick={() => navigate("/central-kitchen/restocks")} style={{ background: "transparent", border: 0, padding: 0, textAlign: "left" }} type="button">
              <strong>{snapshot.overview.restocks_this_week || 0}</strong>
              <span>restocks this week</span>
            </button>
          </div>
        </div>

        <div className="cf-kitchen-grid">
          <div className="cf-card cf-card--padded">
            <div className="cf-section-title">Outlet Control Tower</div>
            <div className="cf-kitchen-list">
                {(snapshot.outlets || []).map((outlet) => (
                  <div className="cf-kitchen-list__item" key={outlet.id}>
                    <div>
                    <div className="cf-kitchen-list__title">{outlet.name}</div>
                    <div className="cf-kitchen-list__meta">
                      {outlet.code} · {outlet.location} · {outlet.delivery_window || "Window not set"}
                    </div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <span>{outlet.inventory_lines || 0} stock lines</span>
                      <span>{outlet.open_purchase_orders || 0} open PO</span>
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
            <div className="cf-section-title">Run-Out Forecast</div>
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
                {(snapshot.low_stock_items || []).slice(0, 6).map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                    <td className="cf-table__mono">{item.avg_daily_consumption || 0} {item.unit}</td>
                    <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                  </tr>
                ))}
                {!snapshot.low_stock_items.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>Kitchen stock is healthy right now.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-table-wrap" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Central Raw Material Stock and Conversion Cost</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Stock</th>
                <th>Reorder</th>
                <th>Conversion Cost</th>
                <th>Vendor</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {inventoryOptions.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                  <td className="cf-table__mono">{item.reorder_level} {item.unit}</td>
                  <td>
                    <input
                      className="cf-input"
                      style={{ minWidth: 120 }}
                      type="number"
                      step="0.01"
                      value={costDrafts[item.id] ?? 0}
                      onChange={(event) => setCostDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                  </td>
                  <td>{item.vendor || "-"}</td>
                  <td>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => saveConversionCost(item.id)}>
                      Save Cost
                    </button>
                  </td>
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
                {(snapshot.outlet_inventory || []).slice(0, 10).map((line) => (
                  <tr key={line.id}>
                    <td>{line.outlet_name}</td>
                    <td>{line.inventory_name}</td>
                    <td className="cf-table__mono">{line.quantity} {line.unit}</td>
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
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Recent Restocks</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.restock_logs || []).slice(0, 10).map((log) => (
                  <tr key={log.id}>
                    <td>{log.outlet_name}</td>
                    <td>{log.inventory_name}</td>
                    <td className="cf-table__mono">{log.quantity} {log.unit}</td>
                    <td>{log.eta || "-"}</td>
                  </tr>
                ))}
                {!snapshot.restock_logs.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No restocks recorded yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
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
                <button type="submit" className="cf-btn cf-btn--primary">Save Outlet</button>
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
                    <option value="Critical">Critical</option>
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
                <button type="submit" className="cf-btn cf-btn--primary">Create PO</button>
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
                {(snapshot.purchase_orders || []).slice(0, 8).map((order) => (
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
                {(snapshot.route_plans || []).slice(0, 8).map((route) => (
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
          </div>
        </div>

        <Dialog open={showRestockDialog} onOpenChange={setShowRestockDialog}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Restock Outlet from Central Kitchen</DialogTitle>
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
                <div className="cf-field">
                  <label>ETA</label>
                  <input className="cf-input" value={restockForm.eta} onChange={(event) => setRestockForm({ ...restockForm, eta: event.target.value })} placeholder="11:30 AM / today evening" />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Route Name</label>
                  <input className="cf-input" value={restockForm.route_name} onChange={(event) => setRestockForm({ ...restockForm, route_name: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Dispatch Note</label>
                  <input className="cf-input" value={restockForm.note} onChange={(event) => setRestockForm({ ...restockForm, note: event.target.value })} />
                </div>
              </div>
              <DialogFooter className="cf-dialog-actions">
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowRestockDialog(false)}>Cancel</button>
                <button type="submit" className="cf-btn cf-btn--primary">Confirm Restock</button>
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
                <button type="submit" className="cf-btn cf-btn--primary">Save Route</button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};
