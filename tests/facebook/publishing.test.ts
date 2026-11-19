import { describe, expect, it, vi } from "vitest";
import {
  FacebookPublishError,
  FACEBOOK_MESSAGE_LIMIT,
  classifyFacebookStatus,
  fetchPageAccessToken,
  graphBaseUrl,
  isRetryableFacebookError,
  publishToFacebookPage,
  refreshFacebookToken,
  type FacebookPublishInput,
} from "../../supabase/functions/_shared/facebook";

function baseInput(overrides: Partial<FacebookPublishInput> = {}): FacebookPublishInput {
  return {
    postId: "11111111-1111-4111-8111-111111111111",
    pageId: "104231998",
    message: "Hello Facebook",
    accessToken: "member-token",
    graphVersion: "v23.0",
    ...overrides,
  };
}

function response(status: number, body: string | null = null) {
  return new Response(body, { status });
}

function accountsResponse(
  pages: Array<{ id: string; access_token: string; name?: string }>,
  paging?: { next?: string },
) {
  return response(200, JSON.stringify({ data: pages, paging }));
}

/** Publishes a text post: /me/accounts then /feed. */
function textFetch(
  feedBody: string = JSON.stringify({ id: "104231998_987654" }),
  feedStatus = 200,
) {
  return vi.fn(async (url: string) => {
    if (url.includes("/me/accounts")) {
      return accountsResponse([{ id: "104231998", access_token: "page-token" }]);
    }
    return response(feedStatus, feedBody);
  }) as unknown as typeof fetch;
}

describe("classifyFacebookStatus", () => {
  it("treats 401 and provider code 190 as an invalid token", () => {
    for (const [status, body] of [
      [401, "{}"],
      [400, JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token." } })],
    ] as const) {
      const classified = classifyFacebookStatus(status, body);
      expect(classified.code).toBe("invalid_token");
      expect(classified.retryable).toBe(false);
    }
  });

  it("retries rate limits and transient failures", () => {
    for (const code of [4, 17, 32, 613]) {
      const classified = classifyFacebookStatus(
        400,
        JSON.stringify({ error: { code } }),
      );
      expect(classified.code).toBe("rate_limited");
      expect(classified.retryable).toBe(true);
    }

    for (const [status, body] of [
      [429, "{}"],
      [500, "{}"],
      [503, JSON.stringify({ error: { code: 1 } })],
      [400, JSON.stringify({ error: { code: 2 } })],
      [400, JSON.stringify({ error: { code: 100, is_transient: true } })],
    ] as const) {
      const classified = classifyFacebookStatus(status, body);
      expect(classified.retryable).toBe(true);
    }
    expect(classifyFacebookStatus(500, "{}").code).toBe("facebook_server_error");
  });

  it("treats permission errors as permanent", () => {
    for (const [status, body] of [
      [403, "{}"],
      [400, JSON.stringify({ error: { code: 200, message: "(#200) Permissions error" } })],
      [400, JSON.stringify({ error: { code: 294 } })],
    ] as const) {
      const classified = classifyFacebookStatus(status, body);
      expect(classified.code).toBe("missing_permissions");
      expect(classified.retryable).toBe(false);
    }
  });

  it("surfaces the provider message for rejected content", () => {
    const classified = classifyFacebookStatus(
      400,
      JSON.stringify({
        error: { code: 100, message: "(#100) The post is too long." },
      }),
    );
    expect(classified.code).toBe("invalid_content");
    expect(classified.retryable).toBe(false);
    expect(classified.message).toContain("too long");
  });

  it("falls back to a generic code for unknown statuses", () => {
    const classified = classifyFacebookStatus(418, "");
    expect(classified.code).toBe("unknown_error");
    expect(classified.retryable).toBe(false);
    expect(classified.message).toContain("418");
  });
});

describe("graphBaseUrl", () => {
  it("normalizes the graph version and defaults to v23.0", () => {
    expect(graphBaseUrl("v23.0")).toBe("https://graph.facebook.com/v23.0");
    expect(graphBaseUrl("/v21.0/")).toBe("https://graph.facebook.com/v21.0");
    expect(graphBaseUrl("")).toBe("https://graph.facebook.com/v23.0");
  });
});

describe("fetchPageAccessToken", () => {
  it("returns the Page token from the member's page list", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/v23.0/me/accounts");
      expect(url).toContain("access_token=member-token");
      return accountsResponse([
        { id: "111", access_token: "other-page-token" },
        { id: "104231998", access_token: "page-token" },
      ]);
    }) as unknown as typeof fetch;

    await expect(
      fetchPageAccessToken({
        accessToken: "member-token",
        pageId: "104231998",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).resolves.toBe("page-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows cursor pagination until the Page is found", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        return accountsResponse([{ id: "111", access_token: "first" }], {
          next: "https://graph.facebook.com/v23.0/me/accounts?after=cursor&access_token=member-token",
        });
      }
      return accountsResponse([{ id: "104231998", access_token: "page-token" }]);
    }) as unknown as typeof fetch;

    await expect(
      fetchPageAccessToken({
        accessToken: "member-token",
        pageId: "104231998",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).resolves.toBe("page-token");
    expect(calls).toHaveLength(2);
  });

  it("fails closed when the Page is not in the list", async () => {
    const fetchImpl = vi.fn(async () =>
      accountsResponse([{ id: "111", access_token: "other" }]),
    ) as unknown as typeof fetch;

    await expect(
      fetchPageAccessToken({
        accessToken: "member-token",
        pageId: "104231998",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "missing_permissions", retryable: false });
  });

  it("reports an expired member token while listing pages", async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, JSON.stringify({ error: { code: 190, message: "Token expired" } })),
    ) as unknown as typeof fetch;

    await expect(
      fetchPageAccessToken({
        accessToken: "member-token",
        pageId: "104231998",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "invalid_token", httpStatus: 400, retryable: false });
  });
});

