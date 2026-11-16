import { describe, expect, it, vi } from "vitest";
import {
  LinkedInPublishError,
  buildAuthorUrn,
  buildMockResult,
  buildPostPayload,
  classifyLinkedInStatus,
  computeRetryDelaySeconds,
  extractErrorDetail,
  isRetryableError,
  publishToLinkedIn,
  refreshLinkedInToken,
  tokenNeedsRefresh,
  type PublishInput,
} from "../../supabase/functions/_shared/linkedin";

function baseInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    postId: "11111111-1111-4111-8111-111111111111",
    memberId: "member-123",
    commentary: "Hello LinkedIn",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    accessToken: "token-abc",
    apiVersion: "202601",
    ...overrides,
  };
}

function response(
  status: number,
  body: string | null = null,
  headers: Record<string, string> = {},
) {
  return new Response(body, { status, headers });
}

describe("buildAuthorUrn", () => {
  it("uses the member id for a personal post", () => {
    expect(buildAuthorUrn({ memberId: "abc" })).toBe("urn:li:person:abc");
  });

  it("uses the organization id for a page post", () => {
    expect(buildAuthorUrn({ memberId: "abc", organizationId: "12345" })).toBe(
      "urn:li:organization:12345",
    );
  });

  it("refuses to publish without a member id", () => {
    expect(() => buildAuthorUrn({ memberId: "" })).toThrow(LinkedInPublishError);
  });
});

describe("buildPostPayload", () => {
  it("builds a public main-feed post", () => {
    const payload = buildPostPayload({ commentary: "Hi", memberId: "abc" });
    expect(payload).toMatchObject({
      author: "urn:li:person:abc",
      commentary: "Hi",
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      distribution: { feedDistribution: "MAIN_FEED" },
    });
    expect(payload.content).toBeUndefined();
  });

  it("attaches an image and truncates alt text to 300 characters", () => {
    const payload = buildPostPayload({
      commentary: "Hi",
      memberId: "abc",
      imageUrn: "urn:li:image:999",
      altText: "a".repeat(400),
    });
    expect(payload.content).toEqual({
      media: { id: "urn:li:image:999", altText: "a".repeat(300) },
    });
  });
});

