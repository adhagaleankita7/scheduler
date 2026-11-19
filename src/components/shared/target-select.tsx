"use client";

import { Building2, Facebook, Linkedin, UserRound } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PublishTargetOption } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TargetSelect({
  targets,
  value,
  onChange,
  disabled,
  size = "default",
  placeholder = "Choose a publishing target",
}: {
  targets: PublishTargetOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  placeholder?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size={size} aria-label="Publishing target">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-w-[min(92vw,26rem)]">
        {targets.map((target) => {
          const isFacebook = target.platform === "facebook";
          return (
            <SelectItem
              key={target.value}
              value={target.value}
              disabled={!target.canPublish}
              className="items-start py-2"
            >
              <span className="flex w-full items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md",
                    target.targetType === "organization"
                      ? isFacebook
                        ? "bg-[#1877f2]/12 text-[#1877f2]"
                        : "bg-violet-500/12 text-violet-600 dark:text-violet-300"
                      : "bg-primary/12 text-primary",
                  )}
                >
                  {target.targetType === "organization" ? (
                    isFacebook ? (
                      <Facebook className="size-3" />
                    ) : (
                      <Building2 className="size-3" />
                    )
                  ) : (
                    <UserRound className="size-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="block truncate text-[12.5px] font-medium">{target.label}</span>
                    {target.platform === "linkedin" ? (
                      <Linkedin className="size-2.5 shrink-0 text-[#0a66c2]" />
                    ) : (
                      <Facebook className="size-2.5 shrink-0 text-[#1877f2]" />
                    )}
                  </span>
                  <span className="text-muted-foreground block truncate text-[10.5px]">
                    {target.canPublish ? target.subtitle : target.disabledReason ?? target.subtitle}
                  </span>
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
