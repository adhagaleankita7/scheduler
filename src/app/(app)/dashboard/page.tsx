import Link from "next/link";
import {
  ArrowRight,
  CalendarPlus,
  CalendarRange,
  Clock3,
  FileText,
  Send,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusRing } from "@/components/shared/status-ring";
import { PublishingActivityChart } from "@/components/shared/activity-chart";
import { PostCard } from "@/components/posts/post-card";
import { EmptyState } from "@/components/shared/empty-state";
import { LocalTime, Countdown } from "@/components/shared/local-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDashboardData } from "@/lib/data/dashboard";
import { requireSession } from "@/lib/session";
import { formatInZone } from "@/lib/scheduling/timezone";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [session, data] = await Promise.all([requireSession(), getDashboardData()]);
  const timezone = data.timezone;
  const firstName = session.profile.full_name?.split(" ")[0] ?? "there";
  const hour = Number(formatInZone(new Date(), timezone, "H"));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = formatInZone(new Date(), timezone, "EEEE, MMMM d");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {today}
          </>
        }
        title={`${greeting}, ${firstName}`}
        description="Here's how your LinkedIn publishing is going. The engine runs on its own — you just keep the ideas coming."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/composer">
                <CalendarPlus className="size-4" /> New post
              </Link>
            </Button>
            <Button asChild variant="gradient">
              <Link href="/planner">
                Plan my week <ArrowRight className="size-4" />
              </Link>
            </Button>
          </>
        }
      />

      {/* Hero: next post */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.09] via-brand-violet/[0.06] to-transparent p-5 sm:p-6">
        <div className="pointer-events-none absolute -top-16 right-0 size-64 rounded-full bg-brand-violet/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-card/70 px-2.5 py-1 text-[10.5px] font-semibold text-primary">
              <Clock3 className="size-3" /> Next scheduled post
            </div>
            {data.nextPost ? (
              <>
                <p className="max-w-2xl text-[15px] leading-snug font-semibold sm:text-[17px]">
                  {data.nextPost.content.split("\n")[0].slice(0, 160)}
                </p>
                <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <span className="inline-flex items-center gap-1.5">
                    <LocalTime
                      iso={data.nextPost.scheduled_for}
                      timeZone={timezone}
                      pattern="EEEE, MMM d · h:mm a"
                      className="font-medium text-foreground/85"
                    />
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                  <Countdown iso={data.nextPost.scheduled_for} className="font-medium text-primary" />
                  <span className="text-muted-foreground/60">·</span>
                  <span>
                    {data.nextPost.target_type === "organization"
                      ? data.nextPost.page?.name ?? "Company page"
                      : data.nextPost.account?.display_name ?? "Personal profile"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="font-display text-lg font-semibold">Nothing queued yet</p>
                <p className="text-muted-foreground mt-1 max-w-lg text-[12.5px]">
                  Write thirty posts in one sitting and LINKFLOW will publish one every day at your
                  chosen time — even while you&apos;re offline.
                </p>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.nextPost ? (
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/calendar">
                  <CalendarRange className="size-4" /> View calendar
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="gradient">
              <Link href="/planner/month">
                <Sparkles className="size-4" /> Plan a 30-day month
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Total posts" value={data.counts.total} icon={FileText} tone="slate" hint="All time" />
        <StatCard
          label="Scheduled"
          value={data.counts.scheduled}
          icon={Clock3}
          tone="blue"
          hint={data.nextPost ? "Waiting in queue" : "Queue is empty"}
        />
        <StatCard
          label="Published"
          value={data.counts.published}
          icon={Send}
          tone="emerald"
          hint="Delivered to LinkedIn"
        />
        <StatCard label="Drafts" value={data.counts.draft} icon={FileText} tone="violet" hint="Not scheduled yet" />
        <StatCard
          label="Failed"
          value={data.counts.failed}
          icon={TriangleAlert}
          tone={data.counts.failed > 0 ? "red" : "slate"}
          hint={data.counts.failed > 0 ? "Needs attention" : "All clear"}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Weekly publishing activity</CardTitle>
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
            <CardTitle>Post mix</CardTitle>
            <CardDescription>Where everything stands right now</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <StatusRing counts={data.counts} />
            {data.counts.failed > 0 && (
              <Link
                href="/posts?status=failed"
                className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/[0.06] px-3 py-2.5 text-[11.5px] text-destructive transition-colors hover:bg-destructive/10"
              >
                <XCircle className="size-3.5 shrink-0" />
                <span className="flex-1">
                  {data.counts.failed} post{data.counts.failed === 1 ? "" : "s"} need attention
                </span>
                <ArrowRight className="size-3.5" />
              </Link>
            )}
            <div className="text-muted-foreground rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed">
              <span className="font-semibold text-foreground/80">Publishing engine:</span> runs every
              minute via Supabase Cron. Paused queues hold posts and resume exactly where they left
              off.
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Upcoming + recent */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Up next</CardTitle>
              <CardDescription>Your next five scheduled posts</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/queue">
                Queue <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.upcoming.length === 0 ? (
              <EmptyState
                compact
                icon={Clock3}
                title="No scheduled posts"
                description="Your queue is empty. Plan a month of posts and they'll publish automatically."
                actions={
                  <Button asChild size="sm" variant="gradient">
                    <Link href="/planner/month">Plan my month</Link>
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
              <CardDescription>Every attempt is logged</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/posts">
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
                description="Once the engine publishes your first post, its full history appears here."
              />
            ) : (
              <div className="space-y-2.5">
                {data.recent.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    timezone={timezone}
                    variant="row"
                    mediaUrl={null}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {session.demo && (
        <div className="text-muted-foreground rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[11.5px] leading-relaxed">
          <span className="font-semibold text-amber-600 dark:text-amber-400">Demo workspace.</span>{" "}
          This data is generated locally so you can explore the interface. Connect Supabase and sign
          in to publish for real — see the{" "}
          <Link href="/setup" className="font-medium underline">
            setup guide
          </Link>
          .
        </div>
      )}
    </div>
  );
}
