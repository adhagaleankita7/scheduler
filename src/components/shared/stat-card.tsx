import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";

const TONES = {
  blue: "from-blue-500/16 to-indigo-500/8 text-blue-600 dark:text-blue-300 border-blue-500/15",
  violet: "from-violet-500/16 to-fuchsia-500/8 text-violet-600 dark:text-violet-300 border-violet-500/15",
  emerald: "from-emerald-500/16 to-teal-500/8 text-emerald-600 dark:text-emerald-300 border-emerald-500/15",
  amber: "from-amber-500/16 to-orange-500/8 text-amber-600 dark:text-amber-300 border-amber-500/15",
  red: "from-red-500/16 to-rose-500/8 text-red-600 dark:text-red-300 border-red-500/15",
  slate: "from-slate-500/16 to-slate-400/8 text-slate-600 dark:text-slate-300 border-slate-500/15",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
  className,
  footer,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ElementType;
  tone?: keyof typeof TONES;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[11.5px] font-medium tracking-wide">{label}</p>
          <p className="font-display mt-1.5 text-[26px] leading-none font-bold tracking-[-0.04em] tabular-nums">
            {typeof value === "number" ? formatNumber(value) : value}
          </p>
          {hint && <p className="text-muted-foreground/80 mt-1.5 text-[11px]">{hint}</p>}
        </div>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border bg-gradient-to-br transition-transform duration-300 group-hover:scale-105",
            TONES[tone],
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      {footer && <div className="mt-3 border-t border-border/60 pt-2.5">{footer}</div>}
    </div>
  );
}
