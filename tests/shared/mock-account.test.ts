import { describe, expect, it } from "vitest";
import {
  MOCK_PROVIDER_ACCOUNT_PREFIXES,
  isMockProviderAccountId,
} from "../../supabase/functions/_shared/mock";
import { MOCK_PROVIDER_PREFIX } from "@/lib/linkedin/mock-account";
import { FACEBOOK_MOCK_PROVIDER_PREFIX } from "@/lib/facebook/mock-account";

describe("worker mock account detection", () => {
  it("recognises mock ids from both connect routes", () => {
    expect(isMockProviderAccountId(`${MOCK_PROVIDER_PREFIX}abc123`)).toBe(true);
    expect(isMockProviderAccountId(`${FACEBOOK_MOCK_PROVIDER_PREFIX}abc123`)).toBe(true);
  });

  it("never treats a real provider id as mock", () => {
    // Real LinkedIn member ids are opaque strings; Facebook Page-scoped ids are
    // numeric. Neither can start with a mock prefix.
    expect(isMockProviderAccountId("1EVz3jGXNg")).toBe(false);
    expect(isMockProviderAccountId("123456789012345")).toBe(false);
    expect(isMockProviderAccountId("")).toBe(false);
    expect(isMockProviderAccountId(null)).toBe(false);
    expect(isMockProviderAccountId(undefined)).toBe(false);
  });

  it("stays in sync with the connect route prefixes", () => {
    const prefixes: string[] = [...MOCK_PROVIDER_ACCOUNT_PREFIXES];
    expect(prefixes).toContain(MOCK_PROVIDER_PREFIX);
    expect(prefixes).toContain(FACEBOOK_MOCK_PROVIDER_PREFIX);
  });
});
