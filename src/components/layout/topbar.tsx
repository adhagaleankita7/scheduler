"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  CircleHelp,
  ExternalLink,
  LogOut,
  Plus,
  Search,
  Settings,
  UserRoundCog,
} from "lucide-react";
import { MobileSidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PAGE_TITLES } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { signOutAction } from "@/lib/auth/actions";
import type { Profile } from "@/lib/types";

type Props = {
  profile: Pick<Profile, "full_name" | "avatar_url" | "timezone">;
  email: string | null;
  demo: boolean;
};

export function Topbar({ profile, email, demo }: Props) {
  const pathname = usePathname();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const meta = PAGE_TITLES[base] ?? { title: "LINKFLOW", subtitle: "" };
  const isComposer = pathname.startsWith("/composer");

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileSidebar profile={profile} email={email} demo={demo} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display truncate text-[15px] font-semibold tracking-tight">
              {meta.title}
            </h1>
            {demo && (
              <span className="hidden rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 sm:inline dark:text-amber-400">
                Demo
              </span>
            )}
          </div>
          <p className="text-muted-foreground hidden truncate text-[11.5px] sm:block">
            {meta.subtitle}
          </p>
        </div>

        <Link
          href="/posts"
          className="text-muted-foreground hover:bg-muted hover:text-foreground hidden items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[12px] transition-colors md:flex"
        >
          <Search className="size-3.5" />
          <span className="w-28 lg:w-40">Search posts…</span>
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-medium">
            /
          </kbd>
        </Link>

        <ThemeToggle />

        <Button
          asChild
          variant="gradient"
          size="sm"
          className={isComposer ? "hidden sm:inline-flex" : ""}
        >
          <Link href="/composer">
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">New post</span>
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl p-0.5 pr-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label="Open account menu"
            >
              <Avatar className="size-8">
                {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
                <AvatarFallback className="brand-gradient text-[10px] font-bold text-white">
                  {initials(profile.full_name)}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="normal-case tracking-normal">
              <span className="block text-[12.5px] font-semibold text-foreground">
                {profile.full_name ?? "Your workspace"}
              </span>
              <span className="block truncate text-[11px] font-normal text-muted-foreground">
                {demo ? "Read-only demo workspace" : email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings /> Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/accounts">
                <UserRoundCog /> LinkedIn accounts
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/setup">
                <CircleHelp /> Setup guide
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="https://learn.microsoft.com/en-us/linkedin/marketing/" target="_blank" rel="noreferrer">
                <ExternalLink /> LinkedIn API docs
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" asChild>
              <form action={signOutAction} className="w-full">
                <button type="submit" className="flex w-full items-center gap-2 text-left">
                  <LogOut /> Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
