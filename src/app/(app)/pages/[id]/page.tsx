import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  Clock3,
  ExternalLink,
  FileText,
  MessageCircle,
  PenSquare,
  Send,
  Share2,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusRing } from "@/components/shared/status-ring";
import { EngagementStats } from "@/components/shared/engagement-stats";
import { PublishingActivityChart } from "@/components/shared/activity-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { TargetAvatar } from "@/components/shared/target-avatar";
import { PostCard } from "@/components/posts/post-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/lib/data/dashboard";
import { listPosts } from "@/lib/data/posts";
import { getPageSummary } from "@/lib/data/targets";
import { encodeTarget } from "@/lib/validation";
import { formatInZone } from "@/lib/scheduling/timezone";

export const dynamic = "force-dynamic";

function formatRole(role: string | null) {
  if (!role) return null;
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function PageDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const summaryData = await getPageSummary(id);
  if (!summaryData) notFound();

  const { page, account, summary, demo } = summaryData;
  const target = encodeTarget(page.social_account_id, page.id);
  const [data, postsData] = await Promise.all([
    getDashboardData({ target }),
    listPosts({ target, limit: 60 }),
  ]);

  const timezone = data.timezone;
  const isFacebook = page.provider === "facebook";
  const platform = isFacebook ? "Facebook" : "LinkedIn";
  const role = formatRole(page.role);
  const profileUrl = page.vanity_name
    ? isFacebook
      ? `https://www.facebook.com/${page.vanity_name}`
      : `https://www.linkedin.com/company/${page.vanity_name}`
    : null;
  const pending = summary.counts.scheduled + summary.counts.processing;
  const engagementTotal =
    summary.engagement.likes + summary.engagement.comments + summary.engagement.shares;
  const lastSynced = postsData.posts.reduce<string | null>((latest, post) => {
    const synced = post.engagement_synced_at;
    if (!synced) return latest;
    return !latest || synced > latest ? synced : latest;
  }, null);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/pages">
            <ArrowLeft className="size-3.5" /> All pages
          </Link>
        </Button>
        <PageHeader
          eyebrow={
            <>
              {isFacebook ? "Facebook Page" : "LinkedIn company page"}
              {role ? ` · ${role}` : ""}
            </>
          }
          title={page.name}
          description={
            <>
              {account ? `Connected through ${account.display_name}. ` : ""}
              Only posts scheduled for this page are counted here. Engagement refreshes about every
              15 minutes.
            </>
          }
          actions={
            <>
              <TargetAvatar
                name={page.name}
                src={page.logo_url}
                type="organization"
                provider={page.provider}
                className="hidden size-11 sm:grid"
              />
              {profileUrl && (
                <Button asChild variant="outline">
                  <a href={profileUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" /> Open page
                  </a>
                </Button>
              )}
              <Button asChild variant="gradient">
                <Link href={`/composer?target=${encodeURIComponent(target)}`}>
                  <PenSquare className="size-4" /> New post
                </Link>
              </Button>
            </>
          }
        />
      </div>

      {!summary.canPublish && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            LINKFLOW can see this page but cannot publish to it yet. Reconnect the account with the
            right page role, or ask a page admin to grant you publishing access.
          </span>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Published"
          value={summary.counts.published}
          icon={Send}
          tone="emerald"
          hint="Live on the page"
        />
        <StatCard
          label="Pending"
          value={pending}
          icon={Clock3}
          tone="blue"
          hint="Scheduled or processing"
        />
        <StatCard
          label="Failed"
          value={summary.counts.failed}
          icon={TriangleAlert}
          tone={summary.counts.failed > 0 ? "red" : "slate"}
          hint={summary.counts.failed > 0 ? "Needs attention" : "All clear"}
        />
        <StatCard
          label="Engagements"
          value={engagementTotal}
          icon={Share2}
          tone="violet"
          hint="Likes + comments + shares"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Publishing activity</CardTitle>
              <CardDescription>Last 7 days in {timezone}</CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              {data.weeklyTarget} posts / week target
            </Badge>
          </CardHeader>
          <CardContent>
            <PublishingActivityChart data={data.activity} weeklyTarget={data.weeklyTarget} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Engagement</CardTitle>
            <CardDescription>Lifetime totals for published posts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EngagementStats engagement={summary.engagement} />
            <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-[11px]">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ThumbsUp className="size-3 text-blue-500" /> Likes
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MessageCircle className="size-3 text-violet-500" /> Comments
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Share2 className="size-3 text-emerald-500" /> Shares
              </span>
            </div>
            <div className="border-t border-border/60 pt-3">
              <StatusRing counts={data.counts} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Up next</CardTitle>
              <CardDescription>Queued for this page</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/posts?target=${encodeURIComponent(target)}&status=scheduled`}>
                View <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.upcoming.length === 0 ? (
              <EmptyState
                compact
                icon={CalendarRange}
                title="Nothing queued"
                description="Schedule a post for this page and it will appear here."
                actions={
                  <Button asChild size="sm" variant="gradient">
                    <Link href={`/composer?target=${encodeURIComponent(target)}`}>Write a post</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {data.upcoming.map((post) => (
                  <PostCard key={post.id} post={post} timezone={timezone} variant="row" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Recent publishing</CardTitle>
              <CardDescription>Latest attempts with engagement</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/posts?target=${encodeURIComponent(target)}`}>
                All posts <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.recent.length === 0 ? (
              <EmptyState
                compact
                icon={Send}
                title="Nothing published yet"
                description="Once this page publishes its first post, it shows up here with likes and comments."
              />
            ) : (
              <div className="space-y-2.5">
                {data.recent.map((post) => (
                  <PostCard key={post.id} post={post} timezone={timezone} variant="row" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display flex items-center gap-2 text-[15px] font-semibold">
              <FileText className="size-4 text-primary" /> All posts for {page.name}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-[11.5px]">
              {postsData.counts.all} post{postsData.counts.all === 1 ? "" : "s"} across every status.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/posts?target=${encodeURIComponent(target)}`}>
              Open in All posts <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        {postsData.posts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No posts for this page yet"
            description={`Write the first post for ${page.name} and LINKFLOW will publish it on schedule.`}
            actions={
              <Button asChild variant="gradient" size="sm">
                <Link href={`/composer?target=${encodeURIComponent(target)}`}>Write a post</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {postsData.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                timezone={timezone}
                mediaUrl={post.media ? postsData.signedMedia[post.media.storage_path] ?? null : null}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-muted-foreground text-[10.5px]">
        Last synced{" "}
        {lastSynced
          ? formatInZone(lastSynced, timezone, "MMM d, yyyy · h:mm a")
          : "—"}{" "}
        · {platform} API
      </p>

      {demo && (
        <div className="text-muted-foreground rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed">
          <span className="font-semibold text-amber-600 dark:text-amber-400">Demo data.</span> This
          page and its numbers are generated locally.
        </div>
      )}
    </div>
  );
}
