import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PostStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  PostStatus,
  { label: string; variant: "muted" | "info" | "violet" | "success" | "danger" | "outline"; icon: typeof Clock3 }
> = {
  draft: { label: "Draft", variant: "muted", icon: CircleDashed },
  scheduled: { label: "Scheduled", variant: "info", icon: Clock3 },
  processing: { label: "Publishing", variant: "violet", icon: Loader2 },
  published: { label: "Published", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "danger", icon: TriangleAlert },
  cancelled: { label: "Cancelled", variant: "outline", icon: Ban },
};

export function StatusBadge({ status }: { status: PostStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1 py-1">
      <Icon className={status === "processing" ? "animate-spin" : ""} />
      {config.label}
    </Badge>
  );
}

export const STATUS_DOT: Record<PostStatus, string> = {
  draft: "bg-muted-foreground/45",
  scheduled: "bg-blue-500",
  processing: "bg-violet-500",
  published: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-slate-400",
};

export function StatusDot({ status }: { status: PostStatus }) {
  return (
    <span className={`inline-block size-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
  );
}
