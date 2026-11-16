import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

const TOUCHED = ["LINKFLOW_DEMO_MODE", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

beforeEach(() => {
  for (const key of TOUCHED) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("demo mode middleware", () => {
  it("does not bounce protected routes to /login when Supabase is configured", async () => {
    process.env.LINKFLOW_DEMO_MODE = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_demo";

    for (const path of ["/dashboard", "/calendar", "/composer"]) {
      const response = await middleware(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("still exposes the demo routes without any Supabase credentials", async () => {
    process.env.LINKFLOW_DEMO_MODE = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const response = await middleware(request("/dashboard"));
    expect(response.status).toBe(200);
  });

  it("redirects to /setup when Supabase is missing outside demo mode", async () => {
    delete process.env.LINKFLOW_DEMO_MODE;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const response = await middleware(request("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/setup");
  });
});
