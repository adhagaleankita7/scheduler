import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatInZone,
  formatTimeLabel,
  getZonedParts,
  isValidDateKey,
  isValidTimeZone,
  normalizeTime,
  relativeToNow,
  timezoneAbbreviation,
  toZonedInputValue,
  todayDateKey,
  utcDateToDateKey,
  weekdayOfDateKey,
  zonedDateTimeToUtc,
  zonedInputToIso,
} from "@/lib/scheduling/timezone";

describe("normalizeTime", () => {
  it("normalizes valid times", () => {
    expect(normalizeTime("10:00")).toBe("10:00");
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("10:00:00")).toBe("10:00");
    expect(normalizeTime(" 23:59 ")).toBe("23:59");
    expect(normalizeTime("00:00")).toBe("00:00");
  });

  it("rejects invalid times", () => {
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("10:60")).toBeNull();
    expect(normalizeTime("10")).toBeNull();
    expect(normalizeTime("10:0")).toBeNull();
    expect(normalizeTime("noon")).toBeNull();
    expect(normalizeTime("")).toBeNull();
  });
});

describe("timezone validation", () => {
  it("accepts IANA zones and rejects nonsense", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("date keys", () => {
  it("validates real calendar dates", () => {
    expect(isValidDateKey("2026-01-15")).toBe(true);
    expect(isValidDateKey("2026-02-29")).toBe(false);
    expect(isValidDateKey("2024-02-29")).toBe(true);
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("15-01-2026")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysToDateKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDateKey("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("maps weekdays with Monday = 1 and Sunday = 7", () => {
    expect(weekdayOfDateKey("2026-01-12")).toBe(1);
    expect(weekdayOfDateKey("2026-01-15")).toBe(4);
    expect(weekdayOfDateKey("2026-01-18")).toBe(7);
  });

  it("round-trips through UTC date helpers", () => {
    expect(utcDateToDateKey(dateKeyToUtcDate("2026-07-04"))).toBe("2026-07-04");
  });

  it("computes today in a specific timezone", () => {
    const instant = new Date("2026-01-15T20:00:00Z");
    expect(todayDateKey("Asia/Kolkata", instant)).toBe("2026-01-16");
    expect(todayDateKey("America/Los_Angeles", instant)).toBe("2026-01-15");
    expect(todayDateKey("UTC", instant)).toBe("2026-01-15");
  });
});

describe("zonedDateTimeToUtc", () => {
  it("converts Asia/Kolkata wall clock to UTC", () => {
    expect(zonedDateTimeToUtc("2026-01-15", "10:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-01-15T04:30:00.000Z",
    );
  });

  it("handles northern-hemisphere DST on both sides of the change", () => {
    expect(zonedDateTimeToUtc("2026-01-15", "10:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T15:00:00.000Z",
    );
    expect(zonedDateTimeToUtc("2026-07-15", "10:00", "America/New_York").toISOString()).toBe(
      "2026-07-15T14:00:00.000Z",
    );
  });

  it("resolves the non-existent spring-forward hour without throwing", () => {
    // 02:30 does not exist on 2026-03-08 in New York. date-fns-tz resolves it
    // to a real instant; we pin the mapping so a library change is visible.
    const resolved = zonedDateTimeToUtc("2026-03-08", "02:30", "America/New_York");
    expect(resolved.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(formatInZone(resolved, "America/New_York", "yyyy-MM-dd HH:mm")).toBe(
      "2026-03-08 01:30",
    );
  });

  it("resolves the ambiguous fall-back hour deterministically", () => {
    // 01:30 happens twice on 2026-11-01 in New York. date-fns-tz picks the first
    // occurrence (EDT, -04:00); we pin the mapping so a library change is visible.
    const resolved = zonedDateTimeToUtc("2026-11-01", "01:30", "America/New_York");
    expect(resolved.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(formatInZone(resolved, "America/New_York", "XXX")).toBe("-04:00");
  });

  it("throws on invalid input instead of silently scheduling", () => {
    expect(() => zonedDateTimeToUtc("2026-02-30", "10:00", "UTC")).toThrow(/Invalid date/);
    expect(() => zonedDateTimeToUtc("2026-02-28", "25:00", "UTC")).toThrow(/Invalid date/);
    expect(() => zonedDateTimeToUtc("2026-02-28", "10:00", "Not/AZone")).toThrow(
      /Invalid timezone/,
    );
  });
});

describe("formatting and parts", () => {
  it("returns zoned parts for a UTC instant", () => {
    const parts = getZonedParts("2026-01-15T04:30:00.000Z", "Asia/Kolkata");
    expect(parts).toMatchObject({
      dateKey: "2026-01-15",
      time: "10:00",
      year: 2026,
      month: 1,
      day: 15,
      hour: 10,
      minute: 0,
      weekday: 4,
      offset: "+05:30",
    });
  });

  it("formats labels", () => {
    expect(formatInZone("2026-01-15T04:30:00.000Z", "Asia/Kolkata", "h:mm a")).toBe("10:00 AM");
    expect(formatTimeLabel("00:00")).toBe("12:00 AM");
    expect(formatTimeLabel("10:00")).toBe("10:00 AM");
    expect(formatTimeLabel("12:30")).toBe("12:30 PM");
    expect(formatTimeLabel("18:05")).toBe("6:05 PM");
  });

  it("reports timezone abbreviations", () => {
    expect(timezoneAbbreviation("Asia/Kolkata", new Date("2026-01-15T00:00:00Z"))).toBe("GMT+5:30");
    expect(timezoneAbbreviation("America/New_York", new Date("2026-01-15T00:00:00Z"))).toBe("EST");
  });

  it("describes relative times", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    expect(relativeToNow("2026-01-15T10:25:00Z", now)).toBe("in 25m");
    expect(relativeToNow("2026-01-15T08:00:00Z", now)).toBe("2h ago");
    expect(relativeToNow("2026-01-18T10:00:00Z", now)).toBe("in 3d");
  });
});

describe("datetime-local helpers", () => {
  it("round-trips a wall-clock value", () => {
    const iso = zonedInputToIso("2026-01-15T10:00", "Asia/Kolkata");
    expect(iso).toBe("2026-01-15T04:30:00.000Z");
    expect(toZonedInputValue(iso, "Asia/Kolkata")).toBe("2026-01-15T10:00");
  });

  it("returns null for incomplete values", () => {
    expect(zonedInputToIso("", "UTC")).toBeNull();
    expect(zonedInputToIso("2026-01-15T99:99", "UTC")).toBeNull();
    expect(toZonedInputValue(null, "UTC")).toBe("");
  });
});