describe("publishToFacebookPage", () => {
  it("publishes a text post to the Page feed with the Page token", async () => {
    const fetchImpl = textFetch();

    const result = await publishToFacebookPage(baseInput({ fetchImpl }));

    expect(result).toMatchObject({
      providerPostId: "104231998_987654",
      providerPostUrl: "https://www.facebook.com/104231998_987654",
      httpStatus: 200,
      isMock: false,
      imageUrn: null,
    });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe("https://graph.facebook.com/v23.0/104231998/feed");

    const body = calls[1][1].body as URLSearchParams;
    expect(body.get("message")).toBe("Hello Facebook");
    expect(body.get("access_token")).toBe("page-token");
  });

  it("uploads an image to /photos with the Page token", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/me/accounts")) {
        return accountsResponse([{ id: "104231998", access_token: "page-token" }]);
      }
      return response(200, JSON.stringify({ id: "photo-1", post_id: "104231998_111" }));
    }) as unknown as typeof fetch;

    const result = await publishToFacebookPage(
      baseInput({
        fetchImpl,
        image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", altText: "Logo" },
      }),
    );

    expect(result.providerPostId).toBe("104231998_111");
    expect(result.imageUrn).toBe("photo-1");

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][0]).toBe("https://graph.facebook.com/v23.0/104231998/photos");

    const form = calls[1][1].body as FormData;
    expect(form.get("message")).toBe("Hello Facebook");
    expect(form.get("published")).toBe("true");
    expect(form.get("access_token")).toBe("page-token");
    const source = form.get("source");
    expect(source).toBeTruthy();
    expect((source as Blob).type).toBe("image/png");
    expect((source as Blob).size).toBe(3);
  });

  it("falls back to the photo id when Facebook omits post_id", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/me/accounts")) {
        return accountsResponse([{ id: "104231998", access_token: "page-token" }]);
      }
      return response(200, JSON.stringify({ id: "photo-9" }));
    }) as unknown as typeof fetch;

    const result = await publishToFacebookPage(
      baseInput({
        fetchImpl,
        image: { bytes: new Uint8Array([1]), mimeType: "image/jpeg" },
      }),
    );
    expect(result.providerPostId).toBe("photo-9");
  });

  it("rejects invalid input before calling Facebook", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      publishToFacebookPage(baseInput({ fetchImpl, accessToken: "" })),
    ).rejects.toMatchObject({ code: "invalid_token", retryable: false });
    await expect(
      publishToFacebookPage(baseInput({ fetchImpl, pageId: "" })),
    ).rejects.toMatchObject({ code: "invalid_content", retryable: false });
    await expect(
      publishToFacebookPage(baseInput({ fetchImpl, message: "   " })),
    ).rejects.toMatchObject({ code: "invalid_content", retryable: false });
    await expect(
      publishToFacebookPage(
        baseInput({ fetchImpl, message: "a".repeat(FACEBOOK_MESSAGE_LIMIT + 1) }),
      ),
    ).rejects.toMatchObject({ code: "invalid_content" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a permission failure to a permanent publishing error", async () => {
    const fetchImpl = textFetch(
      JSON.stringify({ error: { code: 200, message: "(#200) Permissions error" } }),
      403,
    );

    await expect(
      publishToFacebookPage(baseInput({ fetchImpl })),
    ).rejects.toMatchObject({
      code: "missing_permissions",
      httpStatus: 403,
      retryable: false,
    });
  });

  it("marks rate limits as retryable", async () => {
    const fetchImpl = textFetch(
      JSON.stringify({ error: { code: 4, message: "Application request limit reached" } }),
      400,
    );

    const error = await publishToFacebookPage(baseInput({ fetchImpl })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FacebookPublishError);
    expect(isRetryableFacebookError(error)).toBe(true);
  });

  it("retries when Facebook accepts the post but returns no id", async () => {
    const fetchImpl = textFetch("{}", 200);
    await expect(
      publishToFacebookPage(baseInput({ fetchImpl })),
    ).rejects.toMatchObject({ code: "facebook_server_error", retryable: true });
  });

  it("turns network failures into a retryable error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const error = await publishToFacebookPage(baseInput({ fetchImpl })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FacebookPublishError);
    expect(error).toMatchObject({ code: "network_error", retryable: true });
    expect(isRetryableFacebookError(error)).toBe(true);
  });
});

