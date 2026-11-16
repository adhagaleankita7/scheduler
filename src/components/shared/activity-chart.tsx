import { addDaysToDateKey, todayDateKey } from "@/lib/scheduling/timezone";
import type { ActivityPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayShort(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return DAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function PublishingActivityChart({
  data,
  weeklyTarget,
  className,
}: {
  data: ActivityPoint[];
  weeklyTarget: number;
  className?: string;
}) {
  const max = Math.max(
    1,
    ...data.map((point) => point.scheduled + point.failed),
    ...data.map((point) => point.published),
    weeklyTarget,
  );
  const totalPublished = data.reduce((sum, point) => sum + point.published, 0);
  const totalScheduled = data.reduce((sum, point) => sum + point.scheduled, 0);
  const totalFailed = data.reduce((sum, point) => sum + point.failed, 0);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <span className="size-2 rounded-full bg-emerald-500" />
          Published <span className="font-display font-bold">{totalPublished}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <span className="size-2 rounded-full bg-blue-500/60" />
          Scheduled <span className="font-display font-bold">{totalScheduled}</span>
        </div>
        {totalFailed > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <span className="size-2 rounded-full bg-red-500" />
            Failed <span className="font-display font-bold">{totalFailed}</span>
          </div>
        )}
        <span className="text-muted-foreground ml-auto text-[10.5px]">
          Target {weeklyTarget}/week
        </span>
      </div>

      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <div key={line} className="border-t border-dashed border-border/60" />
          ))}
        </div>
        <div className="relative flex h-[168px] items-end gap-2 sm:gap-3">
          {data.map((point) => {
            const publishedHeight = Math.max(4, Math.round((point.published / max) * 100));
            const scheduledHeight = Math.max(2, Math.round((point.scheduled / max) * 100));
            const failedHeight = Math.max(2, Math.round((point.failed / max) * 100));
            const isToday = point.date === todayDateKey("Asia/Kolkata");
            return (
              <div key={point.date} className="group flex h-full flex-1 flex-col justify-end gap-1">
                <div className="relative flex h-full items-end justify-center gap-1">
                  <div
                    className="w-full max-w-[13px] rounded-t-[5px] bg-gradient-to-t from-blue-500/25 to-blue-500/60 transition-all duration-500 group-hover:from-blue-500/40 group-hover:to-blue-500/80"
                    style={{ height: `${scheduledHeight}%` }}
                    title={`${point.scheduled} scheduled`}
                  />
                  <div
                    className="w-full max-w-[13px] rounded-t-[5px] bg-gradient-to-t from-emerald-500 to-teal-400 shadow-[0_2px_10px_-2px_rgba(16,185,129,0.5)] transition-all duration-500 group-hover:brightness-110"
                    style={{ height: `${publishedHeight}%` }}
                    title={`${point.published} published`}
                  />
                  {point.failed > 0 && (
                    <div
                      className="w-full max-w-[13px] rounded-t-[5px] bg-gradient-to-t from-red-500 to-rose-400 transition-all duration-500"
                      style={{ height: `${failedHeight}%` }}
                      title={`${point.failed} failed`}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "text-center text-[10px] font-medium",
                    isToday ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {weekdayShort(point.date)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function weeklyActivitySummary(data: ActivityPoint[]) {
  const published = data.reduce((sum, point) => sum + point.published, 0);
  const scheduled = data.reduce((sum, point) => sum + point.scheduled, 0);
  const start = data[0]?.date ?? todayDateKey("Asia/Kolkata");
  const end = addDaysToDateKey(start, data.length - 1);
  return { published, scheduled, start, end };
}
