import type { SupabaseClient } from "@supabase/supabase-js";
import type { Post, PostWithRelations } from "@/lib/types";

type AccountRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  provider_account_id: string;
  status: "connected" | "needs_reconnect" | "disconnected";
};

type PageRow = {
  id: string;
  name: string;
  logo_url: string | null;
  provider_page_id: string;
};

type MediaRow = {
  id: string;
  post_id: string;
  user_id: string;
  storage_path: string;
  mime_type: string;
  alt_text: string | null;
  size_bytes: number | null;
  created_at: string;
};

export async function hydratePosts(
  supabase: SupabaseClient,
  posts: Post[],
): Promise<PostWithRelations[]> {
  if (posts.length === 0) return [];

  const accountIds = Array.from(
    new Set(posts.map((post) => post.social_account_id).filter(Boolean)),
  ) as string[];
  const pageIds = Array.from(
    new Set(posts.map((post) => post.social_page_id).filter(Boolean)),
  ) as string[];
  const postIds = posts.map((post) => post.id);

  const [accountsResult, pagesResult, mediaResult] = await Promise.all([
    accountIds.length
      ? supabase
          .from("social_accounts")
          .select("id, display_name, avatar_url, provider_account_id, status")
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    pageIds.length
      ? supabase
          .from("social_pages")
          .select("id, name, logo_url, provider_page_id")
          .in("id", pageIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("post_media")
      .select("id, post_id, user_id, storage_path, mime_type, alt_text, size_bytes, created_at")
      .in("post_id", postIds),
  ]);

  const accountMap = new Map(
    ((accountsResult.data ?? []) as AccountRow[]).map((account) => [account.id, account]),
  );
  const pageMap = new Map(
    ((pagesResult.data ?? []) as PageRow[]).map((page) => [page.id, page]),
  );
  const mediaMap = new Map(
    ((mediaResult.data ?? []) as MediaRow[]).map((media) => [media.post_id, media]),
  );

  return posts.map((post) => {
    const account = post.social_account_id ? accountMap.get(post.social_account_id) : null;
    const page = post.social_page_id ? pageMap.get(post.social_page_id) : null;
    const media = mediaMap.get(post.id) ?? null;
    return {
      ...post,
      media,
      account: account
        ? {
            id: account.id,
            display_name: account.display_name,
            avatar_url: account.avatar_url,
            provider_account_id: account.provider_account_id,
            status: account.status,
          }
        : null,
      page: page
        ? {
            id: page.id,
            name: page.name,
            logo_url: page.logo_url,
            provider_page_id: page.provider_page_id,
          }
        : null,
    };
  });
}

export async function signedMediaUrls(
  supabase: SupabaseClient,
  posts: PostWithRelations[],
): Promise<Record<string, string>> {
  const paths = posts
    .map((post) => post.media?.storage_path)
    .filter((path): path is string => Boolean(path));
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from("post-media").createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}
