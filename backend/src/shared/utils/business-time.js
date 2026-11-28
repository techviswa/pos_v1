// The business's own calendar. Reports, dashboards and date filters count days and hours in the business's time
// zone (Settings; India by default), not UTC: in UTC a 1 pm lunch rush in India would show as 7 am, and bills between
// midnight and 5:30 am would land on the previous day.

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
const formatters = new Map();
const formatter = (timeZone) => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }
  return formatters.get(timeZone);
};

export const isValidTimezone = (value) => {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: value }); return true; } catch { return false; }
};

const parts = (date, timeZone) => Object.fromEntries(formatter(timeZone).formatToParts(new Date(date)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));

/** "YYYY-MM-DD" of the instant in the business's time zone. */
export const localDate = (date, timeZone = DEFAULT_TIMEZONE) => {
  const p = parts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** Hour of day (0-23) of the instant in the business's time zone. */
export const localHour = (date, timeZone = DEFAULT_TIMEZONE) => parts(date, timeZone).hour % 24;

/** Minutes the zone is ahead of UTC at that instant. */
const offsetMinutes = (instant, timeZone) => {
  const p = parts(instant, timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(instant / 1000) * 1000) / 60000);
};

/** The UTC instant at which the local day "YYYY-MM-DD" starts (handles daylight-saving zones). */
export const startOfLocalDay = (ymd, timeZone = DEFAULT_TIMEZONE) => {
  const [year, month, day] = ymd.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetMinutes(guess, timeZone) * 60000;
  instant = guess - offsetMinutes(instant, timeZone) * 60000;
  return new Date(instant);
};

export const addDays = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Database bounds for local days from..to inclusive: { gte, lt } (either side optional). */
export const localDayBounds = ({ from, to } = {}, timeZone = DEFAULT_TIMEZONE) => ({
  ...(from ? { gte: startOfLocalDay(from, timeZone) } : {}),
  ...(to ? { lt: startOfLocalDay(addDays(to, 1), timeZone) } : {}),
});

export const todayLocal = (timeZone = DEFAULT_TIMEZONE, now = new Date()) => localDate(now, timeZone);
