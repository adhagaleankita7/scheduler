import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Composer, type ComposerInitial } from "@/components/composer/composer";
import { getAccountsOverview } from "@/lib/data/accounts";
import { getPostById } from "@/lib/data/posts";
import { requireSession } from "@/lib/session";
import { encodeTarget } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { signedMediaUrls } from "@/lib/data/hydrate";

export const metadata: Metadata = { title: "Composer" };
export const dynamic = "force-dynamic";

export default async function ComposerPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string; duplicate?: string }>;
}) {
  const [session, overview, params] = await Promise.all([
    requireSession(),
    getAccountsOverview(),
    searchParams,
  ]);

  const sourceId = params.post ?? params.duplicate;
  const source = sourceId ? await getPostById(sourceId) : null;

  let mediaUrl: string | null = null;
  if (source?.media && !session.demo) {
    try {
      const supabase = await createClient();
      const urls = await signedMediaUrls(supabase, [source]);
      mediaUrl = urls[source.media.storage_path] ?? null;
    } catch {
      mediaUrl = null;
    }
  }

  const editing = Boolean(params.post && source);
  const initial: ComposerInitial = {
    id: editing && source ? source.id : null,
    content: source?.content ?? "",
    target: source
      ? encodeTarget(source.social_account_id ?? "", source.social_page_id)
      : "",
    scheduledFor: editing && source ? source.scheduled_for : null,
    status: editing && source ? source.status : null,
    mediaPath: source?.media?.storage_path ?? null,
    mediaMimeType: source?.media?.mime_type ?? null,
    mediaAlt: source?.media?.alt_text ?? null,
    mediaUrl,
    duplicateOf: params.duplicate && source ? source.id : null,
  };

  return (
    <div>
      <PageHeader
        eyebrow={editing ? "Editing" : "Composer"}
        title={editing ? "Edit your post" : "Write something worth publishing"}
        description={
          editing
            ? "Update the content or move it to a different slot. The publishing engine will use the new schedule."
            : "Draft it once, preview it exactly as LinkedIn will show it, then schedule it for the right moment."
        }
      />
      <Composer
        targets={overview.targets}
        timezone={session.profile.timezone}
        userId={session.user.id}
        demo={session.demo}
        initial={initial}
      />
    </div>
  );
}
