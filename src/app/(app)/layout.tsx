import { requireSession } from "@/lib/session";
import { DesktopSidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { DemoBanner } from "@/components/layout/banners";
import { isLinkedInMockMode } from "@/lib/env";
import { MockModeBanner } from "@/components/layout/banners";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const profile = {
    full_name: session.profile.full_name,
    avatar_url: session.profile.avatar_url,
    timezone: session.profile.timezone,
  };

  return (
    <div className="min-h-dvh">
      <DesktopSidebar profile={profile} email={session.user.email} demo={session.demo} />
      <div className="flex min-h-dvh flex-col lg:pl-[268px]">
        <Topbar profile={profile} email={session.user.email} demo={session.demo} />
        {session.demo && <DemoBanner />}
        {!session.demo && isLinkedInMockMode() && <MockModeBanner />}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
