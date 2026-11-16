import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/12 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-emerald-500/20 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        warning: "border-amber-500/25 bg-amber-500/12 text-amber-600 dark:text-amber-400",
        danger: "border-red-500/25 bg-red-500/12 text-red-600 dark:text-red-400",
        info: "border-blue-500/25 bg-blue-500/12 text-blue-600 dark:text-blue-400",
        violet: "border-violet-500/25 bg-violet-500/12 text-violet-600 dark:text-violet-300",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
