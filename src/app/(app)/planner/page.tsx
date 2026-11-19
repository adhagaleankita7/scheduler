import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PlanPlanner } from "@/components/planner/plan-planner";
import { getAccountsOverview } from "@/lib/data/accounts";
import { requireSession } from "@/lib/session";
import { upcomingMonday } from "@/lib/scheduling/slots";

export const metadata: Metadata = { title: "7-day planner" };
export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const [session, overview] = await Promise.all([requireSession(), getAccountsOverview()]);
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const defaultTime = (session.profile.default_posting_time || "10:00:00").slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <CalendarRange className="size-3.5" />
            7-day workflow
          </>
        }
        title="Write a week. Publish every day."
        description="Seven posts, one per day, at the time you choose. Schedule the whole week in one click — the publisher handles the rest, even while you're offline."
      />
      <PlanPlanner
        days={7}
        targets={overview.targets}
        timezone={timezone}
        defaultTime={defaultTime}
        defaultStartDate={upcomingMonday(timezone)}
        demo={session.demo}
        userId={session.user.id}
      />
    </div>
  );
}
