import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CalendarView } from "@/components/calendar/calendar-view";
import { getCalendarPosts } from "@/lib/data/posts";
import { signedMediaUrls } from "@/lib/data/hydrate";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  getCalendarWindow,
  parseCalendarDate,
  parseCalendarView,
} from "@/lib/scheduling/calendar";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const [session, params] = await Promise.all([requireSession(), searchParams]);
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const view = parseCalendarView(params.view);
  const dateKey = parseCalendarDate(params.date, timezone);
  const window = getCalendarWindow(view, dateKey, timezone);

  const posts = await getCalendarPosts(window.startIso, window.endIso);

  let signedMedia: Record<string, string> = {};
  if (!session.demo && posts.some((post) => post.media)) {
    try {
      const supabase = await createClient();
      signedMedia = await signedMediaUrls(supabase, posts);
    } catch {
      signedMedia = {};
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <CalendarDays className="size-3.5" />
            {timezone}
          </>
        }
        title="Every post, mapped in time"
        description="Review the month at a glance, switch to week or day for detail, and drag any scheduled post to a new day. LINKFLOW recalculates the exact UTC instant for you."
      />
      <CalendarView
        initialView={view}
        initialDate={dateKey}
        timezone={timezone}
        posts={posts}
        signedMedia={signedMedia}
      />
    </div>
  );
}
