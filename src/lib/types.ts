export type PostStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "published"
  | "failed"
  | "cancelled";

export type TargetType = "member" | "organization";

export type SocialProvider = "linkedin" | "facebook";

export type AccountStatus = "connected" | "needs_reconnect" | "disconnected";

export type ScheduleStatus = "active" | "paused" | "completed";

export type Post = {
  id: string;
  workspace_id: string;
  user_id: string;
  social_account_id: string | null;
  social_page_id: string | null;
  schedule_id: string | null;
  target_type: TargetType;
  content: string;
  status: PostStatus;
  scheduled_for: string | null;
  published_at: string | null;
  provider_post_id: string | null;
  provider_post_url: string | null;
  is_mock: boolean;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_http_status: number | null;
  locked_at: string | null;
  locked_by: string | null;
  queue_position: number | null;
  idempotency_key: string;
  like_count: number;
  comment_count: number;
  share_count: number;
  engagement_synced_at: string | null;
  engagement_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PostMedia = {
  id: string;
  workspace_id: string;
  post_id: string;
  user_id: string;
  storage_path: string;
  mime_type: string;
  alt_text: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type PostWithRelations = Post & {
  media: PostMedia | null;
  account: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    provider: SocialProvider;
    provider_account_id: string;
    status: AccountStatus;
  } | null;
  page: {
    id: string;
    name: string;
    logo_url: string | null;
    provider_page_id: string;
  } | null;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  headline: string | null;
  avatar_url: string | null;
  timezone: string;
  default_posting_time: string;
  default_posting_days: number[];
  theme: "light" | "dark" | "system";
  onboarded: boolean;
  active_workspace_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRole = "owner" | "editor" | "viewer";

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  role: WorkspaceRole;
  created_at?: string;
};

export type WorkspaceMember = {
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type WorkspaceInvite = {
  id: string;
  email: string;
  role: Extract<WorkspaceRole, "editor" | "viewer">;
  created_at: string;
  expires_at: string;
};

export type SocialAccount = {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: SocialProvider;
  provider_account_id: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  scopes: string[];
  status: AccountStatus;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  last_refreshed_at: string | null;
  last_error: string | null;
  connected_at: string;
  created_at: string;
  updated_at: string;
};

export type SocialPage = {
  id: string;
  workspace_id: string;
  user_id: string;
  social_account_id: string;
  provider: SocialProvider;
  provider_page_id: string;
  name: string;
  vanity_name: string | null;
  logo_url: string | null;
  page_type: string;
  role: string | null;
  can_publish: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PublishingLog = {
  id: number;
  workspace_id: string | null;
  post_id: string | null;
  user_id: string | null;
  attempt: number | null;
  status: "started" | "success" | "failure" | "retry_scheduled" | "skipped";
  provider: "linkedin" | "facebook" | "mock";
  http_status: number | null;
  provider_post_id: string | null;
  error_code: string | null;
  message: string | null;
  is_mock: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type QueueSettings = {
  workspace_id: string;
  user_id: string;
  timezone: string;
  posting_days: number[];
  posting_times: string[];
  is_paused: boolean;
  last_assigned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishingSchedule = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  timezone: string;
  start_date: string;
  end_date: string | null;
  target_type: TargetType;
  social_account_id: string | null;
  social_page_id: string | null;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string;
};

export type ActivityPoint = {
  date: string;
  scheduled: number;
  published: number;
  failed: number;
};

export type EngagementTotals = {
  likes: number;
  comments: number;
  shares: number;
};

export type DashboardData = {
  counts: {
    total: number;
    scheduled: number;
    published: number;
    draft: number;
    failed: number;
  };
  engagement: EngagementTotals;
  nextPost: PostWithRelations | null;
  recent: PostWithRelations[];
  upcoming: PostWithRelations[];
  activity: ActivityPoint[];
  weeklyTarget: number;
};

export type PublishTargetOption = {
  value: string;
  accountId: string;
  pageId: string | null;
  targetType: TargetType;
  platform: SocialProvider;
  label: string;
  subtitle: string;
  avatarUrl: string | null;
  canPublish: boolean;
  disabledReason?: string;
};

export type ActionResult<T = undefined> =
  | ({ ok: true; message?: string } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
