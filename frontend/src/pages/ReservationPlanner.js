import React, { useMemo, useState } from "react";
import { CalendarBlank, CheckCircle, Clock, Plus, User, XCircle } from "@phosphor-icons/react";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { toast } from "sonner";
import { getApiErrorMessage } from "../lib/apiErrors";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

const ACTIVE_STATUSES = new Set(["reserved", "occupied"]);
const HISTORY_STATUSES = new Set(["available", "released", "cancelled", "no_show"]);
const DEFAULT_FORM = {
  table_id: "",
  customer_name: "",
  customer_phone: "",
  guests_count: "2",
  reservation_date: "",
  reservation_time: "",
  source: "phone",
  deposit_amount: "",
  confirmation_status: "pending",
  notes: "",
};

const todayInputValue = () => new Date().toISOString().slice(0, 10);
const normalizePhone = (value) => String(value || "").replace(/\D/g, "").slice(0, 10);
const toArray = (value) => (Array.isArray(value) ? value : []);
const createClientId = () => window.crypto?.randomUUID?.() || String(Date.now());
const getReservationDateKey = (reservation) => {
  const value = reservation.reservation_for || reservation.reservation_date || reservation.scheduled_for;
  if (!value) return todayInputValue();
  return new Date(value).toISOString().slice(0, 10);
};
const getReservationTime = (reservation) => {
  const value = reservation.reservation_for || reservation.reservation_date || reservation.scheduled_for;
  if (!value) return "Now";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};
