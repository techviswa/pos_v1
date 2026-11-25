// The calendar day (YYYY-MM-DD) in the device's own time zone. toISOString() gives the UTC day instead, which in
// India is still "yesterday" until 5:30 am and puts late-evening bookings on the wrong date.
export const localDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
