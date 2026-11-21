import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  Facebook,
  LayoutGrid,
  Linkedin,
  MessageCircle,
  Send,
  Share2,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { TargetAvatar } from "@/components/shared/target-avatar";
import { LocalTime } from "@/components/shared/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTargetAnalytics, type TargetSummary } from "@/lib/data/targets";
import { requireSession } from "@/lib/session";
import type { SocialPage } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Pages" };
export const dynamic = "force-dynamic";

function formatRole(role: string | null) {
  if (!role) return null;
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function PageCard({
  target,
  page,
  timezone,
}: {
  target: TargetSummary;
  page: SocialPage;
  timezone: string;
}) {
  const isFacebook = target.provider === "facebook";
  const PlatformIcon = isFacebook ? Facebook : Linkedin;
  const role = formatRole(page.role);

  return (
    <Link
      href={`/pages/${page.id}`}
      className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg"
    >
      <div className="flex items-start gap-3">
        <TargetAvatar
          name={target.label}
          src={target.avatarUrl}
          type="organization"
          provider={target.provider}
          className="size-11"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold">{target.label}</p>
            <PlatformIcon
              className={
                isFacebook ? "size-3 shrink-0 text-[#1877f2]" : "size-3 shrink-0 text-[#0a66c2]"
              }
            />
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {role ? `${role} · ` : ""}
            {isFacebook ? "Facebook Page" : "LinkedIn company page"}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            {target.canPublish ? (
              <Badge variant="success" className="px-1.5 py-0 text-[9px]">
                Ready to publish
              </Badge>
            ) : (
              <Badge variant="warning" className="px-1.5 py-0 text-[9px]">
                Read only
              </Badge>
            )}
            {page.vanity_name && (
              <span className="text-muted-foreground truncate text-[10px]">
                {isFacebook ? "facebook.com/" : "linkedin.com/company/"}
                {page.vanity_name}
              </span>
            )}
          </div>
        </div>
        <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2">
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
            <Send className="size-3" /> Published
          </span>
          <p className="font-display mt-1 text-lg leading-none font-bold tabular-nums">
            {formatNumber(target.counts.published)}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2">
          <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-300">
            <Clock3 className="size-3" /> Pending
          </span>
          <p className="font-display mt-1 text-lg leading-none font-bold tabular-nums">
            {formatNumber(target.counts.scheduled + target.counts.processing)}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2">
          <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 dark:text-red-300">
            <TriangleAlert className="size-3" /> Failed
          </span>
          <p className="font-display mt-1 text-lg leading-none font-bold tabular-nums">
            {formatNumber(target.counts.failed)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ThumbsUp className="size-3" /> {formatNumber(target.engagement.likes)}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <MessageCircle className="size-3" /> {formatNumber(target.engagement.comments)}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Share2 className="size-3" /> {formatNumber(target.engagement.shares)}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10.5px]">
          {target.lastPublishedAt ? (
            <>
              Last post{" "}
              <LocalTime
                iso={target.lastPublishedAt}
                timeZone={timezone}
                pattern="MMM d, h:mm a"
                className="font-medium"
              />
            </>
          ) : (
            "No posts yet"
          )}
        </span>
      </div>
    </Link>
  );
}

export default async function PagesPage() {
  const [session, { targets, pages, demo }] = await Promise.all([
    requireSession(),
    getTargetAnalytics(),
  ]);
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const items = targets
    .filter((target) => target.pageId)
    .map((target) => ({
      target,
      page: pages.find((page) => page.id === target.pageId),
    }))
    .filter((item): item is { target: TargetSummary; page: SocialPage } => Boolean(item.page));

  const published = items.reduce((sum, item) => sum + item.target.counts.published, 0);
  const pending = items.reduce(
    (sum, item) => sum + item.target.counts.scheduled + item.target.counts.processing,
    0,
  );

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <LayoutGrid className="size-3.5" />
            {items.length} {items.length === 1 ? "page" : "pages"}
          </>
        }
        title="One dashboard per page"
        description="Every Facebook Page and LinkedIn company page with its own numbers: posts published, posts waiting in the queue, failures and lifetime likes, comments and shares."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/composer">New post</Link>
            </Button>
            <Button asChild variant="gradient">
              <Link href="/accounts">Manage connections</Link>
            </Button>
          </>
        }
      />

      {items.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-card">
            <p className="text-muted-foreground text-[11px] font-medium">Published</p>
            <p className="font-display mt-1 text-2xl leading-none font-bold tabular-nums">
              {formatNumber(published)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-card">
            <p className="text-muted-foreground text-[11px] font-medium">Pending</p>
            <p className="font-display mt-1 text-2xl leading-none font-bold tabular-nums">
              {formatNumber(pending)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-card">
            <p className="text-muted-foreground text-[11px] font-medium">Likes</p>
            <p className="font-display mt-1 text-2xl leading-none font-bold tabular-nums">
              {formatNumber(items.reduce((sum, item) => sum + item.target.engagement.likes, 0))}
            </p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-card">
            <p className="text-muted-foreground text-[11px] font-medium">Comments</p>
            <p className="font-display mt-1 text-2xl leading-none font-bold tabular-nums">
              {formatNumber(items.reduce((sum, item) => sum + item.target.engagement.comments, 0))}
            </p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No pages connected yet"
          description="Connect Facebook Pages or LinkedIn company pages and each one gets its own dashboard here."
          actions={
            <Button asChild variant="gradient" size="sm">
              <Link href="/accounts">Connect a page</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map(({ target, page }) => (
            <PageCard key={page.id} target={target} page={page} timezone={timezone} />
          ))}
        </div>
      )}

      {demo && (
        <div className="text-muted-foreground mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed">
          <span className="font-semibold text-amber-600 dark:text-amber-400">Demo data.</span> This
          workspace is generated locally. Connect Supabase and your real pages to see live numbers.
        </div>
      )}
    </div>
  );
}
