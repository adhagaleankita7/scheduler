import { randomBytes } from "node:crypto";
import type { FacebookPage } from "@/lib/facebook/oauth";

/**
 * Development-only simulated Facebook accounts, mirroring the LinkedIn mock
 * helper. Only reachable when FACEBOOK_MOCK_MODE=true and no app credentials
 * are configured (hard-disabled in production).
 */

export const FACEBOOK_MOCK_PROVIDER_PREFIX = "mock_facebook_";
export const FACEBOOK_MOCK_ACCESS_TOKEN_PREFIX = "mock-facebook-token-";

export function mockFacebookProviderAccountId(userId: string) {
  const normalized = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `${FACEBOOK_MOCK_PROVIDER_PREFIX}${normalized || "member"}`;
}

export function isMockFacebookAccountId(providerAccountId: string | null | undefined) {
  return Boolean(providerAccountId?.startsWith(FACEBOOK_MOCK_PROVIDER_PREFIX));
}

export function mockFacebookDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const metadata = user.user_metadata ?? {};
  for (const key of ["full_name", "name"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return `${value.trim()} (mock Facebook)`;
    }
  }
  const localPart = user.email?.split("@")[0]?.trim();
  return localPart ? `${localPart} (mock Facebook)` : "Mock Facebook member";
}

export function buildMockFacebookAccount(input: {
  userId: string;
  displayName: string;
  email: string | null;
  scopes: string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return {
    user_id: input.userId,
    provider: "facebook" as const,
    provider_account_id: mockFacebookProviderAccountId(input.userId),
    display_name: input.displayName,
    avatar_url: null,
    email: input.email,
    scopes: [...input.scopes],
    status: "connected" as const,
    token_expires_at: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    refresh_token_expires_at: null,
    last_refreshed_at: now.toISOString(),
    last_error: null,
  };
}

export function buildMockFacebookPage(input: {
  userId: string;
  accountId: string;
  now?: Date;
}): FacebookPage {
  return {
    id: `mockpage-${input.accountId.slice(0, 8)}`,
    name: "Mock Facebook Page",
    username: "mock.facebook.page",
    link: "https://www.facebook.com/mock.facebook.page",
    category: "Software Company",
    picture: null,
    tasks: ["CREATE_CONTENT", "MANAGE"],
    canPublish: true,
  };
}

/**
 * Mock tokens never reach Meta: mock publishing exits before the HTTP call.
 * The RPC only requires a value of at least 10 characters.
 */
export function buildMockFacebookToken() {
  return `${FACEBOOK_MOCK_ACCESS_TOKEN_PREFIX}${randomBytes(16).toString("hex")}`;
}
