import { describe, expect, it } from "vitest";
import {
  MOCK_ACCESS_TOKEN_PREFIX,
  MOCK_PROVIDER_PREFIX,
  buildMockAccessToken,
  buildMockLinkedInAccount,
  isMockProviderAccountId,
  mockDisplayName,
  mockProviderAccountId,
} from "@/lib/linkedin/mock-account";

describe("mock LinkedIn account ids", () => {
  it("are stable per user and clearly prefixed", () => {
    const id = mockProviderAccountId("3f9a8b7c-1111-4222-8333-444455556666");
    expect(id).toBe(`${MOCK_PROVIDER_PREFIX}3f9a8b7c1111422283334444`);
    expect(mockProviderAccountId("3f9a8b7c-1111-4222-8333-444455556666")).toBe(id);
  });

  it("never collide with a real LinkedIn member id", () => {
    expect(isMockProviderAccountId(mockProviderAccountId("abc"))).toBe(true);
    expect(isMockProviderAccountId("abc123")).toBe(false);
    expect(isMockProviderAccountId(null)).toBe(false);
  });
});

describe("mockDisplayName", () => {
  it("uses profile metadata and labels the account", () => {
    expect(
      mockDisplayName({
        email: "ada@example.com",
        user_metadata: { full_name: "Ada Lovelace" },
      }),
    ).toBe("Ada Lovelace (mock LinkedIn)");
  });

  it("falls back to the email local part", () => {
    expect(mockDisplayName({ email: "ada@example.com", user_metadata: {} })).toBe(
      "ada (mock LinkedIn)",
    );
  });

  it("has a final fallback", () => {
    expect(mockDisplayName({ email: null, user_metadata: null })).toBe("Mock LinkedIn member");
  });
});

describe("buildMockLinkedInAccount", () => {
  const now = new Date("2026-01-15T10:00:00.000Z");

  it("builds a connected account with no real token", () => {
    const account = buildMockLinkedInAccount({
      userId: "user-1",
      displayName: "Ada (mock LinkedIn)",
      email: "ada@example.com",
      scopes: ["openid", "w_member_social"],
      now,
    });

    expect(account).toMatchObject({
      user_id: "user-1",
      provider: "linkedin",
      provider_account_id: mockProviderAccountId("user-1"),
      display_name: "Ada (mock LinkedIn)",
      email: "ada@example.com",
      scopes: ["openid", "w_member_social"],
      status: "connected",
      avatar_url: null,
      refresh_token_expires_at: null,
      last_error: null,
    });
    expect(account.token_expires_at).toBe("2026-03-16T10:00:00.000Z");
    expect(account.last_refreshed_at).toBe(now.toISOString());
  });

  it("copies the scope array so callers cannot mutate it", () => {
    const scopes = ["openid"];
    const account = buildMockLinkedInAccount({
      userId: "user-1",
      displayName: "Ada",
      email: null,
      scopes,
      now,
    });
    account.scopes.push("w_member_social");
    expect(scopes).toEqual(["openid"]);
  });
});

describe("buildMockAccessToken", () => {
  it("is long enough for the token RPC and clearly not a real token", () => {
    const token = buildMockAccessToken();
    expect(token.startsWith(MOCK_ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(10);
    expect(token).not.toBe(buildMockAccessToken());
  });
});
