"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TargetSelect } from "@/components/shared/target-select";
import { scheduleWeek } from "@/lib/actions/posts";
import { createClient } from "@/lib/supabase/client";
import {
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatInZone,
  isValidDateKey,
  todayDateKey,
  weekdayOfDateKey,
} from "@/lib/scheduling/timezone";
import { MAX_POST_LENGTH, countCharacters } from "@/lib/validation";
import { MAX_PLAN_DAYS } from "@/lib/scheduling/slots";
import { randomUUID } from "@/lib/uuid";
import type { PublishTargetOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

type DayMedia = {
  path: string;
  mimeType: string;
  alt: string;
  url: string | null;
};

function emptyMedia(dayCount: number): (DayMedia | null)[] {
  return Array.from({ length: dayCount }, () => null);
}

function dayLabel(dateKey: string) {
  return formatInZone(dateKeyToUtcDate(dateKey), "UTC", "EEEE");
}

function shortDate(dateKey: string) {
  return formatInZone(dateKeyToUtcDate(dateKey), "UTC", "MMM d");
}

function isToday(dateKey: string, timezone: string) {
  return dateKey === todayDateKey(timezone);
}

export function PlanPlanner({
  targets,
  timezone,
  defaultTime,
  defaultStartDate,
  demo,
  userId,
  days,
}: {
  targets: PublishTargetOption[];
  timezone: string;
  defaultTime: string;
  defaultStartDate: string;
  demo: boolean;
  userId: string;
  /** Length of the plan: 7 for a week, 30 for a month. */
  days: number;
}) {
  const dayCount = Math.min(MAX_PLAN_DAYS, Math.max(1, Math.trunc(days)));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"schedule" | "draft" | null>(null);

  const firstTarget = targets.find((target) => target.canPublish)?.value ?? "";
  const [target, setTarget] = useState(firstTarget);
  const [name, setName] = useState(`${dayCount}-day publishing plan`);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [globalTime, setGlobalTime] = useState(defaultTime);
  const [contents, setContents] = useState<string[]>(() =>
    Array.from({ length: dayCount }, () => ""),
  );
  const [times, setTimes] = useState<string[]>(() =>
    Array.from({ length: dayCount }, () => defaultTime),
  );
  const [weekMedia, setWeekMedia] = useState<(DayMedia | null)[]>(() => emptyMedia(dayCount));
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [mediaErrors, setMediaErrors] = useState<Record<number, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      Array.from({ length: dayCount }).map((_, index) => {
        // Guard against a cleared/invalid <input type="date"> value: without
        // this, addDaysToDateKey("") produces Invalid Date and formatting throws.
        const baseDate = isValidDateKey(startDate) ? startDate : todayDateKey(timezone);
        const dateKey = addDaysToDateKey(baseDate, index);
        return {
          index,
          dateKey,
          weekday: weekdayOfDateKey(dateKey),
          content: contents[index] ?? "",
          time: times[index] ?? globalTime,
        };
      }),
    [startDate, contents, times, globalTime, timezone, dayCount],
  );

  const filled = rows.filter((row) => row.content.trim().length > 0);
  const selected = targets.find((item) => item.value === target) ?? null;
  const canSubmit =
    !demo && uploadingIndex === null && Boolean(selected?.canPublish) && filled.length > 0;
  const totalErrors = Object.keys(fieldErrors).length;

  function updateContent(index: number, value: string) {
    setContents((current) => current.map((item, i) => (i === index ? value : item)));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`entries.${index}.content`];
      return next;
    });
  }

  function updateTime(index: number, value: string) {
    setTimes((current) => current.map((item, i) => (i === index ? value : item)));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`entries.${index}.time`];
      return next;
    });
  }

  function applyTimeToAll(value: string) {
    setGlobalTime(value);
    setTimes(Array.from({ length: dayCount }, () => value));
  }

  async function handleImage(index: number, file: File) {
    setMediaErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
      setMediaErrors((current) => ({ ...current, [index]: "Images must be JPEG, PNG or WebP." }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMediaErrors((current) => ({ ...current, [index]: "Images must be smaller than 8 MB." }));
      return;
    }
    if (demo) {
      setError("Demo mode cannot upload files. Connect Supabase to attach images.");
      return;
    }

    setUploadingIndex(index);
    try {
      const supabase = createClient();
      const extension =
        file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${userId}/${randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("post-media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data } = await supabase.storage.from("post-media").createSignedUrl(path, 3600);
      setWeekMedia((current) =>
        current.map((item, i) =>
          i === index
            ? { path, mimeType: file.type, alt: item?.alt ?? "", url: data?.signedUrl ?? null }
            : item,
        ),
      );
      toast.success("Image uploaded");
    } catch (uploadError) {
      setMediaErrors((current) => ({
        ...current,
        [index]:
          uploadError instanceof Error
            ? `Upload failed: ${uploadError.message}`
            : "Upload failed. Try a smaller image.",
      }));
    } finally {
      setUploadingIndex(null);
    }
  }

  function removeImage(index: number) {
    const current = weekMedia[index];
    setWeekMedia((items) => items.map((item, i) => (i === index ? null : item)));
    setMediaErrors((errors) => {
      const next = { ...errors };
      delete next[index];
      return next;
    });
    if (current?.path && !demo) {
      try {
        void createClient()
          .storage.from("post-media")
          .remove([current.path])
          .catch(() => {});
      } catch {
        // Best-effort cleanup — the database rows are what matter.
      }
    }
  }

  function updateAltText(index: number, value: string) {
    setWeekMedia((items) =>
      items.map((item, i) => (i === index && item ? { ...item, alt: value } : item)),
    );
  }

  function submit(action: "schedule" | "draft") {
    setError(null);
    setFieldErrors({});
    if (uploadingIndex !== null) {
      setError("Wait for the image upload to finish.");
      return;
    }
    if (!selected) {
      setError("Choose a LinkedIn profile/page or a Facebook Page first.");
      return;
    }
    if (!selected.canPublish) {
      setError(selected.disabledReason ?? "That publishing target can't publish yet.");
      return;
    }
    if (filled.length === 0) {
      setError("Write at least one post before continuing.");
      return;
    }
    const imageOnly = rows.filter(
      (row) => weekMedia[row.index] !== null && !row.content.trim(),
    );
    if (imageOnly.length > 0) {
      setError(
        `Add text (or remove the image) for ${imageOnly
          .map((row) => dayLabel(row.dateKey))
          .join(", ")}.`,
      );
      return;
    }

    setPendingAction(action);
    startTransition(async () => {
      const result = await scheduleWeek({
        name: name.trim() || `${dayCount}-day publishing plan`,
        timezone,
        target,
        action,
        entries: rows.map((row) => ({
          dateKey: row.dateKey,
          time: row.time || globalTime,
          content: row.content,
          mediaPath: weekMedia[row.index]?.path ?? null,
          mediaMimeType: weekMedia[row.index]?.mimeType ?? null,
          mediaAlt: weekMedia[row.index]?.alt.trim() || null,
        })),
      });
      setPendingAction(null);

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }

      toast.success(
        result.message ??
          (action === "schedule" ? "Plan scheduled" : "Drafts saved"),
      );
      router.push(action === "schedule" ? "/queue" : "/posts?status=draft");
      router.refresh();
    });
  }

  if (targets.length === 0) {
    return (
      <Card className="border-amber-500/25 bg-amber-500/[0.05]">
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-4" />{" "}
            {dayCount === 30 ? "Connect an account to plan your month" : "Connect an account to plan your week"}
          </div>
          <p className="text-muted-foreground max-w-xl text-[12.5px] leading-relaxed">
            LINKFLOW schedules through the official LinkedIn and Facebook APIs. Connect your
            LinkedIn profile/company page or a Facebook Page, then come back to write all {dayCount}{" "}
            posts in one sitting.
          </p>
          <Button asChild variant="gradient" size="sm">
            <Link href="/accounts">Connect an account</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Plan setup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" /> Plan setup
          </CardTitle>
          <CardDescription>
            Every row becomes one post. The whole plan is scheduled in a single request.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Publishing as</Label>
            <TargetSelect targets={targets} value={target} onChange={setTarget} />
            {selected && !selected.canPublish && selected.disabledReason && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {selected.disabledReason}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-start">Start date</Label>
            <Input
              id="plan-start"
              type="date"
              value={startDate}
              onChange={(event) =>
                setStartDate(event.target.value || todayDateKey(timezone))
              }
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setStartDate(todayDateKey(timezone))}
                className="text-[10.5px] font-medium text-primary hover:underline"
              >
                Today
              </button>
              <span className="text-muted-foreground/50 text-[10.5px]">·</span>
              <button
                type="button"
                onClick={() => setStartDate(addDaysToDateKey(todayDateKey(timezone), 1))}
                className="text-[10.5px] font-medium text-primary hover:underline"
              >
                Tomorrow
              </button>
              <span className="text-muted-foreground/50 text-[10.5px]">·</span>
              <button
                type="button"
                onClick={() => {
                  const today = todayDateKey(timezone);
                  const weekday = weekdayOfDateKey(today);
                  setStartDate(addDaysToDateKey(today, weekday === 1 ? 0 : 8 - weekday));
                }}
                className="text-[10.5px] font-medium text-primary hover:underline"
              >
                Next Monday
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Plan name</Label>
            <Input
              id="plan-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder={`${dayCount}-day publishing plan`}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
            <Label htmlFor="plan-time">Default time</Label>
            <div className="relative">
              <Clock3 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="plan-time"
                type="time"
                value={globalTime}
                onChange={(event) => applyTimeToAll(event.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-muted-foreground text-[10.5px]">
              Applies to all {dayCount} days in {timezone}. You can override each day.
            </p>
          </div>
          <div className="flex items-end sm:col-span-2 xl:col-span-3">
            <div className="text-muted-foreground flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[11.5px]">
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="size-3.5 text-primary" />
                {shortDate(rows[0].dateKey)} → {shortDate(rows[dayCount - 1].dateKey)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarCheck2 className="size-3.5 text-emerald-500" />
                {filled.length} of {dayCount} posts written
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5 text-violet-500" /> one post per day
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan days */}
      <div className="space-y-2.5">
        {rows.map((row) => {
          const characters = countCharacters(row.content);
          const overLimit = characters > MAX_POST_LENGTH;
          const contentError = fieldErrors[`entries.${row.index}.content`];
          const timeError = fieldErrors[`entries.${row.index}.time`];
          const dayMedia = weekMedia[row.index] ?? null;
          const mediaError =
            fieldErrors[`entries.${row.index}.mediaPath`] ??
            fieldErrors[`entries.${row.index}.mediaMimeType`] ??
            mediaErrors[row.index];
          const isUploading = uploadingIndex === row.index;
          const today = isToday(row.dateKey, timezone);
          return (
            <div
              key={row.dateKey}
              className={cn(
                "rounded-2xl border bg-card p-4 shadow-card transition-colors sm:p-4",
                contentError || timeError
                  ? "border-destructive/40"
                  : row.content.trim()
                    ? "border-primary/20"
                    : "border-border/80",
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex shrink-0 items-center gap-3 sm:w-40 sm:flex-col sm:items-start">
                  <div className="flex items-center gap-2 sm:gap-1.5">
                    <span className="font-display text-[13px] font-bold">
                      {dayLabel(row.dateKey)}
                    </span>
                    {today && (
                      <Badge variant="default" className="px-1.5 py-0 text-[9px]">
                        Today
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-[11.5px]">
                      {shortDate(row.dateKey)}
                    </span>
                    <div className="relative">
                      <Input
                        type="time"
                        value={row.time}
                        onChange={(event) => updateTime(row.index, event.target.value)}
                        className="h-7 w-[104px] rounded-lg px-2 text-[11.5px]"
                        aria-label={`Time for ${dayLabel(row.dateKey)}`}
                      />
                    </div>
                  </div>
                  {timeError && <p className="text-[10.5px] text-destructive">{timeError}</p>}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10.5px] font-medium">
                      {row.content.trim() ? (
                        <CheckCircle2 className="size-3 text-emerald-500" />
                      ) : (
                        <Circle className="size-3 text-muted-foreground/40" />
                      )}
                      {row.content.trim() ? "Ready" : "Empty — will be skipped"}
                      {dayMedia && (
                        <span className="text-primary inline-flex items-center gap-1">
                          <ImagePlus className="size-3" /> Image
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium tabular-nums",
                        overLimit
                          ? "text-destructive"
                          : characters > MAX_POST_LENGTH * 0.9
                            ? "text-amber-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {characters.toLocaleString()} / {MAX_POST_LENGTH.toLocaleString()}
                    </span>
                  </div>
                  <Textarea
                    value={row.content}
                    onChange={(event) => updateContent(row.index, event.target.value)}
                    placeholder={`What do you want to share on ${dayLabel(row.dateKey)}?`}
                    className="mt-1.5 min-h-[92px] resize-y text-[12.5px] leading-relaxed"
                    aria-invalid={overLimit || Boolean(contentError)}
                  />
                  {contentError && (
                    <p className="text-[10.5px] text-destructive">{contentError}</p>
                  )}

                  <div className="mt-2.5">
                    {dayMedia ? (
                      <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 p-2 sm:flex-row">
                        <div className="relative h-20 w-full shrink-0 overflow-hidden rounded-lg border border-border/70 sm:w-28">
                          {dayMedia.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={dayMedia.url}
                              alt={dayMedia.alt || `Image for ${dayLabel(row.dateKey)}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="text-muted-foreground grid h-full w-full place-items-center bg-muted">
                              <ImagePlus className="size-5" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => removeImage(row.index)}
                            disabled={pending}
                            className="absolute top-1 right-1 grid size-6 place-items-center rounded-md bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80 disabled:opacity-50"
                            aria-label={`Remove image for ${dayLabel(row.dateKey)}`}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <Input
                            value={dayMedia.alt}
                            maxLength={300}
                            onChange={(event) => updateAltText(row.index, event.target.value)}
                            placeholder="Image description (alt text) for screen readers"
                            className="h-8 text-[11.5px]"
                            aria-label={`Image description for ${dayLabel(row.dateKey)}`}
                          />
                          <p className="text-muted-foreground mt-1 text-[10px]">
                            Attached to {dayLabel(row.dateKey)}&apos;s post · JPEG, PNG or WebP up to 8
                            MB
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <input
                          id={`day-image-${row.index}`}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          disabled={demo || uploadingIndex !== null}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void handleImage(row.index, file);
                          }}
                        />
                        <label
                          htmlFor={`day-image-${row.index}`}
                          className={cn(
                            "inline-flex cursor-pointer flex-wrap items-center gap-1.5 text-[11px] font-medium text-primary hover:underline",
                            (demo || uploadingIndex !== null) && "pointer-events-none opacity-50",
                          )}
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" /> Uploading…
                            </>
                          ) : (
                            <>
                              <ImagePlus className="size-3.5" /> Add image
                              <span className="text-muted-foreground font-normal">
                                · JPEG, PNG or WebP up to 8 MB
                              </span>
                            </>
                          )}
                        </label>
                      </>
                    )}
                    {mediaError && (
                      <p className="mt-1 text-[10.5px] text-destructive">{mediaError}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3 text-[12px] text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {error}
            {totalErrors > 0 && (
              <span className="text-destructive/80"> Check the highlighted days and try again.</span>
            )}
          </span>
        </div>
      )}

      {demo && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-[11.5px] text-amber-700 dark:text-amber-300">
          <span className="font-semibold">Demo mode is read-only.</span> You can explore the planner,
          but scheduling requires a Supabase project and a connected social account.
        </div>
      )}

      {/* Sticky action bar */}
      <div className="sticky bottom-4 z-20">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-xl backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="brand-gradient grid size-9 shrink-0 place-items-center rounded-xl text-white">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="text-[12.5px] font-semibold">
                {filled.length === 0
                  ? "Write your first post to begin"
                  : `${filled.length} post${filled.length === 1 ? "" : "s"} ready for ${timezone}`}
              </p>
              <p className="text-muted-foreground text-[10.5px]">
                Empty days are skipped. Times are converted to UTC on the server.
              </p>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              onClick={() => submit("draft")}
              disabled={pending || !canSubmit}
              className="sm:min-w-[130px]"
            >
              {pendingAction === "draft" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save as drafts
            </Button>
            <Button
              variant="gradient"
              onClick={() => submit("schedule")}
              disabled={pending || !canSubmit}
              className="sm:min-w-[180px]"
            >
              {pendingAction === "schedule" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarCheck2 className="size-4" />
              )}
              Schedule all {filled.length > 0 ? filled.length : ""} posts
            </Button>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[10.5px]">
        <Copy className="size-3" />
        Need to reuse an earlier post? Open{" "}
        <Link href="/posts" className="font-medium text-primary hover:underline">
          All posts
        </Link>{" "}
        and duplicate any post into a fresh draft.
      </p>
    </div>
  );
}
