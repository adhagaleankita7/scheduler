import {
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatInZone,
  isValidDateKey,
  todayDateKey,
  weekdayOfDateKey,
  zonedDateTimeToUtc,
} from "./timezone";

export type CalendarView = "month" | "week" | "day";

export type CalendarDay = {
  dateKey: string;
  /** False for padding days that belong to the previous/next month. */
  inPeriod: boolean;
};

export type CalendarWindow = {
  view: CalendarView;
  dateKey: string;
  startDateKey: string;
  endDateKey: string;
  startIso: string;
  endIso: string;
  days: CalendarDay[];
  title: string;
  subtitle: string;
};

export function parseCalendarView(value: string | undefined): CalendarView {
  return value === "week" || value === "day" ? value : "month";
}

export function parseCalendarDate(value: string | undefined, timeZone: string) {
  return value && isValidDateKey(value) ? value : todayDateKey(timeZone);
}

/** Monday-based start of the week containing `dateKey`. */
export function startOfWeek(dateKey: string) {
  const weekday = weekdayOfDateKey(dateKey);
  return addDaysToDateKey(dateKey, 1 - weekday);
}

export function addMonthsToDateKey(dateKey: string, months: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return [
    target.getUTCFullYear(),
    String(target.getUTCMonth() + 1).padStart(2, "0"),
    String(safeDay).padStart(2, "0"),
  ].join("-");
}

function formatDateKey(dateKey: string, pattern: string) {
  return formatInZone(dateKeyToUtcDate(dateKey), "UTC", pattern);
}

export function shiftCalendarDate(view: CalendarView, dateKey: string, delta: number) {
  if (view === "day") return addDaysToDateKey(dateKey, delta);
  if (view === "week") return addDaysToDateKey(dateKey, delta * 7);
  return addMonthsToDateKey(dateKey, delta);
}

export function getCalendarWindow(
  view: CalendarView,
  dateKey: string,
  timeZone: string,
): CalendarWindow {
  if (view === "day") {
    return {
      view,
      dateKey,
      startDateKey: dateKey,
      endDateKey: dateKey,
      startIso: zonedDateTimeToUtc(dateKey, "00:00", timeZone).toISOString(),
      endIso: zonedDateTimeToUtc(addDaysToDateKey(dateKey, 1), "00:00", timeZone).toISOString(),
      days: [{ dateKey, inPeriod: true }],
      title: formatDateKey(dateKey, "EEEE, MMMM d"),
      subtitle: formatDateKey(dateKey, "yyyy"),
    };
  }

  if (view === "week") {
    const startDateKey = startOfWeek(dateKey);
    const endDateKey = addDaysToDateKey(startDateKey, 6);
    return {
      view,
      dateKey,
      startDateKey,
      endDateKey,
      startIso: zonedDateTimeToUtc(startDateKey, "00:00", timeZone).toISOString(),
      endIso: zonedDateTimeToUtc(addDaysToDateKey(endDateKey, 1), "00:00", timeZone).toISOString(),
      days: Array.from({ length: 7 }).map((_, index) => ({
        dateKey: addDaysToDateKey(startDateKey, index),
        inPeriod: true,
      })),
      title: `${formatDateKey(startDateKey, "MMM d")} – ${formatDateKey(endDateKey, "MMM d")}`,
      subtitle: formatDateKey(endDateKey, "yyyy"),
    };
  }

  const monthStart = `${dateKey.slice(0, 7)}-01`;
  const gridStart = startOfWeek(monthStart);
  const monthPrefix = dateKey.slice(0, 7);
  const days = Array.from({ length: 42 }).map((_, index) => {
    const key = addDaysToDateKey(gridStart, index);
    return { dateKey: key, inPeriod: key.startsWith(monthPrefix) };
  });
  const startDateKey = days[0].dateKey;
  const endDateKey = days[days.length - 1].dateKey;

  return {
    view,
    dateKey,
    startDateKey,
    endDateKey,
    startIso: zonedDateTimeToUtc(startDateKey, "00:00", timeZone).toISOString(),
    endIso: zonedDateTimeToUtc(addDaysToDateKey(endDateKey, 1), "00:00", timeZone).toISOString(),
    days,
    title: formatDateKey(monthStart, "MMMM"),
    subtitle: formatDateKey(monthStart, "yyyy"),
  };
}
