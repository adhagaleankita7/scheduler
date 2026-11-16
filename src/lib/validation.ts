import { z } from "zod";
import { isValidTimeZone, normalizeTime } from "@/lib/scheduling/timezone";

export const MAX_POST_LENGTH = 3000;

export const targetValueSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}(\|[0-9a-f-]{36})?$/i, "Choose a LinkedIn target");

export function encodeTarget(accountId: string, pageId?: string | null) {
  return pageId ? `${accountId}|${pageId}` : accountId;
}

export function decodeTarget(value: string) {
  const [accountId, pageId] = value.split("|");
  return { accountId, pageId: pageId || null };
}

export const postContentSchema = z
  .string()
  .trim()
  .min(1, "Write something to share")
  .max(MAX_POST_LENGTH, `LinkedIn posts can be at most ${MAX_POST_LENGTH.toLocaleString()} characters`);

export const isoDateTimeSchema = z
  .string()
  .min(1, "Choose a date and time")
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date and time");

export const savePostSchema = z.object({
  id: z.string().uuid().optional(),
  content: postContentSchema,
  target: targetValueSchema,
  scheduledFor: z.string().optional().nullable(),
  mode: z.enum(["draft", "schedule", "now"]).default("draft"),
  scheduleId: z.string().uuid().optional().nullable(),
  mediaPath: z.string().max(500).optional().nullable(),
  mediaMimeType: z.string().max(100).optional().nullable(),
  mediaAlt: z.string().max(300).optional().nullable(),
  timezone: z.string().min(1),
});

export type SavePostInput = z.infer<typeof savePostSchema>;

export const weeklyPlanEntrySchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  time: z.string().refine((value) => normalizeTime(value) !== null, "Invalid time"),
  content: z.string().trim().max(MAX_POST_LENGTH).optional().default(""),
});

export const scheduleWeekSchema = z.object({
  name: z.string().trim().min(1).max(80).default("7-day LinkedIn plan"),
  timezone: z.string().refine(isValidTimeZone, "Invalid timezone"),
  target: targetValueSchema,
  entries: z.array(weeklyPlanEntrySchema).min(1).max(7),
  action: z.enum(["schedule", "draft"]).default("schedule"),
});

export const rescheduleSchema = z.object({
  postId: z.string().uuid(),
  scheduledFor: isoDateTimeSchema,
  timezone: z.string().refine(isValidTimeZone, "Invalid timezone"),
});

export const settingsSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(80),
  headline: z.string().trim().max(160).optional().default(""),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid timezone"),
  defaultPostingTime: z.string().refine((value) => normalizeTime(value) !== null, "Invalid time"),
  defaultPostingDays: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Select at least one publishing day"),
  theme: z.enum(["light", "dark", "system"]),
  queuePaused: z.boolean().optional(),
});

export const queueSettingsSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Choose a valid timezone"),
  postingDays: z.array(z.number().int().min(1).max(7)).min(1, "Select at least one day"),
  postingTimes: z
    .array(z.string().refine((value) => normalizeTime(value) !== null, "Invalid time"))
    .min(1, "Add at least one time")
    .max(4, "Up to four daily slots are supported"),
  isPaused: z.boolean().optional(),
});

export function countCharacters(content: string) {
  return [...content].length;
}

/** True only for a parseable ISO timestamp strictly after `now`. */
export function isDateTimeInFuture(value: string | null | undefined, now = new Date()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return timestamp > now.getTime();
}
