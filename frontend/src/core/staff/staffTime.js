// Period and time helpers shared by the Time Clock, Attendance and Tips screens. Periods use the device's local
// day boundaries and are sent to the server as exact instants.

const startOfDay = (date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

export const PERIOD_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom" },
];

/** Monday-based weeks, as rosters usually are. `to` is exclusive (the start of the next day). */
export const presetRange = (key, now = new Date()) => {
  const today = startOfDay(now);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (key) {
    case "today": return { from: today, to: addDays(today, 1) };
    case "yesterday": return { from: addDays(today, -1), to: today };
    case "last_week": return { from: addDays(monday, -7), to: monday };
    case "this_month": return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
    case "last_month": return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
    case "this_week":
    default: return { from: monday, to: addDays(today, 1) };
  }
};

export const toDateInput = (date) => {
  const value = new Date(date);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

/** A period from two date inputs (both days included). */
export const customRange = (fromDate, toDate) => {
  const from = fromDate ? startOfDay(new Date(`${fromDate}T00:00:00`)) : startOfDay(new Date());
  const lastDay = toDate ? startOfDay(new Date(`${toDate}T00:00:00`)) : from;
  return { from, to: addDays(lastDay, 1) };
};

export const rangeQuery = ({ from, to }) =>
  `from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;

export const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

export const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

export const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-";

/** Value for <input type="datetime-local"> in local time. */
export const toLocalInput = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (number) => String(number).padStart(2, "0");
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

export const downloadCsv = (filename, rows) => {
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
