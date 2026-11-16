"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import { OAUTH_PROVIDER_IDS } from "@/lib/auth/providers";
import { safeNextPath } from "@/lib/auth/redirect";

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long");

export type AuthState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

function parseAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Incorrect email or password.";
  if (lower.includes("email not confirmed"))
    return "Please confirm your email address before signing in.";
  if (lower.includes("already registered") || lower.includes("already been registered"))
    return "An account with this email already exists.";
  if (lower.includes("rate limit") || lower.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  if (lower.includes("password should be"))
    return "Choose a stronger password (at least 8 characters).";
  if (lower.includes("provider is not enabled") || lower.includes("unsupported provider"))
    return "That sign-in provider is not enabled for this project. Use email and password instead.";
  return message;
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Password is required") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: parseAuthError(error.message) };

  redirect(safeNextPath(formData.get("next")));
}

/**
 * Kick off an OAuth sign-in (Google by default).
 *
 * `signInWithOAuth` stores the PKCE code verifier in a cookie, so this must run
 * as a Server Action where `cookies()` can write to the response. The returned
 * provider URL is then followed by the browser; Supabase sends the user back to
 * `/auth/callback`, which exchanges the code for a session cookie.
 */
export async function signInWithOAuthAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z.enum(OAUTH_PROVIDER_IDS).safeParse(formData.get("provider"));
  if (!parsed.success) return { error: "Unsupported sign-in provider." };

  const supabase = await createClient();
  const origin = getAppUrl();
  const next = safeNextPath(formData.get("next"));
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsed.data,
    options: {
      redirectTo,
      ...(parsed.data === "google"
        ? { queryParams: { prompt: "select_account" } }
        : {}),
    },
  });

  if (error) return { error: parseAuthError(error.message) };
  if (!data.url) return { error: "Could not start sign-in. Please try again." };

  redirect(data.url);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Enter your full name").max(80),
      email: emailSchema,
      password: passwordSchema,
      acceptTerms: z.literal("on", { message: "Please accept the terms to continue" }),
    })
    .safeParse({
      fullName: formData.get("fullName"),
      email: formData.get("email"),
      password: formData.get("password"),
      acceptTerms: formData.get("acceptTerms"),
    });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const origin = getAppUrl();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) return { error: parseAuthError(error.message) };

  if (!data.session) {
    return {
      message:
        "Check your inbox to confirm your email address. Once confirmed you'll be signed in automatically.",
    };
  }
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function forgotPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const origin = getAppUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: parseAuthError(error.message) };

  return {
    message:
      "If an account exists for that email, a secure reset link is on its way. The link expires in one hour.",
  };
}

export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z
    .object({
      password: passwordSchema,
      confirm: z.string(),
    })
    .refine((value) => value.password === value.confirm, {
      message: "Passwords do not match",
      path: ["confirm"],
    })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset session has expired. Request a new link." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: parseAuthError(error.message) };

  const headerStore = await headers();
  const origin = headerStore.get("origin") ?? getAppUrl();
  await supabase.auth.signOut();
  redirect(`${origin}/login?reason=password_updated`);
}
