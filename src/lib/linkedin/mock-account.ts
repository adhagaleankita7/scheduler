import { randomBytes } from "node:crypto";

/**
 * Development-only simulated LinkedIn accounts.
 *
 * Real OAuth requires an approved LinkedIn app and an HTTPS redirect URL, which
 * means a fresh checkout cannot exercise the scheduler end-to-end. When
 * LINKEDIN_MOCK_MODE=true and no client credentials are configured, the connect
 * route creates a clearly-labelled mock account instead so the real database,
 * server actions, queue and Edge Function can be tested with `is_mock = true`.
 *
 * This module is only ever called after `isLinkedInMockMode()` has been checked
 * (which is hard-disabled in production).
 */

export const MOCK_PROVIDER_PREFIX = "mock_member_";
export const MOCK_ACCESS_TOKEN_PREFIX = "mock-access-token-";

/** Stable per-user id so reconnecting does not create duplicate accounts. */
export function mockProviderAccountId(userId: string) {
  const normalized = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `${MOCK_PROVIDER_PREFIX}${normalized || "member"}`;
}

export function isMockProviderAccountId(
  providerAccountId: string | null | undefined,
) {
  return Boolean(providerAccountId?.startsWith(MOCK_PROVIDER_PREFIX));
}

export function mockDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const metadata = user.user_metadata ?? {};
  for (const key of ["full_name", "name"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return `${value.trim()} (mock LinkedIn)`;
    }
  }
  const localPart = user.email?.split("@")[0]?.trim();
  return localPart ? `${localPart} (mock LinkedIn)` : "Mock LinkedIn member";
}

export function buildMockLinkedInAccount(input: {
  userId: string;
  displayName: string;
  email: string | null;
  scopes: string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return {
    user_id: input.userId,
    provider: "linkedin" as const,
    provider_account_id: mockProviderAccountId(input.userId),
    display_name: input.displayName,
    avatar_url: null,
    email: input.email,
    scopes: [...input.scopes],
    status: "connected" as const,
    // Mock accounts never call LinkedIn; the expiry only keeps the UI honest.
    token_expires_at: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    refresh_token_expires_at: null,
    last_refreshed_at: now.toISOString(),
    last_error: null,
  };
}

/**
 * The token RPC rejects anything shorter than 10 characters. Nothing sends this
 * value to LinkedIn: mock publishing exits before the HTTP call.
 */
export function buildMockAccessToken() {
  return `${MOCK_ACCESS_TOKEN_PREFIX}${randomBytes(16).toString("hex")}`;
}
