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
  Loader2,
  Save,
  Sparkles,
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
import {
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatInZone,
  isValidDateKey,
  todayDateKey,
  weekdayOfDateKey,
} from "@/lib/scheduling/timezone";
import { MAX_POST_LENGTH, countCharacters } from "@/lib/validation";
import type { PublishTargetOption } from "@/lib/types";
import { cn } from "@/lib/utils";

function dayLabel(dateKey: string) {
  return formatInZone(dateKeyToUtcDate(dateKey), "UTC", "EEEE");
}

function shortDate(dateKey: string) {
  return formatInZone(dateKeyToUtcDate(dateKey), "UTC", "MMM d");
}

function isToday(dateKey: string, timezone: string) {
  return dateKey === todayDateKey(timezone);
}

export function WeekPlanner({
  targets,
  timezone,
  defaultTime,
  defaultStartDate,
  demo,
}: {
  targets: PublishTargetOption[];
  timezone: string;
  defaultTime: string;
  defaultStartDate: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"schedule" | "draft" | null>(null);

  const firstTarget = targets.find((target) => target.canPublish)?.value ?? "";
  const [target, setTarget] = useState(firstTarget);
  const [name, setName] = useState("7-day LinkedIn plan");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [globalTime, setGlobalTime] = useState(defaultTime);
  const [contents, setContents] = useState<string[]>(() => Array.from({ length: 7 }, () => ""));
  const [times, setTimes] = useState<string[]>(() =>
    Array.from({ length: 7 }, () => defaultTime),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      Array.from({ length: 7 }).map((_, index) => {
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
    [startDate, contents, times, globalTime, timezone],
  );

  const filled = rows.filter((row) => row.content.trim().length > 0);
  const selected = targets.find((item) => item.value === target) ?? null;
  const canSubmit = !demo && Boolean(selected?.canPublish) && filled.length > 0;
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
    setTimes(Array.from({ length: 7 }, () => value));
  }

  function submit(action: "schedule" | "draft") {
    setError(null);
    setFieldErrors({});
    if (!selected) {
      setError("Choose a LinkedIn profile or company page first.");
      return;
    }
    if (!selected.canPublish) {
      setError(selected.disabledReason ?? "That LinkedIn target can't publish yet.");
      return;
    }
    if (filled.length === 0) {
      setError("Write at least one post before continuing.");
      return;
    }

    setPendingAction(action);
    startTransition(async () => {
      const result = await scheduleWeek({
        name: name.trim() || "7-day LinkedIn plan",
        timezone,
        target,
        action,
        entries: rows.map((row) => ({
          dateKey: row.dateKey,
          time: row.time || globalTime,
          content: row.content,
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
          (action === "schedule" ? "Week scheduled" : "Drafts saved"),
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
            <TriangleAlert className="size-4" /> Connect LinkedIn to plan your week
          </div>
          <p className="text-muted-foreground max-w-xl text-[12.5px] leading-relaxed">
            LINKFLOW schedules through the official LinkedIn API. Connect your personal profile or an
            authorized company page, then come back to write all seven posts in one sitting.
          </p>
          <Button asChild variant="gradient" size="sm">
            <Link href="/accounts">Connect LinkedIn</Link>
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
            Every row becomes one post. The whole week is scheduled in a single request.
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
              placeholder="7-day LinkedIn plan"
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
              Applies to all 7 days in {timezone}. You can override each day.
            </p>
          </div>
          <div className="flex items-end sm:col-span-2 xl:col-span-3">
            <div className="text-muted-foreground flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[11.5px]">
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="size-3.5 text-primary" />
                {shortDate(rows[0].dateKey)} → {shortDate(rows[6].dateKey)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarCheck2 className="size-3.5 text-emerald-500" />
                {filled.length} of 7 posts written
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5 text-violet-500" /> one post per day
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seven days */}
      <div className="space-y-2.5">
        {rows.map((row) => {
          const characters = countCharacters(row.content);
          const overLimit = characters > MAX_POST_LENGTH;
          const contentError = fieldErrors[`entries.${row.index}.content`];
          const timeError = fieldErrors[`entries.${row.index}.time`];
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
          but scheduling requires a Supabase project and a connected LinkedIn account.
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
        Need to reuse last week? Open{" "}
        <Link href="/posts" className="font-medium text-primary hover:underline">
          All posts
        </Link>{" "}
        and duplicate any post into a fresh draft.
      </p>
    </div>
  );
}
