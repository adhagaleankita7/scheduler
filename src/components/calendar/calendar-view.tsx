"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/posts/post-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusDot, STATUS_DOT } from "@/components/shared/status-badge";
import { reschedulePost } from "@/lib/actions/posts";
import {
  formatInZone,
  todayDateKey,
  zonedDateTimeToUtc,
} from "@/lib/scheduling/timezone";
import {
  getCalendarWindow,
  shiftCalendarDate,
  type CalendarDay,
  type CalendarView,
} from "@/lib/scheduling/calendar";
import type { PostStatus, PostWithRelations } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

const VIEW_OPTIONS: { value: CalendarView; label: string; icon: React.ElementType }[] = [
  { value: "month", label: "Month", icon: LayoutGrid },
  { value: "week", label: "Week", icon: CalendarRange },
  { value: "day", label: "Day", icon: CalendarDays },
];

const LEGEND: { status: PostStatus; label: string }[] = [
  { status: "scheduled", label: "Scheduled" },
  { status: "processing", label: "Publishing" },
  { status: "published", label: "Published" },
  { status: "failed", label: "Failed" },
  { status: "cancelled", label: "Cancelled" },
];

const DRAGGABLE: PostStatus[] = ["scheduled", "failed", "cancelled"];

function WeekdayHeader() {
  return (
    <div className="grid grid-cols-7 border-b border-border/70">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
        <div
          key={day}
          className="text-muted-foreground px-2 py-2 text-center text-[10.5px] font-semibold tracking-wide uppercase"
        >
          {day}
        </div>
      ))}
    </div>
  );
}

function CalendarChip({
  post,
  timezone,
  onDragStart,
  onDragEnd,
  dragging,
  compact = false,
}: {
  post: PostWithRelations;
  timezone: string;
  onDragStart: (post: PostWithRelations) => void;
  onDragEnd: () => void;
  dragging: boolean;
  compact?: boolean;
}) {
  const editable = DRAGGABLE.includes(post.status);
  const time = post.scheduled_for
    ? formatInZone(post.scheduled_for, timezone, "h:mm a")
    : "—";
  const target = post.target_type === "organization" ? post.page?.name : post.account?.display_name;
  const href = editable ? `/composer?post=${post.id}` : post.provider_post_url ?? "/posts";

  return (
    <div
      draggable={editable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", post.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(post);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group/chip rounded-lg border border-border/70 bg-card px-1.5 py-1 text-[10.5px] transition-all",
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        dragging && "opacity-40",
        compact ? "" : "hover:border-primary/30 hover:shadow-sm",
      )}
      title={`${time} · ${target ?? "LinkedIn"} — ${truncate(post.content, 140)}`}
    >
      <Link href={href} className="flex items-center gap-1.5" draggable={false}>
        <StatusDot status={post.status} />
        <span className="text-muted-foreground shrink-0 font-medium tabular-nums">{time}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">
          {post.content}
        </span>
        {post.status === "published" && post.provider_post_url ? (
          <ExternalLink className="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/chip:opacity-100" />
        ) : editable ? (
          <Pencil className="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/chip:opacity-100" />
        ) : null}
      </Link>
    </div>
  );
}

