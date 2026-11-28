// Calendar days in the business's time zone (Settings > Time zone; the device's zone until the profile loads).
// Report and dashboard periods must use these days, not UTC: in India UTC "today" starts at 5:30 am.

const formatters = new Map();
const formatterFor = (timeZone) => {
  const key = timeZone || "";
  if (!formatters.has(key)) {
    let formatter;
    try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch { formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }); }
    formatters.set(key, formatter);
  }
  return formatters.get(key);
};

/** "YYYY-MM-DD" of the instant in the business's time zone. */
export const businessDay = (date = new Date(), timeZone) => {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(date)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const addDays = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Report period presets as local days: today, this week (from Sunday) or this month. */
export const periodRange = (period, timeZone, now = new Date()) => {
  const today = businessDay(now, timeZone);
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay()), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
};

/** Time zones the browser knows (for Settings); a short list when the browser cannot list them. */
export const timeZoneOptions = () => {
  try { if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone"); } catch { /* older browser */ }
  return ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "Australia/Sydney"];
};