describe("publishToLinkedIn", () => {
  it("publishes a text post and returns the provider id and URL", async () => {
    const fetchImpl = vi.fn(async () =>
      response(201, null, { "x-restli-id": "urn:li:share:123" }),
    ) as unknown as typeof fetch;

    const result = await publishToLinkedIn(baseInput({ fetchImpl }));

    expect(result).toMatchObject({
      providerPostId: "urn:li:share:123",
      providerPostUrl:
        "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123",
      httpStatus: 201,
      isMock: false,
      imageUrn: null,
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Restli-Idempotency-Key"]).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(init.headers["LinkedIn-Version"]).toBe("202601");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(init.body).author).toBe("urn:li:person:member-123");
  });

  it("reads the provider id from a JSON body when no header is present", async () => {
    const fetchImpl = vi.fn(async () =>
      response(201, JSON.stringify({ id: "urn:li:share:456" })),
    ) as unknown as typeof fetch;

    const result = await publishToLinkedIn(baseInput({ fetchImpl }));
    expect(result.providerPostId).toBe("urn:li:share:456");
  });

  it("uses a synthetic provider reference when LinkedIn returns no id", async () => {
    const fetchImpl = vi.fn(async () => response(201)) as unknown as typeof fetch;
    const result = await publishToLinkedIn(baseInput({ fetchImpl }));
    expect(result.providerPostId).toMatch(/^urn:li:share:accepted_/);
    expect(result.providerPostUrl).toContain("urn%3Ali%3Ashare%3Aaccepted_");
  });

  it("uploads an image before creating the post", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("initializeUpload")) {
        return response(200, JSON.stringify({
          value: { uploadUrl: "https://upload.linkedin.test/image", image: "urn:li:image:777" },
        }));
      }
      if (url === "https://upload.linkedin.test/image") {
        return response(201);
      }
      return response(201, null, { "x-restli-id": "urn:li:share:789" });
    }) as unknown as typeof fetch;

    const result = await publishToLinkedIn(
      baseInput({
        fetchImpl,
        image: {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
          altText: "A diagram",
        },
      }),
    );

    expect(calls).toEqual([
      "POST https://api.linkedin.com/rest/images?action=initializeUpload",
      "PUT https://upload.linkedin.test/image",
      "POST https://api.linkedin.com/rest/posts",
    ]);
    expect(result.imageUrn).toBe("urn:li:image:777");

    const postCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(JSON.parse(postCall[1].body).content).toEqual({
      media: { id: "urn:li:image:777", altText: "A diagram" },
    });
  });

  it("rejects an empty or oversized post before calling LinkedIn", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      publishToLinkedIn(baseInput({ commentary: "   ", fetchImpl })),
    ).rejects.toMatchObject({ code: "invalid_content", retryable: false });
    await expect(
      publishToLinkedIn(baseInput({ commentary: "a".repeat(3001), fetchImpl })),
    ).rejects.toMatchObject({ code: "invalid_content", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing access token", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      publishToLinkedIn(baseInput({ accessToken: "", fetchImpl })),
    ).rejects.toMatchObject({ code: "invalid_token", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies 401 as a non-retryable invalid token", async () => {
    const fetchImpl = vi.fn(async () =>
      response(401, JSON.stringify({ message: "Invalid access token" })),
    ) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "invalid_token",
      retryable: false,
      httpStatus: 401,
    });
  });

  it("classifies a plain 403 as a terminal permission error", async () => {
    const fetchImpl = vi.fn(async () =>
      response(403, JSON.stringify({ message: "Not enough permissions" })),
    ) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "missing_permissions",
      retryable: false,
      httpStatus: 403,
    });
  });

  it("classifies 429 as retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      response(429, JSON.stringify({ message: "Throttled" }), { "retry-after": "30" }),
    ) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      httpStatus: 429,
    });
  });

  it("classifies 409 as a non-retryable duplicate", async () => {
    const fetchImpl = vi.fn(async () =>
      response(409, JSON.stringify({ message: "Duplicate post" })),
    ) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "duplicate_post",
      retryable: false,
    });
  });

  it("classifies 400 as non-retryable invalid content", async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, JSON.stringify({ message: "Commentary is invalid" })),
    ) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "invalid_content",
      retryable: false,
      details: expect.stringContaining("Commentary is invalid"),
    });
  });

  it("classifies 500 as retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      response(503, JSON.stringify({ message: "Service unavailable" })),
    ) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "linkedin_server_error",
      retryable: true,
      httpStatus: 503,
    });
  });

  it("classifies a fetch failure as retryable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(publishToLinkedIn(baseInput({ fetchImpl }))).rejects.toMatchObject({
      code: "network_error",
      retryable: true,
    });
  });

  it("fails retryably when the image upload URL is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, JSON.stringify({ value: {} })),
    ) as unknown as typeof fetch;

    await expect(
      publishToLinkedIn(
        baseInput({
          fetchImpl,
          image: { bytes: new Uint8Array([1]), mimeType: "image/png" },
        }),
      ),
    ).rejects.toMatchObject({ code: "image_upload_failed", retryable: true });
  });
});

