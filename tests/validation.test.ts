import { describe, expect, it } from "vitest";
import {
  MAX_POST_LENGTH,
  countCharacters,
  decodeTarget,
  encodeTarget,
  isDateTimeInFuture,
  postContentSchema,
  queueSettingsSchema,
  rescheduleSchema,
  savePostSchema,
  scheduleWeekSchema,
  settingsSchema,
  targetValueSchema,
} from "@/lib/validation";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PAGE = "22222222-2222-4222-8222-222222222222";

describe("target helpers", () => {
  it("encodes and decodes a member target", () => {
    expect(encodeTarget(ACCOUNT)).toBe(ACCOUNT);
    expect(encodeTarget(ACCOUNT, null)).toBe(ACCOUNT);
    expect(decodeTarget(ACCOUNT)).toEqual({ accountId: ACCOUNT, pageId: null });
  });

  it("encodes and decodes a page target", () => {
    const value = encodeTarget(ACCOUNT, PAGE);
    expect(value).toBe(`${ACCOUNT}|${PAGE}`);
    expect(decodeTarget(value)).toEqual({ accountId: ACCOUNT, pageId: PAGE });
  });

  it("validates target strings", () => {
    expect(targetValueSchema.safeParse(ACCOUNT).success).toBe(true);
    expect(targetValueSchema.safeParse(`${ACCOUNT}|${PAGE}`).success).toBe(true);
    expect(targetValueSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(targetValueSchema.safeParse("").success).toBe(false);
    expect(targetValueSchema.safeParse(`${ACCOUNT}|`).success).toBe(false);
  });
});

describe("post content", () => {
  it("trims and accepts valid content", () => {
    expect(postContentSchema.parse("  Hello LinkedIn  ")).toBe("Hello LinkedIn");
  });

  it("rejects empty and over-limit content", () => {
    expect(postContentSchema.safeParse("").success).toBe(false);
    expect(postContentSchema.safeParse("   ").success).toBe(false);
    expect(postContentSchema.safeParse("a".repeat(MAX_POST_LENGTH)).success).toBe(true);
    expect(postContentSchema.safeParse("a".repeat(MAX_POST_LENGTH + 1)).success).toBe(false);
  });

  it("counts characters by code point, not UTF-16 units", () => {
    expect(countCharacters("hello")).toBe(5);
    expect(countCharacters("🚀")).toBe(1);
    expect(countCharacters("héllo")).toBe(5);
    expect(countCharacters("a🚀b")).toBe(3);
  });
});

describe("savePostSchema", () => {
  const base = {
    content: "Hello",
    target: ACCOUNT,
    timezone: "Asia/Kolkata",
  };

  it("defaults to draft mode", () => {
    const parsed = savePostSchema.parse(base);
    expect(parsed.mode).toBe("draft");
    expect(parsed.scheduledFor).toBeUndefined();
  });

  it("accepts all valid modes", () => {
    for (const mode of ["draft", "schedule", "now"] as const) {
      expect(savePostSchema.safeParse({ ...base, mode }).success).toBe(true);
    }
  });

  it("rejects unknown modes and invalid ids", () => {
    expect(savePostSchema.safeParse({ ...base, mode: "later" }).success).toBe(false);
    expect(savePostSchema.safeParse({ ...base, id: "abc" }).success).toBe(false);
    expect(savePostSchema.safeParse({ ...base, scheduleId: "abc" }).success).toBe(false);
  });

  it("limits media metadata lengths", () => {
    expect(savePostSchema.safeParse({ ...base, mediaPath: "a".repeat(501) }).success).toBe(false);
    expect(savePostSchema.safeParse({ ...base, mediaAlt: "a".repeat(301) }).success).toBe(false);
    expect(savePostSchema.safeParse({ ...base, mediaAlt: "a".repeat(300) }).success).toBe(true);
  });
});

describe("scheduleWeekSchema", () => {
  const valid = {
    name: "My week",
    timezone: "Asia/Kolkata",
    target: ACCOUNT,
    action: "schedule",
    entries: [
      { dateKey: "2026-01-12", time: "10:00", content: "Monday" },
      { dateKey: "2026-01-13", time: "09:30", content: "" },
    ],
  };

  it("accepts a valid week", () => {
    const parsed = scheduleWeekSchema.parse(valid);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.action).toBe("schedule");
  });

  it("trims whitespace-only entries to empty strings", () => {
    const parsed = scheduleWeekSchema.parse({
      ...valid,
      entries: [{ dateKey: "2026-01-12", time: "10:00", content: "   " }],
    });
    expect(parsed.entries[0].content).toBe("");
  });

  it("rejects bad dates, times, timezones and entry counts", () => {
    expect(
      scheduleWeekSchema.safeParse({
        ...valid,
        entries: [{ dateKey: "12-01-2026", time: "10:00", content: "x" }],
      }).success,
    ).toBe(false);
    expect(
      scheduleWeekSchema.safeParse({
        ...valid,
        entries: [{ dateKey: "2026-01-12", time: "25:00", content: "x" }],
      }).success,
    ).toBe(false);
    expect(scheduleWeekSchema.safeParse({ ...valid, timezone: "Nope/Zone" }).success).toBe(false);
    expect(scheduleWeekSchema.safeParse({ ...valid, entries: [] }).success).toBe(false);
    expect(
      scheduleWeekSchema.safeParse({
        ...valid,
        entries: Array.from({ length: 8 }, (_, index) => ({
          dateKey: `2026-01-${String(index + 1).padStart(2, "0")}`,
          time: "10:00",
          content: "x",
        })),
      }).success,
    ).toBe(false);
  });
});

