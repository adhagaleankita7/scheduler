import { describe, expect, it, vi } from "vitest";
import {
  EngagementUnavailableError,
  fetchFacebookEngagement,
  fetchLinkedInEngagement,
  linkedInActivityUrn,
  parseFacebookEngagement,
  parseLinkedInEngagement,
  type EngagementCounts,
} from "../supabase/functions/_shared/engagement";
import { extractDuplicateUrn } from "../supabase/functions/_shared/linkedin";

describe("parseLinkedInEngagement", () => {
  it("reads likes and first-level comments", () => {
    expect(
      parseLinkedInEngagement({
        likesSummary: { totalLikes: 42 },
        commentsSummary: { totalFirstLevelComments: 7 },
      }),
    ).toEqual({ likes: 42, comments: 7, shares: 0 });
  });

  it("treats missing or invalid counts as zero", () => {
    expect(parseLinkedInEngagement({ likesSummary: { totalLikes: "nope" } })).toEqual({
      likes: 0,
      comments: 0,
      shares: 0,
    });
    expect(parseLinkedInEngagement(null)).toEqual({ likes: 0, comments: 0, shares: 0 });
  });
});

describe("parseFacebookEngagement", () => {
  it("reads reaction, comment and share summaries", () => {
    expect(
      parseFacebookEngagement({
        reactions: { summary: { total_count: 31 } },
        comments: { summary: { total_count: 5 } },
        shares: { count: 2 },
      }),
    ).toEqual({ likes: 31, comments: 5, shares: 2 });
  });
});

describe("linkedInActivityUrn", () => {
  it("accepts real share/ugcPost/activity URNs", () => {
    expect(linkedInActivityUrn("urn:li:share:123")).toBe("urn:li:share:123");
    expect(linkedInActivityUrn("urn:li:ugcPost:456")).toBe("urn:li:ugcPost:456");
    expect(linkedInActivityUrn("urn:li:activity:789")).toBe("urn:li:activity:789");
  });

  it("promotes a bare numeric id to a share URN", () => {
    expect(linkedInActivityUrn("7527709240824786944")).toBe(
      "urn:li:share:7527709240824786944",
    );
  });

  it("rejects empty, mock and synthetic ids", () => {
    expect(linkedInActivityUrn(null)).toBeNull();
    expect(linkedInActivityUrn("")).toBeNull();
    expect(linkedInActivityUrn("urn:li:share:accepted_123")).toBeNull();
    expect(linkedInActivityUrn("urn:linkedin:mock_123")).toBeNull();
  });
});

describe("extractDuplicateUrn", () => {
  it("finds the existing URN in a LinkedIn duplicate error", () => {
    expect(
      extractDuplicateUrn(
        "LinkedIn rejected the post: com.linkedin.content.common.exception.BadRequestResponseException: Content is a duplicate of urn:li:share:7527709240824786944",
      ),
    ).toBe("urn:li:share:7527709240824786944");
  });

  it("returns null when no URN is present", () => {
    expect(extractDuplicateUrn("LinkedIn reported this post as a duplicate.")).toBeNull();
  });
});

describe("fetchLinkedInEngagement", () => {
  it("calls the Social Actions endpoint with the URN and auth headers", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          likesSummary: { totalLikes: 12 },
          commentsSummary: { totalFirstLevelComments: 3 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const counts = await fetchLinkedInEngagement({
      accessToken: "token-123",
      apiVersion: "202610",
      providerPostId: "urn:li:share:555",
      fetchImpl,
    });

    expect(counts).toEqual<EngagementCounts>({ likes: 12, comments: 3, shares: 0 });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toContain("/v2/socialActions/urn%3Ali%3Ashare%3A555");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer token-123",
      "LinkedIn-Version": "202610",
    });
  });

  it("treats 403/404 as unavailable instead of a hard error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;

    await expect(
      fetchLinkedInEngagement({
        accessToken: "token-123",
        apiVersion: "202610",
        providerPostId: "urn:li:share:555",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(EngagementUnavailableError);
  });
});

describe("fetchFacebookEngagement", () => {
  it("derives a Page token, then reads Graph summaries", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/accounts")) {
        return new Response(
          JSON.stringify({ data: [{ id: "104231998", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          reactions: { summary: { total_count: 9 } },
          comments: { summary: { total_count: 4 } },
          shares: { count: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const counts = await fetchFacebookEngagement({
      accessToken: "member-token",
      pageId: "104231998",
      graphVersion: "v23.0",
      providerPostId: "104231998_777",
      fetchImpl,
    });

    expect(counts).toEqual<EngagementCounts>({ likes: 9, comments: 4, shares: 1 });
    const statsCall = vi
      .mocked(fetchImpl)
      .mock.calls.find(([url]) => String(url).includes("104231998_777"));
    const statsUrl = decodeURIComponent(String(statsCall?.[0] ?? ""));
    expect(statsUrl).toContain("reactions.summary(total_count)");
    expect(statsUrl).toContain("access_token=page-token");
  });

  it("treats a missing pages_read_user_content scope as unavailable", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/accounts")) {
        return new Response(
          JSON.stringify({ data: [{ id: "104231998", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          error: {
            message:
              "(#10) This endpoint requires the 'pages_read_user_content' permission or the 'Page Public Content Access' feature.",
            code: 10,
          },
        }),
        { status: 400 },
      );
    }) as unknown as typeof fetch;

    await expect(
      fetchFacebookEngagement({
        accessToken: "member-token",
        pageId: "104231998",
        graphVersion: "v23.0",
        providerPostId: "104231998_777",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(EngagementUnavailableError);
  });
});
