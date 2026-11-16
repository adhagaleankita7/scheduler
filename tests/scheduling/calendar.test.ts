import { describe, expect, it } from "vitest";
import {
  addMonthsToDateKey,
  getCalendarWindow,
  parseCalendarDate,
  parseCalendarView,
  shiftCalendarDate,
  startOfWeek,
} from "@/lib/scheduling/calendar";
import { addDaysToDateKey } from "@/lib/scheduling/timezone";

const KOLKATA = "Asia/Kolkata";

describe("startOfWeek", () => {
  it("returns Monday for every day of the week", () => {
    expect(startOfWeek("2026-01-12")).toBe("2026-01-12"); // Monday
    expect(startOfWeek("2026-01-13")).toBe("2026-01-12"); // Tuesday
    expect(startOfWeek("2026-01-15")).toBe("2026-01-12"); // Thursday
    expect(startOfWeek("2026-01-18")).toBe("2026-01-12"); // Sunday
    expect(startOfWeek("2026-01-04")).toBe("2025-12-29"); // Sunday across year
  });

  it("always produces seven consecutive days", () => {
    const start = startOfWeek("2026-07-04");
    expect(start).toBe("2026-06-29");
    expect(addDaysToDateKey(start, 6)).toBe("2026-07-05");
  });
});

describe("addMonthsToDateKey", () => {
  it("clamps to the last valid day of the target month", () => {
    expect(addMonthsToDateKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateKey("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsToDateKey("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsToDateKey("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonthsToDateKey("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsToDateKey("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("parseCalendarView", () => {
  it("defaults to month and accepts week/day", () => {
    expect(parseCalendarView(undefined)).toBe("month");
    expect(parseCalendarView("year")).toBe("month");
    expect(parseCalendarView("week")).toBe("week");
    expect(parseCalendarView("day")).toBe("day");
  });
});

describe("parseCalendarDate", () => {
  it("accepts valid dates and falls back to today in the timezone", () => {
    expect(parseCalendarDate("2026-05-01", KOLKATA)).toBe("2026-05-01");
    expect(parseCalendarDate("not-a-date", KOLKATA)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseCalendarDate(undefined, KOLKATA)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shiftCalendarDate", () => {
  it("moves by one day, week, or month depending on the view", () => {
    expect(shiftCalendarDate("day", "2026-01-15", 1)).toBe("2026-01-16");
    expect(shiftCalendarDate("day", "2026-01-15", -1)).toBe("2026-01-14");
    expect(shiftCalendarDate("week", "2026-01-15", 1)).toBe("2026-01-22");
    expect(shiftCalendarDate("week", "2026-01-15", -1)).toBe("2026-01-08");
    expect(shiftCalendarDate("month", "2026-01-15", 1)).toBe("2026-02-15");
    expect(shiftCalendarDate("month", "2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("getCalendarWindow", () => {
  it("builds a single-day window with an exclusive end", () => {
    const window = getCalendarWindow("day", "2026-01-15", KOLKATA);
    expect(window.days).toEqual([{ dateKey: "2026-01-15", inPeriod: true }]);
    expect(window.startIso).toBe("2026-01-14T18:30:00.000Z");
    expect(window.endIso).toBe("2026-01-15T18:30:00.000Z");
    expect(window.title).toBe("Thursday, January 15");
    expect(window.subtitle).toBe("2026");
  });

  it("builds a Monday-to-Sunday week window", () => {
    const window = getCalendarWindow("week", "2026-01-15", KOLKATA);
    expect(window.startDateKey).toBe("2026-01-12");
    expect(window.endDateKey).toBe("2026-01-18");
    expect(window.days).toHaveLength(7);
    expect(window.days[0]).toEqual({ dateKey: "2026-01-12", inPeriod: true });
    expect(window.days[6]).toEqual({ dateKey: "2026-01-18", inPeriod: true });
    expect(window.startIso).toBe("2026-01-11T18:30:00.000Z");
    expect(window.endIso).toBe("2026-01-18T18:30:00.000Z");
  });

  it("builds a padded 42-day month grid starting on Monday", () => {
    const window = getCalendarWindow("month", "2026-03-15", KOLKATA);
    expect(window.days).toHaveLength(42);
    expect(window.startDateKey).toBe("2026-02-23");
    expect(window.endDateKey).toBe("2026-04-05");
    expect(window.days[0].dateKey).toBe("2026-02-23");
    expect(window.days[41].dateKey).toBe("2026-04-05");
    expect(window.days.filter((day) => day.inPeriod)).toHaveLength(31);
    expect(window.days[0].inPeriod).toBe(false);
    expect(window.days.find((day) => day.dateKey === "2026-03-01")?.inPeriod).toBe(true);
    expect(window.title).toBe("March");
    expect(window.subtitle).toBe("2026");
  });

  it("marks padding days false in a month that starts on Monday", () => {
    const window = getCalendarWindow("month", "2026-06-10", KOLKATA);
    // 2026-06-01 is a Monday, so the grid starts exactly on the first.
    expect(window.startDateKey).toBe("2026-06-01");
    expect(window.days[0].inPeriod).toBe(true);
    expect(window.days.filter((day) => day.inPeriod)).toHaveLength(30);
    expect(window.endDateKey).toBe("2026-07-12");
  });

  it("keeps the range end exclusive for the last grid day", () => {
    const window = getCalendarWindow("month", "2026-03-15", KOLKATA);
    const exclusiveEnd = new Date(window.endIso).getTime() - 1;
    // The instant just before the range end is still April 5 locally.
    expect(window.endDateKey).toBe("2026-04-05");
    expect(exclusiveEnd).toBeGreaterThan(new Date(window.startIso).getTime());
  });

  it("uses 42 days for February in a non-leap year", () => {
    const window = getCalendarWindow("month", "2026-02-10", KOLKATA);
    expect(window.days.filter((day) => day.inPeriod)).toHaveLength(28);
    expect(window.days).toHaveLength(42);
  });
});
