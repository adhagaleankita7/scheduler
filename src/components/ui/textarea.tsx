import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground/70 flex min-h-24 w-full rounded-xl border bg-card px-3.5 py-3 text-sm shadow-[0_1px_1px_rgba(16,24,40,0.03)] transition-[color,box-shadow,border-color] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "field-sizing-content resize-y",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
