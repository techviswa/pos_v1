import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../../components/ui/dialog";
import { toast } from "sonner";

const createEmptyTableForm = () => ({
  name: "",
  code: "",
  seats: "4",
  area_id: "",
  active: true,
  shape: "",
  sort_order: "0",
  meta_text: "{}",
});

const createEmptyAreaForm = () => ({
  name: "",
  code: "",
  active: true,
  sort_order: "0",
  meta_text: "{}",
});

const statusLabelMap = {
  available: "Available",
  reserved: "Reserved",
  occupied: "Occupied",
  disabled: "Disabled",
};

const getTableStatus = (table) => {
  if (table?.active === false) return "disabled";
  return table?.billing_status || table?.status || "available";
};

const getTableShapeClass = (table) => {
  const normalized = String(table?.shape || "").trim().toLowerCase();
  if (!normalized) return "is-square";
  if (["round", "circle", "circular"].includes(normalized)) return "is-round";
  if (["rectangle", "rect", "rectangular"].includes(normalized)) return "is-rectangle";
  if (["booth", "sofa"].includes(normalized)) return "is-booth";
  return "is-square";
};

const buildAreaModel = (tableItems = [], areaItems = []) => {
  const areaById = new Map((areaItems || []).map((area) => [area.id, area]));
  const tableGroups = new Map();
  const summary = {
    total: tableItems.length,
    available: 0,
    reserved: 0,
    occupied: 0,
    disabled: 0,
  };

  (tableItems || []).forEach((table) => {
    const status = getTableStatus(table);
    if (table.active === false) summary.disabled += 1;
    else if (status === "reserved") summary.reserved += 1;
    else if (status === "occupied") summary.occupied += 1;
    else summary.available += 1;

    const areaId = table.area_id || "uncategorized";
    const current = tableGroups.get(areaId) || [];
    current.push(table);
    tableGroups.set(areaId, current);
  });

  const groups = (areaItems || []).map((area) => ({
    id: area.id,
    name: area.name,
    active: area.active !== false,
    items: tableGroups.get(area.id) || [],
  }));

  const uncategorized = tableGroups.get("uncategorized") || [];
  if (uncategorized.length || !groups.length) {
    groups.push({
      id: "uncategorized",
      name: "Unassigned",
      active: true,
      items: uncategorized,
    });
  }

  return {
    summary,
    groups,
    areaById,
  };
};

const createEmptyReservationForm = () => ({
  reservation_date: "",
  reservation_time: "",
  source: "manual",
  meta_text: "{}",
});

