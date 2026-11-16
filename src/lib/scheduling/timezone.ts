import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export const TIMEZONE_OPTIONS = [
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST, UTC+05:30)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST, UTC+04:00)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT, UTC+08:00)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
  { value: "UTC", label: "UTC" },
] as const;

export const WEEKDAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 7, short: "Sun", label: "Sunday" },
] as const;

export function isValidTimeZone(timeZone: string) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTime(time: string) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function isValidDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Turn a wall-clock date/time in a user's timezone into an absolute UTC Date.
 * DST transitions are resolved by date-fns-tz using the IANA database.
 */
export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const normalized = normalizeTime(time);
  if (!isValidDateKey(dateKey) || !normalized) {
    throw new Error(`Invalid date/time: ${dateKey} ${time}`);
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid timezone: ${timeZone}`);
  }
  return fromZonedTime(`${dateKey}T${normalized}:00`, timeZone);
}

export type ZonedParts = {
  dateKey: string;
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  offset: string;
};

export function getZonedParts(value: Date | string, timeZone: string): ZonedParts {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatted = formatInTimeZone(date, timeZone, "yyyy-MM-dd HH:mm");
  const [dateKey, time] = formatted.split(" ");
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const weekday = Number(formatInTimeZone(date, timeZone, "i"));
  const offset = formatInTimeZone(date, timeZone, "XXX");
  return { dateKey, time, year, month, day, hour, minute, weekday, offset };
}

export function formatInZone(
  value: Date | string,
  timeZone: string,
  pattern = "MMM d, yyyy · h:mm a",
) {
  return formatInTimeZone(typeof value === "string" ? new Date(value) : value, timeZone, pattern);
}

export function todayDateKey(timeZone: string, now = new Date()) {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayOfDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

export function dateKeyToUtcDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function utcDateToDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Value for <input type="datetime-local"> in the user's timezone. */
export function toZonedInputValue(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "";
  return formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd'T'HH:mm");
}

/** Convert a datetime-local value (user timezone) to an ISO UTC string. */
export function zonedInputToIso(value: string, timeZone: string) {
  if (!value) return null;
  const [dateKey, time] = value.split("T");
  const normalized = normalizeTime(time ?? "00:00");
  if (!isValidDateKey(dateKey) || !normalized) return null;
  return zonedDateTimeToUtc(dateKey, normalized, timeZone).toISOString();
}

export function formatTimeLabel(time: string) {
  const normalized = normalizeTime(time);
  if (!normalized) return time;
  const [hours, minutes] = normalized.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function timezoneAbbreviation(timeZone: string, now = new Date()) {
  return formatInTimeZone(now, timeZone, "zzz");
}

export function relativeToNow(iso: string, now = new Date()) {
  const target = new Date(iso).getTime();
  const diff = target - now.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const value =
    minutes < 60 ? `${minutes}m` : hours < 48 ? `${hours}h` : `${days}d`;
  return diff >= 0 ? `in ${value}` : `${value} ago`;
}
