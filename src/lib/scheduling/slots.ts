import { addDaysToDateKey, todayDateKey, weekdayOfDateKey, zonedDateTimeToUtc } from "./timezone";

export type QueueSlot = {
  dateKey: string;
  time: string;
  iso: string;
};

export type WeeklyPlanEntry = {
  dateKey: string;
  time: string;
  content: string;
};

export type SlotOptions = {
  now: Date;
  timeZone: string;
  postingDays: number[];
  postingTimes: string[];
  count: number;
  /** Skip candidates at or before this instant (defaults to now). */
  startAfter?: Date | null;
  /** Hard limit of days scanned, protects against invalid settings. */
  horizonDays?: number;
};

/**
 * Compute the next N publishing slots in a user's timezone.
 * Only future instants are returned, slots are chronological, and times are
 * deduplicated/sorted. Pure and deterministic for a fixed `now`.
 */
export function nextQueueSlots(options: SlotOptions): QueueSlot[] {
  const {
    now,
    timeZone,
    postingDays,
    postingTimes,
    count,
    startAfter = null,
    horizonDays = 400,
  } = options;

  if (count <= 0) return [];

  const validDays = Array.from(new Set(postingDays.filter((day) => day >= 1 && day <= 7))).sort(
    (a, b) => a - b,
  );
  const validTimes = Array.from(new Set(postingTimes)).sort();
  if (validDays.length === 0 || validTimes.length === 0) return [];

  const minimum =
    (startAfter && startAfter.getTime() > now.getTime() ? startAfter : now).getTime();

  const slots: QueueSlot[] = [];
  let dateKey = todayDateKey(timeZone, now);

  for (let offset = 0; offset < horizonDays && slots.length < count; offset += 1) {
    const weekday = weekdayOfDateKey(dateKey);
    if (validDays.includes(weekday)) {
      for (const time of validTimes) {
        const utc = zonedDateTimeToUtc(dateKey, time, timeZone);
        if (utc.getTime() > minimum) {
          slots.push({ dateKey, time, iso: utc.toISOString() });
          if (slots.length === count) break;
        }
      }
    }
    dateKey = addDaysToDateKey(dateKey, 1);
  }

  return slots;
}

/** Plan lengths offered by the planner (a week or a month). */
export const PLAN_LENGTHS = [7, 30] as const;
export type PlanLength = (typeof PLAN_LENGTHS)[number];
export const MAX_PLAN_DAYS = 30;

/** Build consecutive days starting on `startDate` (inclusive). */
export function buildDayPlan(input: {
  startDate: string;
  timeZone: string;
  time: string;
  contents: string[];
  days: number;
  postingDays?: number[];
}) {
  const days = Math.min(MAX_PLAN_DAYS, Math.max(1, Math.trunc(input.days)));
  const postingDays = input.postingDays ?? [1, 2, 3, 4, 5, 6, 7];
  const entries: WeeklyPlanEntry[] = [];
  for (let index = 0; index < days; index += 1) {
    const dateKey = addDaysToDateKey(input.startDate, index);
    if (!postingDays.includes(weekdayOfDateKey(dateKey))) continue;
    entries.push({
      dateKey,
      time: input.time,
      content: input.contents[index] ?? "",
    });
  }
  return entries;
}

/** Build seven consecutive days starting on `startDate` (inclusive). */
export function buildSevenDayPlan(input: {
  startDate: string;
  timeZone: string;
  time: string;
  contents: string[];
  postingDays?: number[];
}) {
  return buildDayPlan({ ...input, days: 7 });
}

export type WeekdaySchedule = {
  dateKey: string;
  weekday: number;
  content: string;
  time: string;
};

/** Upcoming Monday (or today if Monday) in the user's timezone. */
export function upcomingMonday(timeZone: string, now = new Date()) {
  const today = todayDateKey(timeZone, now);
  const weekday = weekdayOfDateKey(today);
  const delta = weekday === 1 ? 0 : 8 - weekday;
  return addDaysToDateKey(today, delta);
}

export function buildWeekSchedule(input: {
  startDate: string;
  timeZone: string;
  times: string[];
  contents: string[];
}) {
  return input.contents.map((content, index) => {
    const dateKey = addDaysToDateKey(input.startDate, index);
    return {
      dateKey,
      weekday: weekdayOfDateKey(dateKey),
      content,
      time: input.times[index] ?? input.times[0] ?? "10:00",
      iso: zonedDateTimeToUtc(
        dateKey,
        input.times[index] ?? input.times[0] ?? "10:00",
        input.timeZone,
      ).toISOString(),
    };
  });
}

export function sortPostsBySchedule<T extends { scheduled_for: string | null; created_at: string }>(
  posts: T[],
) {
  return [...posts].sort((a, b) => {
    const aKey = a.scheduled_for ?? a.created_at;
    const bKey = b.scheduled_for ?? b.created_at;
    return new Date(aKey).getTime() - new Date(bKey).getTime();
  });
}
