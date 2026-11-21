import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { demoPosts } from "@/lib/demo/fixtures";
import { hydratePosts, signedMediaUrls } from "@/lib/data/hydrate";
import { matchesTarget, parseTargetParam, type ParsedTarget } from "@/lib/targets";
import type { Post, PostStatus, PostWithRelations, PublishingLog } from "@/lib/types";

export const POST_STATUSES: PostStatus[] = [
  "draft",
  "scheduled",
  "processing",
  "published",
  "failed",
  "cancelled",
];

export type PostCounts = Record<PostStatus | "all", number>;

export type ListPostsOptions = {
  status?: PostStatus | "all";
  search?: string;
  /** `accountId` or `accountId|pageId` from the page filter. */
  target?: string;
  limit?: number;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

function postCountQuery(
  supabase: Supabase,
  workspaceId: string,
  target: ParsedTarget | null,
  status?: PostStatus,
) {
  let query = supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (status) query = query.eq("status", status);
  if (target) {
    query = query.eq("social_account_id", target.accountId);
    query = target.pageId
      ? query.eq("social_page_id", target.pageId)
      : query.is("social_page_id", null);
  }
  return query;
}

export async function getPostCounts(
  workspaceId: string,
  target: ParsedTarget | null = null,
): Promise<PostCounts> {
  const supabase = await createClient();
  const results = await Promise.all([
    postCountQuery(supabase, workspaceId, target),
    ...POST_STATUSES.map((status) => postCountQuery(supabase, workspaceId, target, status)),
  ]);

  const counts = { all: results[0].count ?? 0 } as PostCounts;
  POST_STATUSES.forEach((status, index) => {
    counts[status] = results[index + 1].count ?? 0;
  });
  return counts;
}

export async function listPosts(options: ListPostsOptions = {}) {
  const session = await requireSession();
  const target = parseTargetParam(options.target);

  if (session.demo) {
    const all = demoPosts();
    const scoped = target ? all.filter((post) => matchesTarget(post, target)) : all;
    let posts = scoped;
    if (options.status && options.status !== "all") {
      posts = posts.filter((post) => post.status === options.status);
    }
    if (options.search) {
      const needle = options.search.toLowerCase();
      posts = posts.filter((post) => post.content.toLowerCase().includes(needle));
    }
    const counts = { all: scoped.length } as PostCounts;
    for (const status of POST_STATUSES) {
      counts[status] = scoped.filter((post) => post.status === status).length;
    }
    return {
      posts: posts.slice(0, options.limit ?? 100),
      counts,
      signedMedia: {} as Record<string, string>,
      demo: true,
    };
  }

  const supabase = await createClient();
  const [counts, queryResult] = await Promise.all([
    getPostCounts(session.workspace.id, target),
    (() => {
      let query = supabase
        .from("posts")
        .select("*")
        .eq("workspace_id", session.workspace.id)
        .order("scheduled_for", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(options.limit ?? 100);

      if (options.status && options.status !== "all") {
        query = query.eq("status", options.status);
      }
      if (target) {
        query = query.eq("social_account_id", target.accountId);
        query = target.pageId
          ? query.eq("social_page_id", target.pageId)
          : query.is("social_page_id", null);
      }
      if (options.search?.trim()) {
        const safe = options.search.trim().replace(/[%_]/g, "\\$&");
        query = query.ilike("content", `%${safe}%`);
      }
      return query;
    })(),
  ]);

  if (queryResult.error) {
    throw new Error(`Could not load posts: ${queryResult.error.message}`);
  }

  const posts = await hydratePosts(supabase, (queryResult.data ?? []) as Post[]);
  const signedMedia = await signedMediaUrls(supabase, posts);

  return {
    posts,
    counts,
    signedMedia,
    demo: false,
  };
}

export async function getPostById(postId: string): Promise<PostWithRelations | null> {
  const session = await requireSession();
  if (session.demo) {
    return demoPosts().find((post) => post.id === postId) ?? demoPosts()[7] ?? null;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .eq("workspace_id", session.workspace.id)
    .maybeSingle();
  if (!data) return null;
  const [post] = await hydratePosts(supabase, [data as Post]);
  return post ?? null;
}

export async function getCalendarPosts(startIso: string, endIso: string) {
  const session = await requireSession();
  if (session.demo) {
    return demoPosts().filter((post) => {
      if (!post.scheduled_for) return false;
      return post.scheduled_for >= startIso && post.scheduled_for < endIso;
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .not("scheduled_for", "is", null)
    .gte("scheduled_for", startIso)
    .lt("scheduled_for", endIso)
    .neq("status", "draft")
    .neq("status", "cancelled")
    .order("scheduled_for", { ascending: true });

  if (error) throw new Error(`Could not load the calendar: ${error.message}`);
  return hydratePosts(supabase, (data ?? []) as Post[]);
}

export async function getPublishingLogs(limit = 20): Promise<PublishingLog[]> {
  const session = await requireSession();
  if (session.demo) {
    const { demoLogs } = await import("@/lib/demo/fixtures");
    return demoLogs(demoPosts());
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("publishing_logs")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PublishingLog[];
}
