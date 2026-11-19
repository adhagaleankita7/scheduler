import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PlanPlanner } from "@/components/planner/plan-planner";
import { getAccountsOverview } from "@/lib/data/accounts";
import { requireSession } from "@/lib/session";
import { upcomingMonday } from "@/lib/scheduling/slots";

export const metadata: Metadata = { title: "30-day planner" };
export const dynamic = "force-dynamic";

export default async function MonthPlannerPage() {
  const [session, overview] = await Promise.all([requireSession(), getAccountsOverview()]);
  const timezone = session.profile.timezone || "Asia/Kolkata";
  const defaultTime = (session.profile.default_posting_time || "10:00:00").slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <CalendarDays className="size-3.5" />
            30-day workflow
          </>
        }
        title="Write a month. Publish every day."
        description="Thirty posts, one per day, at the time you choose. Schedule the whole month in one click — the publisher handles the rest, even while you're offline."
      />
      <PlanPlanner
        days={30}
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
