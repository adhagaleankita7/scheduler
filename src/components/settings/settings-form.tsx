"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  CalendarClock,
  Check,
  CircleUserRound,
  Clock3,
  Laptop,
  Loader2,
  Moon,
  Palette,
  Pause,
  Save,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { updateSettings } from "@/lib/actions/settings";
import { TIMEZONE_OPTIONS, WEEKDAYS } from "@/lib/scheduling/timezone";
import type { Profile } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: Sun, description: "Bright and focused" },
  { value: "dark", label: "Dark", icon: Moon, description: "Easy on the eyes" },
  { value: "system", label: "System", icon: Laptop, description: "Follow your device" },
] as const;

type ThemeValue = (typeof THEMES)[number]["value"];

export function SettingsForm({
  profile,
  email,
  queuePaused,
  demo,
}: {
  profile: Profile;
  email: string | null;
  queuePaused: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [timezone, setTimezone] = useState(profile.timezone || "Asia/Kolkata");
  const [postingTime, setPostingTime] = useState(
    (profile.default_posting_time || "10:00:00").slice(0, 5),
  );
  const [postingDays, setPostingDays] = useState<number[]>(
    profile.default_posting_days?.length ? profile.default_posting_days : [1, 2, 3, 4, 5, 6, 7],
  );
  const [theme, setThemeValue] = useState<ThemeValue>(profile.theme ?? "system");
  const [paused, setPaused] = useState(queuePaused);

  function toggleDay(day: number) {
    setPostingDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort(),
    );
  }

  function chooseTheme(next: ThemeValue) {
    setThemeValue(next);
    setTheme(next);
  }

  function save() {
    if (!fullName.trim()) {
      toast.error("Enter your name.");
      return;
    }
    if (postingDays.length === 0) {
      toast.error("Select at least one publishing day.");
      return;
    }
    startTransition(async () => {
      const result = await updateSettings({
        fullName: fullName.trim(),
        headline: headline.trim(),
        timezone,
        defaultPostingTime: postingTime,
        defaultPostingDays: postingDays,
        theme,
        queuePaused: paused,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Settings saved");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleUserRound className="size-4 text-primary" /> Profile
            </CardTitle>
            <CardDescription>
              This is the name attached to your LINKFLOW workspace. It does not change your LinkedIn
              profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
                <AvatarFallback className="brand-gradient text-[13px] font-bold text-white">
                  {initials(fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">{fullName || "Your name"}</p>
                <p className="text-muted-foreground truncate text-[11px]">{email ?? "No email"}</p>
              </div>
              <Badge variant="outline" className="ml-auto shrink-0">
                Workspace owner
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  maxLength={80}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Aarav Mehta"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="headline">Headline</Label>
                <Input
                  id="headline"
                  value={headline}
                  maxLength={160}
                  onChange={(event) => setHeadline(event.target.value)}
                  placeholder="Founder · Northstar Studio"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Publishing defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" /> Publishing defaults
            </CardTitle>
            <CardDescription>
              Used by the 7-day planner and the queue. Existing scheduled posts keep their times.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger aria-label="Default timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default-time">Default posting time</Label>
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="default-time"
                    type="time"
                    value={postingTime}
                    onChange={(event) => setPostingTime(event.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Publishing days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const active = postingDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold transition-colors",
                        active
                          ? "border-primary/25 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/20",
                      )}
                      aria-pressed={active}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-muted-foreground rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[10.5px] leading-relaxed">
              Saving here sets a single daily queue slot. To use up to four slots per day, adjust them
              in{" "}
              <Link href="/queue" className="font-medium text-primary hover:underline">
                Queue settings
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-primary" /> Appearance
            </CardTitle>
            <CardDescription>Choose how LINKFLOW looks on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3">
              {THEMES.map((option) => {
                const Icon = option.icon;
                const active = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => chooseTheme(option.value)}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
                      active
                        ? "border-primary/30 bg-primary/[0.06] shadow-sm"
                        : "border-border bg-card hover:border-primary/20",
                    )}
                    aria-pressed={active}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg",
                        active ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                        {option.label}
                        {active && <Check className="size-3 text-primary" />}
                      </span>
                      <span className="text-muted-foreground block text-[10.5px]">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {/* Queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pause className="size-4 text-primary" /> Queue status
            </CardTitle>
            <CardDescription>
              Pause the publishing engine without losing scheduled posts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
              <div>
                <p className="text-[12.5px] font-semibold">
                  {paused ? "Queue paused" : "Queue active"}
                </p>
                <p className="text-muted-foreground text-[10.5px]">
                  {paused
                    ? "Due posts are held safely until you resume."
                    : "Posts publish automatically on schedule."}
                </p>
              </div>
              <Switch
                checked={!paused}
                onCheckedChange={(checked) => setPaused(!checked)}
                disabled={demo}
                aria-label="Enable automatic publishing"
              />
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
              <Link href="/queue">Open queue settings</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="sticky top-20">
          <CardContent className="space-y-3 py-5">
            <div className="flex items-center gap-2">
              <span className="brand-gradient grid size-8 place-items-center rounded-lg text-white">
                <Save className="size-4" />
              </span>
              <div>
                <p className="text-[12.5px] font-semibold">Save your changes</p>
                <p className="text-muted-foreground text-[10.5px]">
                  Applies to your whole workspace.
                </p>
              </div>
            </div>
            <Button
              variant="gradient"
              className="w-full"
              onClick={save}
              disabled={pending || demo}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {pending ? "Saving…" : "Save settings"}
            </Button>
            {demo && (
              <p className="flex items-start gap-1.5 text-[10.5px] text-amber-600 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                Demo mode is read-only. Connect Supabase to save settings.
              </p>
            )}
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              Your timezone controls every date shown in LINKFLOW. Scheduling always stores UTC.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
