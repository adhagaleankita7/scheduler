import { describe, expect, it } from "vitest";
import {
  matchesTarget,
  parseTargetParam,
  summarizeTargets,
  targetValue,
  type TargetPostRow,
} from "@/lib/targets";
import type { PublishTargetOption } from "@/lib/types";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PAGE = "22222222-2222-4222-8222-222222222222";
const OTHER_PAGE = "33333333-3333-4333-8333-333333333333";

const TARGETS: PublishTargetOption[] = [
  {
    value: ACCOUNT,
    accountId: ACCOUNT,
    pageId: null,
    targetType: "member",
    platform: "linkedin",
    label: "Aarav Mehta",
    subtitle: "Personal profile",
    avatarUrl: null,
    canPublish: true,
  },
  {
    value: `${ACCOUNT}|${PAGE}`,
    accountId: ACCOUNT,
    pageId: PAGE,
    targetType: "organization",
    platform: "facebook",
    label: "Northstar Studio",
    subtitle: "Facebook Page",
    avatarUrl: null,
    canPublish: true,
  },
];

function post(overrides: Partial<TargetPostRow>): TargetPostRow {
  return {
    social_account_id: ACCOUNT,
    social_page_id: null,
    status: "published",
    like_count: 0,
    comment_count: 0,
    share_count: 0,
    published_at: null,
    ...overrides,
  };
}

describe("target values", () => {
  it("builds member and page values", () => {
    expect(targetValue(ACCOUNT)).toBe(ACCOUNT);
    expect(targetValue(ACCOUNT, PAGE)).toBe(`${ACCOUNT}|${PAGE}`);
  });

  it("parses only well-formed target params", () => {
    expect(parseTargetParam(ACCOUNT)).toEqual({ accountId: ACCOUNT, pageId: null });
    expect(parseTargetParam(`${ACCOUNT}|${PAGE}`)).toEqual({ accountId: ACCOUNT, pageId: PAGE });
    expect(parseTargetParam(`  ${ACCOUNT}  `)).toEqual({ accountId: ACCOUNT, pageId: null });
    expect(parseTargetParam("")).toBeNull();
    expect(parseTargetParam(null)).toBeNull();
    expect(parseTargetParam("not-a-uuid")).toBeNull();
    expect(parseTargetParam(`${ACCOUNT}|`)).toBeNull();
    expect(parseTargetParam(`${ACCOUNT}|not-a-uuid`)).toBeNull();
  });

  it("matches member and page posts exactly", () => {
    expect(matchesTarget(post({}), null)).toBe(true);

    const member = parseTargetParam(ACCOUNT)!;
    expect(matchesTarget(post({}), member)).toBe(true);
    expect(matchesTarget(post({ social_page_id: PAGE }), member)).toBe(false);

    const page = parseTargetParam(`${ACCOUNT}|${PAGE}`)!;
    expect(matchesTarget(post({ social_page_id: PAGE }), page)).toBe(true);
    expect(matchesTarget(post({ social_page_id: OTHER_PAGE }), page)).toBe(false);
    expect(matchesTarget(post({ social_page_id: null }), page)).toBe(false);
  });
});

describe("summarizeTargets", () => {
  it("splits counts and engagement per page and profile", () => {
    const summaries = summarizeTargets(TARGETS, [
      post({ status: "published", like_count: 10, comment_count: 2, share_count: 1, published_at: "2026-02-01T10:00:00.000Z" }),
      post({ status: "published", like_count: 5, comment_count: 1, share_count: 0, published_at: "2026-02-03T10:00:00.000Z" }),
      post({ status: "scheduled" }),
      post({ status: "failed", like_count: 99 }),
      post({
        social_page_id: PAGE,
        status: "published",
        like_count: 7,
        comment_count: 3,
        share_count: 2,
        published_at: "2026-02-02T10:00:00.000Z",
      }),
      post({ social_page_id: PAGE, status: "scheduled" }),
      post({ social_page_id: PAGE, status: "draft" }),
      // Unknown page is ignored rather than attributed to the account.
      post({ social_page_id: OTHER_PAGE, status: "published", like_count: 500 }),
    ]);

    const [member, page] = summaries;

    expect(member.counts).toMatchObject({
      total: 4,
      published: 2,
      scheduled: 1,
      failed: 1,
      draft: 0,
    });
    expect(member.engagement).toEqual({ likes: 15, comments: 3, shares: 1 });
    expect(member.lastPublishedAt).toBe("2026-02-03T10:00:00.000Z");

    expect(page.counts).toMatchObject({ total: 3, published: 1, scheduled: 1, draft: 1, failed: 0 });
    expect(page.engagement).toEqual({ likes: 7, comments: 3, shares: 2 });
    expect(page.lastPublishedAt).toBe("2026-02-02T10:00:00.000Z");
  });

  it("returns a zeroed summary for pages with no posts", () => {
    const [member] = summarizeTargets(TARGETS, []);
    expect(member.counts.total).toBe(0);
    expect(member.engagement).toEqual({ likes: 0, comments: 0, shares: 0 });
    expect(member.lastPublishedAt).toBeNull();
  });
});
