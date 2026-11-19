/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { Facebook, Globe2, MessageCircle, Share2, ThumbsUp } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn, initials } from "@/lib/utils";

function renderContent(content: string) {
  if (!content.trim()) {
    return (
      <p className="text-muted-foreground/70 italic">
        Your Facebook post preview will appear here as you type…
      </p>
    );
  }

  return content.split(/(\s+)/).map((token, index) => {
    if (/^#[\p{L}\p{N}_]+$/u.test(token)) {
      return (
        <span key={index} className="font-medium text-[#1877f2]">
          {token}
        </span>
      );
    }
    if (/^https?:\/\//i.test(token)) {
      return (
        <span key={index} className="text-[#1877f2] underline underline-offset-2">
          {token}
        </span>
      );
    }
    return <span key={index}>{token}</span>;
  });
}

export function FacebookPostPreview({
  content,
  authorName,
  authorHeadline = "Facebook Page",
  authorAvatar,
  imageUrl,
  timestamp = "Just now",
  isMock = false,
  className,
  compact = false,
}: {
  content: string;
  authorName: string;
  authorHeadline?: string;
  authorAvatar?: string | null;
  imageUrl?: string | null;
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
          <AvatarFallback className="bg-[#1877f2] text-[11px] font-bold text-white">
            {initials(authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-semibold">{authorName}</p>
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
          href="https://www.facebook.com"
          target="_blank"
          rel="noreferrer"
          className="grid size-6 place-items-center rounded-full bg-[#1877f2] text-white"
          aria-label="Facebook"
        >
          <Facebook className="size-3.5" />
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
        <div className="pb-3">
          <img
            src={imageUrl}
            alt="Post attachment"
            className="max-h-72 w-full object-cover"
          />
        </div>
      )}

      <div className="border-t border-border/60 px-4 py-2.5">
        <div className="text-muted-foreground flex items-center justify-between text-[10px]">
          <span className="flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-[#1877f2] text-white">
              <ThumbsUp className="size-2" />
            </span>
            0
          </span>
          <span>0 comments · 0 shares</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
          {[
            { icon: ThumbsUp, label: "Like" },
            { icon: MessageCircle, label: "Comment" },
            { icon: Share2, label: "Share" },
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
