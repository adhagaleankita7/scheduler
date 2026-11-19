import { describe, expect, it } from "vitest";
import {
  buildDayPlan,
  buildSevenDayPlan,
  buildWeekSchedule,
  nextQueueSlots,
  sortPostsBySchedule,
  upcomingMonday,
} from "@/lib/scheduling/slots";
import { formatInZone } from "@/lib/scheduling/timezone";

const KOLKATA = "Asia/Kolkata";

describe("nextQueueSlots", () => {
  it("returns the next N daily slots in chronological order", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-01-15T00:00:00Z"),
      timeZone: KOLKATA,
      postingDays: [1, 2, 3, 4, 5, 6, 7],
      postingTimes: ["10:00"],
      count: 3,
    });

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.dateKey)).toEqual(["2026-01-15", "2026-01-16", "2026-01-17"]);
    expect(slots.map((slot) => slot.iso)).toEqual([
      "2026-01-15T04:30:00.000Z",
      "2026-01-16T04:30:00.000Z",
      "2026-01-17T04:30:00.000Z",
    ]);
  });

  it("skips a slot that has already passed today", () => {
    const slots = nextQueueSlots({
      // 10:30 in Kolkata, so today's 10:00 slot is in the past.
      now: new Date("2026-01-15T05:00:00Z"),
      timeZone: KOLKATA,
      postingDays: [1, 2, 3, 4, 5, 6, 7],
      postingTimes: ["10:00"],
      count: 2,
    });

    expect(slots.map((slot) => slot.dateKey)).toEqual(["2026-01-16", "2026-01-17"]);
  });

  it("sorts and de-duplicates multiple daily times", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-01-15T00:00:00Z"),
      timeZone: KOLKATA,
      postingDays: [4, 4, 5],
      postingTimes: ["18:00", "10:00", "10:00"],
      count: 4,
    });

    expect(slots.map((slot) => `${slot.dateKey} ${slot.time}`)).toEqual([
      "2026-01-15 10:00",
      "2026-01-15 18:00",
      "2026-01-16 10:00",
      "2026-01-16 18:00",
    ]);
  });

  it("only uses selected weekdays", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-01-15T00:00:00Z"), // Thursday
      timeZone: KOLKATA,
      postingDays: [1],
      postingTimes: ["10:00"],
      count: 2,
    });

    expect(slots.map((slot) => slot.dateKey)).toEqual(["2026-01-19", "2026-01-26"]);
  });

  it("starts after the last queued post", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-01-15T00:00:00Z"),
      timeZone: KOLKATA,
      postingDays: [1, 2, 3, 4, 5, 6, 7],
      postingTimes: ["10:00"],
      count: 2,
      startAfter: new Date("2026-01-17T04:30:00.000Z"),
    });

    expect(slots.map((slot) => slot.dateKey)).toEqual(["2026-01-18", "2026-01-19"]);
  });

  it("ignores a startAfter in the past", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-01-15T00:00:00Z"),
      timeZone: KOLKATA,
      postingDays: [1, 2, 3, 4, 5, 6, 7],
      postingTimes: ["10:00"],
      count: 1,
      startAfter: new Date("2020-01-01T00:00:00Z"),
    });

    expect(slots[0].dateKey).toBe("2026-01-15");
  });

  it("returns nothing for invalid settings", () => {
    const base = {
      now: new Date("2026-01-15T00:00:00Z"),
      timeZone: KOLKATA,
      count: 3,
    };
    expect(nextQueueSlots({ ...base, postingDays: [], postingTimes: ["10:00"] })).toEqual([]);
    expect(nextQueueSlots({ ...base, postingDays: [1], postingTimes: [] })).toEqual([]);
    expect(nextQueueSlots({ ...base, postingDays: [0, 8], postingTimes: ["10:00"] })).toEqual([]);
    expect(
      nextQueueSlots({ ...base, postingDays: [1], postingTimes: ["10:00"], count: 0 }),
    ).toEqual([]);
  });

  it("respects the horizon guard", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-01-15T00:00:00Z"),
      timeZone: KOLKATA,
      postingDays: [1],
      postingTimes: ["10:00"],
      count: 2,
      horizonDays: 2,
    });
    expect(slots).toEqual([]);
  });

  it("keeps 10:00 local across the US spring-forward change", () => {
    const slots = nextQueueSlots({
      now: new Date("2026-03-06T00:00:00Z"),
      timeZone: "America/New_York",
      postingDays: [1, 2, 3, 4, 5, 6, 7],
      postingTimes: ["10:00"],
      count: 5,
    });

    expect(slots.map((slot) => slot.iso)).toEqual([
      "2026-03-06T15:00:00.000Z",
      "2026-03-07T15:00:00.000Z",
      "2026-03-08T14:00:00.000Z",
      "2026-03-09T14:00:00.000Z",
      "2026-03-10T14:00:00.000Z",
    ]);

    for (const slot of slots) {
      expect(formatInZone(slot.iso, "America/New_York", "HH:mm")).toBe("10:00");
    }
  });
});

