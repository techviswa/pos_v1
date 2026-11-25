import React, { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { formatQuantity } from "../../lib/quantity";

/**
 * Physical stock count. Staff type what is actually on the shelf at the central kitchen or one outlet; the server
 * records the difference against the system figure as an audited "stock audit" movement. Only items with a typed
 * count are sent. A count is an absolute figure, so sending the same sheet twice changes nothing the second time.
 */
export function StockCount({ apiUrl, inventory = [], outlets = [], onDone }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("central");
  const [outletRows, setOutletRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadOutlet = async (outletId) => {
    setOutletRows(null);
    try {
      const rows = apiData(await axios.get(`${apiUrl}/api/outlets/${outletId}/inventory`, { withCredentials: true }));
      setOutletRows(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not load this outlet's stock"));
      setOutletRows([]);
    }
  };

  // What the system thinks is there, in the item's stock unit, for the chosen location.
  const rows = useMemo(() => {
    if (location === "central") return inventory.map((item) => ({ id: item.id, name: item.name, unit: item.unit, system: Number(item.current_stock || 0) }));
    return (outletRows || []).map((row) => ({
      id: row.inventory_id, name: row.inventory_name, unit: row.unit,
      system: row.enabled && !String(row.id).startsWith("virtual_") ? Number(row.stock || 0) : 0,
    }));
  }, [inventory, location, outletRows]);

  const changeLocation = (value) => {
    setLocation(value);
    setCounts({});
    setResult(null);
    if (value !== "central") void loadOutlet(value);
  };

  const counted = rows.filter((row) => String(counts[row.id] ?? "").trim() !== "");
  const invalid = counted.some((row) => !(Number(counts[row.id]) >= 0));

  const submit = async (event) => {
    event.preventDefault();
    if (!counted.length || invalid) return;
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/inventory/stock-audits`, {
        stock_location: location === "central" ? "central" : "outlet",
        ...(location === "central" ? {} : { outlet_id: location }),
        reason: reason.trim() || "Physical stock count",
        counts: counted.map((row) => ({ inventory_id: row.id, counted_quantity: Number(counts[row.id]) })),
      }, { withCredentials: true });
      const data = apiData(response);
      const adjustments = Array.isArray(data?.adjustments) ? data.adjustments : [];
      setResult(adjustments);
      setCounts({});
      toast.success(`Stock count saved: ${adjustments.filter((row) => row.variance !== 0).length} item(s) corrected`);
      onDone?.();
      if (location !== "central") void loadOutlet(location);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Stock count could not be saved"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="cf-btn cf-btn--secondary" type="button" data-testid="open-stock-count" onClick={() => { setOpen(true); setResult(null); }}>Stock count</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="cf-dialog" style={{ maxWidth: 760 }}>
          <DialogHeader><DialogTitle>Physical stock count</DialogTitle></DialogHeader>
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }} data-testid="stock-count-form">
            <div className="cf-field">
              <label>Where are you counting?</label>
              <select aria-label="Count location" className="cf-select" value={location} onChange={(event) => changeLocation(event.target.value)}>
                <option value="central">Central kitchen</option>
                {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </select>
              <span className="cf-card__meta">Type what is on the shelf. Leave an item blank to skip it. Differences are saved as a stock audit with your name.</span>
            </div>
            {location !== "central" && outletRows === null ? <p className="cf-card__meta">Loading stock...</p> : (
              <div className="cf-table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
                <table className="cf-table">
                  <thead><tr><th>Item</th><th>System</th><th>Counted</th><th>Difference</th></tr></thead>
                  <tbody>
                    {rows.map((row) => {
                      const typed = String(counts[row.id] ?? "").trim();
                      const difference = typed !== "" && Number(typed) >= 0 ? Math.round((Number(typed) - row.system) * 1000) / 1000 : null;
                      return (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td className="cf-table__mono">{formatQuantity(row.system, row.unit)}</td>
                          <td><input aria-label={`Counted ${row.name}`} className="cf-input" min="0" step="any" type="number" value={counts[row.id] ?? ""} onChange={(event) => setCounts({ ...counts, [row.id]: event.target.value })} style={{ maxWidth: 120 }} /></td>
                          <td className="cf-table__mono" style={{ color: difference ? (difference < 0 ? "var(--cf-red)" : "var(--cf-green, #15803d)") : undefined }}>
                            {difference == null ? "" : `${difference > 0 ? "+" : ""}${formatQuantity(difference, row.unit)}`}
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length ? <tr><td colSpan="4">No stock items at this location yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            )}
            <input aria-label="Count note" className="cf-input" maxLength={200} placeholder="Note (optional), e.g. Monthly count" value={reason} onChange={(event) => setReason(event.target.value)} />
            {result ? (
              <p className="cf-card__meta" role="status" data-testid="stock-count-result">
                Saved. {result.filter((row) => row.variance !== 0).map((row) => `${row.inventory_name} ${row.variance > 0 ? "+" : ""}${row.variance}`).join(", ") || "No differences found."}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setOpen(false)}>Close</button>
              <button className="cf-btn cf-btn--primary" type="submit" disabled={busy || !counted.length || invalid}>{busy ? "Saving..." : `Save count (${counted.length})`}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