const formatReservationDateTime = (value) => {
  if (!value) return "Reserve now";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Reserve later";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

const buildReservationIso = (dateValue, timeValue) => {
  if (!dateValue) return null;
  const time = timeValue || "00:00";
  const parsed = new Date(`${dateValue}T${time}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const safeSerializeMeta = (value) => {
  if (!value || (typeof value === "object" && !Object.keys(value).length)) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
};

const parseMetaInput = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
};

export const FulfillmentTablePanel = ({
  busy,
  canManageTables,
  areaItems = [],
  onCreateArea,
  onCreateTable,
  onDeleteArea,
  onDeleteTable,
  onReserveTable,
  onSelectTable,
  onDeleteReservation,
  onUndoReservation,
  onUpsertTableQrCode,
  onUpdateArea,
  onUpdateTable,
  orderMeta,
  qrOrderingEnabled,
  reservationItems = [],
  tableItems = [],
}) => {
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
  const [editingTableId, setEditingTableId] = useState("");
  const [editingAreaId, setEditingAreaId] = useState("");
  const [qrPreview, setQrPreview] = useState(null);
  const [reservationTable, setReservationTable] = useState(null);
  const [tableForm, setTableForm] = useState(createEmptyTableForm);
  const [areaForm, setAreaForm] = useState(createEmptyAreaForm);
  const [reservationForm, setReservationForm] = useState(createEmptyReservationForm);

  const selectedTable = useMemo(
    () => tableItems.find((table) => table.id === orderMeta.table_id) || null,
    [orderMeta.table_id, tableItems],
  );

  const { summary, groups: groupedAreas, areaById } = useMemo(
    () => buildAreaModel(tableItems, areaItems),
    [tableItems, areaItems],
  );
  const visibleAreaGroups = useMemo(
    () => groupedAreas.filter((group) => group.id === "uncategorized" || group.items.length > 0),
    [groupedAreas],
  );
  const upcomingReservations = useMemo(
    () =>
      reservationItems.filter((reservation) => {
        const status = String(reservation.status || "").toLowerCase();
        return status === "reserved" || status === "occupied";
      }),
    [reservationItems],
  );
  const reservationHistory = useMemo(
    () =>
      reservationItems.filter((reservation) => {
        const status = String(reservation.status || "").toLowerCase();
        return status !== "reserved" && status !== "occupied";
      }),
    [reservationItems],
  );

  const closeTableModal = () => {
    setIsTableModalOpen(false);
    setEditingTableId("");
    setTableForm(createEmptyTableForm());
  };

  const closeAreaModal = () => {
    setIsAreaModalOpen(false);
    setEditingAreaId("");
    setAreaForm(createEmptyAreaForm());
  };

  const closeReservationModal = () => {
    setIsReservationModalOpen(false);
    setReservationTable(null);
    setReservationForm(createEmptyReservationForm());
  };

  const openCreateTableModal = (areaId = "") => {
    setEditingTableId("");
    setTableForm({
      ...createEmptyTableForm(),
      area_id: areaId || "",
    });
    setIsTableModalOpen(true);
  };

  const openEditTableModal = (table) => {
    setEditingTableId(table.id);
    setTableForm({
      name: table.name || "",
      code: table.code || "",
      seats: String(table.seats || 4),
      area_id: table.area_id || "",
      active: table.active !== false,
      shape: table.shape || "",
      sort_order: String(table.sort_order ?? 0),
      meta_text: safeSerializeMeta(table.meta),
    });
    setIsTableModalOpen(true);
  };

  const openCreateAreaModal = () => {
    setEditingAreaId("");
    setAreaForm(createEmptyAreaForm());
    setIsAreaModalOpen(true);
  };

  const openEditAreaModal = (area) => {
    if (!area) return;
    setEditingAreaId(area.id);
    setAreaForm({
      name: area.name || "",
      code: area.code || "",
      active: area.active !== false,
      sort_order: String(area.sort_order ?? 0),
      meta_text: safeSerializeMeta(area.meta),
    });
    setIsAreaModalOpen(true);
  };

  const openReservationModal = (table) => {
    setReservationTable(table);
    setReservationForm({
      ...createEmptyReservationForm(),
      source: table.current_reservation?.source || "manual",
      meta_text: safeSerializeMeta(table.current_reservation?.meta),
    });
    setIsReservationModalOpen(true);
  };

  const submitTable = async () => {
    let payload;
    try {
      payload = {
        name: tableForm.name.trim(),
        code: tableForm.code.trim() || null,
        seats: Number(tableForm.seats || 4),
        area_id: tableForm.area_id || null,
        active: tableForm.active,
        shape: tableForm.shape.trim() || null,
        sort_order: Number(tableForm.sort_order || 0),
        meta: parseMetaInput(tableForm.meta_text),
      };
    } catch {
      toast.error("Table meta must be valid JSON");
      return;
    }

    if (editingTableId) {
      await onUpdateTable(editingTableId, payload);
    } else {
      await onCreateTable(payload);
    }

    closeTableModal();
  };

  const submitArea = async () => {
    let payload;
    try {
      payload = {
        name: areaForm.name.trim(),
        code: areaForm.code.trim() || null,
        active: areaForm.active,
        sort_order: Number(areaForm.sort_order || 0),
        meta: parseMetaInput(areaForm.meta_text),
      };
    } catch {
      toast.error("Category meta must be valid JSON");
      return;
    }

    if (editingAreaId) {
      await onUpdateArea(editingAreaId, payload);
    } else {
      await onCreateArea(payload);
    }

    closeAreaModal();
  };

  const submitReservation = async () => {
    if (!reservationTable) return;

    let reservationMeta;
    try {
      reservationMeta = parseMetaInput(reservationForm.meta_text);
    } catch {
      toast.error("Reservation meta must be valid JSON");
      return;
    }

    await onReserveTable(reservationTable, {
      reservation_for: buildReservationIso(reservationForm.reservation_date, reservationForm.reservation_time),
      status: reservationForm.reservation_date ? "reserved" : "occupied",
      source: reservationForm.source || "manual",
      meta: reservationMeta,
    });

    closeReservationModal();
  };

  const handleQuickReserve = async () => {
    if (!selectedTable) return;
    try {
      await onReserveTable(selectedTable, { status: "occupied" });
    } catch {
      // The parent action already shows a toast for conflicts like already-reserved tables.
    }
  };

  const handleUndoReservation = async (reservationId) => {
    if (!reservationId) return;
    try {
      await onUndoReservation(reservationId);
    } catch {
      // The parent action already shows a toast if undo fails.
    }
  };

  const getQrUrl = (token) => {
    const publicOrigin = (process.env.REACT_APP_PUBLIC_FRONTEND_URL || window.location.origin).replace(/\/$/, "");
    return `${publicOrigin}/qr/${token}`;
  };

  const copyToClipboard = async (url) => {
    await window.navigator.clipboard?.writeText(url);
  };

  const copyQrLink = async (table, { preview = true } = {}) => {
    if (!table) return;
    try {
      const qr = table.qr_ordering?.token
        ? table.qr_ordering
        : await onUpsertTableQrCode(table.id, { active: true });
      const url = getQrUrl(qr.token);
      await copyToClipboard(url);
      if (preview) {
        setQrPreview({ table, qr, url });
      }
      toast.success(`QR link copied for ${table.name}`);
    } catch (error) {
      toast.error("Unable to prepare QR link");
    }
  };

  const rotateQrLink = async (table) => {
    if (!table) return;
    try {
      const qr = await onUpsertTableQrCode(table.id, { active: true, rotate: true });
      const url = getQrUrl(qr.token);
      await copyToClipboard(url);
      setQrPreview({ table, qr, url });
      toast.success(`New QR link copied for ${table.name}`);
    } catch {
      toast.error("Unable to rotate QR link");
    }
  };

  const renderTableTile = (table) => {
    const status = getTableStatus(table);
    const isSelected = orderMeta.table_id === table.id;
    const isBlocked = table.active === false;

        return (
      <div className={`cf-table-sketch__tile-wrap ${getTableShapeClass(table)}`} key={table.id}>
        {canManageTables ? (
          <div className="cf-table-sketch__quick-actions">
            <button className="cf-table-sketch__edit-btn" disabled={busy} onClick={() => openEditTableModal(table)} type="button">
              Edit
            </button>
            {qrOrderingEnabled ? (
              <button className="cf-table-sketch__edit-btn" disabled={busy} onClick={() => copyQrLink(table)} type="button">
                QR
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          className={`cf-table-chip ${getTableShapeClass(table)} is-${status} ${isSelected ? "is-selected" : ""} ${isBlocked ? "is-blocked" : ""}`}
          disabled={isBlocked}
          onClick={() => onSelectTable(table)}
          type="button"
        >
          <span className="cf-table-chip__name">{table.name}</span>
          <small>{table.seats} seats</small>
          <span className="cf-table-chip__status">{statusLabelMap[status] || status}</span>
        </button>
      </div>
    );
  };

  return (
    <div className="cf-card cf-card--padded">
      <div className="cf-card__title">
        <span>Table Availability</span>
      </div>

      <div className="cf-table-overview">
        <div className="cf-table-overview__metric"><strong>{summary.total}</strong><span>Total tables</span></div>
        <div className="cf-table-overview__metric"><strong>{summary.available}</strong><span>Available</span></div>
        <div className="cf-table-overview__metric"><strong>{summary.reserved}</strong><span>Reserved</span></div>
        <div className="cf-table-overview__metric"><strong>{summary.occupied}</strong><span>Occupied</span></div>
      </div>

      <div className="cf-table-category-sections">
        {visibleAreaGroups.map((group) => {
          const area = areaById.get(group.id) || null;
          const isSelectedGroup = selectedTable ? (selectedTable.area_id || "uncategorized") === group.id : false;
          const groupSelectedTable = isSelectedGroup ? selectedTable : null;
          const groupSelectedStatus = groupSelectedTable ? getTableStatus(groupSelectedTable) : "available";
          const groupActiveReservation = groupSelectedTable?.current_reservation || null;

          return (
            <section className={`cf-table-category cf-table-category--simple ${group.active === false ? "is-disabled" : ""}`} key={group.id}>
              <div className="cf-table-category__header">
                <div className="cf-table-category__title-row">
                  <h3 className="cf-table-category__title">{group.name}</h3>
                  <span className="cf-card__meta">
                    {group.active === false ? "Disabled" : `${group.items.length} tables`}
                    {area?.code ? ` | ${area.code}` : ""}
                  </span>
                </div>
                {canManageTables ? (
                  <div className="cf-table-category__actions">
                    {group.id !== "uncategorized" ? (
                      <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => openEditAreaModal(area)} type="button">
                        Edit Category
                      </button>
                    ) : null}
                    <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} onClick={() => openCreateTableModal(group.id === "uncategorized" ? "" : group.id)} type="button">
                      + Add Table
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="cf-table-sketch__grid">
                {group.items.map(renderTableTile)}
                {canManageTables ? (
                  <button
                    className="cf-table-chip cf-table-chip--add"
                    disabled={busy}
                    onClick={() => openCreateTableModal(group.id === "uncategorized" ? "" : group.id)}
                    type="button"
                  >
                    <span>+</span>
                    <small>Create Table</small>
                  </button>
                ) : null}
                {!group.items.length && !canManageTables ? <div className="cf-table-sketch__empty">No tables in this category yet.</div> : null}
              </div>

              <div className="cf-table-panel__footer">
                <div className="cf-table-panel__footer-actions">
                  <div className="cf-table-action-row">
                    <button
                      className="cf-btn cf-btn--primary cf-table-action-row__button"
                      disabled={busy || !groupSelectedTable || groupSelectedTable.active === false || groupSelectedStatus !== "available"}
                      onClick={handleQuickReserve}
                      type="button"
                    >
                      Reserve Now
                    </button>
                    <button
                      className="cf-btn cf-btn--secondary cf-table-action-row__button"
                      disabled={busy || !groupSelectedTable || groupSelectedTable.active === false || groupSelectedStatus !== "available"}
                      onClick={() => groupSelectedTable && openReservationModal(groupSelectedTable)}
                      type="button"
                    >
                      Reserve Table
                    </button>
                    <button
                      className="cf-btn cf-btn--secondary cf-table-action-row__button"
                      disabled={busy || !groupActiveReservation?.id}
                      onClick={() => handleUndoReservation(groupActiveReservation?.id)}
                      type="button"
                    >
                      Undo Reservation
                    </button>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {areaItems.length ? (
        <div className="cf-table-category-manager">
          <div className="cf-table-category-manager__header">
            <div>
              <div className="cf-table-category-manager__title">Your Categories</div>
              <div className="cf-card__meta">You can rename, enable, disable, or delete categories whenever you need.</div>
            </div>
          </div>
          <div className="cf-table-category-manager__list">
            {areaItems.map((area) => (
              <div className="cf-table-category-manager__row" key={area.id}>
                <div>
                  <div className="cf-table-category-manager__name">{area.name}</div>
                  <div className="cf-card__meta">
                    {area.active === false ? "Disabled" : "Enabled"} | {area.table_count || 0} tables
                    {area.code ? ` | ${area.code}` : ""}
                    {area.sort_order !== undefined ? ` | Sort ${area.sort_order}` : ""}
                  </div>
                </div>
                {canManageTables ? (
                  <div className="cf-table-category-manager__actions">
                    <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => openEditAreaModal(area)} type="button">
                      Edit
                    </button>
                    <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy || (area.table_count || 0) > 0} onClick={() => onDeleteArea(area.id)} type="button">
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {upcomingReservations.length ? (
        <div className="cf-table-sketch__reserved">
          {upcomingReservations.slice(0, 8).map((reservation) => (
            <div className="cf-table-sketch__reserved-item" key={reservation.id}>
              <div>
                <strong>{reservation.table_label || "Reserved table"}</strong>
                <span>
                  {reservation.customer_name || "Walk-in"}
                  {reservation.guests_count ? ` | ${reservation.guests_count} guests` : ""}
                  {reservation.area_name ? ` | ${reservation.area_name}` : ""}
                  {reservation.reservation_for ? ` | ${formatReservationDateTime(reservation.reservation_for)}` : ""}
                  {reservation.source ? ` | ${reservation.source}` : ""}
                  {reservation.confirmed_at ? ` | Confirmed ${formatReservationDateTime(reservation.confirmed_at)}` : ""}
                  {reservation.released_at ? ` | Released ${formatReservationDateTime(reservation.released_at)}` : ""}
                  {reservation.canceled_at ? ` | Canceled ${formatReservationDateTime(reservation.canceled_at)}` : ""}
                </span>
                {reservation.meta && Object.keys(reservation.meta).length ? (
                  <div className="cf-card__meta" style={{ marginTop: 6 }}>Meta: {safeSerializeMeta(reservation.meta)}</div>
                ) : null}
              </div>
              <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => handleUndoReservation(reservation.id)} type="button">
                Undo
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {reservationHistory.length ? (
        <div className="cf-table-sketch__reserved">
          <div className="cf-card__title" style={{ marginTop: 8 }}>
            <span>Recent Reservation History</span>
            <span className="cf-card__meta">Released and canceled reservations still stored in the backend.</span>
          </div>
          {reservationHistory.slice(0, 8).map((reservation) => (
            <div className="cf-table-sketch__reserved-item" key={reservation.id}>
              <div>
                <strong>{reservation.table_label || "Table history"}</strong>
                <span>
                  {reservation.customer_name || "Walk-in"}
                  {reservation.guests_count ? ` | ${reservation.guests_count} guests` : ""}
                  {reservation.area_name ? ` | ${reservation.area_name}` : ""}
                  {reservation.reservation_for ? ` | ${formatReservationDateTime(reservation.reservation_for)}` : ""}
                  {reservation.source ? ` | ${reservation.source}` : ""}
                  {reservation.released_at ? ` | Released ${formatReservationDateTime(reservation.released_at)}` : ""}
                  {reservation.canceled_at ? ` | Canceled ${formatReservationDateTime(reservation.canceled_at)}` : ""}
                </span>
                {reservation.meta && Object.keys(reservation.meta).length ? (
                  <div className="cf-card__meta" style={{ marginTop: 6 }}>Meta: {safeSerializeMeta(reservation.meta)}</div>
                ) : null}
              </div>
              {canManageTables ? (
                <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => onDeleteReservation(reservation.id)} type="button">
                  Delete
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <Dialog onOpenChange={setIsTableModalOpen} open={isTableModalOpen}>
        <DialogContent className="bg-white cf-table-modal">
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">{editingTableId ? "Edit Table" : "Create Table"}</DialogTitle>
          </DialogHeader>

          <div className="cf-table-modal__grid">
            <div className="cf-field">
              <label>Table Name</label>
              <input
                className="cf-input cf-table-modal__input"
                onChange={(event) => setTableForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="T1"
                value={tableForm.name}
              />
            </div>

            <div className="cf-field">
              <label>Table Code</label>
              <input
                className="cf-input cf-table-modal__input"
                onChange={(event) => setTableForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="TBL-01"
                value={tableForm.code}
              />
            </div>

            <div className="cf-field">
              <label>Seats</label>
              <input
                className="cf-input cf-table-modal__input"
                min="1"
                onChange={(event) => setTableForm((current) => ({ ...current, seats: event.target.value }))}
                type="number"
                value={tableForm.seats}
              />
            </div>

            <div className="cf-field">
              <label>Category</label>
              <select
                className="cf-select cf-table-category-slot__select"
                onChange={(event) => {
                  if (event.target.value === "__create_new__") {
                    openCreateAreaModal();
                    return;
                  }
                  setTableForm((current) => ({ ...current, area_id: event.target.value }));
                }}
                value={tableForm.area_id}
              >
                <option value="">Select category</option>
                {areaItems.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
                {canManageTables ? <option value="__create_new__">+ Add New Category</option> : null}
              </select>
            </div>

            <div className="cf-field">
              <label>Shape</label>
              <select
                className="cf-select cf-table-modal__input"
                onChange={(event) => setTableForm((current) => ({ ...current, shape: event.target.value }))}
                value={tableForm.shape}
              >
                <option value="">Square</option>
                <option value="rectangle">Rectangle</option>
                <option value="round">Round</option>
                <option value="booth">Booth</option>
              </select>
            </div>

            <div className="cf-field">
              <label>Sort Order</label>
              <input
                className="cf-input cf-table-modal__input"
                min="0"
                onChange={(event) => setTableForm((current) => ({ ...current, sort_order: event.target.value }))}
                type="number"
                value={tableForm.sort_order}
              />
            </div>

            <div className="cf-field">
              <label>Table Status</label>
              <div className="cf-table-toggle">
                <button
                  className={`cf-switch-pill ${tableForm.active ? "is-active" : ""}`}
                  onClick={() => setTableForm((current) => ({ ...current, active: true }))}
                  type="button"
                >
                  Enabled
                </button>
                <button
                  className={`cf-switch-pill ${!tableForm.active ? "is-active" : ""}`}
                  onClick={() => setTableForm((current) => ({ ...current, active: false }))}
                  type="button"
                >
                  Disabled
                </button>
              </div>
            </div>

            <div className="cf-field" style={{ gridColumn: "1 / -1" }}>
              <label>Table Meta JSON</label>
              <textarea
                className="cf-textarea cf-table-modal__input"
                onChange={(event) => setTableForm((current) => ({ ...current, meta_text: event.target.value }))}
                placeholder='{"zone":"window","min_spend":500}'
                value={tableForm.meta_text}
              />
            </div>
          </div>

          <div className="cf-table-modal__actions">
            {editingTableId ? (
              <button className="cf-btn cf-btn--danger" disabled={busy} onClick={() => onDeleteTable(editingTableId).then(closeTableModal)} type="button">
                Delete Table
              </button>
            ) : <span />}
            <div className="cf-table-modal__actions-right">
              {editingTableId && qrOrderingEnabled ? (
                <button
                  className="cf-btn cf-btn--secondary"
                  disabled={busy}
                  onClick={() => {
                    const table = tableItems.find((item) => item.id === editingTableId);
                    return rotateQrLink(table);
                  }}
                  type="button"
                >
                  Rotate QR
                </button>
              ) : null}
              <button className="cf-btn cf-btn--secondary" onClick={closeTableModal} type="button">
                Cancel
              </button>
              <button className="cf-btn cf-btn--primary" disabled={busy || !tableForm.name.trim()} onClick={submitTable} type="button">
                {editingTableId ? "Save Table" : "Create Table"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setQrPreview(null)} open={Boolean(qrPreview)}>
        <DialogContent className="bg-white cf-table-modal">
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">Table QR Ordering</DialogTitle>
          </DialogHeader>
          {qrPreview ? (
            <div className="cf-qr-preview">
              <div>
                <strong>{qrPreview.table?.name}</strong>
                <div className="cf-card__meta">Print this QR and place it on the table.</div>
                <div className="cf-card__meta">
                  {Number(qrPreview.qr?.scan_count || qrPreview.table?.qr_ordering?.scan_count || 0)} scans
                  {(qrPreview.qr?.last_scanned_at || qrPreview.table?.qr_ordering?.last_scanned_at)
                    ? ` | Last scanned ${new Date(qrPreview.qr?.last_scanned_at || qrPreview.table.qr_ordering.last_scanned_at).toLocaleString()}`
                    : ""}
                </div>
              </div>
              <img
                alt={`QR ordering code for ${qrPreview.table?.name || "table"}`}
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPreview.url)}`}
              />
              <input className="cf-input" readOnly value={qrPreview.url} />
              <div className="cf-table-modal__actions-right">
                <button className="cf-btn cf-btn--secondary" onClick={() => copyToClipboard(qrPreview.url).then(() => toast.success("QR link copied"))} type="button">
                  Copy Link
                </button>
                <button className="cf-btn cf-btn--secondary" onClick={() => rotateQrLink(qrPreview.table)} type="button">
                  Rotate QR
                </button>
                <button className="cf-btn cf-btn--primary" onClick={() => window.print()} type="button">
                  Print
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsAreaModalOpen} open={isAreaModalOpen}>
        <DialogContent className="bg-white cf-table-modal">
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">{editingAreaId ? "Edit Category" : "Create Category"}</DialogTitle>
          </DialogHeader>

          <div className="cf-table-modal__grid">
            <div className="cf-field">
              <label>Category Name</label>
              <input
                className="cf-input cf-table-modal__input"
                onChange={(event) => setAreaForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Top Floor"
                value={areaForm.name}
              />
            </div>

            <div className="cf-field">
              <label>Category Code</label>
              <input
                className="cf-input cf-table-modal__input"
                onChange={(event) => setAreaForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="TOP-FLR"
                value={areaForm.code}
              />
            </div>

            <div className="cf-field">
              <label>Sort Order</label>
              <input
                className="cf-input cf-table-modal__input"
                min="0"
                onChange={(event) => setAreaForm((current) => ({ ...current, sort_order: event.target.value }))}
                type="number"
                value={areaForm.sort_order}
              />
            </div>

            <div className="cf-field">
              <label>Category Status</label>
              <div className="cf-table-toggle">
                <button
                  className={`cf-switch-pill ${areaForm.active ? "is-active" : ""}`}
                  onClick={() => setAreaForm((current) => ({ ...current, active: true }))}
                  type="button"
                >
                  Enabled
                </button>
                <button
                  className={`cf-switch-pill ${!areaForm.active ? "is-active" : ""}`}
                  onClick={() => setAreaForm((current) => ({ ...current, active: false }))}
                  type="button"
                >
                  Disabled
                </button>
              </div>
            </div>

            <div className="cf-field" style={{ gridColumn: "1 / -1" }}>
              <label>Category Meta JSON</label>
              <textarea
                className="cf-textarea cf-table-modal__input"
                onChange={(event) => setAreaForm((current) => ({ ...current, meta_text: event.target.value }))}
                placeholder='{"theme":"family","priority":1}'
                value={areaForm.meta_text}
              />
            </div>
          </div>

          <div className="cf-table-modal__actions">
            {editingAreaId ? (
              <button className="cf-btn cf-btn--danger" disabled={busy} onClick={() => onDeleteArea(editingAreaId).then(closeAreaModal)} type="button">
                Delete Category
              </button>
            ) : <span />}
            <div className="cf-table-modal__actions-right">
              <button className="cf-btn cf-btn--secondary" onClick={closeAreaModal} type="button">
                Cancel
              </button>
              <button className="cf-btn cf-btn--primary" disabled={busy || !areaForm.name.trim()} onClick={submitArea} type="button">
                {editingAreaId ? "Save Category" : "Create Category"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsReservationModalOpen} open={isReservationModalOpen}>
        <DialogContent className="bg-white cf-table-modal">
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">Reserve Table</DialogTitle>
          </DialogHeader>

          <div className="cf-table-modal__grid">
            <div className="cf-card__meta">
              {reservationTable
                ? `Reserving ${reservationTable.name}. Leave date and time empty to reserve immediately, or add them for a later booking.`
                : "Select a table first."}
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Reservation Date</label>
                <input
                  className="cf-input cf-table-modal__input"
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setReservationForm((current) => ({ ...current, reservation_date: event.target.value }))}
                  type="date"
                  value={reservationForm.reservation_date}
                />
              </div>
              <div className="cf-field">
                <label>Reservation Time</label>
                <input
                  className="cf-input cf-table-modal__input"
                  onChange={(event) => setReservationForm((current) => ({ ...current, reservation_time: event.target.value }))}
                  type="time"
                  value={reservationForm.reservation_time}
                />
              </div>
            </div>

            <div className="cf-grid-2">
              <div className="cf-field">
                <label>Reservation Source</label>
                <select
                  className="cf-select cf-table-modal__input"
                  onChange={(event) => setReservationForm((current) => ({ ...current, source: event.target.value }))}
                  value={reservationForm.source}
                >
                  <option value="manual">Manual</option>
                  <option value="phone">Phone</option>
                  <option value="walk_in">Walk-In</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div className="cf-field">
                <label>Confirmation Deadline</label>
                <input
                  className="cf-input cf-table-modal__input"
                  readOnly
                  value={reservationForm.reservation_date ? formatReservationDateTime(buildReservationIso(reservationForm.reservation_date, reservationForm.reservation_time)) : "Matches reservation time"}
                />
              </div>
            </div>

            <div className="cf-field">
              <label>Reservation Meta JSON</label>
              <textarea
                className="cf-textarea cf-table-modal__input"
                onChange={(event) => setReservationForm((current) => ({ ...current, meta_text: event.target.value }))}
                placeholder='{"occasion":"birthday","deposit_received":true}'
                value={reservationForm.meta_text}
              />
            </div>

            <div className="cf-card__meta">
              {reservationForm.reservation_date
                ? `Scheduled for ${formatReservationDateTime(buildReservationIso(reservationForm.reservation_date, reservationForm.reservation_time))}`
                : "This will mark the table reserved right away."}
            </div>
          </div>

          <div className="cf-table-modal__actions">
            <span />
            <div className="cf-table-modal__actions-right">
              <button className="cf-btn cf-btn--secondary" onClick={closeReservationModal} type="button">
                Cancel
              </button>
              <button className="cf-btn cf-btn--primary" disabled={busy || !reservationTable} onClick={submitReservation} type="button">
                {reservationForm.reservation_date ? "Reserve for Later" : "Reserve Now"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
