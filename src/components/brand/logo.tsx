import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "brand-gradient relative grid size-9 shrink-0 place-items-center rounded-[11px] text-white shadow-[0_6px_18px_-6px_rgba(99,91,253,0.8)]",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5">
        <path
          d="M7 6.5h4.2a3.3 3.3 0 0 1 0 6.6H8.4l6.1 6.1"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />
        <circle cx="6.2" cy="6.5" r="2.2" fill="currentColor" />
        <circle cx="16.6" cy="19.2" r="2.2" fill="currentColor" />
        <circle cx="17.4" cy="9.2" r="1.7" fill="currentColor" opacity="0.75" />
      </svg>
    </span>
  );
}

export function Logo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      {!compact && (
        <span className="font-display text-[17px] leading-none font-extrabold tracking-[-0.03em]">
          LINK<span className="gradient-text">FLOW</span>
        </span>
      )}
    </span>
  );
}
