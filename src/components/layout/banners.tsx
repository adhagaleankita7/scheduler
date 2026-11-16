import Link from "next/link";
import { FlaskConical, ShieldCheck } from "lucide-react";

export function DemoBanner() {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2 text-amber-700 sm:px-6 lg:px-8 dark:text-amber-300">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <FlaskConical className="size-3.5 shrink-0" />
        <span className="font-semibold">Read-only demo data.</span>
        <span className="text-amber-700/80 dark:text-amber-300/80">
          Nothing is sent to LinkedIn and changes are disabled.
        </span>
        <Link href="/setup" className="ml-auto inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
          <ShieldCheck className="size-3.5" /> Connect Supabase to go live
        </Link>
      </div>
    </div>
  );
}

export function MockModeBanner() {
  return (
    <div className="border-b border-blue-500/20 bg-blue-500/[0.06] px-4 py-2 text-blue-700 sm:px-6 lg:px-8 dark:text-blue-300">
      <div className="flex items-center gap-2 text-[11.5px]">
        <FlaskConical className="size-3.5 shrink-0" />
        <span className="font-semibold">Mock publishing is ON.</span>
        <span className="text-blue-700/80 dark:text-blue-300/80">
          Posts are simulated and labelled as mock. Disable LINKEDIN_MOCK_MODE to publish for real.
        </span>
      </div>
    </div>
  );
}
