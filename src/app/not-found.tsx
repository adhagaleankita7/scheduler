"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="brand-gradient mb-4 grid size-12 place-items-center rounded-2xl text-white shadow-lg">
        <Compass className="size-5" />
      </span>
      <p className="text-primary text-[11px] font-semibold tracking-[0.14em] uppercase">404</p>
      <h1 className="font-display mt-1 text-2xl font-bold tracking-[-0.02em]">Page not found</h1>
      <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
        That link doesn&apos;t lead anywhere in LINKFLOW. It may have been moved, deleted, or never
        existed.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="gradient">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
