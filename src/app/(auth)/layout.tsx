import Link from "next/link";
import { BadgeCheck, CalendarRange, Check, Clock3, LockKeyhole, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { isDemoMode } from "@/lib/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemoMode();

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="brand-gradient noise relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.14]" />
        <div className="pointer-events-none absolute -top-32 -left-20 size-[420px] rounded-full bg-white/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 size-[420px] rounded-full bg-black/20 blur-3xl" />

        <Link href="/" className="relative z-10 inline-flex w-fit items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-[11px] bg-white/15 backdrop-blur">
            <svg viewBox="0 0 24 24" fill="none" className="size-5">
              <path d="M7 6.5h4.2a3.3 3.3 0 0 1 0 6.6H8.4l6.1 6.1" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6.2" cy="6.5" r="2.2" fill="currentColor" />
              <circle cx="16.6" cy="19.2" r="2.2" fill="currentColor" />
              <circle cx="17.4" cy="9.2" r="1.7" fill="currentColor" opacity="0.75" />
            </svg>
          </span>
          <span className="font-display text-[17px] font-extrabold tracking-[-0.03em]">
            LINKFLOW
          </span>
        </Link>

        <div className="relative z-10 my-auto max-w-md py-14">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10.5px] font-semibold backdrop-blur">
            <Sparkles className="size-3" /> LinkedIn scheduling that runs itself
          </div>
          <h1 className="font-display text-balance text-[36px] leading-[1.08] font-bold tracking-[-0.04em] xl:text-[42px]">
            Publish like clockwork.
            <br />
            <span className="text-white/70">Even on the days you don&apos;t feel like it.</span>
          </h1>
          <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-white/75">
            Plan a full week in one session. LINKFLOW publishes one post every day at your chosen
            time — securely, through the official LinkedIn API.
          </p>

          <div className="mt-8 space-y-2.5">
            {[
              { day: "Mon", title: "Consistency compounds", time: "10:00 AM", done: true },
              { day: "Tue", title: "Specific beats polished", time: "10:00 AM", done: true },
              { day: "Wed", title: "Your page isn't a brochure", time: "10:00 AM", done: false },
            ].map((item) => (
              <div key={item.day} className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/15">
                  <span className="text-[9.5px] font-bold">{item.day}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] font-medium">{item.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[9px] text-white/60">
                    <Clock3 className="size-2.5" /> {item.time}
                  </p>
                </div>
                {item.done ? (
                  <span className="grid size-5 place-items-center rounded-full bg-emerald-400/25 text-emerald-200">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                ) : (
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[8.5px] font-semibold">
                    Queued
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex flex-wrap gap-x-5 gap-y-2 text-[10.5px] text-white/65">
          <span className="inline-flex items-center gap-1.5"><LockKeyhole className="size-3" /> Vault-encrypted tokens</span>
          <span className="inline-flex items-center gap-1.5"><BadgeCheck className="size-3" /> Official LinkedIn API</span>
          <span className="inline-flex items-center gap-1.5"><CalendarRange className="size-3" /> Asia/Kolkata default</span>
        </div>
      </aside>

      <main className="relative flex flex-col bg-background">
        <div className="flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="lg:hidden">
            <Logo />
          </Link>
          <Link
            href="/"
            className="text-muted-foreground ml-auto text-[12px] font-medium transition-colors hover:text-foreground"
          >
            ← Back to home
          </Link>
        </div>

        {demo && (
          <div className="mx-5 mb-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 sm:mx-8 dark:text-amber-300">
            Demo mode is enabled. <Link href="/dashboard" className="font-semibold underline">Open the demo dashboard</Link> instead.
          </div>
        )}

        <div className="flex flex-1 items-center justify-center px-5 py-6 sm:px-8 sm:py-10">
          <div className="w-full max-w-[400px] animate-fade-up">{children}</div>
        </div>

        <div className="text-muted-foreground px-5 pb-6 text-center text-[10.5px] sm:px-8">
          By continuing you agree to LINKFLOW&apos;s{" "}
          <span className="font-medium text-foreground/70">Terms</span> and{" "}
          <span className="font-medium text-foreground/70">Privacy Policy</span>.
        </div>
      </main>
    </div>
  );
}
