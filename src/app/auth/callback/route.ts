import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

/**
 * Supabase Auth callback.
 *
 * Supports both email link styles:
 *   - PKCE: `?code=...` exchanged for a session
 *   - OTP:  `?token_hash=...&type=email|recovery` verified directly
 *
 * Configure the Supabase email templates to point at:
 *   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";
  const next = safeNextPath(url.searchParams.get("next"));
  const errorDescription = url.searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/login?reason=link_expired`, origin),
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    return NextResponse.redirect(new URL("/setup", origin));
  }

  let response = NextResponse.redirect(new URL(next, origin));

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.redirect(new URL(next, origin));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return NextResponse.redirect(new URL("/login?reason=link_expired", origin));
      }
      return response;
    }

    if (tokenHash) {
      const otpType = type === "recovery" || type === "invite" || type === "email" ? type : "email";
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (error) {
        return NextResponse.redirect(new URL("/login?reason=link_expired", origin));
      }
      return response;
    }
  } catch {
    return NextResponse.redirect(new URL("/login?reason=link_expired", origin));
  }

  return NextResponse.redirect(new URL("/login?reason=link_expired", origin));
}
