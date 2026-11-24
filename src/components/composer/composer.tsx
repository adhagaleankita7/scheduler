"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  Eye,
  Hash,
  ImagePlus,
  Info,
  Loader2,
  Save,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { TargetSelect } from "@/components/shared/target-select";
import { LinkedInPostPreview } from "@/components/shared/linkedin-preview";
import { FacebookPostPreview } from "@/components/shared/facebook-preview";
import { savePost } from "@/lib/actions/posts";
import { createClient } from "@/lib/supabase/client";
import {
  addDaysToDateKey,
  formatInZone,
  normalizeTime,
  todayDateKey,
  zonedDateTimeToUtc,
  zonedInputToIso,
} from "@/lib/scheduling/timezone";
import {
  MAX_FIRST_COMMENT_LENGTH,
  MAX_POST_LENGTH,
  countCharacters,
} from "@/lib/validation";
import { randomUUID } from "@/lib/uuid";
import type { PostStatus, PublishTargetOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const HASHTAG_SUGGESTIONS = ["#LinkedIn", "#Growth", "#SaaS", "#ContentStrategy", "#Founders"];

export type ComposerInitial = {
  id: string | null;
  content: string;
  firstComment: string | null;
  target: string;
  scheduledFor: string | null;
  status: PostStatus | null;
  mediaPath: string | null;
  mediaMimeType: string | null;
  mediaAlt: string | null;
  mediaUrl: string | null;
  duplicateOf: string | null;
};

function defaultScheduleValue(timezone: string, time: string) {
  const normalized = normalizeTime(time) ?? "10:00";
  const today = todayDateKey(timezone);
  const todayInstant = zonedDateTimeToUtc(today, normalized, timezone);
  const dateKey =
    todayInstant.getTime() > Date.now() + 5 * 60 * 1000
      ? today
      : addDaysToDateKey(today, 1);
  return `${dateKey}T${normalized}`;
}

export function Composer({
  targets,
  timezone,
  userId,
  demo,
  initial,
}: {
  targets: PublishTargetOption[];
  timezone: string;
  userId: string;
  demo: boolean;
  initial: ComposerInitial;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const firstTarget = targets.find((target) => target.canPublish)?.value ?? "";
  const [content, setContent] = useState(initial.content);
  const [firstComment, setFirstComment] = useState(initial.firstComment ?? "");
  const [target, setTarget] = useState(initial.target || firstTarget);
  const [when, setWhen] = useState(() =>
    initial.scheduledFor
      ? formatInZone(new Date(initial.scheduledFor), timezone, "yyyy-MM-dd'T'HH:mm")
      : defaultScheduleValue(timezone, "10:00"),
  );
  const [altText, setAltText] = useState(initial.mediaAlt ?? "");
  const [mediaPath, setMediaPath] = useState<string | null>(initial.mediaPath);
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(initial.mediaMimeType);
  const [mediaUrl, setMediaUrl] = useState<string | null>(initial.mediaUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => targets.find((item) => item.value === target) ?? null,
    [targets, target],
  );
  const characters = countCharacters(content);
  const overLimit = characters > MAX_POST_LENGTH;
  const usedPercent = Math.min(100, (characters / MAX_POST_LENGTH) * 100);
  const editable = !initial.status || ["draft", "scheduled", "failed", "cancelled"].includes(initial.status);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  async function handleFile(file: File) {
    setError(null);
    if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
      setError("Images must be JPEG, PNG or WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Images must be smaller than 8 MB.");
      return;
    }
    if (demo) {
      setError("Demo mode cannot upload files. Connect Supabase to attach images.");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${userId}/${randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("post-media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data } = await supabase.storage.from("post-media").createSignedUrl(path, 3600);
      setMediaPath(path);
      setMediaMimeType(file.type);
      setMediaUrl(data?.signedUrl ?? null);
      toast.success("Image uploaded");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? `Upload failed: ${uploadError.message}`
          : "Upload failed. Try a smaller image.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeImage() {
    setMediaPath(null);
    setMediaMimeType(null);
    setMediaUrl(null);
    setAltText("");
  }

  function appendHashtag(tag: string) {
    setContent((value) => {
      const trimmed = value.replace(/\s+$/, "");
      if (trimmed.includes(tag)) return value;
      return `${trimmed}${trimmed ? " " : ""}${tag}`;
    });
  }

  function submit(mode: "draft" | "schedule" | "now") {
    setError(null);
    if (!content.trim()) {
      setError("Write something to share before saving.");
      return;
    }
    if (overLimit) {
      setError(`Posts can be at most ${MAX_POST_LENGTH.toLocaleString()} characters.`);
      return;
    }
    if (!target) {
      setError("Choose a LinkedIn profile/page or a Facebook Page first.");
      return;
    }
    if (!selected?.canPublish) {
      setError(selected?.disabledReason ?? "That publishing target can't publish yet.");
      return;
    }

    let scheduledFor: string | null = null;
    if (mode === "schedule") {
      const iso = zonedInputToIso(when, timezone);
      if (!iso) {
        setError("Choose a valid date and time.");
        return;
      }
      if (new Date(iso).getTime() < Date.now() - 30_000) {
        setError("The scheduled time is in the past. Pick a future time.");
        return;
      }
      scheduledFor = iso;
    }

    startTransition(async () => {
      const result = await savePost({
        id: initial.id ?? undefined,
        content: content.trim(),
        firstComment: firstComment.trim() || null,
        target,
        scheduledFor,
        mode,
        mediaPath,
        mediaMimeType,
        mediaAlt: altText.trim() || null,
        timezone,
      });

      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success(
        result.message ??
          (mode === "now" ? "Publishing now" : mode === "schedule" ? "Post scheduled" : "Draft saved"),
      );
      if (mode === "draft" && !initial.id) {
        router.push("/posts?status=draft");
      } else {
        router.push(mode === "now" ? "/posts" : "/queue");
      }
      router.refresh();
    });
  }

  if (!editable) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card p-6 text-center shadow-card">
        <TriangleAlert className="mx-auto size-8 text-amber-500" />
        <h3 className="font-display mt-3 text-[15px] font-semibold">This post can no longer be edited</h3>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-[12.5px]">
          {initial.status === "published"
            ? "It's already live. Duplicate it from All posts to reuse the content."
            : "The publishing engine is currently working on it."}
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/posts">Back to all posts</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {initial.duplicateOf && (
          <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-3.5 py-2.5 text-[12px] text-primary">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Duplicated from an existing post. This is a new draft — nothing is scheduled until you
            choose a time.
          </div>
        )}

        {targets.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-5">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-700 dark:text-amber-300">
              <TriangleAlert className="size-4" /> Connect an account to start writing
            </div>
            <p className="text-muted-foreground text-[12.5px] leading-relaxed">
              LINKFLOW publishes through the official LinkedIn and Facebook APIs. Connect your
              LinkedIn profile/company page or a Facebook Page before creating posts.
            </p>
            <Button asChild variant="gradient" size="sm">
              <Link href="/accounts">Connect an account</Link>
            </Button>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="post-content" className="text-[12.5px]">
              Post content
            </Label>
            <span
              className={cn(
                "text-[11px] font-medium tabular-nums",
                overLimit ? "text-destructive" : characters > MAX_POST_LENGTH * 0.9 ? "text-amber-500" : "text-muted-foreground",
              )}
            >
              {characters.toLocaleString()} / {MAX_POST_LENGTH.toLocaleString()}
            </span>
          </div>

          <Textarea
            id="post-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Share a specific lesson, a surprising result, or a question your audience is already asking…"
            className="mt-2 min-h-[248px] resize-y border-0 bg-transparent px-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0"
            aria-invalid={overLimit}
          />

          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                overLimit ? "bg-destructive" : characters > MAX_POST_LENGTH * 0.9 ? "bg-amber-500" : "brand-gradient",
              )}
              style={{ width: `${usedPercent}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground inline-flex items-center gap-1 text-[10.5px] font-medium">
              <Hash className="size-3" /> Add:
            </span>
            {HASHTAG_SUGGESTIONS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => appendHashtag(tag)}
                className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-border/70 pt-4">
            {mediaUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-border/70">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl} alt={altText || "Post attachment"} className="max-h-56 w-full object-cover" />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
                  aria-label="Remove image"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <ImagePlus className="size-4" /> Add an image
                    <span className="text-muted-foreground/70">· JPEG, PNG or WebP up to 8 MB</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            {mediaUrl && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="alt-text" className="text-[11.5px]">
                  Image description (alt text)
                </Label>
                <Input
                  id="alt-text"
                  value={altText}
                  maxLength={300}
                  onChange={(event) => setAltText(event.target.value)}
                  placeholder="Describe the image for screen readers"
                />
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-border/70 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="first-comment" className="text-[12.5px]">
                First comment{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <span
                className={cn(
                  "text-[11px] font-medium tabular-nums",
                  countCharacters(firstComment) > MAX_FIRST_COMMENT_LENGTH
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {countCharacters(firstComment).toLocaleString()} /{" "}
                {MAX_FIRST_COMMENT_LENGTH.toLocaleString()}
              </span>
            </div>
            <Textarea
              id="first-comment"
              value={firstComment}
              onChange={(event) => setFirstComment(event.target.value)}
              maxLength={MAX_FIRST_COMMENT_LENGTH}
              placeholder="Post a comment right after this goes live — extra links, hashtags or context. Works on LinkedIn and Facebook."
              className="mt-2 min-h-[64px] resize-y text-[12.5px]"
            />
            <p className="text-muted-foreground mt-1.5 text-[10.5px]">
              LINKFLOW posts this as the first comment after the post is published. If it fails,
              the post itself stays live.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-card sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Publishing as</Label>
              <TargetSelect targets={targets} value={target} onChange={setTarget} />
              {selected && !selected.canPublish && selected.disabledReason && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{selected.disabledReason}</p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="schedule-when">Schedule for</Label>
              <div className="relative">
                <CalendarClock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="schedule-when"
                  type="datetime-local"
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  className="pl-9"
                />
              </div>
              <p className="text-muted-foreground text-[10.5px]">
                Times are in {timezone}. Stored in UTC so daylight-saving changes are handled.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3 py-2.5 text-[12px] text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              onClick={() => submit("draft")}
              disabled={pending || uploading || !targets.length}
              className="sm:mr-auto"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save draft
            </Button>
            {!initial.id && (
              <Button
                variant="secondary"
                onClick={() => submit("now")}
                disabled={pending || uploading || !targets.length}
              >
                <Send className="size-4" /> Publish now
              </Button>
            )}
            <Button
              variant="gradient"
              onClick={() => submit("schedule")}
              disabled={pending || uploading || !targets.length}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
              {initial.id ? "Update schedule" : "Schedule post"}
            </Button>
          </div>
        </div>
      </div>

      <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <div className="flex items-center justify-between px-1">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
            <Eye className="size-3.5" /> Live preview
          </span>
          <Badge variant="outline" className="text-[9.5px]">
            {selected?.platform === "facebook"
              ? "Facebook Page"
              : selected?.targetType === "organization"
                ? "Company page"
                : "Personal profile"}
          </Badge>
        </div>
        {selected?.platform === "facebook" ? (
          <FacebookPostPreview
            content={content}
            authorName={selected?.label ?? "Your Facebook Page"}
            authorHeadline={selected?.subtitle ?? "Facebook Page"}
            authorAvatar={selected?.avatarUrl ?? null}
            imageUrl={mediaUrl}
          />
        ) : (
          <LinkedInPostPreview
            content={content}
            authorName={selected?.label ?? "Your LinkedIn profile"}
            authorHeadline={selected?.subtitle ?? "LinkedIn member"}
            authorAvatar={selected?.avatarUrl ?? null}
            imageUrl={mediaUrl}
            targetType={selected?.targetType ?? "member"}
          />
        )}
        <div className="text-muted-foreground rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[10.5px] leading-relaxed">
          <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
            <Sparkles className="size-3" /> Publishing checklist
          </span>
          <ul className="mt-1.5 space-y-1">
            <li className={content.trim().length > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
              • Post content written
            </li>
            <li className={target ? "text-emerald-600 dark:text-emerald-400" : ""}>• Target selected</li>
            <li className={targets.some((item) => item.canPublish) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
              • Permissions verified
            </li>
          </ul>
        </div>
        {demo && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] text-amber-700 dark:text-amber-300">
            <UploadCloud className="mt-0.5 size-3.5 shrink-0" />
            Demo mode is read-only. Connect Supabase and sign in to save posts and upload images.
          </div>
        )}
      </aside>
    </div>
  );
}