describe("refreshFacebookToken", () => {
  it("exchanges the stored token for a fresh long-lived one", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/v23.0/oauth/access_token");
      expect(url).toContain("grant_type=fb_exchange_token");
      expect(url).toContain("fb_exchange_token=member-token");
      return response(200, JSON.stringify({ access_token: "fresh-token", expires_in: 5_184_000 }));
    }) as unknown as typeof fetch;

    await expect(
      refreshFacebookToken({
        accessToken: "member-token",
        appId: "app-id",
        appSecret: "app-secret",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).resolves.toEqual({ accessToken: "fresh-token", expiresIn: 5_184_000 });
  });

  it("fails with invalid_token when Facebook rejects the exchange", async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, JSON.stringify({ error: { message: "Invalid OAuth access token." } })),
    ) as unknown as typeof fetch;

    await expect(
      refreshFacebookToken({
        accessToken: "expired",
        appId: "app-id",
        appSecret: "app-secret",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "invalid_token", httpStatus: 400, retryable: false });
  });

  it("fails when Facebook returns an empty token", async () => {
    const fetchImpl = vi.fn(async () => response(200, JSON.stringify({}))) as unknown as typeof fetch;

    await expect(
      refreshFacebookToken({
        accessToken: "member-token",
        appId: "app-id",
        appSecret: "app-secret",
        graphVersion: "v23.0",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "invalid_token", retryable: false });
  });
});
