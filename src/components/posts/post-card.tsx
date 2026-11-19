"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  ThumbsUp,
  Trash2,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/status-badge";
import { LocalTime } from "@/components/shared/local-time";
import {
  cancelPost,
  deletePost,
  reschedulePost,
  retryPost,
} from "@/lib/actions/posts";
import { toZonedInputValue, zonedInputToIso } from "@/lib/scheduling/timezone";
import type { PostWithRelations } from "@/lib/types";
import { cn, formatNumber, initials, truncate } from "@/lib/utils";

function TargetLine({ post }: { post: PostWithRelations }) {
  const isOrg = post.target_type === "organization";
  const isFacebook = post.account?.provider === "facebook";
  const name = isOrg ? post.page?.name : post.account?.display_name;
  const avatar = isOrg ? post.page?.logo_url : post.account?.avatar_url;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6 rounded-md">
        {avatar ? <AvatarImage src={avatar} alt="" /> : null}
        <AvatarFallback
          className={cn(
            "rounded-md text-[9px] font-bold",
            isFacebook
              ? "bg-[#1877f2] text-white"
              : isOrg
                ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                : "brand-gradient text-white",
          )}
        >
          {isFacebook ? "f" : isOrg ? "in" : initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-[11.5px] font-medium">{name ?? "Publishing target"}</span>
      <Badge
        variant={isFacebook ? "default" : "violet"}
        className="shrink-0 px-1.5 py-0 text-[9px]"
      >
        {isFacebook ? "Facebook" : "Page"}
      </Badge>
    </div>
  );
}

export function PostCard({
  post,
  timezone,
  mediaUrl,
  variant = "card",
  className,
}: {
  post: PostWithRelations;
  timezone: string;
  mediaUrl?: string | null;
  variant?: "card" | "row";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [when, setWhen] = useState(() =>
    toZonedInputValue(
      post.scheduled_for ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      timezone,
    ),
  );

  const editable = ["draft", "scheduled", "failed", "cancelled"].includes(post.status);

  function run(name: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setAction(name);
    startTransition(async () => {
      const result = await fn();
      setAction(null);
      if (result.ok) {
        toast.success(result.message ?? "Done");
        setRescheduleOpen(false);
        setDeleteOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  function submitReschedule() {
    const iso = zonedInputToIso(when, timezone);
    if (!iso) {
      toast.error("Choose a valid date and time.");
      return;
    }
    run("reschedule", () => reschedulePost(post.id, iso));
  }

  const scheduleLabel = post.published_at
    ? "Posted"
    : post.scheduled_for
      ? "Scheduled for"
      : "Created";
  const providerLabel = post.account?.provider === "facebook" ? "Facebook" : "LinkedIn";

  return (
    <article
      className={cn(
        "group relative rounded-2xl border border-border/80 bg-card shadow-card transition-all duration-200 hover:border-primary/20",
        variant === "card" ? "p-4 sm:p-5" : "p-3.5",
        className,
      )}
    >
      {pending && (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-card/60 backdrop-blur-[1px]">
          <Loader2 className="size-4 animate-spin text-primary" />
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <TargetLine post={post} />
        <div className="flex shrink-0 items-center gap-1.5">
          {post.is_mock && (
            <Badge variant="warning" className="px-1.5 py-0 text-[9px]">
              Mock
            </Badge>
          )}
          <StatusBadge status={post.status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Post actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Post actions</DropdownMenuLabel>
              {editable && (
                <DropdownMenuItem asChild>
                  <Link href={`/composer?post=${post.id}`}>
                    <Pencil /> Edit post
                  </Link>
                </DropdownMenuItem>
              )}
              {(post.status === "scheduled" || post.status === "failed") && (
                <DropdownMenuItem onSelect={() => setRescheduleOpen(true)}>
                  <CalendarClock /> Reschedule
                </DropdownMenuItem>
              )}
              {(post.status === "failed" || post.status === "cancelled") && (
                <DropdownMenuItem onSelect={() => run("retry", () => retryPost(post.id))}>
                  <RotateCcw /> Retry now
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link href={`/composer?duplicate=${post.id}`}>
                  <Copy /> Duplicate
                </Link>
              </DropdownMenuItem>
              {post.provider_post_url && (
                <DropdownMenuItem asChild>
                  <a href={post.provider_post_url} target="_blank" rel="noreferrer">
                    <ExternalLink /> View post
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {editable && (
                <DropdownMenuItem onSelect={() => run("cancel", () => cancelPost(post.id))}>
                  <XCircle /> Cancel post
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p
        className={cn(
          "mt-3 whitespace-pre-wrap break-words text-foreground/90",
          variant === "card" ? "line-clamp-4 text-[12.5px] leading-relaxed" : "line-clamp-2 text-[12px] leading-snug",
        )}
      >
        {post.content}
      </p>

      {mediaUrl && variant === "card" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl}
          alt=""
          className="mt-3 max-h-44 w-full rounded-lg border border-border/60 object-cover"
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3" />
          {scheduleLabel}{" "}
          <LocalTime
            iso={post.published_at ?? post.scheduled_for}
            timeZone={timezone}
            pattern="MMM d · h:mm a"
            className="font-medium text-foreground/80"
          />
        </span>
        {post.status === "published" && (
          <>
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              title={`${post.like_count} like${post.like_count === 1 ? "" : "s"} · updated every ~15 minutes`}
            >
              <ThumbsUp className="size-3" /> {formatNumber(post.like_count)}
            </span>
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              title={`${post.comment_count} comment${post.comment_count === 1 ? "" : "s"} · updated every ~15 minutes`}
            >
              <MessageCircle className="size-3" /> {formatNumber(post.comment_count)}
            </span>
            {post.share_count > 0 && (
              <span
                className="inline-flex items-center gap-1 tabular-nums"
                title={`${post.share_count} share${post.share_count === 1 ? "" : "s"}`}
              >
                <Share2 className="size-3" /> {formatNumber(post.share_count)}
              </span>
            )}
            {post.provider_post_url && (
              <a
                href={post.provider_post_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 font-semibold hover:underline"
              >
                View on {providerLabel} <ExternalLink className="size-3" />
              </a>
            )}
          </>
        )}
        {post.status === "failed" && post.attempt_count > 0 && (
          <span className="text-destructive/90">
            {post.attempt_count}/{post.max_attempts} attempts
          </span>
        )}
        {post.last_error && post.status === "failed" && (
          <span className="w-full truncate text-[10.5px] text-destructive/80" title={post.last_error}>
            {truncate(post.last_error, 120)}
          </span>
        )}
      </div>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule this post</DialogTitle>
            <DialogDescription>
              Time shown in {timezone}. LINKFLOW stores every schedule in UTC.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`when-${post.id}`}>New date &amp; time</Label>
            <Input
              id={`when-${post.id}`}
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={submitReschedule} disabled={pending}>
              {pending && action === "reschedule" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This permanently removes the post and its attached image from your workspace. Posts
              already published to LinkedIn or Facebook are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => run("delete", () => deletePost(post.id))}
              disabled={pending}
            >
              <Trash2 className="size-4" /> Delete post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
