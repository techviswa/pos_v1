import React, { useEffect, useMemo, useRef, useState } from "react";
import { BackupStatusRow, DownloadBusinessData } from "../core/platform/BackupStatus";
import { timeZoneOptions } from "../lib/businessDate";
import axios from "axios";
import { Layout } from "../components/Layout";
import { useUi } from "../contexts/UiContext";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { PaymentGatewaySettings } from "../core/payments/PaymentGatewaySettings";
import { toast } from "sonner";
import { DEFAULT_UI_SETTINGS, getLegacyUiSettings } from "../lib/pos";
import { getPaymentMethodFlags, setPaymentMethodEnabled } from "../core/payments/utils/paymentMethods";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";
import { apiData } from '../lib/apiData';

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
  const { settings, updateSettings, profileLoaded, profileError, refreshProfile } = useUi();
  const [legacySettings] = useState(getLegacyUiSettings);
  const { user, applyProfile } = useAuth();
  const [accountName, setAccountName] = useState(user?.name || '');
  const [savingAccount, setSavingAccount] = useState(false);
  const accountDirty = useRef(false);
  useEffect(() => { if (!accountDirty.current) setAccountName(user?.name || ''); }, [user?.name]);
  const saveAccountName = async () => {
    const name = accountName.trim();
    if (!name || name.length > 120) { toast.error('Account name must contain 1 to 120 characters'); return; }
    setSavingAccount(true);
    try {
      const response = await axios.put(`${API_URL}/api/staff/me/profile`, { name }, { withCredentials: true });
      const saved = apiData(response);
      applyProfile?.(saved);
      accountDirty.current = false;
      setAccountName(saved.name);
      toast.success('Account name saved');
    } catch (error) { toast.error(error?.response?.data?.error?.message || 'Account name was not saved. Review and retry.'); }
    finally { setSavingAccount(false); }
  };
  const [form, setFormState] = useState(settings);
  const dirty = useRef(false);
  const editVersion = useRef(settings.updated_at);
  const setForm = next => { dirty.current = true; setFormState(next); };
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [changingPassword, setChangingPassword] = useState(false);

  const changePassword = async () => {
    if (passwordForm.next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      toast.error("The new passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      await axios.post(
        `${API_URL}/api/auth/change-password`,
        { current_password: passwordForm.current, new_password: passwordForm.next },
        { withCredentials: true },
      );
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast.success("Password changed. Other devices have been signed out.");
    } catch (error) {
      toast.error(error?.response?.data?.error?.message || "Could not change the password");
    } finally {
      setChangingPassword(false);
    }
  };
  const [tableSettings, setTableSettings] = useState(DEFAULT_TABLE_SETTINGS);
  const [tableSettingsLoaded, setTableSettingsLoaded] = useState(false);
  const [tableSettingsError, setTableSettingsError] = useState(false);
  const [tableReload, setTableReload] = useState(0);
  const tableBaseline = useRef(DEFAULT_TABLE_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty.current) { setFormState(settings); editVersion.current = settings.updated_at; }
  }, [settings]);

  useEffect(() => {
    let active = true;

    const loadTableSettings = async () => {
      setTableSettingsLoaded(false);
      setTableSettingsError(false);
      try {
        const data = await fulfillmentService.fetchSettings();
        if (!active) return;
        const loadedSettings = {
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
        };
        tableBaseline.current = loadedSettings;
        setTableSettings(loadedSettings);
        setTableSettingsLoaded(true);
      } catch (error) {
        if (active) {
          setTableSettingsError(true);
          toast.error("Failed to load table management settings");
        }
      }
    };

    loadTableSettings();

    return () => {
      active = false;
    };
  }, [tableReload]);

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
    let profileSaved = false;
    try {
      const saved = await updateSettings({
        ...form,
        taxRate: Number(form.taxRate) || 0,
      }, editVersion.current);
      dirty.current = false;
      editVersion.current = saved.updated_at;
      setFormState(saved);
      profileSaved = true;
      await fulfillmentService.updateSettings(tableSettings);
      tableBaseline.current = tableSettings;
      toast.success("Settings saved");
    } catch (error) {
      toast.error(`${profileSaved ? 'Shop details saved, but table preferences failed: ' : ''}${error?.response?.data?.error?.message || error?.message || 'Review and retry.'}`);
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    setForm({ ...DEFAULT_UI_SETTINGS, shopName: form.shopName, gst: form.gst, address: form.address, phone: form.phone });
    setTableSettings(DEFAULT_TABLE_SETTINGS);
    toast.info("Defaults prepared. Review and save to apply; shop details were kept.");
  };

  return (
    <Layout title="Settings">
      <div className="cf-page">
        {profileError ? <div role="alert">{profileError} <button className="cf-btn cf-btn--secondary" onClick={refreshProfile}>Retry</button></div> : null}
        {tableSettingsError ? <div role="alert">Table preferences could not be loaded. Saving is paused to protect existing settings. <button className="cf-btn cf-btn--secondary" onClick={() => setTableReload(value => value + 1)}>Retry table preferences</button></div> : null}
        {profileLoaded && !settings.persisted && legacySettings ? <div className="cf-settings-migration" role="note">
          Shop details now save to this business for all staff. Older browser preferences have been kept, but may belong to a different business.
          <button className="cf-btn cf-btn--secondary" onClick={() => setForm({ ...settings, ...legacySettings })}>Review browser preferences for this business</button>
        </div> : null}
        {dirty.current ? <button className="cf-btn cf-btn--secondary" onClick={() => { dirty.current = false; setFormState(settings); setTableSettings(tableBaseline.current); editVersion.current = settings.updated_at; refreshProfile(); }}>Discard draft and reload saved settings</button> : null}
        <div className="cf-page__header">
          <div>
            <h1>Settings</h1>
            <p>Shop configuration &amp; preferences</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" disabled={saving} onClick={restoreDefaults}>
              Reset
            </button>
            <button className="cf-btn cf-btn--primary" disabled={saving || !tableSettingsLoaded || !profileLoaded} onClick={save}>
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
              <label htmlFor="business-timezone">Time zone</label>
              <select id="business-timezone" className="cf-select" value={form.timezone || "Asia/Kolkata"} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                {timeZoneOptions().map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
              <span className="cf-card__meta">Reports, the dashboard and bill dates count days and hours in this time zone.</span>
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
            <div className="cf-settings-card__title">Your Account</div>
            <div className="cf-field">
              <label>Full Name</label>
              <input className="cf-input" maxLength={120} value={accountName} onChange={(event) => { accountDirty.current = true; setAccountName(event.target.value); }} />
            </div>
            <div className="cf-field">
              <label>Email</label>
              <input className="cf-input" type="email" value={user?.email || ''} readOnly />
              <p className="cf-field__hint">Login email and access are managed in Staff.</p>
            </div>
            <button className="cf-btn cf-btn--secondary" style={{ marginBottom: 20 }} type="button" disabled={savingAccount || !accountDirty.current} onClick={saveAccountName}>{savingAccount ? 'Saving account...' : 'Save account name'}</button>
            <div className="cf-field">
              <label htmlFor="pw-current">Current Password</label>
              <input id="pw-current" className="cf-input" type="password" autoComplete="current-password" value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} />
            </div>
            <div className="cf-field">
              <label htmlFor="pw-next">New Password</label>
              <input id="pw-next" className="cf-input" type="password" autoComplete="new-password" value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} />
            </div>
            <div className="cf-field">
              <label htmlFor="pw-confirm">Confirm New Password</label>
              <input id="pw-confirm" className="cf-input" type="password" autoComplete="new-password" value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} />
            </div>
            <button className="cf-btn cf-btn--primary" type="button" disabled={changingPassword || !passwordForm.current || !passwordForm.next} onClick={changePassword}>
              {changingPassword ? "Changing..." : "Change Password"}
            </button>
          </div>

          {["Owner", "Manager"].includes(user?.role) ? <PaymentGatewaySettings apiUrl={API_URL} isOwner={user?.role === "Owner"} /> : null}
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
                  <td className="cf-table__mono">{settings.taxRate}%</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--cf-text-2)" }}>Payment Methods</td>
                  <td className="cf-table__mono">{settings.paymentMethods.join(", ")}</td>
                </tr>
                <BackupStatusRow />
              </tbody>
            </table>
            {user?.role === "Owner" ? <DownloadBusinessData /> : null}
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