describe("rescheduleSchema", () => {
  it("accepts a valid ISO instant", () => {
    expect(
      rescheduleSchema.safeParse({
        postId: ACCOUNT,
        scheduledFor: "2026-01-15T04:30:00.000Z",
        timezone: "Asia/Kolkata",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid dates and post ids", () => {
    expect(
      rescheduleSchema.safeParse({
        postId: "abc",
        scheduledFor: "2026-01-15T04:30:00.000Z",
        timezone: "Asia/Kolkata",
      }).success,
    ).toBe(false);
    expect(
      rescheduleSchema.safeParse({
        postId: ACCOUNT,
        scheduledFor: "tomorrow",
        timezone: "Asia/Kolkata",
      }).success,
    ).toBe(false);
  });
});

describe("settings and queue schemas", () => {
  const settings = {
    fullName: "Aarav Mehta",
    headline: "Founder",
    timezone: "Asia/Kolkata",
    defaultPostingTime: "10:00",
    defaultPostingDays: [1, 2, 3, 4, 5],
    theme: "system" as const,
  };

  it("accepts valid settings", () => {
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    expect(settingsSchema.safeParse({ ...settings, theme: "dark" }).success).toBe(true);
  });

  it("rejects short names, empty days and bad times", () => {
    expect(settingsSchema.safeParse({ ...settings, fullName: "A" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, defaultPostingDays: [] }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, defaultPostingTime: "25:00" }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ ...settings, theme: "neon" }).success).toBe(false);
  });

  it("validates queue settings and the four-slot limit", () => {
    const queue = {
      timezone: "Asia/Kolkata",
      postingDays: [1, 3, 5],
      postingTimes: ["10:00", "17:00"],
    };
    expect(queueSettingsSchema.safeParse(queue).success).toBe(true);
    expect(
      queueSettingsSchema.safeParse({
        ...queue,
        postingTimes: ["08:00", "10:00", "13:00", "17:00"],
      }).success,
    ).toBe(true);
    expect(
      queueSettingsSchema.safeParse({
        ...queue,
        postingTimes: ["08:00", "10:00", "13:00", "17:00", "20:00"],
      }).success,
    ).toBe(false);
    expect(queueSettingsSchema.safeParse({ ...queue, postingDays: [] }).success).toBe(false);
  });
});

describe("isDateTimeInFuture", () => {
  it("compares against a fixed clock", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    expect(isDateTimeInFuture("2026-01-15T10:01:00Z", now)).toBe(true);
    expect(isDateTimeInFuture("2026-01-15T10:00:00Z", now)).toBe(false);
    expect(isDateTimeInFuture("2026-01-15T09:59:00Z", now)).toBe(false);
    expect(isDateTimeInFuture("not-a-date", now)).toBe(false);
  });
});
