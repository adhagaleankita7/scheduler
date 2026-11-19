import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PostCard } from "@/components/posts/post-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPosts, POST_STATUSES, type PostCounts } from "@/lib/data/posts";
import { requireSession } from "@/lib/session";
import type { PostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "All posts" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Drafts",
  scheduled: "Scheduled",
  processing: "Publishing",
  published: "Posted",
  failed: "Failed",
  cancelled: "Cancelled",
};

const EMPTY_COPY: Record<PostStatus | "all", { title: string; description: string }> = {
  all: {
    title: "No posts yet",
    description:
      "Write your first post in the composer, or plan a full month and let LINKFLOW publish one every day.",
  },
  draft: {
    title: "No drafts",
    description: "Drafts are posts you've written but not scheduled yet. Create one in the composer.",
  },
  scheduled: {
    title: "Nothing scheduled",
    description: "Plan a week from the 7-day planner, a month from the 30-day planner, or add a post straight to the queue.",
  },
  processing: {
    title: "Nothing publishing right now",
    description: "Posts appear here for the few seconds the publishing engine is delivering them.",
  },
  published: {
    title: "Nothing posted yet",
    description:
      "Once the engine publishes a post it appears here as Posted, with a link to the live post and its like/comment counts.",
  },
  failed: {
    title: "No failed posts",
    description: "Every publishing attempt either succeeded or is still queued. Nothing needs attention.",
  },
  cancelled: {
    title: "No cancelled posts",
    description: "Cancelled posts keep their content here so you can duplicate or retry them later.",
  },
};

function StatusTabs({
  status,
  counts,
  search,
}: {
  status: PostStatus | "all";
  counts: PostCounts;
  search?: string;
}) {
  const items: (PostStatus | "all")[] = ["all", ...POST_STATUSES];
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {items.map((item) => {
        const params = new URLSearchParams();
        if (item !== "all") params.set("status", item);
        if (search) params.set("q", search);
        const href = `/posts${params.toString() ? `?${params.toString()}` : ""}`;
        const active = status === item;
        return (
          <Link
            key={item}
            href={href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11.5px] font-semibold transition-all",
              active
                ? "border-primary/25 bg-primary/10 text-primary shadow-sm"
                : "border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground",
            )}
          >
            {item === "all" ? "All posts" : STATUS_LABELS[item]}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums",
                active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {counts[item] ?? 0}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const [session, params] = await Promise.all([requireSession(), searchParams]);
  const status: PostStatus | "all" =
    params.status && (POST_STATUSES as string[]).includes(params.status)
      ? (params.status as PostStatus)
      : "all";
  const search = params.q?.trim() || undefined;
  const data = await listPosts({ status, search, limit: 200 });
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const copy = EMPTY_COPY[status];

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <FileText className="size-3.5" />
            {data.counts.all} total
          </>
        }
        title="Every post, one place"
        description="Drafts, scheduled posts and full publishing history. Filter by status, search the text, and act on anything that needs attention."
        actions={
          <Button asChild variant="gradient">
            <Link href="/composer">
              <Plus className="size-4" /> New post
            </Link>
          </Button>
        }
      />

      <div className="mb-4 space-y-3">
        <StatusTabs status={status} counts={data.counts} search={search} />

        <form action="/posts" method="get" className="flex flex-wrap items-center gap-2">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search post content…"
              className="pl-9"
              aria-label="Search posts"
            />
          </div>
          <Button type="submit" variant="outline" size="default">
            Search
          </Button>
          {search && (
            <Button asChild variant="ghost" size="sm">
              <Link href={status === "all" ? "/posts" : `/posts?status=${status}`}>
                <X className="size-3.5" /> Clear
              </Link>
            </Button>
          )}
          {search && (
            <span className="text-muted-foreground text-[11px]">
              {data.posts.length} result{data.posts.length === 1 ? "" : "s"} for “{search}”
            </span>
          )}
        </form>
      </div>

      {data.posts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={copy.title}
          description={copy.description}
          actions={
            <>
              <Button asChild variant="gradient" size="sm">
                <Link href="/composer">Write a post</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/planner">Plan a week</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data.posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              timezone={timezone}
              mediaUrl={post.media ? data.signedMedia[post.media.storage_path] ?? null : null}
            />
          ))}
        </div>
      )}

      {data.demo && (
        <div className="text-muted-foreground mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed">
          <span className="font-semibold text-amber-600 dark:text-amber-400">Demo data.</span> These
          posts are generated locally and are read-only. Connect Supabase to manage real posts.
        </div>
      )}
    </div>
  );
}
