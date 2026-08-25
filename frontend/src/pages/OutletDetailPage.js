import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { formatCurrency } from "../lib/pos";
import { useUi } from "../contexts/UiContext";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const createBasicForm = (detail) => ({
  name: detail?.name || "",
  code: detail?.code || "",
  location: detail?.location || "",
  manager_name: detail?.manager_name || "",
  phone: detail?.phone || "",
  status: detail?.status || "active",
});

export const OutletDetailPage = () => {
  const { outletId } = useParams();
  const navigate = useNavigate();
  const { settings } = useUi();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [staff, setStaff] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [features, setFeatures] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [basicForm, setBasicForm] = useState(createBasicForm());
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);

  const fetchData = useCallback(async () => {
    try {
      const [detailResponse, allStaffResponse] = await Promise.all([
        axios.get(`${API_URL}/api/outlets/${outletId}`, { withCredentials: true }),
        axios.get(`${API_URL}/api/staff`, { withCredentials: true }),
      ]);

      const nextDetail = detailResponse.data?.data || detailResponse.data;
      setDetail(nextDetail);
      setStaff(nextDetail?.staff_assignments || []);
      setProducts(nextDetail?.products || []);
      setInventory(nextDetail?.inventory || []);
      setFeatures(nextDetail?.features || []);
      setAllStaff(allStaffResponse.data || []);
      setBasicForm(createBasicForm(nextDetail));
      setSelectedStaffIds((nextDetail?.staff_assignments || []).map((item) => item.user_id));
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Failed to load outlet details");
    } finally {
      setLoading(false);
    }
  }, [outletId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableStaff = useMemo(
    () => (allStaff || []).filter((member) => member.active !== false),
    [allStaff],
  );

  const toggleStaff = (userId) => {
    setSelectedStaffIds((current) =>
      current.includes(userId) ? current.filter((item) => item !== userId) : [...current, userId],
    );
  };

  const saveBasicInfo = async () => {
    try {
      const response = await axios.put(`${API_URL}/api/outlets/${outletId}`, basicForm, {
        withCredentials: true,
      });
      setDetail(response.data?.data || response.data);
      toast.success("Outlet basic info updated");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Unable to update outlet");
    }
  };

  const saveStaffAssignments = async () => {
    try {
      const response = await axios.put(
        `${API_URL}/api/outlets/${outletId}/staff`,
        { assigned_user_ids: selectedStaffIds },
        { withCredentials: true },
      );
      const nextStaff = response.data?.data || response.data || [];
      setStaff(nextStaff);
      toast.success("Outlet staff assignments updated");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Unable to update outlet staff");
    }
  };

  const toggleProductEnabled = (productId) => {
    setProducts((current) =>
      current.map((item) => (item.product_id === productId ? { ...item, enabled: !item.enabled } : item)),
    );
  };

  const changeProductPriceOverride = (productId, value) => {
    setProducts((current) =>
      current.map((item) =>
        item.product_id === productId ? { ...item, price_override: value === "" ? "" : Number(value) } : item,
      ),
    );
  };

  const saveProducts = async () => {
    try {
      const response = await axios.put(
        `${API_URL}/api/outlets/${outletId}/products`,
        {
          items: products.map((item) => ({
            product_id: item.product_id,
            enabled: item.enabled,
            price_override: item.price_override === "" ? null : item.price_override,
          })),
        },
        { withCredentials: true },
      );
      setProducts(response.data?.data || response.data || []);
      toast.success("Outlet products updated");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Unable to update outlet products");
    }
  };

  const updateInventoryLine = (inventoryId, key, value) => {
    setInventory((current) =>
      current.map((item) =>
        item.inventory_id === inventoryId
          ? {
              ...item,
              [key]: key === "enabled" ? value : Number(value),
            }
          : item,
      ),
    );
  };

  const saveInventory = async () => {
    try {
      const response = await axios.put(
        `${API_URL}/api/outlets/${outletId}/inventory`,
        {
          items: inventory.map((item) => ({
            inventory_id: item.inventory_id,
            stock: item.stock,
            reorder_level: item.reorder_level,
            enabled: item.enabled,
          })),
        },
        { withCredentials: true },
      );
      setInventory(response.data?.data || response.data || []);
      toast.success("Outlet inventory updated");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Unable to update outlet inventory");
    }
  };

  const toggleFeature = (featureKey) => {
    setFeatures((current) =>
      current.map((item) =>
        item.feature_key === featureKey ? { ...item, enabled: !item.enabled } : item,
      ),
    );
  };

  const saveFeatures = async () => {
    try {
      const response = await axios.put(
        `${API_URL}/api/outlets/${outletId}/features`,
        {
          items: features.map((item) => ({
            feature_key: item.feature_key,
            enabled: item.enabled,
          })),
        },
        { withCredentials: true },
      );
      setFeatures(response.data?.data || response.data || []);
      toast.success("Outlet features updated");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Unable to update outlet features");
    }
  };

  if (loading) {
    return (
      <Layout title="Outlet Management">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading outlet management...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Outlet Management">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>{detail?.name || "Outlet"}</h1>
            <p>Manage outlet basics, staff, inventory, products, feature access, and analytics from one screen.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" onClick={() => navigate("/central-kitchen")} type="button">
              Back to Central Kitchen
            </button>
          </div>
        </div>

        <div className="cf-grid-2">
          <div className="cf-card cf-card--padded">
            <div className="cf-section-title">Basic Info</div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Outlet Name</label>
                <input className="cf-input" value={basicForm.name} onChange={(event) => setBasicForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="cf-field">
                <label>Code</label>
                <input className="cf-input" value={basicForm.code} onChange={(event) => setBasicForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Location</label>
                <input className="cf-input" value={basicForm.location} onChange={(event) => setBasicForm((current) => ({ ...current, location: event.target.value }))} />
              </div>
              <div className="cf-field">
                <label>Manager Name</label>
                <input className="cf-input" value={basicForm.manager_name} onChange={(event) => setBasicForm((current) => ({ ...current, manager_name: event.target.value }))} />
              </div>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Phone</label>
                <input className="cf-input" value={basicForm.phone} onChange={(event) => setBasicForm((current) => ({ ...current, phone: event.target.value }))} />
              </div>
              <div className="cf-field">
                <label>Status</label>
                <select className="cf-select" value={basicForm.status} onChange={(event) => setBasicForm((current) => ({ ...current, status: event.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="cf-dialog-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="cf-btn cf-btn--primary" onClick={saveBasicInfo} type="button">Save Basic Info</button>
            </div>
          </div>

          <div className="cf-card cf-card--padded">
            <div className="cf-section-title">Analytics</div>
            <div className="cf-metrics" style={{ marginTop: 12 }}>
              <div className="cf-metric">
                <div className="cf-metric__label">Assigned Staff</div>
                <div className="cf-metric__value">{detail?.analytics?.assigned_staff_count || 0}</div>
                <div className="cf-metric__sub">Team members mapped to this outlet</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__label">Active Products</div>
                <div className="cf-metric__value">{detail?.analytics?.active_product_count || 0}</div>
                <div className="cf-metric__sub">Menu items enabled for sale</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__label">Low Inventory</div>
                <div className="cf-metric__value">{detail?.analytics?.low_inventory_count || 0}</div>
                <div className="cf-metric__sub">Lines at or below reorder</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__label">Sales Tracked</div>
                <div className="cf-metric__value">
                  {formatCurrency(detail?.analytics?.total_sales || 0, settings.currency)}
                </div>
                <div className="cf-metric__sub">Current tracked billed sales</div>
              </div>
            </div>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Staff Assignment</div>
          <div className="cf-checkbox-row" style={{ marginTop: 12 }}>
            {availableStaff.map((member) => (
              <label key={member.id}>
                <input
                  type="checkbox"
                  checked={selectedStaffIds.includes(member.id)}
                  onChange={() => toggleStaff(member.id)}
                />
                {member.name} ({member.role})
              </label>
            ))}
          </div>
          <div className="cf-dialog-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="cf-btn cf-btn--primary" onClick={saveStaffAssignments} type="button">Save Staff Assignment</button>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Products</div>
          <div className="cf-table-wrap" style={{ marginTop: 12 }}>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Base Price</th>
                  <th>Outlet Price</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {products.map((item) => (
                  <tr key={item.product_id}>
                    <td>{item.product_name}</td>
                    <td>{item.category}</td>
                    <td>{formatCurrency(item.base_price, settings.currency)}</td>
                    <td>
                      <input
                        className="cf-input"
                        type="number"
                        step="0.01"
                        value={item.price_override ?? ""}
                        onChange={(event) => changeProductPriceOverride(item.product_id, event.target.value)}
                        placeholder={`${item.base_price}`}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(item.enabled)}
                        onChange={() => toggleProductEnabled(item.product_id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cf-dialog-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="cf-btn cf-btn--primary" onClick={saveProducts} type="button">Save Products</button>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Inventory</div>
          <div className="cf-table-wrap" style={{ marginTop: 12 }}>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Central Stock</th>
                  <th>Outlet Stock</th>
                  <th>Reorder</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.inventory_id}>
                    <td>{item.inventory_name}</td>
                    <td className="cf-table__mono">{item.central_stock} {item.unit}</td>
                    <td>
                      <input
                        className="cf-input"
                        type="number"
                        step="0.01"
                        value={item.stock}
                        onChange={(event) => updateInventoryLine(item.inventory_id, "stock", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="cf-input"
                        type="number"
                        step="0.01"
                        value={item.reorder_level}
                        onChange={(event) => updateInventoryLine(item.inventory_id, "reorder_level", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(item.enabled)}
                        onChange={(event) => updateInventoryLine(item.inventory_id, "enabled", event.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cf-dialog-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="cf-btn cf-btn--primary" onClick={saveInventory} type="button">Save Inventory</button>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Features</div>
          <div className="cf-checkbox-row" style={{ marginTop: 12 }}>
            {features.map((feature) => (
              <label key={feature.feature_key}>
                <input
                  type="checkbox"
                  checked={Boolean(feature.enabled)}
                  onChange={() => toggleFeature(feature.feature_key)}
                />
                {feature.label}
              </label>
            ))}
          </div>
          <div className="cf-dialog-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="cf-btn cf-btn--primary" onClick={saveFeatures} type="button">Save Features</button>
          </div>
        </div>
      </div>
    </Layout>
  );
};
