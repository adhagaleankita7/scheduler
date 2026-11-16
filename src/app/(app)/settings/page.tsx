import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettingsData } from "@/lib/data/settings";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [data, session] = await Promise.all([getSettingsData(), requireSession()]);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Settings className="size-3.5" />
            Workspace preferences
          </>
        }
        title="Settings"
        description="Your profile, publishing defaults, appearance and queue controls. Everything here applies to the whole workspace."
      />
      <SettingsForm
        profile={data.profile}
        email={session.user.email}
        queuePaused={data.queue.is_paused}
        demo={data.demo}
      />
    </div>
  );
}
