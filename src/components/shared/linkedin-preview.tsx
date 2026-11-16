/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { Globe2, MessageCircle, Repeat2, Send, ThumbsUp } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn, initials } from "@/lib/utils";

function renderContent(content: string) {
  if (!content.trim()) {
    return (
      <p className="text-muted-foreground/70 italic">
        Your post preview will appear here as you type…
      </p>
    );
  }

  return content.split(/(\s+)/).map((token, index) => {
    if (/^#[\p{L}\p{N}_]+$/u.test(token)) {
      return (
        <span key={index} className="text-primary font-medium">
          {token}
        </span>
      );
    }
    if (/^https?:\/\//i.test(token)) {
      return (
        <span key={index} className="text-primary underline decoration-primary/30 underline-offset-2">
          {token}
        </span>
      );
    }
    return <span key={index}>{token}</span>;
  });
}

export function LinkedInPostPreview({
  content,
  authorName,
  authorHeadline = "LinkedIn member",
  authorAvatar,
  imageUrl,
  targetType = "member",
  timestamp = "Now",
  isMock = false,
  className,
  compact = false,
}: {
  content: string;
  authorName: string;
  authorHeadline?: string;
  authorAvatar?: string | null;
  imageUrl?: string | null;
  targetType?: "member" | "organization";
  timestamp?: string;
  isMock?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card shadow-card",
        className,
      )}
    >
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <Avatar className="size-11">
          {authorAvatar ? <AvatarImage src={authorAvatar} alt="" /> : null}
          <AvatarFallback className="brand-gradient text-[11px] font-bold text-white">
            {initials(authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-semibold">{authorName}</p>
            {targetType === "organization" && (
              <Badge variant="violet" className="hidden px-1.5 py-0 text-[9px] sm:inline-flex">
                Page
              </Badge>
            )}
            {isMock && (
              <Badge variant="warning" className="px-1.5 py-0 text-[9px]">
                MOCK
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground truncate text-[10.5px]">{authorHeadline}</p>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[10px]">
            {timestamp} · <Globe2 className="size-2.5" />
          </p>
        </div>
        <Link
          href="https://www.linkedin.com"
          target="_blank"
          rel="noreferrer"
          className="grid size-6 place-items-center rounded bg-[#0a66c2] text-[10px] font-bold text-white"
          aria-label="LinkedIn"
        >
          in
        </Link>
      </div>

      <div
        className={cn(
          "px-4 py-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words text-foreground/90",
          compact ? "max-h-40 overflow-hidden" : "",
        )}
      >
        {renderContent(content)}
      </div>

      {imageUrl && (
        <div className="px-4 pb-3">
          <img
            src={imageUrl}
            alt="Post attachment"
            className="max-h-72 w-full rounded-lg border border-border/60 object-cover"
          />
        </div>
      )}

      <div className="border-t border-border/60 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[10.5px]">
            <span className="grid size-4 place-items-center rounded-full bg-[#0a66c2] text-white">
              <ThumbsUp className="size-2" />
            </span>
            <span>Be the first to react</span>
          </div>
          <span className="text-muted-foreground text-[10px]">0 comments · 0 reposts</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
          {[
            { icon: ThumbsUp, label: "Like" },
            { icon: MessageCircle, label: "Comment" },
            { icon: Repeat2, label: "Repost" },
            { icon: Send, label: "Send" },
          ].map((item) => (
            <span
              key={item.label}
              className="text-muted-foreground flex items-center gap-1.5 rounded px-1.5 py-1 text-[10.5px] font-medium"
            >
              <item.icon className="size-3.5" />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
