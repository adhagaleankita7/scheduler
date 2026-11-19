"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CirclePause,
  Clock3,
  Hash,
  Info,
  Loader2,
  Pause,
  Play,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  TimerReset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PostCard } from "@/components/posts/post-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Countdown } from "@/components/shared/local-time";
import { TargetSelect } from "@/components/shared/target-select";
import {
  addToQueue,
  reorderQueue,
  scheduleDraftInQueue,
  toggleQueuePaused,
  updateQueueSettings,
} from "@/lib/actions/queue";
import {
  TIMEZONE_OPTIONS,
  WEEKDAYS,
  formatInZone,
  formatTimeLabel,
} from "@/lib/scheduling/timezone";
import { MAX_POST_LENGTH, countCharacters } from "@/lib/validation";
import type { QueueData } from "@/lib/data/queue";
import { cn } from "@/lib/utils";

function normalizeTimes(times: string[]) {
  return times.map((time) => time.slice(0, 5));
}

export function QueueView({ data }: { data: QueueData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<string | null>(null);

  const timezone = data.settings.timezone;
  const [paused, setPaused] = useState(data.settings.is_paused);
  const firstTarget = data.targets.find((target) => target.canPublish)?.value ?? "";

  const [content, setContent] = useState("");
  const [target, setTarget] = useState(firstTarget);
  const [contentError, setContentError] = useState<string | null>(null);
  const characters = countCharacters(content);
  const overLimit = characters > MAX_POST_LENGTH;

  const [settingsTimezone, setSettingsTimezone] = useState(data.settings.timezone);
  const [settingsDays, setSettingsDays] = useState<number[]>(
    data.settings.posting_days.length > 0 ? data.settings.posting_days : [1, 2, 3, 4, 5],
  );
  const [settingsTimes, setSettingsTimes] = useState<string[]>(() => {
    const times = normalizeTimes(data.settings.posting_times);
    return times.length > 0 ? times : ["10:00"];
  });
  const [settingsPaused, setSettingsPaused] = useState(data.settings.is_paused);

  const selectedTarget = useMemo(
    () => data.targets.find((item) => item.value === target) ?? null,
    [data.targets, target],
  );

  function run(
    name: string,
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    onSuccess?: () => void,
    onFailure?: () => void,
  ) {
    setAction(name);
    startTransition(async () => {
      const result = await fn();
      setAction(null);
      if (result.ok) {
        toast.success(result.message ?? "Done");
        onSuccess?.();
        router.refresh();
      } else {
        onFailure?.();
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  function submitQuickAdd() {
    setContentError(null);
    if (!content.trim()) {
      setContentError("Write something to add to the queue.");
      return;
    }
    if (overLimit) {
      setContentError(`Keep posts under ${MAX_POST_LENGTH.toLocaleString()} characters.`);
      return;
    }
    if (!selectedTarget?.canPublish) {
      setContentError(selectedTarget?.disabledReason ?? "Choose a publishing target that can publish.");
      return;
    }

    setAction("add");
    startTransition(async () => {
      const result = await addToQueue({ content: content.trim(), target });
      setAction(null);
      if (!result.ok) {
        setContentError(result.error);
        toast.error(result.error);
        return;
      }
      setContent("");
      toast.success(
        `Queued for ${formatInZone(result.data.scheduledFor, timezone, "EEE, MMM d")} at ${formatInZone(result.data.scheduledFor, timezone, "h:mm a")}`,
      );
      router.refresh();
    });
  }

  function togglePause(next: boolean) {
    const previous = paused;
    const previousSettings = settingsPaused;
    setPaused(next);
    setSettingsPaused(next);
    run(
      "pause",
      () => toggleQueuePaused(next),
      () => {
        // Keep both pause controls in sync after a successful toggle.
        setPaused(next);
        setSettingsPaused(next);
      },
      () => {
        // Revert the optimistic switch so the UI never lies about queue state.
        setPaused(previous);
        setSettingsPaused(previousSettings);
      },
    );
  }

  function saveSettings() {
    if (settingsDays.length === 0) {
      toast.error("Select at least one publishing day.");
      return;
    }
    const times = normalizeTimes(settingsTimes).filter(Boolean);
    if (times.length === 0) {
      toast.error("Add at least one posting time.");
      return;
    }
    run("settings", () =>
      updateQueueSettings({
        timezone: settingsTimezone,
        postingDays: settingsDays,
        postingTimes: times,
        isPaused: settingsPaused,
      }),
    );
  }

  function toggleDay(day: number) {
    setSettingsDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort(),
    );
  }

  function updateTime(index: number, value: string) {
    setSettingsTimes((current) => current.map((time, i) => (i === index ? value : time)));
  }

  function addTime() {
    if (settingsTimes.length >= 4) return;
    setSettingsTimes((current) => [...current, "17:00"]);
  }

  function removeTime(index: number) {
    setSettingsTimes((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      {/* Engine + next slots */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-xl border",
                  paused
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                    : "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                )}
              >
                {paused ? <CirclePause className="size-5" /> : <Zap className="size-5" />}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-[15px] font-semibold">
                    {paused ? "Queue paused" : "Automatic publishing is on"}
                  </p>
                  <Badge variant={paused ? "warning" : "success"}>
                    {paused ? "Paused" : "Active"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 max-w-lg text-[12px] leading-relaxed">
                  {paused
                    ? "Due posts are held safely. Nothing publishes until you resume — then the queue continues exactly where it left off."
                    : "Supabase Cron wakes the publishing engine every minute. Due posts publish automatically, with retries and full logging."}
                </p>
                <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <ListIcon /> {data.scheduled.length} queued
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <TimerReset className="size-3" />
                    {data.nextPublishAt ? (
                      <>
                        next <Countdown iso={data.nextPublishAt} className="font-semibold text-primary" />
                      </>
                    ) : (
                      "no upcoming slot"
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-3" /> no duplicate publishing
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant={paused ? "gradient" : "outline"}
              onClick={() => togglePause(!paused)}
              disabled={data.demo || pending}
              className="shrink-0"
            >
              {action === "pause" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : paused ? (
                <Play className="size-4" />
              ) : (
                <Pause className="size-4" />
              )}
              {paused ? "Resume queue" : "Pause queue"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" /> Next open slots
            </CardTitle>
            <CardDescription>
              Calculated after your last queued post in {timezone}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.nextSlots.length === 0 ? (
              <p className="text-muted-foreground text-[11.5px]">
                No slots available. Choose at least one day and time in Queue settings.
              </p>
            ) : (
              data.nextSlots.slice(0, 5).map((slot, index) => (
                <div
                  key={slot.iso}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11.5px]"
                >
                  <span className="text-muted-foreground w-3 text-[10px] font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <span className="font-medium">{formatInZone(slot.iso, timezone, "EEE, MMM d")}</span>
                  <span className="text-muted-foreground ml-auto tabular-nums">
                    {formatTimeLabel(slot.time)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {data.demo && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-[11.5px] text-amber-700 dark:text-amber-300">
          <span className="font-semibold">Demo workspace.</span> The queue is read-only. Connect
          Supabase and sign in to add, pause, reorder and publish real posts.
        </div>
      )}

      {/* Quick add */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4 text-primary" /> Quick add to queue
            </CardTitle>
            <CardDescription>
              Drops the post into the next open slot. No date picker needed.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0">
            {paused ? "Paused" : "Next slot"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setContentError(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submitQuickAdd();
              }
            }}
            placeholder="Write a short post and press ⌘/Ctrl + Enter to queue it…"
            className="min-h-[110px] text-[13px] leading-relaxed"
            aria-invalid={overLimit}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                "text-[10.5px] font-medium tabular-nums",
                overLimit ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {characters.toLocaleString()} / {MAX_POST_LENGTH.toLocaleString()}
            </span>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="w-full sm:w-[260px]">
                <TargetSelect
                  targets={data.targets}
                  value={target}
                  onChange={setTarget}
                  size="sm"
                  disabled={pending}
                />
              </div>
              <Button
                variant="gradient"
                size="sm"
                onClick={submitQuickAdd}
                disabled={pending || data.demo || paused || overLimit || !selectedTarget?.canPublish}
              >
                {action === "add" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Add to queue
              </Button>
            </div>
          </div>
          {contentError && (
            <p className="flex items-start gap-1.5 text-[11px] text-destructive">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" /> {contentError}
            </p>
          )}
          {paused && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              Resume the queue to add new posts.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {/* Scheduled queue */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Publishing queue</CardTitle>
                <CardDescription>
                  Ordered by scheduled time. Reorder by swapping adjacent slots.
                </CardDescription>
              </div>
              <Badge variant="info" className="shrink-0">
                {data.scheduled.length} post{data.scheduled.length === 1 ? "" : "s"}
              </Badge>
            </CardHeader>
            <CardContent>
              {data.scheduled.length === 0 ? (
                <EmptyState
                  compact
                  icon={Clock3}
                  title="Nothing in the queue"
                  description="Add a post above, promote a draft, or schedule a full month from the planner."
                  actions={
                    <Button asChild size="sm" variant="gradient">
                      <Link href="/planner/month">Plan my month</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-2.5">
                  {data.scheduled.map((post, index) => (
                    <div key={post.id} className="flex items-stretch gap-2">
                      <div className="flex w-7 shrink-0 flex-col items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-6"
                          disabled={index === 0 || pending || data.demo}
                          onClick={() =>
                            run("reorder", () => reorderQueue(post.id, "up"))
                          }
                          aria-label="Move post earlier"
                        >
                          <ArrowUp className="size-3" />
                        </Button>
                        <span className="text-muted-foreground text-[10px] font-semibold tabular-nums">
                          {index + 1}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-6"
                          disabled={index === data.scheduled.length - 1 || pending || data.demo}
                          onClick={() =>
                            run("reorder", () => reorderQueue(post.id, "down"))
                          }
                          aria-label="Move post later"
                        >
                          <ArrowDown className="size-3" />
                        </Button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <PostCard
                          post={post}
                          timezone={timezone}
                          variant="row"
                          mediaUrl={
                            post.media ? data.signedMedia[post.media.storage_path] ?? null : null
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Drafts */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Drafts waiting for a slot</CardTitle>
                <CardDescription>
                  Promote a draft and LINKFLOW assigns the next available time.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/posts?status=draft">
                  All drafts <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {data.drafts.length === 0 ? (
                <p className="text-muted-foreground rounded-xl border border-dashed border-border px-3 py-5 text-center text-[11.5px]">
                  No drafts right now.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {data.drafts.slice(0, 5).map((post) => (
                    <div
                      key={post.id}
                      className="rounded-2xl border border-border/70 bg-muted/20 p-1"
                    >
                      <PostCard
                        post={post}
                        timezone={timezone}
                        variant="row"
                        className="border-0 bg-transparent shadow-none hover:border-transparent"
                        mediaUrl={
                          post.media ? data.signedMedia[post.media.storage_path] ?? null : null
                        }
                      />
                      <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
                        <span className="text-muted-foreground text-[10.5px]">
                          Will publish at the next open slot
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending || data.demo || paused}
                          onClick={() =>
                            run("promote", () => scheduleDraftInQueue(post.id))
                          }
                        >
                          {action === "promote" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Plus className="size-3.5" />
                          )}
                          Queue it
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Settings */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="size-4 text-primary" /> Queue rhythm
              </CardTitle>
              <CardDescription>
                New posts flow into these days and times automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Select value={settingsTimezone} onValueChange={setSettingsTimezone}>
                  <SelectTrigger aria-label="Queue timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Publishing days</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const active = settingsDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => toggleDay(day.value)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                          active
                            ? "border-primary/25 bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/20",
                        )}
                        aria-pressed={active}
                        title={day.label}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Daily slots</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addTime}
                    disabled={settingsTimes.length >= 4}
                    className="h-6 px-2 text-[10.5px]"
                  >
                    <Plus className="size-3" /> Add slot
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {settingsTimes.map((time, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Clock3 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="time"
                          value={time}
                          onChange={(event) => updateTime(index, event.target.value)}
                          className="h-9 pl-8 text-[12px]"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeTime(index)}
                        disabled={settingsTimes.length <= 1}
                        aria-label="Remove time"
                      >
                        <span className="text-[15px] leading-none">−</span>
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-[10px]">
                  Up to four slots per day. All times are in {settingsTimezone}.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-semibold">Pause queue</p>
                  <p className="text-muted-foreground text-[10.5px]">
                    Hold posts without losing their place.
                  </p>
                </div>
                <Switch
                  checked={settingsPaused}
                  onCheckedChange={(checked) => {
                    setSettingsPaused(checked);
                    togglePause(checked);
                  }}
                  disabled={data.demo || pending}
                  aria-label="Pause the publishing queue"
                />
              </div>

              <Button
                variant="gradient"
                className="w-full"
                onClick={saveSettings}
                disabled={pending || data.demo}
              >
                {action === "settings" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save queue settings
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-muted/25">
            <CardContent className="space-y-2.5 py-4">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                <Info className="size-3.5 text-primary" /> How the queue works
              </p>
              <ul className="text-muted-foreground space-y-1.5 text-[10.5px] leading-relaxed">
                <li className="flex gap-1.5">
                  <Hash className="mt-0.5 size-3 shrink-0" /> New posts take the next open slot after
                  your latest scheduled post.
                </li>
                <li className="flex gap-1.5">
                  <Hash className="mt-0.5 size-3 shrink-0" /> Reordering swaps timestamps only — the
                  content never changes.
                </li>
                <li className="flex gap-1.5">
                  <Hash className="mt-0.5 size-3 shrink-0" /> Paused queues keep everything queued and
                  resume safely.
                </li>
              </ul>
              <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-2 text-[10.5px] text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0 text-emerald-500" />
                Atomic claims guarantee one publisher per post.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ListIcon() {
  return (
    <span className="inline-flex items-center gap-1">
      <Clock3 className="size-3" />
    </span>
  );
}
