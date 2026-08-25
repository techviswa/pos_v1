import React, { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Copy, QrCode } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";

const DEFAULT_QR_RULES = {
  orderingPaused: false,
  requireCustomerPhone: false,
  minOrderTotal: 0,
  estimatedPrepMinutes: 20,
};

const getPublicQrUrl = (token) => {
  const publicOrigin = (process.env.REACT_APP_PUBLIC_FRONTEND_URL || window.location.origin).replace(/\/$/, "");
  return `${publicOrigin}/qr/${token}`;
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
  const [loading, setLoading] = useState(true);
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
    } catch (error) {
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

  const saveRules = async () => {
    setSavingRules(true);
    try {
      const nextSettings = await fulfillmentService.updateSettings(settings);
      setSettings(normalizeSettings(nextSettings));
      toast.success("QR settings saved");
    } catch {
      toast.error("Unable to save QR settings");
    } finally {
      setSavingRules(false);
    }
  };

  const prepareQr = async (table, payload = {}) => {
    setBusyTableId(table.id);
    try {
      const qr = await fulfillmentService.upsertTableQrCode(table.id, { active: true, ...payload });
      const url = getPublicQrUrl(qr.token);
      await window.navigator.clipboard?.writeText(url);
      setLastGeneratedTableId(table.id);
      toast.success(payload.rotate ? "New QR link copied" : "QR generated and copied");
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

  return (
    <Layout title="QR">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>QR Ordering</h1>
            <p>Manage table QR links, scan activity, and public ordering rules.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" disabled={loading} onClick={load} type="button">
              <ArrowClockwise size={15} weight="bold" />
              Refresh
            </button>
            <button className="cf-btn cf-btn--primary" disabled={savingRules || loading} onClick={saveRules} type="button">
              {savingRules ? "Saving..." : "Save Rules"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="cf-card cf-card--padded">
            <div className="cf-card__meta">Loading QR workspace...</div>
          </div>
        ) : (
          <>
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
              </section>

              <section className="cf-card cf-card--padded">
                <div className="cf-card__title">
                  <span>Public Link</span>
                </div>
                <div className="cf-card__meta">QR codes generated from this screen use the public frontend URL for phone scanning.</div>
                <div className="cf-code-block">{process.env.REACT_APP_PUBLIC_FRONTEND_URL || window.location.origin}</div>
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
