import React, { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Copy, QrCode } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";
import { getPublicQrUrl, isLocalNetworkUrl } from "../lib/qrUrls";
import { LocalQrCode } from "../components/LocalQrCode";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { QrServiceAnalytics } from "../components/QrServiceAnalytics";

const DEFAULT_QR_RULES = {
  orderingPaused: false,
  requireCustomerPhone: false,
  requireRestaurantApproval: true,
  requirePhoneVerification: false,
  minOrderTotal: 0,
  estimatedPrepMinutes: 20,
  serviceChargePercent: 0,
  serviceChargeFixed: 0,
  tipsEnabled: true,
  onlinePaymentEnabled: false,
  paymentRequiredBeforeApproval: false,
};


const normalizeSettings = (settings = {}) => ({
  ...settings,
  capabilities: {
    ...(settings.capabilities || {}),
  },
  reservationRules: {
    ...(settings.reservationRules || {}),
    qrOrderingRules: {
      ...DEFAULT_QR_RULES,
      ...(settings.reservationRules?.qrOrderingRules || {}),
    },
  },
});

export const QrManagement = () => {
  const [section, setSection] = useState("codes");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busyTableId, setBusyTableId] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [tableData, setTableData] = useState(null);
  const [settings, setSettings] = useState(normalizeSettings());
  const [lastGeneratedTableId, setLastGeneratedTableId] = useState("");

  const tables = useMemo(() => tableData?.tables?.items || [], [tableData]);
  const qrTables = useMemo(() => tables.filter((table) => table.qr_ordering), [tables]);
  const activeQrTables = qrTables.filter((table) => table.qr_ordering?.active);
  const totalScans = qrTables.reduce((sum, table) => sum + Number(table.qr_ordering?.scan_count || 0), 0);
  const qrRules = settings.reservationRules.qrOrderingRules;
  const qrOrderingEnabled = Boolean(settings.capabilities.qrOrderingEnabled);

  const load = async () => {
    setLoading(true);
    try {
      const [nextTableData, nextSettings] = await Promise.all([
        fulfillmentService.fetchTableManagement({ force: true, includeHistory: true }),
        fulfillmentService.fetchSettings(),
      ]);
      setTableData(nextTableData);
      setSettings(normalizeSettings(nextSettings));
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
      toast.error("Unable to load QR ordering workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateQrRule = (key, value) => {
    setSettings((current) => ({
      ...current,
      reservationRules: {
        ...current.reservationRules,
        qrOrderingRules: {
          ...current.reservationRules.qrOrderingRules,
          [key]: value,
        },
      },
    }));
  };

  const updateQrCapability = (enabled) => {
    setSettings((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        qrOrderingEnabled: enabled,
      },
    }));
  };

  const saveRules = async (toSave = settings, message = "QR settings saved") => {
    setSavingRules(true);
    try {
      const nextSettings = await fulfillmentService.updateSettings(toSave);
      setSettings(normalizeSettings(nextSettings));
      toast.success(message);
    } catch {
      toast.error("Unable to save QR settings");
    } finally {
      setSavingRules(false);
    }
  };

  // Guests who scan a code while ordering is off or paused only see "Ordering unavailable", so say so here.
  const orderingBlocked = !qrOrderingEnabled ? "off" : qrRules.orderingPaused ? "paused" : "";
  const turnOnOrdering = () => saveRules(
    { ...settings, capabilities: { ...settings.capabilities, qrOrderingEnabled: true }, reservationRules: { ...settings.reservationRules, qrOrderingRules: { ...qrRules, orderingPaused: false } } },
    "QR ordering is on. Guests can now order by scanning a table code.",
  );
  const localLinks = qrTables.some((table) => isLocalNetworkUrl(getPublicQrUrl(table.qr_ordering.token)));

  const prepareQr = async (table, payload = {}) => {
    setBusyTableId(table.id);
    try {
      const qr = await fulfillmentService.upsertTableQrCode(table.id, { active: true, ...payload });
      const url = getPublicQrUrl(qr.token);
      await window.navigator.clipboard?.writeText(url).catch(() => {});
      setLastGeneratedTableId(table.id);
      toast.success(payload.rotate ? "New QR code ready below" : "QR code ready below");
      await load();
    } catch {
      toast.error("Unable to prepare QR link");
    } finally {
      setBusyTableId("");
    }
  };

  const copyExisting = async (table) => {
    const token = table.qr_ordering?.token;
    if (!token) return prepareQr(table);
    await window.navigator.clipboard?.writeText(getPublicQrUrl(token));
    toast.success("QR link copied");
  };

  const deleteQr = async (table) => {
    if (!window.confirm(`Delete the QR code for ${table.name}? Printed copies will stop working. The table and its orders will be kept.`)) return;
    setBusyTableId(table.id);
    try {
      await fulfillmentService.deleteTableQrCode(table.id);
      await load();
      toast.success("QR code deleted");
    } catch { toast.error("Unable to delete the QR code. Try again."); }
    finally { setBusyTableId(""); }
  };

  return (
    <Layout title="QR">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>QR Ordering</h1>
            <p>{section === "codes" ? "Manage table QR links, scan activity, and public ordering rules." : "Review offers, guest feedback, and service performance."}</p>
          </div>
          {section === "codes" ? <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" disabled={loading} onClick={load} type="button">
              <ArrowClockwise size={15} weight="bold" />
              Refresh
            </button>
            <button className="cf-btn cf-btn--primary" disabled={savingRules || loading} onClick={() => saveRules()} type="button">
              {savingRules ? "Saving..." : "Save Rules"}
            </button>
          </div> : null}
        </div>

        <nav aria-label="QR workspace sections" style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <button className="cf-btn cf-btn--secondary" type="button" aria-pressed={section === "codes"} onClick={() => setSection("codes")}>QR codes & settings</button>
          <button className="cf-btn cf-btn--secondary" type="button" aria-pressed={section === "analytics"} onClick={() => setSection("analytics")}>Offers, feedback & analytics</button>
        </nav>
        {section === "analytics" ? <QrServiceAnalytics /> : loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : loading ? (
          <div className="cf-card cf-card--padded">
            <div className="cf-card__meta">Loading QR workspace...</div>
          </div>
        ) : (
          <>
            {orderingBlocked ? <section className="cf-card cf-card--padded" role="alert" data-testid="qr-ordering-blocked" style={{ marginBottom: 24, borderColor: "var(--cf-danger, #dc2626)" }}>
              <div className="cf-card__title"><span>{orderingBlocked === "off" ? "QR ordering is off" : "QR ordering is paused"}</span></div>
              <p className="cf-card__meta">Guests who scan a table code now see "Ordering unavailable" and cannot order.</p>
              <button className="cf-btn cf-btn--primary" type="button" disabled={savingRules} onClick={turnOnOrdering} data-testid="qr-turn-on">
                {savingRules ? "Saving..." : orderingBlocked === "off" ? "Turn on QR ordering" : "Resume QR ordering"}
              </button>
            </section> : null}
            <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }} aria-label="Scannable table QR codes">
              <div className="cf-card__title"><span>Scan a table QR code</span></div>
              <p className="cf-card__meta">Scan the image with your phone camera, or download it to print for the table.{localLinks ? " These links use a local address, so phones must be on the same Wi-Fi as the POS computer." : ""}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
                {qrTables.map((table) => <article className="cf-card cf-card--padded" key={table.id} style={{ textAlign: "center" }}>
                  <h3>{table.name}</h3>
                  <p className="cf-card__meta">{table.area_name || "Unassigned"} · {!table.qr_ordering.active ? "Inactive — activate before use" : orderingBlocked ? `Code ready · ordering ${orderingBlocked}` : "Active"}</p>
                  {table.qr_ordering.active ? <LocalQrCode size={128} value={getPublicQrUrl(table.qr_ordering.token)} label={`Scan to order at ${table.name}`} filename={`table-${table.code || table.id}-qr.png`} /> : <p>Generate an active QR code for this table below.</p>}
                  <a className="cf-btn cf-btn--secondary cf-btn--small" style={{ marginTop: 12 }} href={getPublicQrUrl(table.qr_ordering.token)} target="_blank" rel="noreferrer">Open menu</a>
                  <button className="cf-btn cf-btn--danger cf-btn--small" style={{ marginTop: 8 }} type="button" disabled={busyTableId === table.id} onClick={() => deleteQr(table)}>Delete QR</button>
                </article>)}
              </div>
              {!qrTables.length ? <p>No QR codes yet. Use Generate QR in the table list below.</p> : null}
            </section>
            <div className="cf-metrics">
              <div className="cf-metric">
                <div className="cf-metric__value">{tables.length}</div>
                <div className="cf-metric__label">Tables</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__value">{activeQrTables.length}</div>
                <div className="cf-metric__label">Active QR Links</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__value">{totalScans}</div>
                <div className="cf-metric__label">Total Scans</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__value">{qrOrderingEnabled ? "On" : "Off"}</div>
                <div className="cf-metric__label">QR Ordering</div>
              </div>
            </div>

            <div className="cf-grid-2">
              <section className="cf-card cf-card--padded">
                <div className="cf-card__title">
                  <span>Ordering Rules</span>
                </div>
                <div className="cf-field">
                  <label>Availability</label>
                  <div className="cf-checkbox-row">
                    <label>
                      <input checked={qrOrderingEnabled} onChange={(event) => updateQrCapability(event.target.checked)} type="checkbox" />
                      Enable QR Ordering
                    </label>
                    <label>
                      <input checked={Boolean(qrRules.orderingPaused)} onChange={(event) => updateQrRule("orderingPaused", event.target.checked)} type="checkbox" />
                      Pause Ordering
                    </label>
                    <label>
                      <input checked={Boolean(qrRules.requireCustomerPhone)} onChange={(event) => updateQrRule("requireCustomerPhone", event.target.checked)} type="checkbox" />
                      Require Phone
                    </label>
                    <label>
                      <input checked={Boolean(qrRules.requireRestaurantApproval)} onChange={(event) => updateQrRule("requireRestaurantApproval", event.target.checked)} type="checkbox" />
                      Staff Approval Before Kitchen
                    </label>
                    <label>
                      <input checked={Boolean(qrRules.requirePhoneVerification)} onChange={(event) => updateQrRule("requirePhoneVerification", event.target.checked)} type="checkbox" />
                      Require Phone OTP
                    </label>
                  </div>
                </div>
                <div className="cf-grid-2">
                  <div className="cf-field">
                    <label>Minimum Order Value</label>
                    <input className="cf-input" min="0" onChange={(event) => updateQrRule("minOrderTotal", Number(event.target.value || 0))} type="number" value={qrRules.minOrderTotal} />
                  </div>
                  <div className="cf-field">
                    <label>Estimated Prep Minutes</label>
                    <input className="cf-input" min="0" onChange={(event) => updateQrRule("estimatedPrepMinutes", Number(event.target.value || 0))} type="number" value={qrRules.estimatedPrepMinutes} />
                  </div>
                </div>
                <div className="cf-grid-2">
                  <div className="cf-field">
                    <label>Service Charge %</label>
                    <input className="cf-input" min="0" onChange={(event) => updateQrRule("serviceChargePercent", Number(event.target.value || 0))} type="number" value={qrRules.serviceChargePercent} />
                  </div>
                  <div className="cf-field">
                    <label>Fixed Service Charge</label>
                    <input className="cf-input" min="0" onChange={(event) => updateQrRule("serviceChargeFixed", Number(event.target.value || 0))} type="number" value={qrRules.serviceChargeFixed} />
                  </div>
                </div>
                <div className="cf-field">
                  <label>Payment & Tips</label>
                  <div className="cf-checkbox-row">
                    <label>
                      <input checked={Boolean(qrRules.tipsEnabled)} onChange={(event) => updateQrRule("tipsEnabled", event.target.checked)} type="checkbox" />
                      Allow Tips
                    </label>
                    <label>
                      <input checked={Boolean(qrRules.onlinePaymentEnabled)} onChange={(event) => updateQrRule("onlinePaymentEnabled", event.target.checked)} type="checkbox" />
                      Online Payment Ready
                    </label>
                    <label>
                      <input checked={Boolean(qrRules.paymentRequiredBeforeApproval)} onChange={(event) => updateQrRule("paymentRequiredBeforeApproval", event.target.checked)} type="checkbox" />
                      Require Payment Before Approval
                    </label>
                  </div>
                </div>
              </section>

              <section className="cf-card cf-card--padded">
                <div className="cf-card__title">
                  <span>Public Link</span>
                </div>
                <div className="cf-card__meta">QR codes generated from this screen use the public frontend URL for phone scanning.</div>
                <div className="cf-code-block">{tableData?.connection?.public_frontend_url || new URL(getPublicQrUrl("preview")).origin}</div>
                <div className="cf-card__meta">Use Billing table setup to create/edit dining tables. This page manages ordering links for those tables.</div>
              </section>
            </div>


            <section className="cf-card cf-card--padded">
              <div className="cf-card__title">
                <span>Table QR Links</span>
              </div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th>Scans</th>
                    <th>Last Scan</th>
                    <th>Link</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table) => {
                    const qr = table.qr_ordering;
                    const busy = busyTableId === table.id;
                    return (
                      <tr key={table.id}>
                        <td>{table.name}</td>
                        <td>{table.area_name || "Unassigned"}</td>
                        <td>{qr?.active ? "Active" : qr ? "Inactive" : "Not Generated"}</td>
                        <td>{Number(qr?.scan_count || 0)}</td>
                        <td>{qr?.last_scanned_at ? new Date(qr.last_scanned_at).toLocaleString() : "-"}</td>
                        <td>
                          {qr ? (
                            <div className="cf-qr-link-cell">
                              <span>{getPublicQrUrl(qr.token)}</span>
                              {lastGeneratedTableId === table.id ? <b>Generated</b> : null}
                            </div>
                          ) : (
                            <span className="cf-card__meta">Generate a QR link first</span>
                          )}
                        </td>
                        <td>
                          <div className="cf-table-actions">
                            {qr ? (
                              <>
                                <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => copyExisting(table)} type="button">
                                  <Copy size={14} weight="bold" />
                                  Copy
                                </button>
                                <button className="cf-btn cf-btn--danger cf-btn--small" disabled={busy} onClick={() => deleteQr(table)} type="button">Delete QR</button>
                                <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => prepareQr(table, { rotate: true })} type="button">
                                  <ArrowClockwise size={14} weight="bold" />
                                  Rotate
                                </button>
                                <a className="cf-btn cf-btn--secondary cf-btn--small" href={getPublicQrUrl(qr.token)} rel="noreferrer" target="_blank">
                                  Open
                                </a>
                              </>
                            ) : (
                              <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} onClick={() => prepareQr(table)} type="button">
                                <QrCode size={14} weight="bold" />
                                {busy ? "Generating..." : "Generate QR"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!tables.length ? (
                    <tr>
                      <td colSpan="7">
                        <div className="cf-empty-state">Create tables in Billing before generating QR ordering links.</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
};
