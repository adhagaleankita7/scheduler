"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TargetAvatar } from "@/components/shared/target-avatar";
import type { SocialProvider, TargetType } from "@/lib/types";
import { cn } from "@/lib/utils";

export type TargetFilterOption = {
  value: string;
  label: string;
  subtitle?: string;
  provider: SocialProvider;
  targetType: TargetType;
  avatarUrl: string | null;
};

/**
 * Page/profile switcher for the dashboard and posts list. The selection lives
 * in the `?target=` query string so links, refresh and the back button all
 * keep the chosen page.
 */
export function TargetFilter({
  targets,
  allLabel = "All pages & profiles",
  ariaLabel = "Filter by page",
  className,
}: {
  targets: TargetFilterOption[];
  allLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const requested = searchParams.get("target") ?? "all";
  const value =
    requested === "all" || targets.some((target) => target.value === requested)
      ? requested
      : "all";
  const selected = targets.find((target) => target.value === value) ?? null;

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("target");
    else params.set("target", next);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select value={value} onValueChange={change} disabled={pending}>
        <SelectTrigger size="sm" aria-label={ariaLabel} className="w-[220px] gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <TargetAvatar
                name={selected.label}
                src={selected.avatarUrl}
                type={selected.targetType}
                provider={selected.provider}
                className="size-5"
              />
            ) : (
              <Layers className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <SelectValue placeholder={allLabel}>
              {selected ? selected.label : allLabel}
            </SelectValue>
          </span>
        </SelectTrigger>
        <SelectContent className="max-w-[min(92vw,26rem)]">
          <SelectItem value="all">
            <span className="flex items-center gap-2">
              <Layers className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-[12.5px] font-medium">{allLabel}</span>
            </span>
          </SelectItem>
          {targets.map((target) => (
            <SelectItem key={target.value} value={target.value} className="items-start py-2">
              <span className="flex w-full items-start gap-2">
                <TargetAvatar
                  name={target.label}
                  src={target.avatarUrl}
                  type={target.targetType}
                  provider={target.provider}
                  className="mt-0.5 size-6"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{target.label}</span>
                  {target.subtitle && (
                    <span className="text-muted-foreground block truncate text-[10.5px]">
                      {target.subtitle}
                    </span>
                  )}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}
