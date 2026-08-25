import React from "react";

export const TableManagerPanel = ({
  tables,
  editingTableId,
  tableForm,
  onChangeForm,
  onEditTable,
  onCancelEdit,
  onSubmit,
  onDeleteTable,
  busy,
}) => (
  <div className="cf-card cf-card--padded" style={{ marginBottom: 16 }}>
    <div className="cf-card__title">
      <span>Manage Tables</span>
      <span className="cf-card__meta">Add, edit, and delete real table records used by billing</span>
    </div>

    <div className="cf-table-manager">
      <div className="cf-table-manager__form">
        <input
          className="cf-input"
          onChange={(event) => onChangeForm("name", event.target.value)}
          placeholder="Table name"
          value={tableForm.name}
        />
        <input
          className="cf-input"
          min="1"
          onChange={(event) => onChangeForm("seats", event.target.value)}
          placeholder="Seats"
          type="number"
          value={tableForm.seats}
        />
        <div className="cf-table-manager__actions">
          <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} onClick={onSubmit} type="button">
            {editingTableId ? "Save Table" : "Add Table"}
          </button>
          {editingTableId ? (
            <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={onCancelEdit} type="button">
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="cf-table-manager__list">
        {tables.length ? (
          tables.map((table) => (
            <div className="cf-table-manager__row" key={table.id}>
              <div>
                <div className="cf-table-manager__name">{table.name}</div>
                <div className="cf-table-manager__meta">
                  {table.seats} seats · {table.status}
                </div>
              </div>
              <div className="cf-table-manager__row-actions">
                <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => onEditTable(table)} type="button">
                  Edit
                </button>
                <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} onClick={() => onDeleteTable(table)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="cf-empty-state">No tables added yet.</div>
        )}
      </div>
    </div>
  </div>
);
