import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  Check,
  ChevronRight,
  Clock3,
  FlaskConical,
  KeyRound,
  Layers3,
  Linkedin,
  LockKeyhole,
  Play,
  Quote,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/session";

const FEATURES = [
  {
    icon: CalendarRange,
    title: "A 7-day planner that thinks ahead",
    description:
      "Draft seven posts once, assign each day a time, and publish the whole week in one click. No spreadsheets, no reminders.",
    tone: "from-blue-500/15 to-indigo-500/5 text-blue-600 dark:text-blue-300",
  },
  {
    icon: TimerReset,
    title: "Publishes while you're offline",
    description:
      "Supabase Cron wakes the publishing engine every minute. Your laptop can be closed — the queue keeps moving.",
    tone: "from-violet-500/15 to-fuchsia-500/5 text-violet-600 dark:text-violet-300",
  },
  {
    icon: Clock3,
    title: "Buffer-style queue",
    description:
      "Set your weekly slots once. Every new post flows into the next open time automatically, in Asia/Kolkata or any timezone.",
    tone: "from-emerald-500/15 to-teal-500/5 text-emerald-600 dark:text-emerald-300",
  },
  {
    icon: Linkedin,
    title: "Profiles and company pages",
    description:
      "Publish as yourself or an authorized LinkedIn Company Page, with role and permission checks before anything goes live.",
    tone: "from-sky-500/15 to-blue-500/5 text-sky-600 dark:text-sky-300",
  },
  {
    icon: ShieldCheck,
    title: "Tokens locked in Supabase Vault",
    description:
      "OAuth tokens never touch the browser, localStorage or your logs. Row Level Security keeps every workspace isolated.",
    tone: "from-amber-500/15 to-orange-500/5 text-amber-600 dark:text-amber-300",
  },
  {
    icon: RefreshCw,
    title: "Retries that know when to stop",
    description:
      "Rate limits and LinkedIn outages retry with exponential backoff. Permission errors fail fast with a clear fix.",
    tone: "from-rose-500/15 to-red-500/5 text-rose-600 dark:text-rose-300",
  },
];

const WEEK = [
  { day: "Mon", date: "10", title: "Consistency compounds", time: "10:00 AM", status: "Published" },
  { day: "Tue", date: "11", title: "Specific beats polished", time: "10:00 AM", status: "Published" },
  { day: "Wed", date: "12", title: "Your page isn't a brochure", time: "10:00 AM", status: "Published" },
  { day: "Thu", date: "13", title: "Distribution is usefulness", time: "10:00 AM", status: "Scheduled" },
  { day: "Fri", date: "14", title: "Protect the human voice", time: "10:00 AM", status: "Scheduled" },
  { day: "Sat", date: "15", title: "Drop to one post a day", time: "10:00 AM", status: "Scheduled" },
  { day: "Sun", date: "16", title: "Show up when it's inconvenient", time: "10:00 AM", status: "Scheduled" },
];

const STEPS = [
  {
    number: "01",
    title: "Connect LinkedIn",
    description:
      "Authorize your profile or company page through official LinkedIn OAuth. Tokens are stored server-side in Vault.",
  },
  {
    number: "02",
    title: "Write your week",
    description:
      "Seven prompts, seven days, one fixed time. Preview every post exactly as LinkedIn will render it.",
  },
  {
    number: "03",
    title: "Close the laptop",
    description:
      "LINKFLOW claims each due post, publishes through the LinkedIn Posts API and logs every attempt.",
  },
];