export function CalendarView({
  initialView,
  initialDate,
  timezone,
  posts,
  signedMedia,
}: {
  initialView: CalendarView;
  initialDate: string;
  timezone: string;
  posts: PostWithRelations[];
  signedMedia: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<PostWithRelations | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [view, setView] = useState<CalendarView>(initialView);
  const [dateKey, setDateKey] = useState(initialDate);

  const window = useMemo(
    () => getCalendarWindow(view, dateKey, timezone),
    [view, dateKey, timezone],
  );
  const today = todayDateKey(timezone);

  const postsByDate = useMemo(() => {
    const map = new Map<string, PostWithRelations[]>();
    for (const post of posts) {
      if (!post.scheduled_for) continue;
      const key = formatInZone(post.scheduled_for, timezone, "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(post);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.scheduled_for ?? 0).getTime() - new Date(b.scheduled_for ?? 0).getTime(),
      );
    }
    return map;
  }, [posts, timezone]);

  function navigate(nextView: CalendarView, nextDate: string) {
    setView(nextView);
    setDateKey(nextDate);
    startTransition(() => {
      router.push(`/calendar?view=${nextView}&date=${nextDate}`);
    });
  }

  function go(delta: number) {
    navigate(view, shiftCalendarDate(view, dateKey, delta));
  }

  function goToDay(dayKey: string) {
    navigate("day", dayKey);
  }

  function handleDrop(day: CalendarDay) {
    setDropTarget(null);
    if (!dragging?.scheduled_for) {
      setDragging(null);
      return;
    }
    const post = dragging;
    const scheduledFor = post.scheduled_for;
    setDragging(null);
    if (!scheduledFor) return;

    const originalTime = formatInZone(scheduledFor, timezone, "HH:mm");
    const originalDate = formatInZone(scheduledFor, timezone, "yyyy-MM-dd");
    if (originalDate === day.dateKey) return;

    const iso = zonedDateTimeToUtc(day.dateKey, originalTime, timezone).toISOString();
    startTransition(async () => {
      const result = await reschedulePost(post.id, iso);
      if (result.ok) {
        toast.success(
          `Moved to ${formatInZone(iso, timezone, "EEE, MMM d")} at ${formatInZone(iso, timezone, "h:mm a")}`,
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not move that post.");
      }
    });
  }

  const navigableDate = dateKey;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => go(-1)} aria-label="Previous period">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(view, today)}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => go(1)} aria-label="Next period">
            <ChevronRight className="size-4" />
          </Button>
          <div className="ml-1 min-w-0">
            <p className="font-display flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              {window.title}
              <span className="text-muted-foreground font-normal">{window.subtitle}</span>
              {pending && <Loader2 className="size-3.5 animate-spin text-primary" />}
            </p>
            <p className="text-muted-foreground text-[10.5px]">
              Times in {timezone} · {posts.length} scheduled event{posts.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-muted/70 inline-flex h-9 items-center rounded-xl p-1">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => navigate(option.value, navigableDate)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-all",
                    view === option.value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{option.label}</span>
                </button>
              );
            })}
          </div>
          <Button asChild variant="gradient" size="sm">
            <Link href="/composer">
              <Plus className="size-3.5" /> New post
            </Link>
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[10.5px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground/70">
          <Clock3 className="size-3" /> Drag a scheduled post to move it to another day
        </span>
        <span className="text-border">|</span>
        {LEGEND.map((item) => (
          <span key={item.status} className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[item.status])} />
            {item.label}
          </span>
        ))}
      </div>

      {/* Month */}
      {view === "month" && (
        <div className="overflow-x-auto rounded-2xl border border-border/80 bg-card shadow-card">
          <div className="min-w-[780px]">
            <WeekdayHeader />
            <div className="grid grid-cols-7">
              {window.days.map((day, index) => {
                const dayPosts = postsByDate.get(day.dateKey) ?? [];
                const visible = dayPosts.slice(0, 3);
                const isToday = day.dateKey === today;
                const isDropTarget = dropTarget === day.dateKey;
                return (
                  <div
                    key={day.dateKey}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(day.dateKey);
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === day.dateKey ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(day);
                    }}
                    className={cn(
                      "min-h-[118px] border-b border-border/60 p-1.5 transition-colors",
                      index % 7 !== 6 && "border-r",
                      !day.inPeriod && "bg-muted/25",
                      isDropTarget && "bg-primary/[0.07] ring-1 ring-inset ring-primary/30",
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between px-0.5">
                      <button
                        type="button"
                        onClick={() => goToDay(day.dateKey)}
                        className={cn(
                          "grid size-6 place-items-center rounded-full text-[11px] font-semibold transition-colors",
                          isToday
                            ? "brand-gradient text-white"
                            : day.inPeriod
                              ? "text-foreground/80 hover:bg-muted"
                              : "text-muted-foreground/50 hover:bg-muted",
                        )}
                      >
                        {Number(day.dateKey.slice(-2))}
                      </button>
                      {dayPosts.length > 0 && (
                        <span className="text-muted-foreground text-[9px] font-medium tabular-nums">
                          {dayPosts.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {visible.map((post) => (
                        <CalendarChip
                          key={post.id}
                          post={post}
                          timezone={timezone}
                          onDragStart={setDragging}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                          dragging={dragging?.id === post.id}
                        />
                      ))}
                      {dayPosts.length > 3 && (
                        <button
                          type="button"
                          onClick={() => goToDay(day.dateKey)}
                          className="text-muted-foreground hover:text-primary w-full rounded px-1 py-0.5 text-left text-[10px] font-medium"
                        >
                          +{dayPosts.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Week */}
      {view === "week" && (
        <div className="overflow-x-auto rounded-2xl border border-border/80 bg-card shadow-card">
          <div className="grid min-w-[900px] grid-cols-7">
            {window.days.map((day) => {
              const dayPosts = postsByDate.get(day.dateKey) ?? [];
              const isToday = day.dateKey === today;
              const isDropTarget = dropTarget === day.dateKey;
              return (
                <div
                  key={day.dateKey}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget(day.dateKey);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === day.dateKey ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(day);
                  }}
                  className={cn(
                    "min-h-[440px] border-r border-border/60 last:border-r-0",
                    isDropTarget && "bg-primary/[0.06]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => goToDay(day.dateKey)}
                    className={cn(
                      "w-full border-b border-border/60 px-2 py-2.5 text-center transition-colors hover:bg-muted/40",
                      isToday && "bg-primary/[0.05]",
                    )}
                  >
                    <p className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
                      {formatInZone(`${day.dateKey}T12:00:00Z`, "UTC", "EEE")}
                    </p>
                    <p
                      className={cn(
                        "font-display mt-0.5 text-[16px] font-bold",
                        isToday ? "text-primary" : "text-foreground/85",
                      )}
                    >
                      {Number(day.dateKey.slice(-2))}
                    </p>
                  </button>
                  <div className="space-y-1.5 p-1.5">
                    {dayPosts.length === 0 ? (
                      <p className="text-muted-foreground/50 px-1 py-3 text-center text-[10px]">—</p>
                    ) : (
                      dayPosts.map((post) => (
                        <CalendarChip
                          key={post.id}
                          post={post}
                          timezone={timezone}
                          onDragStart={setDragging}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                          dragging={dragging?.id === post.id}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day */}
      {view === "day" && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-[15px] font-semibold">
                {formatInZone(`${window.dateKey}T12:00:00Z`, "UTC", "EEEE, MMMM d")}
              </p>
              <p className="text-muted-foreground text-[11px]">
                {(postsByDate.get(window.dateKey) ?? []).length} post
                {(postsByDate.get(window.dateKey) ?? []).length === 1 ? "" : "s"} scheduled
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/composer`}>
                <Plus className="size-3.5" /> Write a post
              </Link>
            </Button>
          </div>

          {(postsByDate.get(window.dateKey) ?? []).length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nothing scheduled for this day"
              description="Pick another day, or write a post and schedule it for this date."
              actions={
                <Button asChild variant="gradient" size="sm">
                  <Link href="/planner">Plan the week</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(postsByDate.get(window.dateKey) ?? []).map((post) => (
                <div key={post.id} className="space-y-1.5">
                  <div className="text-muted-foreground flex items-center gap-2 px-1 text-[10.5px] font-medium">
                    <Clock3 className="size-3" />
                    {post.scheduled_for
                      ? formatInZone(post.scheduled_for, timezone, "h:mm a")
                      : "No time"}
                    <Badge variant="outline" className="ml-auto text-[9px]">
                      {post.media ? "With image" : "Text post"}
                    </Badge>
                  </div>
                  <PostCard
                    post={post}
                    timezone={timezone}
                    mediaUrl={post.media ? signedMedia[post.media.storage_path] ?? null : null}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
