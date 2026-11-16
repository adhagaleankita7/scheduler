"use client";

import * as React from "react";
import { formatInZone } from "@/lib/scheduling/timezone";

export function LocalTime({
  iso,
  timeZone,
  pattern = "MMM d, yyyy · h:mm a",
  className,
}: {
  iso: string | null | undefined;
  timeZone: string;
  pattern?: string;
  className?: string;
}) {
  if (!iso) return <span className={className}>—</span>;
  return (
    <span className={className} suppressHydrationWarning>
      {formatInZone(iso, timeZone, pattern)}
    </span>
  );
}

export function Countdown({
  iso,
  className,
}: {
  iso: string | null | undefined;
  className?: string;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!iso) return <span className={className}>No upcoming post</span>;
  const target = new Date(iso).getTime();
  const diff = target - now;
  const absolute = Math.abs(diff);
  const days = Math.floor(absolute / 86_400_000);
  const hours = Math.floor((absolute % 86_400_000) / 3_600_000);
  const minutes = Math.floor((absolute % 3_600_000) / 60_000);

  const label =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <span className={className} suppressHydrationWarning>
      {diff >= 0 ? `in ${label}` : `${label} overdue`}
    </span>
  );
}
