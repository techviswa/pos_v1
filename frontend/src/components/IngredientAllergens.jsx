import React, { useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";

export function IngredientAllergens({ apiUrl }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState([]), [editing, setEditing] = useState(null);
  const [query, setQuery] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const base = `${apiUrl}/api/public/qr/allergens/ingredients`;
  const load = async () => {
    setOpen(true); setBusy(true); setError("");
    try { setItems(apiData(await axios.get(base, { withCredentials: true, skipCache: true }))); }
    catch (failure) { setError(failure.response?.data?.error?.message || "Unable to load ingredient allergens."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError("");
    const list = (value) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
    try {
      const details = apiData(await axios.put(`${base}/${editing.id}`, { allergens: list(editing.contains), may_contain: list(editing.may), reviewed: editing.reviewed }, { withCredentials: true }));
      setItems(items.map((item) => item.id === editing.id ? { ...item, ...details } : item)); setEditing(null);
    } catch (failure) { setError(failure.response?.data?.error?.message || "Unable to save allergen information."); }
    finally { setBusy(false); }
  };
  return <section className="cf-card cf-card--padded" aria-label="Ingredient allergens">
    <h2>Ingredient allergens</h2>
    <p>Record supplier-label allergens once per ingredient. Recipes, variations, add-ons and combos carry these warnings into the QR menu automatically. Review the dish's kitchen handling separately in Products.</p>
    <button type="button" disabled={busy} onClick={open ? () => { setOpen(false); setEditing(null); } : load}>{open ? "Hide ingredient allergens" : "Manage ingredient allergens"}</button>
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={load}>Retry</button></p> : null}
    {open ? <>
      <label>Find ingredient <input className="cf-input" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {editing ? <fieldset disabled={busy}><legend>{editing.name}</legend>
        <label className="cf-field">Contains (comma separated)<input className="cf-input" maxLength={1000} value={editing.contains} onChange={(event) => setEditing({ ...editing, contains: event.target.value, reviewed: false })} /></label>
        <label className="cf-field">May contain / supplier cross-contact (comma separated)<input className="cf-input" maxLength={1000} value={editing.may} onChange={(event) => setEditing({ ...editing, may: event.target.value, reviewed: false })} /></label>
        <label><input type="checkbox" checked={editing.reviewed} onChange={(event) => setEditing({ ...editing, reviewed: event.target.checked })} /> Verified against the current supplier label</label>
        <p>Changing suppliers or recipes requires a new review. Empty lists do not certify an ingredient as safe for every allergy.</p>
        <button type="button" onClick={save}>Save ingredient allergens</button> <button type="button" onClick={() => setEditing(null)}>Cancel</button>
      </fieldset> : null}
      <div style={{ maxHeight: 350, overflow: "auto" }}><table className="cf-table"><thead><tr><th>Ingredient</th><th>Contains / may contain</th><th>Review</th><th>Action</th></tr></thead><tbody>
        {items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.allergens.join(", ") || "None listed"} / {item.may_contain.join(", ") || "None listed"}</td><td>{item.reviewed ? "Reviewed" : "Needs review"}</td><td><button type="button" disabled={busy} onClick={() => setEditing({ ...item, contains: item.allergens.join(", "), may: item.may_contain.join(", ") })}>Edit allergens</button></td></tr>)}
      </tbody></table></div>
    </> : null}
  </section>;
}
