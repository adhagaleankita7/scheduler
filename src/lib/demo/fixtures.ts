import { addDaysToDateKey, formatInZone, todayDateKey, zonedDateTimeToUtc } from "@/lib/scheduling/timezone";
import { matchesTarget, type ParsedTarget } from "@/lib/targets";
import type {
  ActivityPoint,
  DashboardData,
  Post,
  PostMedia,
  PostWithRelations,
  Profile,
  PublishingLog,
  QueueSettings,
  SocialAccount,
  SocialPage,
} from "@/lib/types";

const DEMO_USER_ID = "d0000000-0000-4000-8000-000000000001";
const DEMO_WORKSPACE_ID = "d0000000-0000-4000-8000-000000000101";

const DEMO_CONTENT = [
  "Most teams don't have a content problem — they have a consistency problem.\n\nYou don't need 30 brilliant ideas. You need 7 honest ones, published every week.\n\nHere's the system we use:\n\n1. One theme per week\n2. Seven short observations\n3. One fixed publishing time\n4. Review once, then let the queue do the work\n\nConsistency compounds. Brilliance is optional.\n\n#LinkedInGrowth #ContentStrategy",
  "The best LinkedIn post I wrote last month took 11 minutes.\n\nIt wasn't clever. It was specific.\n\nI replaced \"we help teams scale\" with \"we cut our weekly reporting from 6 hours to 25 minutes.\"\n\nSpecific beats polished. Every single time.\n\n#Copywriting #SaaS",
  "A friendly reminder that your company page is not a press release archive.\n\nIt's a person-to-person channel.\n\nPost the lesson, not the launch.\nPost the mistake, not the award.\nPost the question, not the brochure.\n\n#B2BMarketing #LinkedIn",
  "We shipped a tiny feature yesterday.\n\nNo launch email. No webinar. Just a changelog entry and a 4-line post.\n\nIt drove more qualified trials than our last campaign.\n\nDistribution isn't about volume. It's about being useful in the place your customer already is.\n\n#ProductLed #Growth",
  "If your content calendar lives in a spreadsheet, you're one sick day away from silence.\n\nAutomation isn't about removing the human voice. It's about protecting it when life happens.\n\nSchedule the thinking. Keep the spontaneity.\n\n#CreatorEconomy #Systems",
  "Three signs your posting schedule is too ambitious:\n\n• You dread Sundays\n• Every post is a recycled quote card\n• You publish three times in one day and vanish for a week\n\nDrop to one post a day. Make it repeatable. Then earn the right to scale.\n\n#ContentMarketing #LinkedInTips",
  "Sunday evening thought:\n\nThe algorithm rewards people who show up when it's inconvenient.\n\nYou don't need a perfect hook. You need a point of view and a deadline.\n\nSee you tomorrow at 10:00.\n\n#Writing #Consistency",
  "Draft: what I learned rebuilding our onboarding in 30 days. Still shaping the numbers — publish once the cohort data is clean.",
];

const DEMO_IMAGES: (PostMedia | null)[] = [null, null, null, null, null, null, null, null];