describe("weekly plan helpers", () => {
  it("builds seven consecutive entries and skips unselected weekdays", () => {
    const entries = buildSevenDayPlan({
      startDate: "2026-01-12", // Monday
      timeZone: KOLKATA,
      time: "10:00",
      contents: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      postingDays: [1, 3, 5],
    });

    expect(entries).toEqual([
      { dateKey: "2026-01-12", time: "10:00", content: "Mon" },
      { dateKey: "2026-01-14", time: "10:00", content: "Wed" },
      { dateKey: "2026-01-16", time: "10:00", content: "Fri" },
    ]);
  });

  it("includes every day by default, preserving empty content", () => {
    const entries = buildSevenDayPlan({
      startDate: "2026-01-12",
      timeZone: KOLKATA,
      time: "10:00",
      contents: ["one"],
    });

    expect(entries).toHaveLength(7);
    expect(entries[0].content).toBe("one");
    expect(entries[6].content).toBe("");
  });

  it("builds a 30-day plan with one entry per day", () => {
    const entries = buildDayPlan({
      startDate: "2026-01-12",
      timeZone: KOLKATA,
      time: "10:00",
      days: 30,
      contents: ["first"],
    });

    expect(entries).toHaveLength(30);
    expect(entries[0]).toEqual({ dateKey: "2026-01-12", time: "10:00", content: "first" });
    expect(entries[29].dateKey).toBe("2026-02-10");
    expect(entries[29].content).toBe("");
  });

  it("caps oversized plans at 30 days", () => {
    const entries = buildDayPlan({
      startDate: "2026-01-12",
      timeZone: KOLKATA,
      time: "10:00",
      days: 90,
      contents: [],
    });

    expect(entries).toHaveLength(30);
  });

  it("converts each week row to the exact same local wall-clock time", () => {
    const schedule = buildWeekSchedule({
      startDate: "2026-01-12",
      timeZone: KOLKATA,
      times: Array.from({ length: 7 }, () => "10:00"),
      contents: ["a", "b", "c", "d", "e", "f", "g"],
    });

    expect(schedule).toHaveLength(7);
    for (const [index, row] of schedule.entries()) {
      expect(row.dateKey).toBe(`2026-01-${12 + index}`);
      expect(formatInZone(row.iso, KOLKATA, "yyyy-MM-dd HH:mm")).toBe(
        `2026-01-${12 + index} 10:00`,
      );
    }
  });

  it("falls back to the first time for missing per-day values", () => {
    const schedule = buildWeekSchedule({
      startDate: "2026-01-12",
      timeZone: KOLKATA,
      times: ["09:15"],
      contents: ["a", "b"],
    });

    expect(schedule[0].time).toBe("09:15");
    expect(schedule[1].time).toBe("09:15");
  });

  it("computes the upcoming Monday", () => {
    expect(upcomingMonday(KOLKATA, new Date("2026-01-12T00:00:00Z"))).toBe("2026-01-12");
    expect(upcomingMonday(KOLKATA, new Date("2026-01-13T00:00:00Z"))).toBe("2026-01-19");
    expect(upcomingMonday(KOLKATA, new Date("2026-01-18T00:00:00Z"))).toBe("2026-01-19");
  });
});

describe("sortPostsBySchedule", () => {
  it("orders scheduled posts before unscheduled ones and keeps a stable order", () => {
    const posts = [
      { id: "c", scheduled_for: null, created_at: "2026-01-14T10:00:00Z" },
      { id: "a", scheduled_for: "2026-01-16T10:00:00Z", created_at: "2026-01-10T10:00:00Z" },
      { id: "b", scheduled_for: "2026-01-15T10:00:00Z", created_at: "2026-01-11T10:00:00Z" },
    ];

    expect(sortPostsBySchedule(posts).map((post) => post.id)).toEqual(["c", "b", "a"]);
    expect(posts.map((post) => post.id)).toEqual(["c", "a", "b"]);
  });
});
