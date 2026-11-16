import { Building2, Linkedin } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";

export function TargetAvatar({
  name,
  src,
  type = "member",
  className,
}: {
  name: string;
  src?: string | null;
  type?: "member" | "organization";
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8 rounded-lg", className)}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback
        className={cn(
          "rounded-lg text-[10px] font-bold",
          type === "organization"
            ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
            : "brand-gradient text-white",
        )}
      >
        {type === "organization" ? <Building2 className="size-3.5" /> : initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function LinkedInMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-9 place-items-center rounded-xl bg-[#0a66c2] text-white shadow-[0_8px_20px_-8px_rgba(10,102,194,0.7)]",
        className,
      )}
    >
      <Linkedin className="size-4" />
    </span>
  );
}
