"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("LINKFLOW root error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" />
      </span>
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">This page could not load</h1>
      <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
        An unexpected error interrupted the request. Retry the page, or return to the LINKFLOW home
        page.
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
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </div>
  );
}
