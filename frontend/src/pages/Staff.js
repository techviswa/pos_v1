import React, { useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import {
  formatCurrency,
  getDefaultPermissionsForRole,
  normalizeStaffBio,
  PERMISSION_LABELS,
  STAFF_BIO_REQUIRED_FIELDS,
  STAFF_PERMISSION_KEYS,
  STAFF_ROLE_OPTIONS,
} from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

const API_URL = (() => {
  const configured = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (typeof window === "undefined") return configured;

  const currentOrigin = window.location.origin.replace(/\/+$/, "");
  const currentHost = window.location.hostname;
  if (configured && configured !== currentOrigin && !configured.includes("vercel.app")) {
    return configured;
  }

  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    return configured || "http://localhost:4001";
  }

  return "https://pos-v1-fwjm.onrender.com";
})();

const createDefaultForm = () => ({
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "Cashier",
  permissions: getDefaultPermissionsForRole("Cashier"),
  assigned_outlet_ids: [],
  active: true,
  bio: normalizeStaffBio(),
});

const buildFormFromMember = (member) => ({
  name: member.name,
  email: member.email,
  phone: member.phone || "",
  password: "",
  role: member.role || "Cashier",
  permissions: member.permissions || ["billing", "bills"],
  assigned_outlet_ids: member.assigned_outlet_ids || [],
  active: member.active ?? true,
  bio: normalizeStaffBio(member.bio),
});

const bioCompletionLabel = (member) => (member.profile_completed ? "Complete" : "Pending");

const normalizePhone = (value) => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(-10);
  return digits;
};

const sanitizeTenDigitPhoneInput = (value) => normalizePhone(value).slice(0, 10);

const hasDuplicateContactNumbers = (form) => {
  const numbers = [
    normalizePhone(form.phone),
    normalizePhone(form.bio?.emergency_contact_phone),
    normalizePhone(form.bio?.emergency_contact_phone_2),
  ].filter(Boolean);
  return numbers.length !== new Set(numbers).size;
};

const BioFields = ({ form, setForm }) => {
  const updateBio = (key, value) => {
    setForm((current) => ({ ...current, bio: { ...current.bio, [key]: value } }));
  };

  return (
    <>
      <div className="cf-section-title">Complete Bio</div>
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Employee Code</label>
          <input className="cf-input" required value={form.bio.employee_code} onChange={(event) => updateBio("employee_code", event.target.value)} />
        </div>
        <div className="cf-field">
          <label>Joining Date</label>
          <input className="cf-input" required type="date" value={form.bio.joining_date} onChange={(event) => updateBio("joining_date", event.target.value)} />
        </div>
      </div>
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Date of Birth</label>
          <input className="cf-input" required type="date" value={form.bio.date_of_birth} onChange={(event) => updateBio("date_of_birth", event.target.value)} />
        </div>
        <div className="cf-field">
          <label>Gender</label>
          <select className="cf-select" required value={form.bio.gender} onChange={(event) => updateBio("gender", event.target.value)}>
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Emergency Contact Name</label>
          <input className="cf-input" required value={form.bio.emergency_contact_name} onChange={(event) => updateBio("emergency_contact_name", event.target.value)} />
        </div>
        <div className="cf-field">
          <label>Emergency Contact Phone</label>
          <input className="cf-input" inputMode="numeric" maxLength={10} required value={form.bio.emergency_contact_phone} onChange={(event) => updateBio("emergency_contact_phone", sanitizeTenDigitPhoneInput(event.target.value))} />
        </div>
      </div>
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Emergency Contact Name 2</label>
          <input className="cf-input" required value={form.bio.emergency_contact_name_2} onChange={(event) => updateBio("emergency_contact_name_2", event.target.value)} />
        </div>
        <div className="cf-field">
          <label>Emergency Contact Phone 2</label>
          <input className="cf-input" inputMode="numeric" maxLength={10} required value={form.bio.emergency_contact_phone_2} onChange={(event) => updateBio("emergency_contact_phone_2", sanitizeTenDigitPhoneInput(event.target.value))} />
        </div>
      </div>
      <div className="cf-field">
        <label>Address</label>
        <textarea className="cf-textarea" required rows={3} value={form.bio.address} onChange={(event) => updateBio("address", event.target.value)} />
      </div>
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Education</label>
          <input className="cf-input" value={form.bio.education} onChange={(event) => updateBio("education", event.target.value)} />
        </div>
        <div className="cf-field">
          <label>ID Number</label>
          <input className="cf-input" value={form.bio.id_number} onChange={(event) => updateBio("id_number", event.target.value)} />
        </div>
      </div>
      <div className="cf-grid-2">
        <div className="cf-field">
          <label>Shift Timing</label>
          <input className="cf-input" value={form.bio.shift_timing} onChange={(event) => updateBio("shift_timing", event.target.value)} />
        </div>
        <div className="cf-field">
          <label>Staff Phone</label>
          <input className="cf-input" inputMode="numeric" maxLength={10} value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: sanitizeTenDigitPhoneInput(event.target.value) }))} />
        </div>
      </div>
      <div className="cf-field">
        <label>Notes</label>
        <textarea className="cf-textarea" rows={3} value={form.bio.notes} onChange={(event) => updateBio("notes", event.target.value)} />
      </div>
      <div style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
        Required for profile completion: {STAFF_BIO_REQUIRED_FIELDS.join(", ").replaceAll("_", " ")}.
      </div>
    </>
  );
};

