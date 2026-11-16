import { formatNumber } from "@/lib/utils";

const SEGMENTS = [
  { key: "published", label: "Published", color: "#10b981" },
  { key: "scheduled", label: "Scheduled", color: "#3b82f6" },
  { key: "draft", label: "Drafts", color: "#94a3b8" },
  { key: "failed", label: "Failed", color: "#ef4444" },
] as const;

export function StatusRing({
  counts,
}: {
  counts: { published: number; scheduled: number; draft: number; failed: number; total: number };
}) {
  const total = Math.max(1, counts.total);
  const values = SEGMENTS.map((segment) => ({
    ...segment,
    value: counts[segment.key],
    percent: (counts[segment.key] / total) * 100,
  }));

  let offset = 0;
  const gradient = values
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = offset;
      offset += segment.percent;
      return `${segment.color} ${start}% ${offset}%`;
    })
    .join(", ");

  return (
    <div className="flex items-center gap-5">
      <div
        className="relative grid size-[108px] shrink-0 place-items-center rounded-full"
        style={{
          background: gradient
            ? `conic-gradient(${gradient})`
            : "conic-gradient(var(--border) 0% 100%)",
        }}
      >
        <div className="bg-card grid size-[78px] place-items-center rounded-full shadow-inner">
          <div className="text-center">
            <p className="font-display text-lg leading-none font-bold tabular-nums">
              {formatNumber(counts.total)}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[9px] tracking-wide uppercase">Posts</p>
          </div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2.5">
        {SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-muted-foreground truncate text-[11px]">{segment.label}</span>
            <span className="ml-auto text-[11px] font-semibold tabular-nums">
              {formatNumber(counts[segment.key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
