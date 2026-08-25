import React, { useMemo, useRef, useState } from "react";
import axios from "axios";
import { Layout } from "../components/Layout";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatCurrency } from "../lib/pos";
import { useAuth } from "../contexts/AuthContext";
import { useUi } from "../contexts/UiContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const LOW_STOCK_THRESHOLD = 3;
const MENU_CHANNELS = ["Dine-In", "Takeaway", "Delivery"];

const parseOptionText = (value) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, price = "0"] = line.split(":");
      return {
        name: (name || "").trim(),
        price: Number((price || "0").trim()) || 0,
      };
    })
    .filter((item) => item.name);

const formatOptionText = (items = []) =>
  items.map((item) => `${item.name}:${item.price || 0}`).join("\n");

const parseSimpleLines = (value) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const formatSimpleLines = (items = []) => items.join("\n");

const deriveAddonSelections = (product, products) => {
  const options = product?.addon_options || [];
  return options
    .map((option) => {
      if (option.id) return option.id;
      const match = products.find((candidate) => candidate.name === option.name);
      return match?.id || null;
    })
    .filter(Boolean);
};

const deriveCustomAddonText = (product = []) =>
  formatOptionText((product?.addon_options || []).filter((option) => !option.id));

const createDefaultChannelSettings = (price = "", active = true) =>
  MENU_CHANNELS.reduce((settings, channel) => {
    settings[channel] = {
      price: price?.toString?.() ?? String(price ?? ""),
      active,
    };
    return settings;
  }, {});

const createDefaultOutletOverrides = (outlets = []) =>
  outlets.reduce((overrides, outlet) => {
    overrides[outlet.id] = { price: "", status: "inherit" };
    return overrides;
  }, {});

const createRecipeFormLines = (lines = []) =>
  (lines || []).map((line) => ({
    inventory_id: line.inventory_id,
    ingredient_name: line.ingredient_name,
    quantity: line.quantity?.toString?.() || "",
    unit: line.unit || "",
  }));

const getProductImageUrl = (product = {}) =>
  product.image_url ||
  product.imageUrl ||
  product.photo_url ||
  product.photoUrl ||
  product.picture_url ||
  product.pictureUrl ||
  product.thumbnail_url ||
  product.thumbnailUrl ||
  "";

const getProductInitial = (name = "") =>
  String(name || "P").trim().charAt(0).toUpperCase() || "P";

const computeDraftRecipeCost = (lines = [], inventoryCatalog = []) =>
  (lines || []).reduce((sum, line) => {
    const inventoryItem = inventoryCatalog.find((item) => item.id === line.inventory_id);
    return sum + (Number(inventoryItem?.conversion_cost || 0) * Number(line.quantity || 0));
  }, 0);