export const Staff = () => {
  const { settings } = useUi();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [outlets, setOutlets] = useState([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [formData, setFormData] = useState(createDefaultForm);
  const [editForm, setEditForm] = useState(createDefaultForm);
  const [addFormError, setAddFormError] = useState("");
  const [editFormError, setEditFormError] = useState("");
  const hasLoadedStaffRef = useRef(false);

  const fetchData = async () => {
    try {
      const [staffResponse, outletsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/staff`, { withCredentials: true }),
        axios.get(`${API_URL}/api/outlets`, { withCredentials: true }),
      ]);
      const nextStaff = staffResponse.data || [];
      setStaff(nextStaff);
      setSelectedStaffId((current) => {
        if (current && nextStaff.some((item) => item.id === current)) {
          return current;
        }
        return nextStaff[0]?.id || null;
      });
      setOutlets(outletsResponse.data || []);
      hasLoadedStaffRef.current = true;
    } catch (error) {
      if (!hasLoadedStaffRef.current) {
        toast.error(error.response?.data?.detail || "Failed to load staff rights");
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData);

  const togglePermission = (permission, editing = false) => {
    const form = editing ? editForm : formData;
    const setForm = editing ? setEditForm : setFormData;
    const nextPermissions = form.permissions.includes(permission)
      ? form.permissions.filter((item) => item !== permission)
      : [...form.permissions, permission];
    setForm({ ...form, permissions: nextPermissions });
  };

  const toggleOutlet = (outletId, editing = false) => {
    const form = editing ? editForm : formData;
    const setForm = editing ? setEditForm : setFormData;
    const nextOutlets = form.assigned_outlet_ids.includes(outletId)
      ? form.assigned_outlet_ids.filter((item) => item !== outletId)
      : [...form.assigned_outlet_ids, outletId];
    setForm({ ...form, assigned_outlet_ids: nextOutlets });
  };

  const applyRoleDefaults = (role, editing = false) => {
    const setForm = editing ? setEditForm : setFormData;
    setForm((current) => ({
      ...current,
      role,
      permissions: getDefaultPermissionsForRole(role),
      assigned_outlet_ids: role === "Owner" ? [] : current.assigned_outlet_ids,
    }));
  };

  const openEdit = (member) => {
    setEditingStaff(member);
    setEditForm(buildFormFromMember(member));
    setEditFormError("");
  };

  const addStaff = async (event) => {
    event.preventDefault();
    setAddFormError("");
    if (normalizePhone(formData.phone).length && normalizePhone(formData.phone).length !== 10) {
      setAddFormError("Staff phone must be exactly 10 digits");
      return;
    }
    if (normalizePhone(formData.bio?.emergency_contact_phone).length !== 10) {
      setAddFormError("Emergency contact phone 1 must be exactly 10 digits");
      return;
    }
    if (normalizePhone(formData.bio?.emergency_contact_phone_2).length !== 10) {
      setAddFormError("Emergency contact phone 2 must be exactly 10 digits");
      return;
    }
    if (hasDuplicateContactNumbers(formData)) {
      setAddFormError("Staff phone, emergency contact 1, and emergency contact 2 must all be different");
      return;
    }
    try {
      await axios.post(
        `${API_URL}/api/staff`,
        {
          ...formData,
          phone: formData.phone || null,
          permissions: formData.role === "Owner" ? STAFF_PERMISSION_KEYS : formData.permissions,
          assigned_outlet_ids: formData.role === "Owner" ? [] : formData.assigned_outlet_ids,
          bio: normalizeStaffBio(formData.bio),
        },
        { withCredentials: true }
      );
      toast.success("Staff member added");
      setShowAddDialog(false);
      setFormData(createDefaultForm());
      setAddFormError("");
      fetchData();
    } catch (error) {
      setAddFormError(error.response?.data?.detail || "Unable to add staff");
    }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setEditFormError("");
    if (normalizePhone(editForm.phone).length && normalizePhone(editForm.phone).length !== 10) {
      setEditFormError("Staff phone must be exactly 10 digits");
      return;
    }
    if (normalizePhone(editForm.bio?.emergency_contact_phone).length !== 10) {
      setEditFormError("Emergency contact phone 1 must be exactly 10 digits");
      return;
    }
    if (normalizePhone(editForm.bio?.emergency_contact_phone_2).length !== 10) {
      setEditFormError("Emergency contact phone 2 must be exactly 10 digits");
      return;
    }
    if (hasDuplicateContactNumbers(editForm)) {
      setEditFormError("Staff phone, emergency contact 1, and emergency contact 2 must all be different");
      return;
    }
    try {
      await axios.put(
        `${API_URL}/api/staff/${editingStaff.id}`,
        {
          name: editForm.name,
          phone: editForm.phone || null,
          role: editForm.role,
          permissions: editForm.role === "Owner" ? STAFF_PERMISSION_KEYS : editForm.permissions,
          assigned_outlet_ids: editForm.role === "Owner" ? [] : editForm.assigned_outlet_ids,
          active: editForm.active,
          bio: normalizeStaffBio(editForm.bio),
        },
        { withCredentials: true }
      );
      toast.success("Staff rights updated");
      setEditingStaff(null);
      setEditFormError("");
      fetchData();
    } catch (error) {
      setEditFormError(error.response?.data?.detail || "Unable to update staff");
    }
  };

  const toggleStaffActive = async (member) => {
    try {
      await axios.put(
        `${API_URL}/api/staff/${member.id}`,
        { active: !(member.active ?? true) },
        { withCredentials: true }
      );
      toast.success(`${member.name} is now ${member.active ? "inactive" : "active"}`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to update staff status");
    }
  };

  const renderPermissionGrid = (form, editing = false) => (
    <div className="cf-checkbox-row">
      {STAFF_PERMISSION_KEYS.map((permission) => (
        <label key={`${editing ? "edit" : "create"}-${permission}`}>
          <input
            checked={form.role === "Owner" || form.permissions.includes(permission)}
            disabled={form.role === "Owner"}
            onChange={() => togglePermission(permission, editing)}
            type="checkbox"
          />
          {PERMISSION_LABELS[permission]}
        </label>
      ))}
    </div>
  );

  const renderOutletGrid = (form, editing = false) => (
    <div className="cf-checkbox-row">
      {outlets.map((outlet) => (
        <label key={`${editing ? "edit-outlet" : "create-outlet"}-${outlet.id}`}>
          <input
            checked={form.assigned_outlet_ids.includes(outlet.id)}
            disabled={form.role === "Owner"}
            onChange={() => toggleOutlet(outlet.id, editing)}
            type="checkbox"
          />
          {outlet.name}
        </label>
      ))}
      {!outlets.length ? <span style={{ color: "var(--cf-text-3)" }}>Add outlets in Central Kitchen first.</span> : null}
    </div>
  );

  const selectedStaff = staff.find((member) => member.id === selectedStaffId) || null;

  if (loading) {
    return (
      <Layout title="Staff">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading staff rights...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Staff">
      <div className="cf-page" data-testid="staff-page">
        <div className="cf-page__header">
          <div>
            <h1>User Right Management</h1>
            <p>Control role visibility, outlet-wise access, and track staff performance so strong work is visible.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--primary" data-testid="add-staff-button" onClick={() => setShowAddDialog(true)} type="button">
              + Add Staff
            </button>
          </div>
        </div>

        <div className="cf-metrics">
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/staff/summary/team-members")} type="button">
            <div className="cf-metric__label">Team Members</div>
            <div className="cf-metric__value">{staff.length}</div>
            <div className="cf-metric__sub">Configured with custom rights</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/staff/summary/active-users")} type="button">
            <div className="cf-metric__label">Active Users</div>
            <div className="cf-metric__value">{staff.filter((member) => member.active).length}</div>
            <div className="cf-metric__sub">Can sign in and operate</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/staff/summary/outlet-linked")} type="button">
            <div className="cf-metric__label">Outlet-linked Staff</div>
            <div className="cf-metric__value">{staff.filter((member) => (member.assigned_outlet_ids || []).length).length}</div>
            <div className="cf-metric__sub">Mapped to outlet-wise rights</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/staff/summary/tracked-sales")} type="button">
            <div className="cf-metric__label">Tracked Sales</div>
            <div className="cf-metric__value">
              {formatCurrency(staff.reduce((sum, member) => sum + Number(member.performance?.total_sales || 0), 0), settings.currency)}
            </div>
            <div className="cf-metric__sub">Attributed to logged-in staff</div>
          </button>
        </div>

        <div className="cf-metrics" style={{ marginTop: 20 }}>
          <button
            className="cf-metric cf-metric--button"
            disabled={!selectedStaff}
            onClick={() => selectedStaff && navigate(`/staff/${selectedStaff.id}/bio`)}
            type="button"
          >
            <div className="cf-metric__label">View Bio</div>
            <div className="cf-metric__value">{selectedStaff ? bioCompletionLabel(selectedStaff) : "-"}</div>
            <div className="cf-metric__sub">
              {selectedStaff ? `${selectedStaff.name} · ${selectedStaff.bio?.employee_code || "No employee code"}` : "Select a staff member below"}
            </div>
          </button>
          <button
            className="cf-metric cf-metric--button"
            disabled={!selectedStaff}
            onClick={() => selectedStaff && navigate(`/staff/${selectedStaff.id}/activity`)}
            type="button"
          >
            <div className="cf-metric__label">Track Activity</div>
            <div className="cf-metric__value">{selectedStaff?.performance?.bills_count || 0}</div>
            <div className="cf-metric__sub">
              {selectedStaff ? `${selectedStaff.name} · ${formatCurrency(selectedStaff.performance?.total_sales || 0, settings.currency)}` : "Select a staff member below"}
            </div>
          </button>
        </div>

        <div style={{ color: "var(--cf-text-3)", fontSize: 12, marginTop: 10, marginBottom: 18 }}>
          {selectedStaff ? `Selected staff: ${selectedStaff.name}` : "Select a staff member from the table to open bio or activity."}
        </div>

        <div className="cf-table-wrap">
          <table className="cf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rights</th>
                <th>Outlets</th>
                <th>Bio</th>
                <th>Performance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr
                  key={member.id}
                  data-testid={`staff-row-${member.email}`}
                  onClick={() => setSelectedStaffId(member.id)}
                  style={{
                    background: selectedStaffId === member.id ? "rgba(0, 45, 245, 0.06)" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{member.name}</div>
                    <div style={{ color: "var(--cf-text-3)", fontSize: 12 }}>{member.email}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{member.role}</div>
                    <div style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                      {(member.permissions || []).map((permission) => PERMISSION_LABELS[permission]).join(", ") || "No rights"}
                    </div>
                  </td>
                  <td>
                    {(member.assigned_outlets || []).length ? (
                      <div style={{ color: "var(--cf-text-2)", fontSize: 12 }}>
                        {member.assigned_outlets.map((outlet) => outlet.name).join(", ")}
                      </div>
                    ) : (
                      <span style={{ color: "var(--cf-text-3)" }}>{member.role === "Owner" ? "All outlets" : "No outlet assigned"}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{bioCompletionLabel(member)}</div>
                    <div style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                      {member.bio?.employee_code || "No employee code"} {member.bio?.joining_date ? `· Joined ${member.bio.joining_date}` : ""}
                    </div>
                  </td>
                  <td>
                    <div className="cf-table__mono">{member.performance?.bills_count || 0} bills</div>
                    <div className="cf-table__mono">{formatCurrency(member.performance?.total_sales || 0, settings.currency)}</div>
                    <div style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                      {member.performance?.last_bill_at ? new Date(member.performance.last_bill_at).toLocaleString("en-IN") : "No sales yet"}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className={`cf-badge ${member.active ? "cf-badge--green" : "cf-badge--gray"}`}>
                        {member.active ? "Active" : "Inactive"}
                      </span>
                      <span className={`cf-badge ${member.profile_completed ? "cf-badge--blue" : "cf-badge--amber"}`}>
                        Profile {member.profile_completed ? "Complete" : "Pending"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={`cf-badge ${selectedStaffId === member.id ? "cf-badge--blue" : "cf-badge--gray"}`}>
                        {selectedStaffId === member.id ? "Selected" : "Select"}
                      </span>
                      <button
                        className="cf-btn cf-btn--secondary cf-btn--small"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(member);
                        }}
                        type="button"
                      >
                        Edit Rights
                      </button>
                      <button
                        className="cf-btn cf-btn--secondary cf-btn--small"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleStaffActive(member);
                        }}
                        type="button"
                      >
                        {member.active ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Dialog onOpenChange={setShowAddDialog} open={showAddDialog}>
          <DialogContent className="bg-white cf-dialog-content" style={{ maxWidth: 1180, width: "96vw" }}>
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Add Staff Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={addStaff}>
              <div className="cf-dialog-scroll">
                <div className="cf-grid-2">
                  <div className="cf-field">
                    <label>Name</label>
                    <input className="cf-input" required value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} />
                  </div>
                  <div className="cf-field">
                    <label>Email</label>
                    <input className="cf-input" required type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} />
                  </div>
                </div>
                <div className="cf-grid-2">
                  <div className="cf-field">
                    <label>Phone</label>
                    <input className="cf-input" inputMode="numeric" maxLength={10} value={formData.phone} onChange={(event) => setFormData({ ...formData, phone: sanitizeTenDigitPhoneInput(event.target.value) })} />
                  </div>
                  <div className="cf-field">
                    <label>Password</label>
                    <input className="cf-input" required type="password" value={formData.password} onChange={(event) => setFormData({ ...formData, password: event.target.value })} />
                  </div>
                </div>
                <div className="cf-field">
                  <label>Role</label>
                  <select className="cf-select" value={formData.role} onChange={(event) => applyRoleDefaults(event.target.value)}>
                    {STAFF_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </div>
                <div className="cf-field">
                  <label>Screen Rights</label>
                  {renderPermissionGrid(formData)}
                </div>
                <div className="cf-field">
                  <label>Outlet-wise Rights</label>
                  {renderOutletGrid(formData)}
                </div>
                <div className="cf-checkbox-row" style={{ marginBottom: 20 }}>
                  <label>
                    <input checked={formData.active} onChange={(event) => setFormData({ ...formData, active: event.target.checked })} type="checkbox" />
                    Active
                  </label>
                </div>
                <BioFields form={formData} setForm={setFormData} />
              </div>
              {addFormError ? (
                <div
                  className="cf-card"
                  style={{ borderColor: "var(--cf-red)", padding: "12px 14px", marginTop: 16, color: "var(--cf-red)", fontSize: 13 }}
                >
                  {addFormError}
                </div>
              ) : null}
              <DialogFooter className="cf-dialog-actions">
                <button className="cf-btn cf-btn--secondary" onClick={() => setShowAddDialog(false)} type="button">Cancel</button>
                <button className="cf-btn cf-btn--primary" type="submit">Add Staff</button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog onOpenChange={() => setEditingStaff(null)} open={Boolean(editingStaff)}>
          <DialogContent className="bg-white cf-dialog-content" style={{ maxWidth: 1180, width: "96vw" }}>
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Edit Staff Rights</DialogTitle>
            </DialogHeader>
            {editingStaff ? (
              <form onSubmit={saveEdit}>
                <div className="cf-dialog-scroll">
                  <div className="cf-grid-2">
                    <div className="cf-field">
                      <label>Name</label>
                      <input className="cf-input" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
                    </div>
                    <div className="cf-field">
                      <label>Phone</label>
                      <input className="cf-input" inputMode="numeric" maxLength={10} value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: sanitizeTenDigitPhoneInput(event.target.value) })} />
                    </div>
                  </div>
                  <div className="cf-field">
                    <label>Role</label>
                    <select className="cf-select" value={editForm.role} onChange={(event) => applyRoleDefaults(event.target.value, true)}>
                      {STAFF_ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cf-field">
                    <label>Screen Rights</label>
                    {renderPermissionGrid(editForm, true)}
                  </div>
                  <div className="cf-field">
                    <label>Outlet-wise Rights</label>
                    {renderOutletGrid(editForm, true)}
                  </div>
                  <div className="cf-checkbox-row" style={{ marginBottom: 20 }}>
                    <label>
                      <input checked={editForm.active} onChange={(event) => setEditForm({ ...editForm, active: event.target.checked })} type="checkbox" />
                      Active
                    </label>
                  </div>
                  <BioFields form={editForm} setForm={setEditForm} />
                </div>
                {editFormError ? (
                  <div
                    className="cf-card"
                    style={{ borderColor: "var(--cf-red)", padding: "12px 14px", marginTop: 16, color: "var(--cf-red)", fontSize: 13 }}
                  >
                    {editFormError}
                  </div>
                ) : null}
                <DialogFooter className="cf-dialog-actions">
                  <button className="cf-btn cf-btn--secondary" onClick={() => setEditingStaff(null)} type="button">Cancel</button>
                  <button className="cf-btn cf-btn--primary" type="submit">Save Changes</button>
                </DialogFooter>
              </form>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

