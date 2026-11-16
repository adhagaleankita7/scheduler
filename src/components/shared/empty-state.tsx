import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  compact = false,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  actions?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 dot-bg opacity-[0.35]" />
      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <div className="brand-gradient-soft mb-4 grid size-12 place-items-center rounded-2xl border border-primary/15 text-primary shadow-sm">
          <Icon className="size-5" />
        </div>
        <h3 className="font-display text-[15px] font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">{description}</p>
        {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