export const Products = () => {
  const { user } = useAuth();
  const { settings } = useUi();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [inventoryCatalog, setInventoryCatalog] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [stockTarget, setStockTarget] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    cost_price: "",
    stock: "",
    active: true,
    category: "",
    dietary_type: "Veg",
    channel_settings: createDefaultChannelSettings(),
    outlet_overrides: {},
    variationText: "",
    addonProductIds: [],
    customAddonText: "",
    removalText: "",
    recipe_lines: [],
    variationRecipeMap: {},
    addonRecipeMap: {},
  });
  const [stockForm, setStockForm] = useState({
    operation: "add",
    quantity: "",
    reason: "",
  });
  const [linkedAddonCandidate, setLinkedAddonCandidate] = useState("");
  const [categoryMode, setCategoryMode] = useState("select");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [recipeDraftInventoryId, setRecipeDraftInventoryId] = useState("");
  const [formError, setFormError] = useState("");
  const hasLoadedProductsRef = useRef(false);

  const fetchProducts = async () => {
    try {
      const [productsResponse, outletsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/products`, { withCredentials: true }),
        axios.get(`${API_URL}/api/outlets`, { withCredentials: true }),
      ]);
      setProducts(productsResponse.data || []);
      setOutlets(outletsResponse.data || []);
      try {
        const inventoryResponse = await axios.get(`${API_URL}/api/inventory/catalog`, { withCredentials: true });
        setInventoryCatalog(inventoryResponse.data || []);
      } catch (inventoryError) {
        setInventoryCatalog([]);
      }
      hasLoadedProductsRef.current = true;
    } catch (error) {
      if (!hasLoadedProductsRef.current) {
        toast.error(error.response?.data?.detail || "Failed to load products");
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchProducts, { enabled: !showDialog && !showStockDialog });

  const closeProductDialog = (open) => {
    setShowDialog(open);
    if (!open) {
      setEditingProduct(null);
      setFormError("");
      setLinkedAddonCandidate("");
      setRecipeDraftInventoryId("");
    }
  };

  const closeStockAdjustmentDialog = (open) => {
    setShowStockDialog(open);
    if (!open) {
      setStockTarget(null);
    }
  };

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category).filter(Boolean))],
    [products]
  );

  const filtered = useMemo(() => {
    return products.filter((product) => {
      const matchesQuery = !query || product.name.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = !category || product.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [products, query, category]);

  const openModal = (product = null) => {
    const basePrice = product?.base_price ?? product?.price ?? "";
    const baseActive = product?.base_active ?? product?.active ?? true;
    const nextChannelSettings = MENU_CHANNELS.reduce((settings, channel) => {
      const current = product?.channel_settings?.[channel];
      settings[channel] = {
        price: current?.price?.toString?.() ?? basePrice?.toString?.() ?? "",
        active: current?.active ?? baseActive,
      };
      return settings;
    }, {});
    const nextOutletOverrides = createDefaultOutletOverrides(outlets);
    (product?.outlet_overrides || []).forEach((entry) => {
      if (entry?.outlet_id) {
        nextOutletOverrides[entry.outlet_id] = {
          price: entry.price?.toString?.() ?? "",
          status: entry.status || "inherit",
        };
      }
    });
    setEditingProduct(product);
    setFormData({
      name: product?.name || "",
      price: basePrice?.toString() || "",
      cost_price: product?.cost_price?.toString() || "",
      stock: product?.stock?.toString() || "",
      active: baseActive,
      category: product?.category || "",
      dietary_type: product?.dietary_type || "Veg",
      channel_settings: nextChannelSettings,
      outlet_overrides: nextOutletOverrides,
      variationText: formatOptionText(product?.variation_options || []),
      addonProductIds: deriveAddonSelections(product, products),
      customAddonText: deriveCustomAddonText(product),
      removalText: formatSimpleLines(product?.removal_options || []),
      recipe_lines: createRecipeFormLines(product?.recipe_lines || []),
      variationRecipeMap: Object.fromEntries(
        (product?.variation_options || []).map((option) => [option.name, createRecipeFormLines(option.recipe_lines || [])])
      ),
      addonRecipeMap: Object.fromEntries(
        (product?.addon_options || []).map((option) => [option.name, createRecipeFormLines(option.recipe_lines || [])])
      ),
    });
    setLinkedAddonCandidate("");
    setCategoryMode(product?.category && !categories.includes(product.category) ? "new" : "select");
    setNewCategoryName(product?.category && !categories.includes(product.category) ? product.category : "");
    setRecipeDraftInventoryId("");
    setFormError("");
    setShowDialog(true);
  };

  const availableAddonProducts = useMemo(
    () => products.filter((product) => product.id !== editingProduct?.id),
    [editingProduct?.id, products]
  );
  const selectedAddonProducts = useMemo(
    () => formData.addonProductIds
      .map((productId) => availableAddonProducts.find((item) => item.id === productId))
      .filter(Boolean),
    [availableAddonProducts, formData.addonProductIds]
  );
  const unselectedAddonProducts = useMemo(
    () => availableAddonProducts.filter((product) => !formData.addonProductIds.includes(product.id)),
    [availableAddonProducts, formData.addonProductIds]
  );

  const addLinkedAddonProduct = () => {
    if (!linkedAddonCandidate || formData.addonProductIds.includes(linkedAddonCandidate)) {
      return;
    }
    setFormData((current) => ({
      ...current,
      addonProductIds: [...current.addonProductIds, linkedAddonCandidate],
    }));
    setLinkedAddonCandidate("");
  };

  const removeLinkedAddonProduct = (productId) => {
    setFormData((current) => ({
      ...current,
      addonProductIds: current.addonProductIds.filter((item) => item !== productId),
    }));
    setLinkedAddonCandidate((current) => (current === productId ? "" : current));
  };

  const availableRecipeIngredients = useMemo(
    () => inventoryCatalog.filter((item) => !formData.recipe_lines.some((line) => line.inventory_id === item.id)),
    [formData.recipe_lines, inventoryCatalog]
  );
  const parsedVariationOptions = useMemo(
    () => parseOptionText(formData.variationText),
    [formData.variationText]
  );
  const derivedAddonOptions = useMemo(() => {
    const linked = formData.addonProductIds
      .map((productId) => availableAddonProducts.find((item) => item.id === productId))
      .filter(Boolean)
      .map((item) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price || 0),
      }));
    const custom = parseOptionText(formData.customAddonText).map((item) => ({
      name: item.name,
      price: Number(item.price || 0),
    }));
    const all = [...linked];
    custom.forEach((option) => {
      if (!all.some((item) => item.name.toLowerCase() === option.name.toLowerCase())) {
        all.push(option);
      }
    });
    return all;
  }, [availableAddonProducts, formData.addonProductIds, formData.customAddonText]);

  const availableNestedRecipeIngredients = (lines = []) =>
    inventoryCatalog.filter((item) => !lines.some((line) => line.inventory_id === item.id));

  const addNestedRecipeLine = (targetKey, optionName, inventoryId) => {
    if (!inventoryId) return;
    const ingredient = inventoryCatalog.find((item) => item.id === inventoryId);
    if (!ingredient) return;
    setFormData((current) => ({
      ...current,
      [targetKey]: {
        ...(current[targetKey] || {}),
        [optionName]: [
          ...((current[targetKey] || {})[optionName] || []),
          {
            inventory_id: ingredient.id,
            ingredient_name: ingredient.name,
            quantity: "",
            unit: ingredient.unit || "",
          },
        ],
      },
    }));
    setFormError("");
  };

  const updateNestedRecipeLine = (targetKey, optionName, inventoryId, key, value) => {
    setFormError("");
    setFormData((current) => ({
      ...current,
      [targetKey]: {
        ...(current[targetKey] || {}),
        [optionName]: (((current[targetKey] || {})[optionName]) || []).map((line) =>
          line.inventory_id === inventoryId ? { ...line, [key]: value } : line
        ),
      },
    }));
  };

  const removeNestedRecipeLine = (targetKey, optionName, inventoryId) => {
    setFormData((current) => ({
      ...current,
      [targetKey]: {
        ...(current[targetKey] || {}),
        [optionName]: (((current[targetKey] || {})[optionName]) || []).filter((line) => line.inventory_id !== inventoryId),
      },
    }));
  };

  const addRecipeIngredient = () => {
    if (!recipeDraftInventoryId) return;
    const ingredient = inventoryCatalog.find((item) => item.id === recipeDraftInventoryId);
    if (!ingredient) return;
    setFormData((current) => ({
      ...current,
      recipe_lines: [
        ...current.recipe_lines,
        {
          inventory_id: ingredient.id,
          ingredient_name: ingredient.name,
          quantity: "",
          unit: ingredient.unit || "",
        },
      ],
    }));
    setRecipeDraftInventoryId("");
  };

  const updateRecipeLine = (inventoryId, key, value) => {
    setFormError("");
    setFormData((current) => ({
      ...current,
      recipe_lines: current.recipe_lines.map((line) =>
        line.inventory_id === inventoryId
          ? { ...line, [key]: value }
          : line
      ),
    }));
  };

  const removeRecipeLine = (inventoryId) => {
    setFormData((current) => ({
      ...current,
      recipe_lines: current.recipe_lines.filter((line) => line.inventory_id !== inventoryId),
    }));
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    setFormError("");
    const resolvedCategory = (categoryMode === "new" ? newCategoryName : formData.category).trim();
    if (!resolvedCategory) {
      setFormError("Category is required.");
      return;
    }
    const missingChannelPrice = MENU_CHANNELS.find((channel) => {
      const value = formData.channel_settings?.[channel]?.price;
      return value === "" || value === null || value === undefined || Number.isNaN(Number(value));
    });
    if (missingChannelPrice) {
      setFormError(`Enter ${missingChannelPrice} price in Channel Menu Pricing.`);
      return;
    }
    const invalidRecipeLine = formData.recipe_lines.find((line) => !line.quantity || Number(line.quantity) <= 0);
    if (invalidRecipeLine) {
      setFormError(`Enter a valid recipe quantity for ${invalidRecipeLine.ingredient_name}.`);
      return;
    }
    const invalidVariationRecipe = Object.entries(formData.variationRecipeMap || {}).find(([, lines]) =>
      (lines || []).some((line) => !line.quantity || Number(line.quantity) <= 0)
    );
    if (invalidVariationRecipe) {
      setFormError(`Enter a valid variation recipe quantity for ${invalidVariationRecipe[0]}.`);
      return;
    }
    const invalidAddonRecipe = Object.entries(formData.addonRecipeMap || {}).find(([, lines]) =>
      (lines || []).some((line) => !line.quantity || Number(line.quantity) <= 0)
    );
    if (invalidAddonRecipe) {
      setFormError(`Enter a valid add-on recipe quantity for ${invalidAddonRecipe[0]}.`);
      return;
    }

    const payload = {
      name: formData.name.trim(),
      price: Number(formData.price),
      cost_price: Number(formData.cost_price || 0),
      stock: Number(formData.stock),
      active: formData.active,
      category: resolvedCategory || null,
      dietary_type: formData.dietary_type || "Veg",
      channel_settings: MENU_CHANNELS.reduce((settings, channel) => {
        const current = formData.channel_settings[channel] || {};
        settings[channel] = {
          price: Number(current.price || formData.price || 0),
          active: current.active !== false,
        };
        return settings;
      }, {}),
      outlet_overrides: Object.entries(formData.outlet_overrides || {})
        .map(([outletId, override]) => ({
          outlet_id: outletId,
          price: override?.price === "" ? null : Number(override?.price || 0),
          status: override?.status || "inherit",
        }))
        .filter((entry) => entry.price !== null || entry.status !== "inherit"),
      variation_options: parsedVariationOptions.map((option) => ({
        ...option,
        recipe_lines: ((formData.variationRecipeMap || {})[option.name] || []).map((line) => ({
          inventory_id: line.inventory_id,
          quantity: Number(line.quantity || 0),
        })),
      })),
      addon_options: derivedAddonOptions.map((option) => ({
        ...option,
        recipe_lines: ((formData.addonRecipeMap || {})[option.name] || []).map((line) => ({
          inventory_id: line.inventory_id,
          quantity: Number(line.quantity || 0),
        })),
      })),
      removal_options: parseSimpleLines(formData.removalText),
      recipe_lines: formData.recipe_lines.map((line) => ({
        inventory_id: line.inventory_id,
        quantity: Number(line.quantity || 0),
      })),
    };

    try {
      if (editingProduct) {
        await axios.put(`${API_URL}/api/products/${editingProduct.id}`, payload, { withCredentials: true });
        toast.success("Product updated");
      } else {
        await axios.post(`${API_URL}/api/products`, payload, { withCredentials: true });
        toast.success("Product added");
      }
      closeProductDialog(false);
      setFormError("");
      fetchProducts();
    } catch (error) {
      setFormError(error.response?.data?.detail || "Unable to save product");
    }
  };

  const deleteProduct = async (productId) => {
    if (!window.confirm("Delete this product?")) return;
    try {
      await axios.delete(`${API_URL}/api/products/${productId}`, { withCredentials: true });
      toast.success("Product deleted");
      fetchProducts();
    } catch (error) {
      toast.error("Unable to delete product");
    }
  };

  const toggleProductActive = async (product) => {
    try {
      await axios.put(`${API_URL}/api/products/${product.id}`, { active: !(product.active ?? true) }, { withCredentials: true });
      toast.success(`${product.name} ${product.active === false ? "enabled" : "disabled"}`);
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to update product status");
    }
  };

  const openStockDialog = (product) => {
    setStockTarget(product);
    setStockForm({ operation: "add", quantity: "", reason: "" });
    setShowStockDialog(true);
  };

  const adjustStock = async (event) => {
    event.preventDefault();
    if (!stockTarget) return;
    try {
      await axios.post(
        `${API_URL}/api/products/${stockTarget.id}/stock-adjustments`,
        {
          operation: stockForm.operation,
          quantity: Number(stockForm.quantity),
          reason: stockForm.reason || null,
        },
        { withCredentials: true }
      );
      toast.success("Product stock updated");
      closeStockAdjustmentDialog(false);
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to adjust product stock");
    }
  };

  if (loading) {
    return (
      <Layout title="Products">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading products...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Products">
      <div className="cf-page" data-testid="products-page">
        <div className="cf-page__header">
          <div>
            <h1>Products</h1>
            <div style={{ color: "var(--cf-text-3)", fontSize: 12, marginTop: 6 }}>
              Build one dynamic menu here, then control prices and availability by channel and outlet without recreating items.
            </div>
            <p>
              {filtered.length} products · {categories.length} categories
            </p>
          </div>
          <div className="cf-page__header-actions">
            {user?.role === "Owner" ? (
              <button className="cf-btn cf-btn--primary" data-testid="add-product-button" onClick={() => openModal()}>
                + Add Product
              </button>
            ) : null}
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginBottom: 16 }}>
          <div className="cf-card__title">
            <span>Recipe Controls</span>
            <span className="cf-card__meta">Operate recipe-aware products from one place</span>
          </div>
          <div className="cf-card__meta">
            Base recipe lines deduct on every sale. Variation-wise recipe lines deduct only for that selected size or variant. Add-on recipe lines deduct only when the add-on is chosen in billing. Auto recipe cost is pulled from ingredient conversion cost so recipe margins stay current automatically.
          </div>
        </div>

        <div className="cf-table-wrap">
          <div className="cf-table-toolbar">
            <input
              className="cf-search"
              data-testid="product-search-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product..."
              style={{ width: 220 }}
              value={query}
            />
            <select className="cf-select" onChange={(event) => setCategory(event.target.value)} style={{ width: 180 }} value={category}>
              <option value="">All Categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <table className="cf-table">
            <thead>
              <tr>
                <th>Pic</th>
                <th>Name</th>
                <th>Category</th>
                <th>Base Price</th>
                <th>Goods Cost</th>
                <th>Stock</th>
                <th>Last Stock Update</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id} data-testid={`product-row-${product.id}`}>
                  <td>
                    <ProductImageCell product={product} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{product.name}</td>
                  <td>
                    <span className="cf-badge cf-badge--gray">{product.category || "Other"}</span>
                    <span className={`cf-badge ${product.dietary_type === "Non Veg" ? "cf-badge--red" : "cf-badge--green"}`} style={{ marginLeft: 6 }}>
                      {product.dietary_type || "Veg"}
                    </span>
                    {product.variation_options?.length ? (
                      <span className="cf-badge cf-badge--blue" style={{ marginLeft: 6 }}>
                        {product.variation_options.length} sizes
                      </span>
                    ) : null}
                    {product.addon_options?.length ? (
                      <span className="cf-badge cf-badge--amber" style={{ marginLeft: 6 }}>
                        {product.addon_options.length} add-ons
                      </span>
                    ) : null}
                    {product.removal_options?.length ? (
                      <span className="cf-badge cf-badge--red" style={{ marginLeft: 6 }}>
                        {product.removal_options.length} skip options
                      </span>
                    ) : null}
                    {product.recipe_lines?.length ? (
                      <span className="cf-badge cf-badge--green" style={{ marginLeft: 6 }}>
                        {product.recipe_lines.length} recipe lines
                      </span>
                    ) : null}
                    {MENU_CHANNELS.some((channel) => {
                      const current = product.channel_settings?.[channel];
                      return current && (Number(current.price || 0) !== Number(product.base_price ?? product.price ?? 0) || current.active !== (product.base_active ?? product.active ?? true));
                    }) ? (
                      <span className="cf-badge cf-badge--blue" style={{ marginLeft: 6 }}>
                        channel pricing
                      </span>
                    ) : null}
                    {(product.outlet_overrides || []).length ? (
                      <span className="cf-badge cf-badge--gray" style={{ marginLeft: 6 }}>
                        {(product.outlet_overrides || []).length} outlet overrides
                      </span>
                    ) : null}
                  </td>
                  <td className="cf-table__mono">{formatCurrency(product.price, settings.currency)}</td>
                  <td className="cf-table__mono">
                    {formatCurrency(product.auto_recipe_cost || product.cost_price || 0, settings.currency)}
                    {product.auto_recipe_cost ? (
                      <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>Auto recipe cost</div>
                    ) : null}
                  </td>
                  <td className="cf-table__mono">{product.stock}</td>
                  <td style={{ color: "var(--cf-text-2)", fontSize: 12 }}>
                    {product.stock_updated_at ? new Date(product.stock_updated_at).toLocaleString("en-IN") : "-"}
                  </td>
                  <td>
                    <span className={`cf-badge ${product.active === false ? "cf-badge--gray" : product.stock <= 0 ? "cf-badge--red" : product.stock <= LOW_STOCK_THRESHOLD ? "cf-badge--amber" : "cf-badge--green"}`}>
                      {product.active === false ? "Disabled" : product.stock <= 0 ? "Out of Stock" : product.stock <= LOW_STOCK_THRESHOLD ? `Only ${product.stock} left` : "In Stock"}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => toggleProductActive(product)} type="button">
                      {product.active === false ? "Enable" : "Disable"}
                    </button>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => openStockDialog(product)} type="button">
                      Adjust Stock
                    </button>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => openModal(product)} type="button">
                      Edit
                    </button>
                    <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => deleteProduct(product.id)} type="button">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Dialog onOpenChange={closeProductDialog} open={showDialog}>
          <DialogContent className="bg-white cf-dialog-content">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveProduct}>
              <div className="cf-dialog-scroll">
                <div className="cf-field">
                  <label>Product Name</label>
                  <input className="cf-input" data-testid="product-name-input" required value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Price</label>
                  <input className="cf-input" data-testid="product-price-input" min="0" required step="0.01" type="number" value={formData.price} onChange={(event) => setFormData({ ...formData, price: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Stock</label>
                  <input className="cf-input" data-testid="product-stock-input" min="0" required type="number" value={formData.stock} onChange={(event) => setFormData({ ...formData, stock: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Goods Cost</label>
                  <input className="cf-input" min="0" required step="0.01" type="number" value={formData.cost_price} onChange={(event) => setFormData({ ...formData, cost_price: event.target.value })} />
                </div>
                <div className="cf-field">
                  <label>Category</label>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select
                        className="cf-select"
                        data-testid="product-category-input"
                        style={{ minWidth: 220, flex: "1 1 220px" }}
                        value={categoryMode === "new" ? "__new__" : formData.category}
                        onChange={(event) => {
                          setFormError("");
                          if (event.target.value === "__new__") {
                            setCategoryMode("new");
                            setFormData((current) => ({ ...current, category: "" }));
                            return;
                          }
                          setCategoryMode("select");
                          setNewCategoryName("");
                          setFormData((current) => ({ ...current, category: event.target.value }));
                        }}
                      >
                        <option value="">Select category</option>
                        {categories.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                        <option value="__new__">+ Add New Category</option>
                      </select>
                      {categoryMode === "new" ? (
                        <button
                          className="cf-btn cf-btn--secondary cf-btn--small"
                          onClick={() => {
                            setFormError("");
                            setCategoryMode("select");
                            setNewCategoryName("");
                          }}
                          type="button"
                        >
                          Use Existing
                        </button>
                      ) : null}
                    </div>
                    {categoryMode === "new" ? (
                      <input
                        className="cf-input"
                        placeholder="Enter new category"
                        required
                        value={newCategoryName}
                        onChange={(event) => {
                          setFormError("");
                          setNewCategoryName(event.target.value);
                        }}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="cf-field">
                  <label>Food Type</label>
                  <div className="cf-switch-row">
                    <button
                      className={`cf-switch-pill ${formData.dietary_type === "Veg" ? "is-active is-veg" : ""}`}
                      onClick={() => setFormData({ ...formData, dietary_type: "Veg" })}
                      type="button"
                    >
                      Veg
                    </button>
                    <button
                      className={`cf-switch-pill ${formData.dietary_type === "Non Veg" ? "is-active is-nonveg" : ""}`}
                      onClick={() => setFormData({ ...formData, dietary_type: "Non Veg" })}
                      type="button"
                    >
                      Non Veg
                    </button>
                  </div>
                </div>
                <div className="cf-field">
                  <label>Variations</label>
                  <textarea
                    className="cf-textarea"
                    placeholder={"Small:0\nLarge:40"}
                    value={formData.variationText}
                    onChange={(event) => setFormData({ ...formData, variationText: event.target.value })}
                  />
                </div>
                {parsedVariationOptions.length ? (
                  <div className="cf-field">
                    <label>Variation-wise Recipe / BOM</label>
                    <div style={{ display: "grid", gap: 10 }}>
                      {parsedVariationOptions.map((option) => {
                        const recipeLines = (formData.variationRecipeMap || {})[option.name] || [];
                        const availableIngredients = availableNestedRecipeIngredients(recipeLines);
                        return (
                          <div className="cf-card" key={`variation-recipe-${option.name}`} style={{ padding: 12 }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>
                              {option.name} · Sell price +{formatCurrency(option.price || 0, settings.currency)}
                            </div>
                            <div className="cf-card__meta" style={{ marginBottom: 10 }}>
                              Extra ingredients deducted only for this variation.
                            </div>
                            <div className="cf-card__meta" style={{ marginBottom: 10 }}>
                              Auto extra recipe cost: {formatCurrency(computeDraftRecipeCost(recipeLines, inventoryCatalog), settings.currency)}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                              <select
                                className="cf-select"
                                defaultValue=""
                                onChange={(event) => {
                                  addNestedRecipeLine("variationRecipeMap", option.name, event.target.value);
                                  event.target.value = "";
                                }}
                                style={{ minWidth: 240, flex: "1 1 240px" }}
                              >
                                <option value="">+ Add ingredient</option>
                                {availableIngredients.map((item) => (
                                  <option key={`${option.name}-${item.id}`} value={item.id}>
                                    {item.name} ({item.unit})
                                  </option>
                                ))}
                              </select>
                            </div>
                            {recipeLines.length ? (
                              <div style={{ display: "grid", gap: 8 }}>
                                {recipeLines.map((line) => (
                                  <div key={`${option.name}-${line.inventory_id}`} style={{ display: "grid", gap: 10, gridTemplateColumns: "1.2fr 0.8fr auto", alignItems: "center" }}>
                                    <div>
                                      <div style={{ fontWeight: 600 }}>{line.ingredient_name}</div>
                                      <div className="cf-card__meta">{line.unit}</div>
                                    </div>
                                    <input
                                      className="cf-input"
                                      min="0.001"
                                      step="0.001"
                                      type="number"
                                      value={line.quantity}
                                      onChange={(event) => updateNestedRecipeLine("variationRecipeMap", option.name, line.inventory_id, "quantity", event.target.value)}
                                    />
                                    <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => removeNestedRecipeLine("variationRecipeMap", option.name, line.inventory_id)} type="button">
                                      Delete
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="cf-empty-state">No extra ingredient deduction for this variation.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="cf-field">
                  <label>Availability</label>
                  <div className="cf-switch-row">
                    <button className={`cf-switch-pill ${formData.active ? "is-active" : ""}`} onClick={() => setFormData({ ...formData, active: true })} type="button">
                      Enabled
                    </button>
                    <button className={`cf-switch-pill ${!formData.active ? "is-active" : ""}`} onClick={() => setFormData({ ...formData, active: false })} type="button">
                      Disabled
                    </button>
                  </div>
                </div>
                <div className="cf-field">
                  <label>Channel Menu Pricing</label>
                  <div style={{ display: "grid", gap: 10 }}>
                    {MENU_CHANNELS.map((channel) => {
                      const channelConfig = formData.channel_settings[channel] || { price: formData.price, active: formData.active };
                      return (
                        <div className="cf-card" key={channel} style={{ padding: 12 }}>
                          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1.1fr 1fr auto" }}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{channel}</div>
                              <div className="cf-card__meta">Control item visibility and pricing for this menu.</div>
                            </div>
                            <input
                              className="cf-input"
                              min="0"
                              placeholder="Price"
                              step="0.01"
                              type="number"
                              value={channelConfig.price}
                              onChange={(event) =>
                                {
                                  setFormError("");
                                  setFormData((current) => ({
                                    ...current,
                                    channel_settings: {
                                      ...current.channel_settings,
                                      [channel]: {
                                        ...(current.channel_settings[channel] || {}),
                                        price: event.target.value,
                                      },
                                    },
                                  }));
                                }
                              }
                            />
                            <div className="cf-switch-row">
                              <button
                                className={`cf-switch-pill ${channelConfig.active ? "is-active" : ""}`}
                                onClick={() =>
                                  setFormData((current) => ({
                                    ...current,
                                    channel_settings: {
                                      ...current.channel_settings,
                                      [channel]: {
                                        ...(current.channel_settings[channel] || {}),
                                        active: true,
                                      },
                                    },
                                  }))
                                }
                                type="button"
                              >
                                On
                              </button>
                              <button
                                className={`cf-switch-pill ${channelConfig.active === false ? "is-active" : ""}`}
                                onClick={() =>
                                  setFormData((current) => ({
                                    ...current,
                                    channel_settings: {
                                      ...current.channel_settings,
                                      [channel]: {
                                        ...(current.channel_settings[channel] || {}),
                                        active: false,
                                      },
                                    },
                                  }))
                                }
                                type="button"
                              >
                                Off
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="cf-card__meta" style={{ marginTop: 6 }}>
                    This gives you one product with separate dine-in, takeaway, and delivery menu behavior.
                  </div>
                </div>
                <div className="cf-field">
                  <label>Outlet Overrides</label>
                  {outlets.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {outlets.map((outlet) => {
                        const override = formData.outlet_overrides[outlet.id] || { price: "", status: "inherit" };
                        return (
                          <div className="cf-card" key={outlet.id} style={{ padding: 12 }}>
                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1.1fr 1fr 1fr" }}>
                              <div>
                                <div style={{ fontWeight: 600 }}>{outlet.name}</div>
                                <div className="cf-card__meta">Leave price empty to use the base or channel price.</div>
                              </div>
                              <input
                                className="cf-input"
                                min="0"
                                placeholder="Outlet price"
                                step="0.01"
                                type="number"
                                value={override.price}
                                onChange={(event) =>
                                  setFormData((current) => ({
                                    ...current,
                                    outlet_overrides: {
                                      ...current.outlet_overrides,
                                      [outlet.id]: {
                                        ...(current.outlet_overrides[outlet.id] || {}),
                                        price: event.target.value,
                                      },
                                    },
                                  }))
                                }
                              />
                              <select
                                className="cf-select"
                                value={override.status}
                                onChange={(event) =>
                                  setFormData((current) => ({
                                    ...current,
                                    outlet_overrides: {
                                      ...current.outlet_overrides,
                                      [outlet.id]: {
                                        ...(current.outlet_overrides[outlet.id] || {}),
                                        status: event.target.value,
                                      },
                                    },
                                  }))
                                }
                              >
                                <option value="inherit">Inherit status</option>
                                <option value="enabled">Force enable</option>
                                <option value="disabled">Force disable</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="cf-empty-state">Add outlets in Central Kitchen first to control location-wise pricing.</div>
                  )}
                </div>
                <div className="cf-field">
                  <label>Linked Product Add-ons</label>
                  {availableAddonProducts.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <select
                          className="cf-select"
                          style={{ minWidth: 240, flex: "1 1 240px" }}
                          value={linkedAddonCandidate}
                          onChange={(event) => setLinkedAddonCandidate(event.target.value)}
                        >
                          <option value="">Select product add-on</option>
                          {unselectedAddonProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} ({formatCurrency(product.base_price ?? product.price, settings.currency)})
                            </option>
                          ))}
                        </select>
                        <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={addLinkedAddonProduct} type="button">
                          + Add
                        </button>
                      </div>
                      {selectedAddonProducts.length ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {selectedAddonProducts.map((product) => (
                            <div
                              className="cf-card"
                              key={product.id}
                              style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}
                            >
                              <div>
                                <div style={{ fontWeight: 600 }}>{product.name}</div>
                                <div className="cf-card__meta">{formatCurrency(product.base_price ?? product.price, settings.currency)}</div>
                              </div>
                              <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => removeLinkedAddonProduct(product.id)} type="button">
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="cf-empty-state">No linked product add-ons selected yet.</div>
                      )}
                    </div>
                  ) : (
                    <div className="cf-empty-state">Add more products first to use them as add-ons.</div>
                  )}
                </div>
                {derivedAddonOptions.length ? (
                  <div className="cf-field">
                    <label>Add-on Ingredient Deduction</label>
                    <div style={{ display: "grid", gap: 10 }}>
                      {derivedAddonOptions.map((option) => {
                        const recipeLines = (formData.addonRecipeMap || {})[option.name] || [];
                        const availableIngredients = availableNestedRecipeIngredients(recipeLines);
                        return (
                          <div className="cf-card" key={`addon-recipe-${option.name}`} style={{ padding: 12 }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>
                              {option.name} · +{formatCurrency(option.price || 0, settings.currency)}
                            </div>
                            <div className="cf-card__meta" style={{ marginBottom: 10 }}>
                              Deducted only when this add-on is selected in billing.
                            </div>
                            <div className="cf-card__meta" style={{ marginBottom: 10 }}>
                              Auto add-on recipe cost: {formatCurrency(computeDraftRecipeCost(recipeLines, inventoryCatalog), settings.currency)}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                              <select
                                className="cf-select"
                                defaultValue=""
                                onChange={(event) => {
                                  addNestedRecipeLine("addonRecipeMap", option.name, event.target.value);
                                  event.target.value = "";
                                }}
                                style={{ minWidth: 240, flex: "1 1 240px" }}
                              >
                                <option value="">+ Add ingredient</option>
                                {availableIngredients.map((item) => (
                                  <option key={`${option.name}-${item.id}`} value={item.id}>
                                    {item.name} ({item.unit})
                                  </option>
                                ))}
                              </select>
                            </div>
                            {recipeLines.length ? (
                              <div style={{ display: "grid", gap: 8 }}>
                                {recipeLines.map((line) => (
                                  <div key={`${option.name}-${line.inventory_id}`} style={{ display: "grid", gap: 10, gridTemplateColumns: "1.2fr 0.8fr auto", alignItems: "center" }}>
                                    <div>
                                      <div style={{ fontWeight: 600 }}>{line.ingredient_name}</div>
                                      <div className="cf-card__meta">{line.unit}</div>
                                    </div>
                                    <input
                                      className="cf-input"
                                      min="0.001"
                                      step="0.001"
                                      type="number"
                                      value={line.quantity}
                                      onChange={(event) => updateNestedRecipeLine("addonRecipeMap", option.name, line.inventory_id, "quantity", event.target.value)}
                                    />
                                    <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => removeNestedRecipeLine("addonRecipeMap", option.name, line.inventory_id)} type="button">
                                      Delete
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="cf-empty-state">No ingredient deduction for this add-on yet.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="cf-field">
                  <label>Recipe / BOM</label>
                  {inventoryCatalog.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <select
                          className="cf-select"
                          style={{ minWidth: 240, flex: "1 1 240px" }}
                          value={recipeDraftInventoryId}
                          onChange={(event) => setRecipeDraftInventoryId(event.target.value)}
                        >
                          <option value="">Select ingredient</option>
                          {availableRecipeIngredients.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit}) · Stock {item.current_stock}
                            </option>
                          ))}
                        </select>
                        <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={addRecipeIngredient} type="button">
                          + Add Ingredient
                        </button>
                      </div>
                      {formData.recipe_lines.length ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {formData.recipe_lines.map((line) => (
                            <div
                              className="cf-card"
                              key={line.inventory_id}
                              style={{ padding: "10px 12px", display: "grid", gap: 10, gridTemplateColumns: "1.2fr 0.8fr auto", alignItems: "center" }}
                            >
                              <div>
                                <div style={{ fontWeight: 600 }}>{line.ingredient_name}</div>
                                <div className="cf-card__meta">Deducted every time this product is billed.</div>
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                  className="cf-input"
                                  min="0.001"
                                  placeholder="Qty"
                                  step="0.001"
                                  type="number"
                                  value={line.quantity}
                                  onChange={(event) => updateRecipeLine(line.inventory_id, "quantity", event.target.value)}
                                />
                                <span className="cf-card__meta" style={{ minWidth: 48 }}>{line.unit}</span>
                              </div>
                              <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => removeRecipeLine(line.inventory_id)} type="button">
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="cf-empty-state">No recipe lines added yet. Add ingredients here to deduct real inventory stock.</div>
                      )}
                    </div>
                  ) : (
                    <div className="cf-empty-state">Add inventory items first to build a recipe/BOM.</div>
                  )}
                  <div className="cf-card__meta" style={{ marginTop: 6 }}>
                    Auto recipe cost: {formatCurrency(computeDraftRecipeCost(formData.recipe_lines, inventoryCatalog), settings.currency)}
                  </div>
                </div>
                <div className="cf-field">
                  <label>Custom Add-ons</label>
                  <textarea
                    className="cf-textarea"
                    placeholder={"Extra cheese:30\nPacking charge:10\nBrownie scoop:40"}
                    value={formData.customAddonText}
                    onChange={(event) => setFormData({ ...formData, customAddonText: event.target.value })}
                  />
                  <div className="cf-card__meta" style={{ marginTop: 6 }}>
                    Add one custom add-on per line as `name:price`. These add-ons do not need to exist in products.
                  </div>
                </div>
                <div className="cf-field">
                  <label>Skip Common Ingredients</label>
                  <textarea
                    className="cf-textarea"
                    placeholder={"No cream\nNo frosting\nNo nuts"}
                    value={formData.removalText}
                    onChange={(event) => setFormData({ ...formData, removalText: event.target.value })}
                  />
                </div>
              </div>
              {formError ? (
                <div
                  className="cf-card"
                  style={{ borderColor: "var(--cf-red)", padding: "12px 14px", marginTop: 16, color: "var(--cf-red)", fontSize: 13 }}
                >
                  {formError}
                </div>
              ) : null}
              <DialogFooter className="cf-dialog-actions">
                <button className="cf-btn cf-btn--secondary" onClick={() => {
                  setFormError("");
                  closeProductDialog(false);
                }} type="button">
                  Cancel
                </button>
                <button className="cf-btn cf-btn--primary" data-testid="save-product-button" type="submit">
                  {editingProduct ? "Save Changes" : "Add Product"}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog onOpenChange={closeStockAdjustmentDialog} open={showStockDialog}>
          <DialogContent className="bg-white" style={{ maxWidth: 560 }}>
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">
                {stockTarget ? `Adjust Stock - ${stockTarget.name}` : "Adjust Stock"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={adjustStock}>
              <div className="cf-field">
                <label>Operation</label>
                <select className="cf-select" value={stockForm.operation} onChange={(event) => setStockForm({ ...stockForm, operation: event.target.value })}>
                  <option value="add">Add to current stock</option>
                  <option value="set">Set exact stock</option>
                </select>
              </div>
              <div className="cf-field">
                <label>Quantity</label>
                <input className="cf-input" min="0" required type="number" value={stockForm.quantity} onChange={(event) => setStockForm({ ...stockForm, quantity: event.target.value })} />
              </div>
              <div className="cf-field">
                <label>Reason</label>
                <textarea className="cf-textarea" rows={3} value={stockForm.reason} onChange={(event) => setStockForm({ ...stockForm, reason: event.target.value })} />
              </div>
              <DialogFooter className="cf-dialog-actions">
                <button className="cf-btn cf-btn--secondary" onClick={() => closeStockAdjustmentDialog(false)} type="button">
                  Cancel
                </button>
                <button className="cf-btn cf-btn--primary" type="submit">
                  Save Stock
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

function ProductImageCell({ product }) {
  const imageUrl = getProductImageUrl(product);

  if (imageUrl) {
    return (
      <div
        aria-label={`${product.name || "Product"} image`}
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--cf-border)",
          background: "var(--cf-surface-2)",
        }}
      >
        <img
          alt=""
          src={imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${product.name || "Product"} has no image`}
      title="No product image"
      style={{
        width: 48,
        height: 48,
        borderRadius: 10,
        border: "1px solid var(--cf-border)",
        background: "var(--cf-surface-2)",
        color: "var(--cf-text-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        fontWeight: 700,
      }}
    >
      {getProductInitial(product.name)}
    </div>
  );
}
