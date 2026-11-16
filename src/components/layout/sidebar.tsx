"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, ChevronRight, Menu, Sparkles, X } from "lucide-react";
import { NAV_ITEMS, SETTINGS_ITEM } from "@/components/layout/nav-config";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import type { Profile } from "@/lib/types";

type Props = {
  profile: Pick<Profile, "full_name" | "avatar_url">;
  email: string | null;
  demo: boolean;
};

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-200",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              item.featured && !active && "text-foreground",
            )}
          >
            {active && (
              <span className="brand-gradient absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full" />
            )}
            <Icon
              className={cn(
                "size-[18px] shrink-0 transition-colors",
                active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )}
              strokeWidth={active ? 2.3 : 2}
            />
            <span className="truncate">{item.label}</span>
            {item.featured && (
              <span className="ml-auto rounded-full border border-primary/15 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-primary uppercase">
                7d
              </span>
            )}
          </Link>
        );
      })}

      <div className="bg-border/70 my-3 h-px" />

      <Link
        href={SETTINGS_ITEM.href}
        onClick={onNavigate}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
          pathname.startsWith(SETTINGS_ITEM.href)
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
      >
        <SETTINGS_ITEM.icon
          className={cn(
            "size-[18px]",
            pathname.startsWith(SETTINGS_ITEM.href) ? "text-primary" : "text-muted-foreground",
          )}
        />
        {SETTINGS_ITEM.label}
      </Link>
    </nav>
  );
}

function PlannerCard({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/planner"
      onClick={onNavigate}
      className="group relative mb-4 overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-brand-violet/8 to-transparent p-3.5 transition-all hover:border-primary/30 hover:shadow-glow"
    >
      <div className="pointer-events-none absolute -top-8 -right-6 size-24 rounded-full bg-brand-violet/15 blur-2xl transition-transform group-hover:scale-125" />
      <div className="mb-2 flex items-center gap-2">
        <span className="brand-gradient grid size-7 place-items-center rounded-lg text-white">
          <CalendarRange className="size-3.5" />
        </span>
        <span className="text-[12px] font-semibold">Plan a full week</span>
        <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="text-muted-foreground text-[11.5px] leading-relaxed">
        Write seven posts once. LINKFLOW publishes one every day.
      </p>
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
        <Sparkles className="size-3" /> 7-day workflow
      </span>
    </Link>
  );
}

function UserBlock({ profile, email, demo }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-1 py-2">
      <Avatar className="size-9 ring-2 ring-background">
        {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
        <AvatarFallback className="brand-gradient text-[11px] font-bold text-white">
          {initials(profile.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold">
          {profile.full_name ?? "Your workspace"}
        </p>
        <p className="text-muted-foreground truncate text-[11px]">
          {demo ? "Demo workspace" : email}
        </p>
      </div>
    </div>
  );
}

export function DesktopSidebar({
  profile,
  email,
  demo,
}: Props) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[268px] flex-col border-r border-sidebar-border bg-sidebar px-3.5 py-5 lg:flex">
      <div className="mb-7 flex items-center px-2">
        <Link href="/dashboard" aria-label="LINKFLOW dashboard">
          <Logo />
        </Link>
        <span className="ml-auto rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-muted-foreground">
          BETA
        </span>
      </div>
      <NavLinks />
      <PlannerCard />
      <div className="border-t border-sidebar-border pt-3">
        <UserBlock profile={profile} email={email} demo={demo} />
      </div>
    </aside>
  );
}

export function MobileSidebar({ profile, email, demo }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </button>

      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-0 bg-[#050812]/50 backdrop-blur-sm transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex w-[288px] flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 shadow-2xl transition-transform duration-300 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-7 flex items-center justify-between px-1">
            <Logo />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>
          <NavLinks onNavigate={() => setOpen(false)} />
          <PlannerCard onNavigate={() => setOpen(false)} />
          <div className="border-t border-sidebar-border pt-3">
            <UserBlock profile={profile} email={email} demo={demo} />
          </div>
        </aside>
      </div>
    </>
  );
}
