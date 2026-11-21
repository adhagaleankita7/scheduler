import { MessageCircle, Share2, ThumbsUp } from "lucide-react";
import type { EngagementTotals } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

const ITEMS = [
  { key: "likes", label: "Likes", icon: ThumbsUp, className: "text-blue-600 dark:text-blue-300" },
  {
    key: "comments",
    label: "Comments",
    icon: MessageCircle,
    className: "text-violet-600 dark:text-violet-300",
  },
  {
    key: "shares",
    label: "Shares",
    icon: Share2,
    className: "text-emerald-600 dark:text-emerald-300",
  },
] as const;

/** Compact likes/comments/shares summary for a page. */
export function EngagementStats({
  engagement,
  className,
  labels = true,
  emptyHint = "Updates about every 15 minutes",
}: {
  engagement: EngagementTotals;
  className?: string;
  labels?: boolean;
  emptyHint?: string | null;
}) {
  const total = engagement.likes + engagement.comments + engagement.shares;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-3 gap-2">
        {ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2"
            title={`${engagement[item.key]} ${item.label.toLowerCase()}`}
          >
            <span className={cn("flex items-center gap-1 text-[10px] font-semibold", item.className)}>
              <item.icon className="size-3" />
              {labels && item.label}
            </span>
            <p className="font-display mt-1 text-lg leading-none font-bold tabular-nums">
              {formatNumber(engagement[item.key])}
            </p>
          </div>
        ))}
      </div>
      {emptyHint && total === 0 && (
        <p className="text-muted-foreground text-[10.5px]">{emptyHint}</p>
      )}
    </div>
  );
}