export default async function LandingPage() {
  const session = await getSessionContext();
  const primaryHref = session ? "/dashboard" : "/signup";

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[760px] overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(99,91,253,0.22),transparent_65%)] blur-2xl" />
        <div className="absolute top-24 -left-24 size-[360px] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute top-40 -right-32 size-[420px] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute inset-0 grid-bg opacity-40 mask-fade-b" />
      </div>

      <header className="relative z-20">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="LINKFLOW home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-[13px] font-medium text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#workflow" className="transition-colors hover:text-foreground">Workflow</a>
            <a href="#security" className="transition-colors hover:text-foreground">Security</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session ? (
              <Button asChild size="sm" variant="gradient">
                <Link href="/dashboard">
                  Open dashboard <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm" variant="gradient">
                  <Link href="/signup">
                    Start free <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/70 py-1 pr-3 pl-1 text-[11.5px] font-medium shadow-sm backdrop-blur">
            <span className="brand-gradient rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-wider text-white uppercase">
              New
            </span>
            <Sparkles className="size-3.5 text-primary" />
            <span>Built for the 7-day LinkedIn workflow</span>
            <ChevronRight className="size-3 text-muted-foreground" />
          </div>

          <h1 className="font-display animate-fade-up mt-6 text-balance text-[42px] leading-[1.03] font-extrabold tracking-[-0.045em] sm:text-6xl lg:text-[68px]">
            Your LinkedIn week,
            <br />
            <span className="gradient-text">published on autopilot.</span>
          </h1>

          <p className="animate-fade-up mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            Write seven posts in one sitting. LINKFLOW queues them, publishes one every day at
            10:00 AM, and shows you exactly what happened — even when your laptop is off.
          </p>

          <div className="animate-fade-up mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="gradient" className="h-12 w-full px-7 sm:w-auto">
              <Link href={primaryHref}>
                Plan my first week <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 w-full bg-card/70 px-6 sm:w-auto">
              <a href="#workflow">
                <Play className="size-4" /> See how it works
              </a>
            </Button>
          </div>

          <div className="animate-fade-up mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-500" /> No credit card</span>
            <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-500" /> Official LinkedIn API</span>
            <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-500" /> Asia/Kolkata by default</span>
          </div>
        </div>

        {/* Product mockup */}
        <div className="animate-fade-up relative mx-auto mt-14 max-w-5xl" style={{ animationDelay: "120ms" }}>
          <div className="brand-gradient absolute -inset-x-8 -top-4 bottom-0 rounded-[36px] opacity-[0.09] blur-2xl" />
          <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/80 p-2 shadow-2xl backdrop-blur-xl sm:rounded-[22px] sm:p-3">
            <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
              <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
                <div className="flex gap-1.5">
                  <span className="size-2 rounded-full bg-red-400/70" />
                  <span className="size-2 rounded-full bg-amber-400/70" />
                  <span className="size-2 rounded-full bg-emerald-400/70" />
                </div>
                <div className="mx-auto flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-3 py-1 text-[9.5px] text-muted-foreground">
                  <LockKeyhole className="size-2.5" /> app.linkflow.io/dashboard
                </div>
              </div>

              <div className="grid gap-0 sm:grid-cols-[180px_1fr]">
                <div className="hidden border-r border-border/70 p-3 sm:block">
                  <Logo className="scale-90 origin-left" />
                  <div className="mt-4 space-y-1">
                    {["Dashboard", "Composer", "7-day planner", "Calendar", "Queue", "All posts"].map((item, index) => (
                      <div
                        key={item}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] font-medium ${
                          index === 0 ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span className={`size-3 rounded-sm ${index === 0 ? "brand-gradient" : "bg-muted"}`} />
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 rounded-lg border border-primary/15 bg-primary/5 p-2.5">
                    <p className="text-[9px] font-semibold">Plan a full week</p>
                    <p className="mt-1 text-[8.5px] leading-relaxed text-muted-foreground">
                      Seven posts. One click. Zero daily admin.
                    </p>
                  </div>
                </div>

                <div className="p-3 sm:p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold tracking-tight">Good morning, Aarav</p>
                      <p className="text-[9px] text-muted-foreground">Your next post goes live in 3h 24m</p>
                    </div>
                    <span className="brand-gradient rounded-lg px-2.5 py-1.5 text-[9px] font-semibold text-white">
                      + New post
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: "Scheduled", value: "7", tone: "text-blue-500" },
                      { label: "Published", value: "24", tone: "text-emerald-500" },
                      { label: "Drafts", value: "3", tone: "text-slate-400" },
                      { label: "Failed", value: "0", tone: "text-red-500" },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-border/70 bg-card p-2">
                        <p className="text-[8px] text-muted-foreground">{stat.label}</p>
                        <p className={`font-display text-[17px] font-bold ${stat.tone}`}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 rounded-lg border border-border/70 bg-card p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold">This week</p>
                      <span className="text-[8px] text-muted-foreground">6 of 7 published</span>
                    </div>
                    <div className="mt-3 flex h-[86px] items-end gap-2">
                      {[55, 72, 62, 88, 68, 94, 78].map((height, index) => (
                        <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                          <div className="flex h-full w-full items-end gap-0.5">
                            <div className="h-full w-full rounded-sm bg-blue-500/20" style={{ height: `${height * 0.8}%` }} />
                            <div
                              className="w-full rounded-sm bg-gradient-to-t from-emerald-500 to-teal-400"
                              style={{ height: `${index < 6 ? height : height * 0.2}%` }}
                            />
                          </div>
                          <span className="text-[7px] text-muted-foreground">{["M", "T", "W", "T", "F", "S", "S"][index]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/70 bg-card p-2.5">
                      <p className="text-[8px] text-muted-foreground">Next scheduled</p>
                      <p className="mt-1 line-clamp-2 text-[9.5px] font-medium leading-snug">
                        The best LinkedIn post took 11 minutes. It wasn&apos;t clever — it was specific.
                      </p>
                      <div className="mt-2 flex items-center gap-1 text-[8px] text-muted-foreground">
                        <Clock3 className="size-2.5" /> Today · 10:00 AM
                        <Badge className="ml-auto px-1 py-0 text-[7px]">Scheduled</Badge>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-card p-2.5">
                      <p className="text-[8px] text-muted-foreground">Recent publishing</p>
                      {[
                        ["Consistency compounds", "Published", "text-emerald-500"],
                        ["Specific beats polished", "Published", "text-emerald-500"],
                        ["Your page isn't a brochure", "Published", "text-emerald-500"],
                      ].map(([title, status, tone]) => (
                        <div key={title} className="mt-1.5 flex items-center gap-1.5">
                          <span className={`size-1 rounded-full ${tone.replace("text-", "bg-")}`} />
                          <span className="truncate text-[8px]">{title}</span>
                          <span className={`ml-auto text-[7px] ${tone}`}>{status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="animate-float absolute -right-4 top-24 hidden rounded-xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur lg:block">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/12 text-emerald-500">
                <BadgeCheck className="size-3.5" />
              </span>
              <div>
                <p className="text-[9.5px] font-semibold">Published automatically</p>
                <p className="text-[8px] text-muted-foreground">Today · 10:00 AM IST</p>
              </div>
            </div>
          </div>

          <div className="animate-float absolute -left-5 bottom-20 hidden rounded-xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur lg:block" style={{ animationDelay: "1.4s" }}>
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-violet-500/12 text-violet-500">
                <Zap className="size-3.5" />
              </span>
              <div>
                <p className="text-[9.5px] font-semibold">7 posts queued</p>
                <p className="text-[8px] text-muted-foreground">One every day at 10:00</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] font-medium text-muted-foreground/80">
          <span className="inline-flex items-center gap-1.5"><Linkedin className="size-3.5" /> Official LinkedIn API</span>
          <span className="inline-flex items-center gap-1.5"><Layers3 className="size-3.5" /> Supabase Postgres + RLS</span>
          <span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" /> Vault-encrypted tokens</span>
          <span className="inline-flex items-center gap-1.5"><FlaskConical className="size-3.5" /> Mock mode for testing</span>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4 border-primary/20 bg-primary/5 text-primary">
            Everything you need, nothing you don&apos;t
          </Badge>
          <h2 className="font-display text-balance text-3xl font-bold tracking-[-0.035em] sm:text-[40px]">
            Built for people who&apos;d rather write than
            <span className="gradient-text"> babysit a scheduler.</span>
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
            A focused tool with a real publishing engine underneath — not another analytics dashboard
            with a compose box bolted on.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-xl sm:p-6"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className={`mb-4 grid size-10 place-items-center rounded-xl bg-gradient-to-br ${feature.tone}`}>
                <feature.icon className="size-[18px]" />
              </div>
              <h3 className="font-display text-[15px] font-semibold tracking-tight">{feature.title}</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Weekly workflow */}
      <section id="workflow" className="relative z-10 border-y border-border/70 bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Badge variant="outline" className="mb-4 border-primary/20 bg-primary/5 text-primary">
                The 7-day workflow
              </Badge>
              <h2 className="font-display text-balance text-3xl font-bold tracking-[-0.035em] sm:text-[40px]">
                One planning session.<br />
                <span className="gradient-text">Seven days of presence.</span>
              </h2>
              <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
                The hardest part of LinkedIn is showing up tomorrow. LINKFLOW turns a single burst of
                inspiration into a week of consistent, on-time publishing.
              </p>

              <div className="mt-8 space-y-5">
                {STEPS.map((step) => (
                  <div key={step.number} className="flex gap-4">
                    <div className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-glow">
                      {step.number}
                    </div>
                    <div>
                      <h3 className="text-[14px] font-semibold">{step.title}</h3>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="brand-gradient absolute -inset-4 rounded-[32px] opacity-[0.08] blur-2xl" />
              <div className="relative rounded-2xl border border-border/80 bg-card p-4 shadow-2xl sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold">Next week</p>
                    <p className="text-[10.5px] text-muted-foreground">7 posts · 10:00 AM IST daily</p>
                  </div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                    All queued
                  </span>
                </div>

                <div className="space-y-2">
                  {WEEK.map((day, index) => (
                    <div
                      key={day.day}
                      className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-2.5 transition-colors hover:border-primary/20 hover:bg-accent/40"
                      style={{ animationDelay: `${index * 40}ms` }}
                    >
                      <div className="w-9 shrink-0 text-center">
                        <p className="text-[9px] font-medium text-muted-foreground">{day.day}</p>
                        <p className="font-display text-[15px] font-bold leading-none">{day.date}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-medium">{day.title}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                          <Clock3 className="size-2.5" /> {day.time}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-semibold ${
                          day.status === "Published"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        }`}
                      >
                        {day.status}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5">
                  <span className="text-[10.5px] text-muted-foreground">No manual work left</span>
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary">
                    <ShieldCheck className="size-3" /> Scheduler armed
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-card p-6 shadow-card sm:p-8">
            <div className="absolute -top-24 -right-16 size-64 rounded-full bg-primary/10 blur-3xl" />
            <Quote className="size-8 text-primary/30" />
            <blockquote className="font-display relative mt-4 text-[19px] leading-[1.45] font-medium tracking-[-0.02em] sm:text-[22px]">
              &ldquo;I used to write one post, feel productive, and disappear for ten days. Now I
              spend an hour on Sunday and LINKFLOW handles the rest of the week. It finally feels
              like a system.&rdquo;
            </blockquote>
            <div className="mt-6 flex items-center gap-3">
              <div className="brand-gradient grid size-10 place-items-center rounded-full text-[11px] font-bold text-white">
                AM
              </div>
              <div>
                <p className="text-[12.5px] font-semibold">Aarav Mehta</p>
                <p className="text-[11px] text-muted-foreground">Founder, Northstar Studio</p>
              </div>
              <div className="ml-auto flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <TrendingUp className="size-3.5 text-emerald-500" /> 3.4× reach
              </div>
            </div>
          </div>

          <div>
            <Badge variant="outline" className="mb-4 border-primary/20 bg-primary/5 text-primary">
              Security by construction
            </Badge>
            <h2 className="font-display text-balance text-3xl font-bold tracking-[-0.035em]">
              Your tokens stay on the server. <span className="gradient-text">Full stop.</span>
            </h2>
            <p className="mt-4 text-[13.5px] leading-relaxed text-muted-foreground">
              LINKFLOW never exposes LinkedIn credentials to the browser. OAuth happens server-side,
              tokens are sealed in Supabase Vault, and every table is protected by Row Level
              Security.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Server-only OAuth with single-use state",
                "Tokens sealed in Supabase Vault — never in tables or logs",
                "Row Level Security on every workspace table",
                "Atomic post claiming prevents duplicate publishing",
                "Permanent errors fail fast; temporary errors back off",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-500">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <div className="text-center">
          <Badge variant="outline" className="mb-4 border-primary/20 bg-primary/5 text-primary">
            Questions, answered
          </Badge>
          <h2 className="font-display text-3xl font-bold tracking-[-0.035em] sm:text-[38px]">
            The honest details.
          </h2>
        </div>
        <div className="mt-10 space-y-2.5">
          {[
            {
              q: "Does this work when my computer is off?",
              a: "Yes. Publishing is handled by a Supabase Edge Function triggered by pg_cron every minute. Your browser is only needed to write and schedule posts.",
            },
            {
              q: "Can I publish to my LinkedIn Company Page?",
              a: "Yes, if your LinkedIn app has Community Management API access and your member has a Super Admin or Content Admin role on the page. LINKFLOW checks both before scheduling and again before publishing.",
            },
            {
              q: "What LinkedIn permissions do you request?",
              a: "openid, profile and email to identify you, and w_member_social to publish to your profile. Company pages additionally need w_organization_social plus r_organization_admin (or rw_organization_admin), which are only requested after LinkedIn approves the Community Management API for your app.",
            },
            {
              q: "What happens if LinkedIn is down?",
              a: "Temporary failures (5xx, timeouts, rate limits) are retried with exponential backoff up to five attempts. Permission and validation errors fail immediately with an actionable message.",
            },
            {
              q: "Can I test without a LinkedIn app?",
              a: "Yes. Set LINKEDIN_MOCK_MODE=true in development. Mock publishes are clearly labelled as mock everywhere and can't be enabled in a production environment.",
            },
          ].map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-border/80 bg-card px-4 py-3.5 shadow-sm transition-colors open:border-primary/20"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[13px] font-semibold">
                {item.q}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="brand-gradient noise relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-2xl sm:px-12">
          <div className="pointer-events-none absolute -top-24 left-1/3 size-72 rounded-full bg-white/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 right-10 size-72 rounded-full bg-black/15 blur-3xl" />
          <div className="relative">
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase opacity-80">
              Your next week starts here
            </p>
            <h2 className="font-display mx-auto mt-3 max-w-2xl text-balance text-3xl font-bold tracking-[-0.035em] sm:text-[42px]">
              Seven posts. One click. Zero daily admin.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[13.5px] leading-relaxed text-white/85">
              Join the people who stopped fighting the algorithm and started showing up on time.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 w-full bg-white px-7 text-[#25316b] hover:bg-white/90 sm:w-auto">
                <Link href={primaryHref}>
                  Start planning <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-11 w-full border border-white/25 px-6 text-white hover:bg-white/10 hover:text-white sm:w-auto">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
            <p className="mt-4 text-[10.5px] text-white/65">
              Free during setup · Official LinkedIn API · Asia/Kolkata by default
            </p>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border/70">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo className="scale-90" />
            <span className="text-[11px] text-muted-foreground">LinkedIn scheduling that runs itself.</span>
          </div>
          <div className="flex items-center gap-5 text-[11.5px] text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground">Create account</Link>
            <Link href="/setup" className="hover:text-foreground">Setup</Link>
            <span>© {new Date().getFullYear()} LINKFLOW</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
