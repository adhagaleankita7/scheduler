"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest so server logs can be matched to what the user saw.
    console.error("LINKFLOW app error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" />
      </span>
      <h2 className="font-display text-xl font-bold tracking-[-0.02em]">
        Something went wrong on this page
      </h2>
      <p className="text-muted-foreground mt-2 text-[12.5px] leading-relaxed">
        The workspace hit an unexpected error. Your scheduled posts are safe — the publishing engine
        runs independently of the dashboard. Try again, or head back to the dashboard.
      </p>
      {error.digest && (
        <p className="text-muted-foreground/70 mt-2 font-mono text-[10.5px]">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button variant="gradient" onClick={reset}>
          <RefreshCw className="size-4" /> Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