const buildReservationIso = (date, time) => {
  if (!date) return null;
  const safeTime = time || "19:00";
  const value = new Date(`${date}T${safeTime}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};
const isSameTimeWindow = (reservation, date, time, minutes = 120) => {
  const value = reservation.reservation_for || reservation.reservation_date || reservation.scheduled_for;
  if (!value || !date) return false;
  const selected = new Date(`${date}T${time || "19:00"}:00`).getTime();
  const scheduled = new Date(value).getTime();
  if (Number.isNaN(selected) || Number.isNaN(scheduled)) return false;
  return Math.abs(selected - scheduled) < minutes * 60 * 1000;
};

export const ReservationPlanner = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tables, setTables] = useState([]);
  const [areas, setAreas] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayInputValue());
  const [form, setForm] = useState({ ...DEFAULT_FORM, reservation_date: todayInputValue() });
  const [waitlist, setWaitlist] = useState([]);

  const fetchPlanner = async () => {
    try {
      const data = await fulfillmentService.fetchTableManagement({ force: true, includeHistory: true });
      setTables(toArray(data?.tables?.items));
      setAreas(toArray(data?.tables?.areas));
      setReservations(toArray(data?.reservations?.items));
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchPlanner);

  const selectedReservations = useMemo(
    () => reservations.filter((reservation) => getReservationDateKey(reservation) === selectedDate),
    [reservations, selectedDate],
  );
  const activeReservations = useMemo(
    () => selectedReservations.filter((reservation) => ACTIVE_STATUSES.has(String(reservation.status || "").toLowerCase())),
    [selectedReservations],
  );
  const historyReservations = useMemo(
    () => reservations.filter((reservation) => HISTORY_STATUSES.has(String(reservation.status || "").toLowerCase())).slice(0, 12),
    [reservations],
  );
  const guestsCount = Number(form.guests_count || 0);
  const suggestedTables = useMemo(() => {
    const blockedTableIds = new Set(
      activeReservations
        .filter((reservation) => isSameTimeWindow(reservation, form.reservation_date, form.reservation_time))
        .map((reservation) => reservation.table_id),
    );
    return tables
      .filter((table) => table.active !== false)
      .filter((table) => !blockedTableIds.has(table.id))
      .filter((table) => !guestsCount || Number(table.seats || 0) >= guestsCount)
      .sort((left, right) => Number(left.seats || 0) - Number(right.seats || 0));
  }, [activeReservations, form.reservation_date, form.reservation_time, guestsCount, tables]);

  const areaRows = useMemo(() => {
    const areaMap = new Map(areas.map((area) => [area.id, area.name]));
    const fallbackArea = "Unassigned";
    return tables.reduce((rows, table) => {
      const areaName = table.area_id ? areaMap.get(table.area_id) || fallbackArea : fallbackArea;
      if (!rows[areaName]) rows[areaName] = [];
      rows[areaName].push(table);
      return rows;
    }, {});
  }, [areas, tables]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submitReservation = async (event) => {
    event.preventDefault();
    if (normalizePhone(form.customer_phone).length && normalizePhone(form.customer_phone).length !== 10) {
      toast.error("Customer phone must be 10 digits");
      return;
    }
    if (!form.table_id) {
      toast.error("Select a table before reserving");
      return;
    }

    try {
      await fulfillmentService.reserveTable({
        table_id: form.table_id,
        customer_name: form.customer_name,
        customer_phone: normalizePhone(form.customer_phone),
        guests_count: Number(form.guests_count || 0) || null,
        reservation_for: buildReservationIso(form.reservation_date, form.reservation_time),
        status: "reserved",
        source: form.source,
        notes: form.notes,
        meta: {
          deposit_amount: Number(form.deposit_amount || 0),
          confirmation_status: form.confirmation_status,
        },
      });
      toast.success("Reservation added to planner");
      setForm({ ...DEFAULT_FORM, reservation_date: selectedDate });
      fetchPlanner();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to create reservation"));
    }
  };

  const addWaitlist = () => {
    if (!form.customer_name || !guestsCount) {
      toast.error("Add customer name and guest count for waitlist");
      return;
    }
    setWaitlist((current) => [
      {
        id: createClientId(),
        customer_name: form.customer_name,
        customer_phone: normalizePhone(form.customer_phone),
        guests_count: guestsCount,
        requested_for: buildReservationIso(form.reservation_date, form.reservation_time),
        notes: form.notes,
      },
      ...current,
    ]);
    toast.success("Guest added to waitlist for this planner session");
  };

  const updateReservationStatus = async (reservationId, status) => {
    try {
      await fulfillmentService.updateReservationStatus(reservationId, status);
      toast.success(`Reservation marked ${status.replace("_", " ")}`);
      fetchPlanner();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update reservation"));
    }
  };

  const deleteReservation = async (reservationId) => {
    try {
      await fulfillmentService.deleteReservation(reservationId);
      toast.success("Reservation removed");
      fetchPlanner();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to remove reservation"));
    }
  };

  const renderReservationActions = (reservation) => {
    const status = String(reservation.status || "").toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) return null;
    return (
      <div className="cf-reservation-actions">
        {status === "reserved" ? (
          <button className="cf-btn cf-btn--primary cf-btn--small" onClick={() => updateReservationStatus(reservation.id, "occupied")} type="button">
            Seat
          </button>
        ) : null}
        <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => updateReservationStatus(reservation.id, "released")} type="button">
          Release
        </button>
        <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => updateReservationStatus(reservation.id, "no_show")} type="button">
          No-show
        </button>
        <button className="cf-btn cf-btn--danger cf-btn--small" onClick={() => updateReservationStatus(reservation.id, "cancelled")} type="button">
          Cancel
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <Layout title="Reservations">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading reservation planner...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Reservations">
        <div className="cf-page">
          <ApiErrorPanel error={loadError} onRetry={fetchPlanner} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Reservations">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Reservation Planner</h1>
            <p>Plan tables by date, time, guest count, deposit, confirmation state, and service status.</p>
          </div>
          <div className="cf-page__header-actions">
            <input className="cf-input" onChange={(event) => setSelectedDate(event.target.value)} type="date" value={selectedDate} />
            <button className="cf-btn cf-btn--secondary" onClick={fetchPlanner} type="button">Refresh</button>
          </div>
        </div>

        <div className="cf-metrics">
          <div className="cf-metric">
            <div className="cf-metric__label">Reserved Today</div>
            <div className="cf-metric__value">{activeReservations.filter((item) => item.status === "reserved").length}</div>
            <div className="cf-metric__sub">Bookings waiting for arrival</div>
          </div>
          <div className="cf-metric">
            <div className="cf-metric__label">Seated</div>
            <div className="cf-metric__value">{activeReservations.filter((item) => item.status === "occupied").length}</div>
            <div className="cf-metric__sub">Guests currently at tables</div>
          </div>
          <div className="cf-metric">
            <div className="cf-metric__label">Waitlist</div>
            <div className="cf-metric__value">{waitlist.length}</div>
            <div className="cf-metric__sub">Held in this planner session</div>
          </div>
        </div>

        <div className="cf-reservation-planner">
          <section className="cf-reservation-planner__form">
            <div className="cf-card cf-card--padded">
              <div className="cf-card__title">
                <span>New Reservation</span>
                <span className="cf-card__meta">Suggested tables update from date, time, and guests</span>
              </div>
              <form className="cf-reservation-form" onSubmit={submitReservation}>
                <label>
                  Customer
                  <input className="cf-input" onChange={(event) => updateForm("customer_name", event.target.value)} placeholder="Guest name" required value={form.customer_name} />
                </label>
                <label>
                  Phone
                  <input className="cf-input" inputMode="numeric" maxLength={10} onChange={(event) => updateForm("customer_phone", normalizePhone(event.target.value))} placeholder="10-digit phone" value={form.customer_phone} />
                </label>
                <label>
                  Guests
                  <input className="cf-input" min="1" onChange={(event) => updateForm("guests_count", event.target.value)} type="number" value={form.guests_count} />
                </label>
                <label>
                  Date
                  <input className="cf-input" onChange={(event) => updateForm("reservation_date", event.target.value)} type="date" value={form.reservation_date} />
                </label>
                <label>
                  Time
                  <input className="cf-input" onChange={(event) => updateForm("reservation_time", event.target.value)} type="time" value={form.reservation_time} />
                </label>
                <label>
                  Table
                  <select className="cf-input" onChange={(event) => updateForm("table_id", event.target.value)} required value={form.table_id}>
                    <option value="">Select available table</option>
                    {suggestedTables.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.name} | {table.seats || "-"} seats{table.area_name ? ` | ${table.area_name}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Source
                  <select className="cf-input" onChange={(event) => updateForm("source", event.target.value)} value={form.source}>
                    <option value="phone">Phone</option>
                    <option value="walk-in">Walk-in</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label>
                  Deposit
                  <input className="cf-input" min="0" onChange={(event) => updateForm("deposit_amount", event.target.value)} placeholder="0" type="number" value={form.deposit_amount} />
                </label>
                <label>
                  Confirmation
                  <select className="cf-input" onChange={(event) => updateForm("confirmation_status", event.target.value)} value={form.confirmation_status}>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="reminder_sent">Reminder sent</option>
                  </select>
                </label>
                <label className="cf-reservation-form__wide">
                  Notes
                  <textarea className="cf-input" onChange={(event) => updateForm("notes", event.target.value)} placeholder="Occasion, seating request, deposit note..." value={form.notes} />
                </label>
                <div className="cf-reservation-form__actions">
                  <button className="cf-btn cf-btn--primary" type="submit"><Plus size={15} weight="bold" /> Reserve Table</button>
                  <button className="cf-btn cf-btn--secondary" onClick={addWaitlist} type="button">Add to Waitlist</button>
                </div>
              </form>
            </div>
          </section>

          <section className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Table Availability</span>
              <span className="cf-card__meta">Selected day view</span>
            </div>
            <div className="cf-floor-plan">
              {Object.entries(areaRows).map(([areaName, areaTables]) => (
                <div className="cf-floor-plan__area" key={areaName}>
                  <div className="cf-floor-plan__area-title">{areaName}</div>
                  <div className="cf-floor-plan__tables">
                    {areaTables.map((table) => {
                      const reservation = activeReservations.find((item) => item.table_id === table.id);
                      return (
                        <button
                          className={`cf-table-tile ${reservation ? "is-held" : "is-free"}`}
                          key={table.id}
                          onClick={() => updateForm("table_id", table.id)}
                          type="button"
                        >
                          <strong>{table.name}</strong>
                          <span>{table.seats || "-"} seats</span>
                          <small>{reservation ? `${reservation.customer_name || "Guest"} | ${getReservationTime(reservation)}` : "Available"}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="cf-dashboard-grid" style={{ marginTop: 24 }}>
          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Today's Plan</span>
              <span className="cf-card__meta">Upcoming, seated, no-show, and cancelled actions</span>
            </div>
            <div className="cf-kitchen-list">
              {selectedReservations.length ? selectedReservations.map((reservation) => (
                <div className="cf-kitchen-list__item" key={reservation.id}>
                  <div>
                    <div className="cf-kitchen-list__title">
                      {reservation.table_label || "Table"} | {reservation.customer_name || "Walk-in"}
                    </div>
                    <div className="cf-kitchen-list__meta">
                      <Clock size={13} weight="bold" /> {getReservationTime(reservation)}
                      {" | "}
                      <User size={13} weight="bold" /> {reservation.guests_count || "-"} guests
                      {reservation.customer_phone ? ` | ${reservation.customer_phone}` : ""}
                      {reservation.meta?.deposit_amount ? ` | Deposit ${reservation.meta.deposit_amount}` : ""}
                      {reservation.meta?.confirmation_status ? ` | ${reservation.meta.confirmation_status}` : ""}
                    </div>
                    {reservation.notes ? <div className="cf-card__meta" style={{ marginTop: 6 }}>{reservation.notes}</div> : null}
                  </div>
                  <div className="cf-kitchen-list__stats">
                    <span className={reservation.status === "occupied" ? "cf-badge cf-badge--blue" : reservation.status === "reserved" ? "cf-badge cf-badge--green" : "cf-badge cf-badge--gray"}>
                      {reservation.status}
                    </span>
                    {renderReservationActions(reservation)}
                  </div>
                </div>
              )) : <div className="cf-empty-state">No reservations for selected date.</div>}
            </div>
          </div>

          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Waitlist</span>
              <span className="cf-card__meta">Temporary queue until a table is chosen</span>
            </div>
            <div className="cf-kitchen-list">
              {waitlist.length ? waitlist.map((entry) => (
                <div className="cf-kitchen-list__item" key={entry.id}>
                  <div>
                    <div className="cf-kitchen-list__title">{entry.customer_name}</div>
                    <div className="cf-kitchen-list__meta">
                      {entry.guests_count} guests{entry.customer_phone ? ` | ${entry.customer_phone}` : ""}
                      {entry.requested_for ? ` | ${new Date(entry.requested_for).toLocaleString("en-IN")}` : ""}
                    </div>
                  </div>
                  <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => setWaitlist((current) => current.filter((item) => item.id !== entry.id))} type="button">
                    Clear
                  </button>
                </div>
              )) : <div className="cf-empty-state">No waitlist guests.</div>}
            </div>
          </div>
        </div>

        <div className="cf-table-wrap" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Reservation History</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Customer</th>
                <th>Guests</th>
                <th>Status</th>
                <th>When</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {historyReservations.length ? historyReservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td>{reservation.table_label || "-"}</td>
                  <td>{reservation.customer_name || "Walk-in"}</td>
                  <td>{reservation.guests_count || "-"}</td>
                  <td>{reservation.status}</td>
                  <td>{reservation.reservation_for ? new Date(reservation.reservation_for).toLocaleString("en-IN") : "-"}</td>
                  <td>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => deleteReservation(reservation.id)} type="button">
                      Remove
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="6" style={{ color: "var(--cf-text-3)" }}>No released, cancelled, or no-show reservations yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="cf-reservation-legend">
          <span><CalendarBlank size={15} weight="bold" /> Future bookings do not block the table immediately.</span>
          <span><CheckCircle size={15} weight="bold" /> Seat confirms arrival and marks table occupied.</span>
          <span><XCircle size={15} weight="bold" /> Cancel/no-show keeps history instead of hiding the operational record.</span>
        </div>
      </div>
    </Layout>
  );
};
