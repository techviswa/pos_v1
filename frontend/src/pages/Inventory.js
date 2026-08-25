import React, { useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const INVENTORY_UNIT_OPTIONS = ["kg", "liter", "pound", "tonne", "pieces", "dozens"];
const formatUnitLabel = (unit) => {
  if (unit === "kg") return "Kilograms (kg)";
  if (unit === "liter") return "Liters";
  if (unit === "pound") return "Pounds";
  if (unit === "tonne") return "Tonnes";
  if (unit === "pieces") return "Pieces";
  if (unit === "dozens") return "Dozens";
  return unit;
};

const movementLabels = {
  purchase: "Purchase",
  consumption: "Consumption",
  wastage: "Wastage",
  pilferage: "Pilferage",
  adjustment: "Adjustment",
};

const badgeClassForMovement = {
  purchase: "cf-badge--green",
  consumption: "cf-badge--blue",
  wastage: "cf-badge--amber",
  pilferage: "cf-badge--red",
  adjustment: "cf-badge--gray",
};

const INVENTORY_SECTION_ORDER = [
  "Bakery Items",
  "Beverages & Coffee",
  "Non-Veg",
  "Pizza & Pasta",
  "Sauces / Toppings",
  "Other",
];

const INVENTORY_SECTION_MAP = {
  "Burger Buns": "Bakery Items",
  "Bread Slices": "Bakery Items",
  Butter: "Bakery Items",
  "Garlic Bread": "Bakery Items",
  "Coffee Powder / Beans": "Beverages & Coffee",
  "Chocolate Syrup": "Beverages & Coffee",
  "Flavored Syrups": "Beverages & Coffee",
  "Soft Drinks Bottles": "Beverages & Coffee",
  Milk: "Beverages & Coffee",
  Sugar: "Beverages & Coffee",
  Ice: "Beverages & Coffee",
  Cream: "Beverages & Coffee",
  "Ice Cream Scoop": "Beverages & Coffee",
  "Maple Syrup": "Beverages & Coffee",
  Honey: "Beverages & Coffee",
  Chicken: "Non-Veg",
  Eggs: "Non-Veg",
  "Pizza Base": "Pizza & Pasta",
  "Pizza Sauce": "Pizza & Pasta",
  Pasta: "Pizza & Pasta",
  Oregano: "Pizza & Pasta",
  "Chilli Flakes": "Pizza & Pasta",
  Paneer: "Sauces / Toppings",
  Mushroom: "Sauces / Toppings",
  Onion: "Sauces / Toppings",
  Tomato: "Sauces / Toppings",
  Capsicum: "Sauces / Toppings",
  Cheese: "Sauces / Toppings",
  "Cheese Slices": "Sauces / Toppings",
  Mayo: "Sauces / Toppings",
  Lettuce: "Sauces / Toppings",
  Jalapenos: "Sauces / Toppings",
  "French Fries": "Sauces / Toppings",
  Olives: "Sauces / Toppings",
  Garlic: "Sauces / Toppings",
  "Chocolate Chips": "Sauces / Toppings",
};

const getInventorySection = (itemName) => INVENTORY_SECTION_MAP[itemName] || "Other";

export const Inventory = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState([]);
  const [unitLibrary, setUnitLibrary] = useState([]);
  const [summary, setSummary] = useState(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showMovementDialog, setShowMovementDialog] = useState(false);
  const [showLedgerDialog, setShowLedgerDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [itemForm, setItemForm] = useState({
    name: "",
    unit: "kg",
    current_stock: "",
    reorder_level: "",
    vendor: "",
    storage_location: "",
    notes: "",
    expiry_date: "",
  });
  const [unitMode, setUnitMode] = useState("select");
  const [newUnitName, setNewUnitName] = useState("");
  const [movementForm, setMovementForm] = useState({
    movement_type: "purchase",
    quantity: "",
    reason: "",
    expiry_date: "",
  });
  const hasLoadedInventoryRef = useRef(false);
  const navigateToSummary = (summaryKey) => {
    navigate(`/inventory/summary/${summaryKey}`, {
      state: {
        inventory,
        snapshot: {
          atRisk: summary?.atRisk || [],
          expiryAlerts: summary?.expiryAlerts || [],
          totalWastage: summary?.totalWastage || 0,
          totalPilferage: summary?.totalPilferage || 0,
          totalItems: summary?.totalItems || inventory.length,
        },
      },
    });
  };

  const fetchInventory = async () => {
    try {
      const [inventoryResponse, unitsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/inventory`, { withCredentials: true }),
        axios.get(`${API_URL}/api/inventory/units`, { withCredentials: true }).catch(() => ({ data: [] })),
      ]);
      setInventory(inventoryResponse.data.items || []);
      setUnitLibrary((unitsResponse.data || []).map((item) => String(item.name || "").trim()).filter(Boolean));
      setSummary({
        atRisk: inventoryResponse.data.at_risk_items || [],
        expiryAlerts: inventoryResponse.data.expiry_alerts || [],
        totalWastage: inventoryResponse.data.total_wastage_last_30_days || 0,
        totalPilferage: inventoryResponse.data.total_pilferage_last_30_days || 0,
        totalItems: inventoryResponse.data.total_inventory_items || 0,
      });
      hasLoadedInventoryRef.current = true;
    } catch (error) {
      if (!hasLoadedInventoryRef.current) {
        toast.error(error.response?.data?.detail || "Failed to load inventory");
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchInventory, {
    enabled: !showAddDialog && !showMovementDialog && !showLedgerDialog,
  });

  const availableUnitOptions = useMemo(
    () => [
      ...new Set(
        [...INVENTORY_UNIT_OPTIONS, ...unitLibrary, ...inventory.map((item) => String(item.unit || "").trim()).filter(Boolean)]
      ),
    ],
    [inventory, unitLibrary]
  );
  const availableSections = useMemo(
    () => INVENTORY_SECTION_ORDER.filter((section) => inventory.some((item) => getInventorySection(item.name) === section)),
    [inventory]
  );

  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const haystack = `${item.name} ${item.vendor || ""} ${item.storage_location || ""}`.toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      const matchesCategory = !categoryFilter || getInventorySection(item.name) === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [categoryFilter, inventory, query]);
  const groupedInventory = useMemo(() => {
    const groups = INVENTORY_SECTION_ORDER.reduce((accumulator, section) => {
      accumulator[section] = [];
      return accumulator;
    }, {});

    filteredInventory.forEach((item) => {
      groups[getInventorySection(item.name)].push(item);
    });

    return INVENTORY_SECTION_ORDER.map((section) => ({
      section,
      items: groups[section].sort((left, right) => left.name.localeCompare(right.name)),
    })).filter((entry) => entry.items.length);
  }, [filteredInventory]);

  const expiryLossControlItems = useMemo(
    () =>
      inventory.filter(
        (item) =>
          Boolean(item.expiry_date) ||
          Number(item.wastage_last_30_days || 0) > 0 ||
          Number(item.pilferage_last_30_days || 0) > 0,
      ),
    [inventory],
  );

  const resetItemForm = () => {
    setEditingItem(null);
    setItemForm({
      name: "",
      unit: "kg",
      current_stock: "",
      reorder_level: "",
      vendor: "",
      storage_location: "",
      notes: "",
      expiry_date: "",
    });
    setUnitMode("select");
    setNewUnitName("");
  };

  const openAddDialog = () => {
    resetItemForm();
    setShowAddDialog(true);
  };

  const openEditDialog = (item) => {
    const normalizedUnit = String(item.unit || "kg").trim() || "kg";
    const isPresetUnit = INVENTORY_UNIT_OPTIONS.includes(normalizedUnit);
    setEditingItem(item);
    setItemForm({
      name: item.name || "",
      unit: normalizedUnit,
      current_stock: item.current_stock?.toString() || "",
      reorder_level: item.reorder_level?.toString() || "",
      vendor: item.vendor || "",
      storage_location: item.storage_location || "",
      notes: item.notes || "",
      expiry_date: item.expiry_date ? item.expiry_date.slice(0, 10) : "",
    });
    setUnitMode(isPresetUnit || availableUnitOptions.includes(normalizedUnit) ? "select" : "new");
    setNewUnitName(isPresetUnit || availableUnitOptions.includes(normalizedUnit) ? "" : normalizedUnit);
    setShowAddDialog(true);
  };

  const saveInventoryItem = async (event) => {
    event.preventDefault();
    const resolvedUnit = (unitMode === "new" ? newUnitName : itemForm.unit).trim().toLowerCase();
    if (!resolvedUnit) {
      toast.error("Enter a unit for this inventory item");
      return;
    }
    const payload = {
      ...itemForm,
      unit: resolvedUnit,
      current_stock: Number(itemForm.current_stock) || 0,
      reorder_level: Number(itemForm.reorder_level) || 0,
      expiry_date: itemForm.expiry_date || null,
    };
    try {
      if (editingItem) {
        await axios.put(`${API_URL}/api/inventory/${editingItem.id}`, payload, { withCredentials: true });
        toast.success("Inventory item updated");
      } else {
        await axios.post(`${API_URL}/api/inventory`, payload, { withCredentials: true });
        toast.success("Inventory item added");
      }
      setShowAddDialog(false);
      resetItemForm();
      fetchInventory();
    } catch (error) {
      toast.error(error.response?.data?.detail || `Unable to ${editingItem ? "update" : "add"} inventory item`);
    }
  };

  const deleteInventoryItem = async (item) => {
    if (!window.confirm(`Delete ${item.name} and its inventory ledger?`)) return;
    try {
      await axios.delete(`${API_URL}/api/inventory/${item.id}`, { withCredentials: true });
      toast.success("Inventory item deleted");
      fetchInventory();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to delete inventory item");
    }
  };

  const submitMovement = async (event) => {
    event.preventDefault();
    if (!selectedItem) return;
    try {
      await axios.post(
        `${API_URL}/api/inventory/${selectedItem.id}/movements`,
        {
          movement_type: movementForm.movement_type,
          quantity: Number(movementForm.quantity),
          reason: movementForm.reason || null,
          expiry_date: movementForm.expiry_date || null,
        },
        { withCredentials: true }
      );
      toast.success("Inventory movement recorded");
      setShowMovementDialog(false);
      setMovementForm({
        movement_type: "purchase",
        quantity: "",
        reason: "",
        expiry_date: "",
      });
      fetchInventory();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to record inventory movement");
    }
  };

  const openMovement = (item) => {
    setSelectedItem(item);
    setShowMovementDialog(true);
  };

  const openLedger = async (item) => {
    setSelectedItem(item);
    try {
      const response = await axios.get(`${API_URL}/api/inventory/${item.id}/movements`, { withCredentials: true });
      setLedger(response.data);
      setShowLedgerDialog(true);
    } catch (error) {
      toast.error("Unable to load inventory ledger");
    }
  };

  if (loading) {
    return (
      <Layout title="Inventory">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading inventory...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Inventory">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Inventory</h1>
            <p>Track item-wise inventory, consumption rate, expiry, wastage, and pilferage</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--primary" onClick={openAddDialog}>
              + Add Inventory Item
            </button>
          </div>
        </div>

        <div className="cf-metrics">
          <button className="cf-metric cf-metric--button" onClick={() => navigateToSummary("items")} type="button">
            <div className="cf-metric__label">Inventory Items</div>
            <div className="cf-metric__value">{summary?.totalItems || 0}</div>
            <div className="cf-metric__sub">Tracked ingredient records</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigateToSummary("at-risk")} type="button">
            <div className="cf-metric__label">At Risk</div>
            <div className="cf-metric__value">{summary?.atRisk.length || 0}</div>
            <div className="cf-metric__sub is-warn">Likely to run out within 7 days</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigateToSummary("expiry")} type="button">
            <div className="cf-metric__label">Expiry Alerts</div>
            <div className="cf-metric__value">{summary?.expiryAlerts.length || 0}</div>
            <div className="cf-metric__sub">Items expiring within 14 days</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigateToSummary("losses")} type="button">
            <div className="cf-metric__label">Losses (30d)</div>
            <div className="cf-metric__value">{summary ? `${summary.totalWastage + summary.totalPilferage}` : 0}</div>
            <div className="cf-metric__sub">
              Wastage {summary?.totalWastage || 0} · Pilferage {summary?.totalPilferage || 0}
            </div>
          </button>
        </div>

        <div className="cf-grid-2" style={{ marginBottom: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Run-Out Watchlist</div>
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
                {(summary?.atRisk || []).slice(0, 6).map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                    <td className="cf-table__mono">{item.avg_daily_consumption || 0} {item.unit}</td>
                    <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                  </tr>
                ))}
                {!(summary?.atRisk || []).length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No critical shortages right now.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Expiry / Loss Control</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Expiry</th>
                  <th>Wastage</th>
                  <th>Pilferage</th>
                </tr>
              </thead>
              <tbody>
                {expiryLossControlItems.slice(0, 6).map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="cf-table__mono">{item.expiry_date ? item.expiry_date.slice(0, 10) : "-"}</td>
                    <td className="cf-table__mono">{item.wastage_last_30_days || 0}</td>
                    <td className="cf-table__mono">{item.pilferage_last_30_days || 0}</td>
                  </tr>
                ))}
                {!expiryLossControlItems.length ? (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>
                      No expiry, wastage, or pilferage records right now.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-table-wrap">
          <div className="cf-table-toolbar">
            <input
              className="cf-search"
              placeholder="Search ingredient, vendor, location..."
              style={{ width: 280 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select className="cf-select" style={{ width: 220 }} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All Categories</option>
              {availableSections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 16, marginBottom: 20 }}>
            {groupedInventory.map((group) => (
              <div className="cf-card cf-card--padded" key={group.section}>
                <div className="cf-section-title">{group.section}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {group.items.map((item) => (
                    <div
                      key={`${group.section}-${item.id}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "10px 12px",
                        border: "1px solid var(--cf-border)",
                        borderRadius: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>
                          Reorder at {item.reorder_level} {item.unit}
                        </div>
                      </div>
                      <div className="cf-table__mono" style={{ alignSelf: "center" }}>
                        {item.current_stock} {item.unit}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!groupedInventory.length ? (
              <div className="cf-empty-state">No inventory items found for this search or category.</div>
            ) : null}
          </div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Stock</th>
                <th>Reorder</th>
                <th>Consumption / Day</th>
                <th>Days Left</th>
                <th>Expiry</th>
                <th>Wastage</th>
                <th>Pilferage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>
                      {item.vendor || "No vendor"} · {item.storage_location || "No location"}
                    </div>
                  </td>
                  <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                  <td className="cf-table__mono">{item.reorder_level} {item.unit}</td>
                  <td className="cf-table__mono">{item.avg_daily_consumption || 0} {item.unit}</td>
                  <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                  <td className="cf-table__mono">{item.expiry_date ? item.expiry_date.slice(0, 10) : "-"}</td>
                  <td className="cf-table__mono">{item.wastage_last_30_days || 0}</td>
                  <td className="cf-table__mono">{item.pilferage_last_30_days || 0}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => openEditDialog(item)}>
                      Edit
                    </button>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => openMovement(item)}>
                      Log Movement
                    </button>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => openLedger(item)}>
                      Ledger
                    </button>
                    <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => deleteInventoryItem(item)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredInventory.length ? (
                <tr>
                  <td colSpan="9" style={{ color: "var(--cf-text-3)" }}>
                    No inventory items found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <Dialog
          open={showAddDialog}
          onOpenChange={(open) => {
            setShowAddDialog(open);
            if (!open) resetItemForm();
          }}
        >
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">{editingItem ? "Edit Inventory Item" : "Add Inventory Item"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveInventoryItem}>
              <div className="cf-field">
                <label>Ingredient / Item Name</label>
                <input className="cf-input" required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} />
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Unit</label>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select
                        className="cf-select"
                        style={{ minWidth: 220, flex: "1 1 220px" }}
                        value={unitMode === "new" ? "__new__" : itemForm.unit}
                        onChange={(event) => {
                          if (event.target.value === "__new__") {
                            setUnitMode("new");
                            setItemForm((current) => ({ ...current, unit: "" }));
                            return;
                          }
                          setUnitMode("select");
                          setNewUnitName("");
                          setItemForm((current) => ({ ...current, unit: event.target.value }));
                        }}
                      >
                        <option value="">Select unit</option>
                        {availableUnitOptions.map((unit) => (
                          <option key={unit} value={unit}>
                            {formatUnitLabel(unit)}
                          </option>
                        ))}
                        <option value="__new__">+ Add New Unit</option>
                      </select>
                      {unitMode === "new" ? (
                        <button
                          className="cf-btn cf-btn--secondary cf-btn--small"
                          onClick={() => {
                            setUnitMode("select");
                            setNewUnitName("");
                          }}
                          type="button"
                        >
                          Use Existing
                        </button>
                      ) : null}
                    </div>
                    {unitMode === "new" ? (
                      <input
                        className="cf-input"
                        placeholder="Enter new unit like ml, gm, tray..."
                        value={newUnitName}
                        onChange={(event) => setNewUnitName(event.target.value)}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="cf-field">
                  <label>Current Stock</label>
                  <input className="cf-input" min="0" step="0.01" type="number" value={itemForm.current_stock} onChange={(event) => setItemForm({ ...itemForm, current_stock: event.target.value })} />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Reorder Level</label>
                  <input className="cf-input" min="0" step="0.01" type="number" value={itemForm.reorder_level} onChange={(event) => setItemForm({ ...itemForm, reorder_level: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Expiry Date</label>
                  <input className="cf-input" type="date" value={itemForm.expiry_date} onChange={(event) => setItemForm({ ...itemForm, expiry_date: event.target.value })} />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Vendor</label>
                  <input className="cf-input" value={itemForm.vendor} onChange={(event) => setItemForm({ ...itemForm, vendor: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Storage Location</label>
                  <input className="cf-input" value={itemForm.storage_location} onChange={(event) => setItemForm({ ...itemForm, storage_location: event.target.value })} />
                </div>
              </div>
              <div className="cf-field">
                <label>Notes</label>
                <textarea className="cf-textarea" value={itemForm.notes} onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })} />
              </div>
              <DialogFooter className="cf-dialog-actions">
                <button
                  type="button"
                  className="cf-btn cf-btn--secondary"
                  onClick={() => {
                    setShowAddDialog(false);
                    resetItemForm();
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="cf-btn cf-btn--primary">
                  {editingItem ? "Save Changes" : "Save Item"}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showMovementDialog} onOpenChange={setShowMovementDialog}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">
                {selectedItem ? `Log Movement - ${selectedItem.name}` : "Log Movement"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={submitMovement}>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Movement Type</label>
                  <select
                    className="cf-select"
                    value={movementForm.movement_type}
                    onChange={(event) => setMovementForm({ ...movementForm, movement_type: event.target.value })}
                  >
                    {Object.entries(movementLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cf-field">
                  <label>Quantity</label>
                  <input
                    className="cf-input"
                    min="0.01"
                    required
                    step="0.01"
                    type="number"
                    value={movementForm.quantity}
                    onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })}
                  />
                </div>
              </div>
              <div className="cf-grid-2">
                <div className="cf-field">
                  <label>Reason</label>
                  <input className="cf-input" value={movementForm.reason} onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Expiry Date Override</label>
                  <input className="cf-input" type="date" value={movementForm.expiry_date} onChange={(event) => setMovementForm({ ...movementForm, expiry_date: event.target.value })} />
                </div>
              </div>
              <DialogFooter className="cf-dialog-actions">
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowMovementDialog(false)}>
                  Cancel
                </button>
                <button type="submit" className="cf-btn cf-btn--primary">
                  Record Movement
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showLedgerDialog} onOpenChange={setShowLedgerDialog}>
          <DialogContent className="bg-white" style={{ maxWidth: 900 }}>
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">
                {selectedItem ? `${selectedItem.name} Ledger` : "Inventory Ledger"}
              </DialogTitle>
            </DialogHeader>
            <div className="cf-table-wrap">
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Quantity</th>
                    <th>Reason</th>
                    <th>Expiry</th>
                    <th>Created By</th>
                    <th>Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <span className={`cf-badge ${badgeClassForMovement[entry.movement_type] || "cf-badge--gray"}`}>
                          {movementLabels[entry.movement_type] || entry.movement_type}
                        </span>
                      </td>
                      <td className="cf-table__mono">{entry.quantity} {entry.unit}</td>
                      <td>{entry.reason || "-"}</td>
                      <td className="cf-table__mono">{entry.expiry_date ? entry.expiry_date.slice(0, 10) : "-"}</td>
                      <td>{entry.created_by_name || "-"}</td>
                      <td className="cf-table__mono">{new Date(entry.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  {!ledger.length ? (
                    <tr>
                      <td colSpan="6" style={{ color: "var(--cf-text-3)" }}>
                        No movements recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};