function demoAccount(): SocialAccount {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_USER_ID,
    provider: "linkedin",
    provider_account_id: "demo_member",
    display_name: "Aarav Mehta",
    avatar_url: null,
    email: "aarav@northstar.studio",
    scopes: ["openid", "profile", "email", "w_member_social", "w_organization_social", "r_organization_admin"],
    status: "connected",
    token_expires_at: new Date(Date.now() + 47 * 86_400_000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 360 * 86_400_000).toISOString(),
    last_refreshed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    last_error: null,
    connected_at: new Date(Date.now() - 26 * 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 26 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function demoPages(accountId: string): SocialPage[] {
  const base = {
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_USER_ID,
    social_account_id: accountId,
    provider: "linkedin" as const,
    page_type: "organization",
    created_at: new Date(Date.now() - 26 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  return [
    {
      ...base,
      id: "b0000000-0000-4000-8000-000000000001",
      provider_page_id: "104231998",
      name: "Northstar Studio",
      vanity_name: "northstar-studio",
      logo_url: null,
      role: "ADMINISTRATOR",
      can_publish: true,
      status: "APPROVED",
    },
    {
      ...base,
      id: "b0000000-0000-4000-8000-000000000002",
      provider_page_id: "88725103",
      name: "Field Notes by Northstar",
      vanity_name: "field-notes-northstar",
      logo_url: null,
      role: "ANALYST",
      can_publish: false,
      status: "APPROVED",
    },
  ];
}

export function demoProfile(): Profile {
  return {
    id: DEMO_USER_ID,
    email: "demo@linkflow.local",
    full_name: "Aarav Mehta",
    headline: "Founder · Northstar Studio",
    avatar_url: null,
    timezone: "Asia/Kolkata",
    default_posting_time: "10:00:00",
    default_posting_days: [1, 2, 3, 4, 5, 6, 7],
    theme: "system",
    onboarded: true,
    active_workspace_id: DEMO_WORKSPACE_ID,
    created_at: new Date(Date.now() - 26 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function demoQueueSettings(): QueueSettings {
  return {
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_USER_ID,
    timezone: "Asia/Kolkata",
    posting_days: [1, 2, 3, 4, 5, 6, 7],
    posting_times: ["10:00:00"],
    is_paused: false,
    last_assigned_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 26 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function basePost(overrides: Partial<Post>): Post {
  return {
    id: crypto.randomUUID(),
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_USER_ID,
    social_account_id: "a0000000-0000-4000-8000-000000000001",
    social_page_id: null,
    schedule_id: null,
    target_type: "member",
    content: "",
    first_comment: null,
    status: "draft",
    scheduled_for: null,
    published_at: null,
    provider_post_id: null,
    provider_post_url: null,
    is_mock: false,
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
    last_error: null,
    last_error_code: null,
    last_http_status: null,
    locked_at: null,
    locked_by: null,
    queue_position: null,
    idempotency_key: crypto.randomUUID(),
    like_count: 0,
    comment_count: 0,
    share_count: 0,
    engagement_synced_at: null,
    engagement_error: null,
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function demoPosts(now = new Date()): PostWithRelations[] {
  const tz = "Asia/Kolkata";
  const today = todayDateKey(tz, now);
  const account = demoAccount();
  const pages = demoPages(account.id);
  const dayAt = (offset: number, time = "10:00:00") =>
    zonedDateTimeToUtc(addDaysToDateKey(today, offset), time, tz).toISOString();

  const posts: Post[] = [
    basePost({
      content: DEMO_CONTENT[0],
      status: "published",
      scheduled_for: dayAt(-6),
      published_at: dayAt(-6),
      provider_post_id: "urn:li:share:7301000000000000001",
      provider_post_url: "https://www.linkedin.com/feed/update/urn:li:share:7301000000000000001",
      attempt_count: 1,
      like_count: 124,
      comment_count: 18,
      share_count: 9,
      engagement_synced_at: dayAt(-6, "12:00:00"),
    }),
    basePost({
      content: DEMO_CONTENT[1],
      status: "published",
      scheduled_for: dayAt(-5),
      published_at: dayAt(-5),
      provider_post_id: "urn:li:share:7301000000000000002",
      provider_post_url: "https://www.linkedin.com/feed/update/urn:li:share:7301000000000000002",
      attempt_count: 1,
      like_count: 87,
      comment_count: 11,
      share_count: 4,
      engagement_synced_at: dayAt(-5, "12:00:00"),
      social_page_id: pages[0].id,
      target_type: "organization",
    }),
    basePost({
      content: DEMO_CONTENT[2],
      status: "published",
      scheduled_for: dayAt(-4),
      published_at: dayAt(-4),
      provider_post_id: "urn:li:share:7301000000000000003",
      provider_post_url: "https://www.linkedin.com/feed/update/urn:li:share:7301000000000000003",
      attempt_count: 1,
      like_count: 63,
      comment_count: 7,
      share_count: 2,
      engagement_synced_at: dayAt(-4, "12:00:00"),
    }),
    basePost({
      content: DEMO_CONTENT[3],
      status: "published",
      scheduled_for: dayAt(-3),
      published_at: dayAt(-3),
      provider_post_id: "urn:li:share:7301000000000000004",
      provider_post_url: "https://www.linkedin.com/feed/update/urn:li:share:7301000000000000004",
      attempt_count: 2,
      last_error: "LinkedIn was briefly unavailable. The retry succeeded.",
      last_error_code: "linkedin_server_error",
      like_count: 210,
      comment_count: 32,
      share_count: 15,
      engagement_synced_at: dayAt(-3, "12:00:00"),
    }),
    basePost({
      content: DEMO_CONTENT[4],
      status: "published",
      scheduled_for: dayAt(-2),
      published_at: dayAt(-2),
      provider_post_id: "urn:li:share:7301000000000000005",
      provider_post_url: "https://www.linkedin.com/feed/update/urn:li:share:7301000000000000005",
      attempt_count: 1,
      like_count: 45,
      comment_count: 6,
      share_count: 1,
      engagement_synced_at: dayAt(-2, "12:00:00"),
    }),
    basePost({
      content: DEMO_CONTENT[5],
      status: "published",
      scheduled_for: dayAt(-1),
      published_at: dayAt(-1),
      provider_post_id: "urn:li:share:7301000000000000006",
      provider_post_url: "https://www.linkedin.com/feed/update/urn:li:share:7301000000000000006",
      attempt_count: 1,
      like_count: 156,
      comment_count: 21,
      share_count: 8,
      engagement_synced_at: dayAt(-1, "12:00:00"),
      social_page_id: pages[0].id,
      target_type: "organization",
    }),
    basePost({
      content: DEMO_CONTENT[6],
      status: "scheduled",
      scheduled_for: dayAt(0),
      queue_position: 1,
    }),
    basePost({
      content: DEMO_CONTENT[0],
      status: "scheduled",
      scheduled_for: dayAt(1),
      queue_position: 2,
    }),
    basePost({
      content: DEMO_CONTENT[2],
      status: "scheduled",
      scheduled_for: dayAt(2),
      queue_position: 3,
      social_page_id: pages[0].id,
      target_type: "organization",
    }),
    basePost({
      content: DEMO_CONTENT[3],
      status: "scheduled",
      scheduled_for: dayAt(3),
      queue_position: 4,
    }),
    basePost({
      content: DEMO_CONTENT[5],
      status: "failed",
      scheduled_for: dayAt(-1, "18:30:00"),
      last_error:
        "Your LinkedIn member no longer has an admin role on this company page. Reconnect or choose another target.",
      last_error_code: "missing_permissions",
      last_http_status: 403,
      attempt_count: 5,
      target_type: "organization",
      social_page_id: pages[0].id,
      social_account_id: account.id,
    }),
    basePost({
      content: DEMO_CONTENT[6],
      status: "draft",
    }),
    basePost({
      content: DEMO_CONTENT[7],
      status: "draft",
    }),
  ];

  return posts.map((post) => ({
    ...post,
    media: DEMO_IMAGES[0],
    account: {
      id: account.id,
      display_name: account.display_name,
      avatar_url: account.avatar_url,
      provider: account.provider,
      provider_account_id: account.provider_account_id,
      status: account.status,
    },
    page: post.social_page_id
      ? {
          id: pages[0].id,
          name: pages[0].name,
          logo_url: pages[0].logo_url,
          provider_page_id: pages[0].provider_page_id,
        }
      : null,
  }));
}

export function demoAccounts() {
  const account = demoAccount();
  const pages = demoPages(account.id);
  return { accounts: [account], pages };
}

export function demoActivity(posts: Post[] = demoPosts(), now = new Date()): ActivityPoint[] {
  const tz = "Asia/Kolkata";
  const today = todayDateKey(tz, now);
  return Array.from({ length: 7 }).map((_, index) => {
    const dateKey = addDaysToDateKey(today, index - 6);
    const scheduled = posts.filter(
      (post) =>
        post.scheduled_for && formatInZone(post.scheduled_for, tz, "yyyy-MM-dd") === dateKey,
    ).length;
    const published = posts.filter(
      (post) => post.published_at && formatInZone(post.published_at, tz, "yyyy-MM-dd") === dateKey,
    ).length;
    const failed = posts.filter(
      (post) => post.status === "failed" && formatInZone(post.updated_at, tz, "yyyy-MM-dd") === dateKey,
    ).length;
    return { date: dateKey, scheduled, published, failed };
  });
}

export function demoLogs(posts: PostWithRelations[]): PublishingLog[] {
  return posts
    .filter((post) => post.status === "published" || post.status === "failed")
    .slice(0, 10)
    .map((post, index) => ({
      id: index + 1,
      workspace_id: post.workspace_id,
      post_id: post.id,
      user_id: post.user_id,
      attempt: post.attempt_count,
      status: post.status === "published" ? "success" : "failure",
      provider: "linkedin",
      http_status: post.status === "published" ? 201 : 403,
      provider_post_id: post.provider_post_id,
      error_code: post.last_error_code,
      message:
        post.status === "published"
          ? "Published to LinkedIn."
          : post.last_error ?? "Publishing failed.",
      is_mock: false,
      metadata: null,
      created_at: post.published_at ?? post.updated_at,
    }));
}

export function demoDashboardData(target: ParsedTarget | null = null): DashboardData {
  const all = demoPosts();
  const posts = all.filter((post) => matchesTarget(post, target));
  const scheduled = posts.filter((post) => post.status === "scheduled");
  const published = posts.filter((post) => post.status === "published");
  return {
    counts: {
      total: posts.length,
      scheduled: scheduled.length,
      published: published.length,
      draft: posts.filter((post) => post.status === "draft").length,
      failed: posts.filter((post) => post.status === "failed").length,
    },
    engagement: published.reduce(
      (totals, post) => ({
        likes: totals.likes + post.like_count,
        comments: totals.comments + post.comment_count,
        shares: totals.shares + post.share_count,
      }),
      { likes: 0, comments: 0, shares: 0 },
    ),
    nextPost: scheduled[0] ?? null,
    recent: [...posts]
      .filter((post) => post.status === "published" || post.status === "failed")
      .sort(
        (a, b) =>
          new Date(b.published_at ?? b.updated_at).getTime() -
          new Date(a.published_at ?? a.updated_at).getTime(),
      )
      .slice(0, 5),
    upcoming: scheduled.slice(0, 5),
    activity: demoActivity(posts),
    weeklyTarget: 7,
  };
}
