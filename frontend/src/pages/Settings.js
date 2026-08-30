import React, { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { useUi } from "../contexts/UiContext";
import { toast } from "sonner";
import { DEFAULT_UI_SETTINGS } from "../lib/pos";
import { getPaymentMethodFlags, setPaymentMethodEnabled } from "../core/payments/utils/paymentMethods";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";

const DEFAULT_TABLE_SETTINGS = {
  nichePreset: "restaurant",
  serviceMode: "full_service",
  capabilities: {
    reservationsEnabled: true,
    areasEnabled: true,
    qrOrderingEnabled: false,
    splitBillEnabled: true,
    mergeTablesEnabled: false,
    waiterAssignmentEnabled: false,
    runnerDeliveryEnabled: false,
    cleaningStateEnabled: true,
    blockedStateEnabled: true,
  },
  reservationRules: {
    autoReleaseOnUndo: true,
    allowWalkInReservation: true,
    qrOrderingRules: {
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
    },
  },
  uiPreferences: {
    boardLayout: "grid",
    highlightReserved: true,
  },
};

export const Settings = () => {
  const { settings, updateSettings, resetSettings } = useUi();
  const [form, setForm] = useState(settings);
  const [tableSettings, setTableSettings] = useState(DEFAULT_TABLE_SETTINGS);
  const [tableSettingsLoaded, setTableSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;

    const loadTableSettings = async () => {
      try {
        const data = await fulfillmentService.fetchSettings();
        if (!active) return;
        setTableSettings({
          nichePreset: data?.nichePreset || DEFAULT_TABLE_SETTINGS.nichePreset,
          serviceMode: data?.serviceMode || DEFAULT_TABLE_SETTINGS.serviceMode,
          capabilities: {
            ...DEFAULT_TABLE_SETTINGS.capabilities,
            ...(data?.capabilities || {}),
          },
          reservationRules: {
            ...DEFAULT_TABLE_SETTINGS.reservationRules,
            ...(data?.reservationRules || {}),
            qrOrderingRules: {
              ...DEFAULT_TABLE_SETTINGS.reservationRules.qrOrderingRules,
              ...(data?.reservationRules?.qrOrderingRules || {}),
            },
          },
          uiPreferences: {
            ...DEFAULT_TABLE_SETTINGS.uiPreferences,
            ...(data?.uiPreferences || {}),
          },
        });
      } catch (error) {
        if (active) {
          toast.error("Failed to load table management settings");
        }
      } finally {
        if (active) {
          setTableSettingsLoaded(true);
        }
      }
    };

    loadTableSettings();

    return () => {
      active = false;
    };
  }, []);

  const paymentFlags = useMemo(
    () => getPaymentMethodFlags(form.paymentMethods),
    [form.paymentMethods]
  );

  const setPaymentEnabled = (method, enabled) => {
    setForm({ ...form, paymentMethods: setPaymentMethodEnabled(form.paymentMethods, method, enabled) });
  };

  const setTableCapability = (key, value) => {
    setTableSettings((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        [key]: value,
      },
    }));
  };

  const setReservationRule = (key, value) => {
    setTableSettings((current) => ({
      ...current,
      reservationRules: {
        ...current.reservationRules,
        [key]: value,
      },
    }));
  };

  const setQrOrderingRule = (key, value) => {
    setTableSettings((current) => ({
      ...current,
      reservationRules: {
        ...current.reservationRules,
        qrOrderingRules: {
          ...(current.reservationRules.qrOrderingRules || DEFAULT_TABLE_SETTINGS.reservationRules.qrOrderingRules),
          [key]: value,
        },
      },
    }));
  };

  const setUiPreference = (key, value) => {
    setTableSettings((current) => ({
      ...current,
      uiPreferences: {
        ...current.uiPreferences,
        [key]: value,
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      updateSettings({
        ...form,
        taxRate: Number(form.taxRate) || 0,
      });
      await fulfillmentService.updateSettings(tableSettings);
      toast.success("Settings saved");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save table management settings");
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    resetSettings();
    setForm(DEFAULT_UI_SETTINGS);
    setTableSettings(DEFAULT_TABLE_SETTINGS);
    toast.success("Settings reset");
  };

  return (
    <Layout title="Settings">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Settings</h1>
            <p>Shop configuration &amp; preferences</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" disabled={saving} onClick={restoreDefaults}>
              Reset
            </button>
            <button className="cf-btn cf-btn--primary" disabled={saving || !tableSettingsLoaded} onClick={save}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        <div className="cf-settings-grid">
          <div className="cf-settings-card">
            <div className="cf-settings-card__title">Shop Information</div>
            <div className="cf-field">
              <label>Shop Name</label>
              <input className="cf-input" value={form.shopName} onChange={(event) => setForm({ ...form, shopName: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>GST Number</label>
              <input className="cf-input" value={form.gst} onChange={(event) => setForm({ ...form, gst: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>Address</label>
              <textarea className="cf-textarea" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>Phone</label>
              <input className="cf-input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
          </div>

          <div className="cf-settings-card">
            <div className="cf-settings-card__title">Billing Preferences</div>
            <div className="cf-field">
              <label>Default Tax %</label>
              <input className="cf-input" min="0" max="100" type="number" value={form.taxRate} onChange={(event) => setForm({ ...form, taxRate: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>Bill Footer Text</label>
              <textarea className="cf-textarea" value={form.footer} onChange={(event) => setForm({ ...form, footer: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>Printable Offer Title</label>
              <input
                className="cf-input"
                placeholder="Weekend Offer"
                value={form.receiptOfferTitle || ""}
                onChange={(event) => setForm({ ...form, receiptOfferTitle: event.target.value })}
              />
            </div>
            <div className="cf-field">
              <label>Printable Offer Message</label>
              <textarea
                className="cf-textarea"
                placeholder="Show this bill next visit and get 10% off on dine-in orders."
                value={form.receiptOfferMessage || ""}
                onChange={(event) => setForm({ ...form, receiptOfferMessage: event.target.value })}
              />
            </div>
            <div className="cf-field">
              <label>Currency Symbol</label>
              <input className="cf-input" maxLength="3" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value || "\u20B9" })} />
            </div>
            <div className="cf-field">
              <label>Payment Methods</label>
              <div className="cf-checkbox-row">
                <label>
                  <input checked={paymentFlags.Cash} onChange={(event) => setPaymentEnabled("Cash", event.target.checked)} type="checkbox" />
                  Cash
                </label>
                <label>
                  <input checked={paymentFlags.UPI} onChange={(event) => setPaymentEnabled("UPI", event.target.checked)} type="checkbox" />
                  UPI
                </label>
                <label>
                  <input checked={paymentFlags.Card} onChange={(event) => setPaymentEnabled("Card", event.target.checked)} type="checkbox" />
                  Card
                </label>
              </div>
            </div>
          </div>

          <div className="cf-settings-card">
            <div className="cf-settings-card__title">Owner Account</div>
            <div className="cf-field">
              <label>Full Name</label>
              <input className="cf-input" value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>Email</label>
              <input className="cf-input" type="email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>New Password</label>
              <input className="cf-input" placeholder="Leave blank to keep current" type="password" />
            </div>
          </div>

          <div className="cf-settings-card">
            <div className="cf-settings-card__title">System Info</div>
            <table className="cf-table">
              <tbody>
                <tr>
                  <td style={{ color: "var(--cf-text-2)", width: "50%" }}>Version</td>
                  <td className="cf-table__mono">v1.0.0</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--cf-text-2)" }}>Configured Tax</td>
                  <td className="cf-table__mono">{form.taxRate}%</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--cf-text-2)" }}>Payment Methods</td>
                  <td className="cf-table__mono">{form.paymentMethods.join(", ")}</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--cf-text-2)" }}>Last Backup</td>
                  <td className="cf-table__mono">Never</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="cf-settings-card">
            <div className="cf-settings-card__title">Table Management</div>
            {!tableSettingsLoaded ? (
              <div className="cf-card__meta">Loading table settings...</div>
            ) : (
              <>
                <div className="cf-field">
                  <label>Business Niche</label>
                  <select
                    className="cf-select"
                    value={tableSettings.nichePreset}
                    onChange={(event) => setTableSettings((current) => ({ ...current, nichePreset: event.target.value }))}
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="cafe">Cafe</option>
                    <option value="food_court">Food Court</option>
                    <option value="bakery">Bakery</option>
                    <option value="quick_service">Quick Service</option>
                  </select>
                </div>
                <div className="cf-field">
                  <label>Service Mode</label>
                  <select
                    className="cf-select"
                    value={tableSettings.serviceMode}
                    onChange={(event) => setTableSettings((current) => ({ ...current, serviceMode: event.target.value }))}
                  >
                    <option value="full_service">Full Service</option>
                    <option value="counter_service">Counter Service</option>
                    <option value="hybrid_service">Hybrid Service</option>
                  </select>
                </div>
                <div className="cf-field">
                  <label>Table Features</label>
                  <div className="cf-checkbox-row">
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.reservationsEnabled)} onChange={(event) => setTableCapability("reservationsEnabled", event.target.checked)} type="checkbox" />
                      Reservations
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.areasEnabled)} onChange={(event) => setTableCapability("areasEnabled", event.target.checked)} type="checkbox" />
                      Areas
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.qrOrderingEnabled)} onChange={(event) => setTableCapability("qrOrderingEnabled", event.target.checked)} type="checkbox" />
                      QR Ordering
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.splitBillEnabled)} onChange={(event) => setTableCapability("splitBillEnabled", event.target.checked)} type="checkbox" />
                      Split Bill
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.mergeTablesEnabled)} onChange={(event) => setTableCapability("mergeTablesEnabled", event.target.checked)} type="checkbox" />
                      Merge Tables
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.waiterAssignmentEnabled)} onChange={(event) => setTableCapability("waiterAssignmentEnabled", event.target.checked)} type="checkbox" />
                      Waiter Assignment
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.runnerDeliveryEnabled)} onChange={(event) => setTableCapability("runnerDeliveryEnabled", event.target.checked)} type="checkbox" />
                      Runner Delivery
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.cleaningStateEnabled)} onChange={(event) => setTableCapability("cleaningStateEnabled", event.target.checked)} type="checkbox" />
                      Cleaning State
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.capabilities.blockedStateEnabled)} onChange={(event) => setTableCapability("blockedStateEnabled", event.target.checked)} type="checkbox" />
                      Blocked State
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="cf-settings-card">
            <div className="cf-settings-card__title">Reservation Board Preferences</div>
            {!tableSettingsLoaded ? (
              <div className="cf-card__meta">Loading table settings...</div>
            ) : (
              <>
                <div className="cf-field">
                  <label>Board Layout</label>
                  <select
                    className="cf-select"
                    value={tableSettings.uiPreferences.boardLayout}
                    onChange={(event) => setUiPreference("boardLayout", event.target.value)}
                  >
                    <option value="grid">Grid</option>
                    <option value="list">List</option>
                  </select>
                </div>
                <div className="cf-field">
                  <label>Reservation Rules</label>
                  <div className="cf-checkbox-row">
                    <label>
                      <input checked={Boolean(tableSettings.reservationRules.autoReleaseOnUndo)} onChange={(event) => setReservationRule("autoReleaseOnUndo", event.target.checked)} type="checkbox" />
                      Auto Release On Undo
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.reservationRules.allowWalkInReservation)} onChange={(event) => setReservationRule("allowWalkInReservation", event.target.checked)} type="checkbox" />
                      Allow Walk-In Reservation
                    </label>
                    <label>
                      <input checked={Boolean(tableSettings.uiPreferences.highlightReserved)} onChange={(event) => setUiPreference("highlightReserved", event.target.checked)} type="checkbox" />
                      Highlight Reserved Tables
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="cf-settings-card">
            <div className="cf-settings-card__title">QR Ordering Rules</div>
            {!tableSettingsLoaded ? (
              <div className="cf-card__meta">Loading table settings...</div>
            ) : (
              <>
                <div className="cf-field">
                  <label>Order Controls</label>
                  <div className="cf-checkbox-row">
                    <label>
                      <input
                        checked={Boolean(tableSettings.reservationRules.qrOrderingRules?.orderingPaused)}
                        onChange={(event) => setQrOrderingRule("orderingPaused", event.target.checked)}
                        type="checkbox"
                      />
                      Pause QR Ordering
                    </label>
                    <label>
                      <input
                        checked={Boolean(tableSettings.reservationRules.qrOrderingRules?.requireCustomerPhone)}
                        onChange={(event) => setQrOrderingRule("requireCustomerPhone", event.target.checked)}
                        type="checkbox"
                      />
                      Require Phone
                    </label>
                  </div>
                </div>
                <div className="cf-field">
                  <label>Minimum Order Value</label>
                  <input
                    className="cf-input"
                    min="0"
                    type="number"
                    value={tableSettings.reservationRules.qrOrderingRules?.minOrderTotal ?? 0}
                    onChange={(event) => setQrOrderingRule("minOrderTotal", Number(event.target.value || 0))}
                  />
                </div>
                <div className="cf-field">
                  <label>Estimated Prep Minutes</label>
                  <input
                    className="cf-input"
                    min="0"
                    type="number"
                    value={tableSettings.reservationRules.qrOrderingRules?.estimatedPrepMinutes ?? 20}
                    onChange={(event) => setQrOrderingRule("estimatedPrepMinutes", Number(event.target.value || 0))}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};