describe("mock publishing", () => {
  it("returns an explicitly marked mock result without calling LinkedIn", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await publishToLinkedIn(baseInput({ fetchImpl }), { mock: true });

    expect(result.isMock).toBe(true);
    expect(result.providerPostId).toMatch(/^urn:li:share:mock_/);
    expect(result.providerPostUrl).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("builds a deterministic-shaped mock id that includes the post id prefix", () => {
    const result = buildMockResult("11111111-1111-4111-8111-111111111111", 1_700_000_000_000);
    expect(result.providerPostId).toBe(
      "urn:li:share:mock_11111111111141118111_1700000000000",
    );
  });
});

describe("classification helpers", () => {
  it("treats a throttled 403 as rate limiting", () => {
    expect(classifyLinkedInStatus(403, "Request throttled: rate limit exceeded")).toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
  });

  it("treats 408 and 425 as retryable network errors", () => {
    expect(classifyLinkedInStatus(408, "")).toMatchObject({
      code: "network_error",
      retryable: true,
    });
    expect(classifyLinkedInStatus(425, "")).toMatchObject({
      code: "network_error",
      retryable: true,
    });
  });

  it("treats unknown 4xx responses as non-retryable", () => {
    expect(classifyLinkedInStatus(418, "")).toMatchObject({
      code: "unknown_error",
      retryable: false,
    });
  });

  it("extracts human-readable error detail", () => {
    expect(extractErrorDetail('{"message":"Bad thing"}')).toBe("Bad thing");
    expect(extractErrorDetail('{"error_description":"Expired"}')).toBe("Expired");
    expect(extractErrorDetail("plain text")).toBe("plain text");
    expect(extractErrorDetail("")).toBe("");
    expect(extractErrorDetail(`{"message":"${"x".repeat(600)}"}`)).toHaveLength(500);
  });

  it("computes exponential backoff capped at one hour", () => {
    expect(computeRetryDelaySeconds(1)).toBe(60);
    expect(computeRetryDelaySeconds(2)).toBe(120);
    expect(computeRetryDelaySeconds(3)).toBe(240);
    expect(computeRetryDelaySeconds(4)).toBe(480);
    expect(computeRetryDelaySeconds(5)).toBe(960);
    expect(computeRetryDelaySeconds(6)).toBe(1920);
    expect(computeRetryDelaySeconds(7)).toBe(3600);
    expect(computeRetryDelaySeconds(20)).toBe(3600);
    expect(computeRetryDelaySeconds(0)).toBe(60);
  });

  it("decides retryability from the error type", () => {
    expect(
      isRetryableError(new LinkedInPublishError("rate_limited", "x", { retryable: true })),
    ).toBe(true);
    expect(
      isRetryableError(new LinkedInPublishError("missing_permissions", "x", { retryable: false })),
    ).toBe(false);
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("nope"))).toBe(false);
  });
});

describe("token refresh", () => {
  it("exchanges a refresh token for a new access token", async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        refresh_token_expires_in: 86_400,
      })),
    ) as unknown as typeof fetch;

    const before = Date.now();
    const tokens = await refreshLinkedInToken({
      refreshToken: "old-refresh",
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });

    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.refreshToken).toBe("new-refresh");
    expect(new Date(tokens.accessExpiresAt!).getTime()).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );
    expect(new Date(tokens.refreshExpiresAt!).getTime()).toBeGreaterThanOrEqual(
      before + 86_400 * 1000,
    );
  });

  it("reports an expired refresh token as terminal", async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, JSON.stringify({ error: "invalid_grant" })),
    ) as unknown as typeof fetch;

    await expect(
      refreshLinkedInToken({
        refreshToken: "old",
        clientId: "client",
        clientSecret: "secret",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "expired_token", retryable: false });
  });

  it("reports a rejected refresh as terminal invalid_token", async () => {
    const fetchImpl = vi.fn(async () =>
      response(401, "nope"),
    ) as unknown as typeof fetch;

    await expect(
      refreshLinkedInToken({
        refreshToken: "old",
        clientId: "client",
        clientSecret: "secret",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "invalid_token", retryable: false });
  });
});

describe("tokenNeedsRefresh", () => {
  const now = new Date("2026-01-15T10:00:00Z").getTime();

  it("returns true inside the five-minute window", () => {
    expect(tokenNeedsRefresh("2026-01-15T10:04:00Z", 300, now)).toBe(true);
    expect(tokenNeedsRefresh("2026-01-15T09:59:00Z", 300, now)).toBe(true);
  });

  it("returns false outside the window or without an expiry", () => {
    expect(tokenNeedsRefresh("2026-01-15T10:06:00Z", 300, now)).toBe(false);
    expect(tokenNeedsRefresh(null, 300, now)).toBe(false);
    expect(tokenNeedsRefresh("not-a-date", 300, now)).toBe(false);
  });
});
