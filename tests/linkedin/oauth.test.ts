import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LINKEDIN_CALLBACK_PATH,
  LinkedInOAuthError,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getLinkedInRedirectUri,
  isSecureRedirectUri,
  parseScopeList,
  probeAuthorizationRequest,
  requireLinkedInRedirectUri,
  resolveGrantedScopes,
} from "@/lib/linkedin/oauth";

const APP = "https://linkflow.example.com";

function env(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
}

function errorCode(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LinkedInOAuthError);
    return (error as LinkedInOAuthError).code;
  }
  throw new Error("expected the call to throw");
}

beforeEach(() => {
  env({
    NEXT_PUBLIC_APP_URL: APP,
    LINKEDIN_REDIRECT_URI: undefined,
    LINKEDIN_CLIENT_ID: "client-123",
    LINKEDIN_CLIENT_SECRET: "secret-456",
    LINKEDIN_SCOPES: undefined,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getLinkedInRedirectUri", () => {
  it("builds the callback URL from NEXT_PUBLIC_APP_URL", () => {
    expect(getLinkedInRedirectUri()).toBe(`${APP}${LINKEDIN_CALLBACK_PATH}`);
  });

  it("prefers LINKEDIN_REDIRECT_URI so a tunnel can differ from the app URL", () => {
    env({ LINKEDIN_REDIRECT_URI: "https://tunnel.example.dev/api/linkedin/callback" });
    expect(getLinkedInRedirectUri("http://localhost:3000")).toBe(
      "https://tunnel.example.dev/api/linkedin/callback",
    );
  });

  it("falls back to the request origin when the app URL is blank", () => {
    env({ NEXT_PUBLIC_APP_URL: undefined });
    expect(getLinkedInRedirectUri("https://request.example.com")).toBe(
      `https://request.example.com${LINKEDIN_CALLBACK_PATH}`,
    );
  });

  it("strips trailing slashes from the origin and override", () => {
    env({ NEXT_PUBLIC_APP_URL: undefined });
    expect(getLinkedInRedirectUri("https://request.example.com///")).toBe(
      `https://request.example.com${LINKEDIN_CALLBACK_PATH}`,
    );
    env({ LINKEDIN_REDIRECT_URI: "https://tunnel.example.dev/api/linkedin/callback///" });
    expect(getLinkedInRedirectUri()).toBe(
      "https://tunnel.example.dev/api/linkedin/callback",
    );
  });
});

describe("isSecureRedirectUri", () => {
  it("accepts only HTTPS", () => {
    expect(isSecureRedirectUri("https://example.com/api/linkedin/callback")).toBe(true);
    expect(isSecureRedirectUri("http://localhost:3000/api/linkedin/callback")).toBe(false);
    expect(isSecureRedirectUri("HTTPS://EXAMPLE.COM/api/linkedin/callback")).toBe(true);
  });
});

describe("requireLinkedInRedirectUri", () => {
  it("accepts an exact HTTPS callback", () => {
    const uri = `${APP}${LINKEDIN_CALLBACK_PATH}`;
    expect(requireLinkedInRedirectUri(uri)).toBe(uri);
  });

  it("rejects an HTTP callback with an actionable error", () => {
    expect(errorCode(() => requireLinkedInRedirectUri("http://localhost:3000/api/linkedin/callback"))).toBe(
      "insecure_redirect_uri",
    );
  });

  it("rejects the Supabase auth callback path", () => {
    expect(errorCode(() => requireLinkedInRedirectUri(`${APP}/auth/callback`))).toBe(
      "invalid_redirect_path",
    );
  });

  it("rejects a callback path with a suffix", () => {
    expect(
      errorCode(() => requireLinkedInRedirectUri(`${APP}/api/linkedin/callback/extra`)),
    ).toBe("invalid_redirect_path");
  });

  it("rejects query strings and fragments", () => {
    expect(
      errorCode(() => requireLinkedInRedirectUri(`${APP}${LINKEDIN_CALLBACK_PATH}?next=/accounts`)),
    ).toBe("invalid_redirect_uri");
    expect(
      errorCode(() => requireLinkedInRedirectUri(`${APP}${LINKEDIN_CALLBACK_PATH}#fragment`)),
    ).toBe("invalid_redirect_uri");
  });

  it("rejects a relative URL", () => {
    expect(errorCode(() => requireLinkedInRedirectUri(LINKEDIN_CALLBACK_PATH))).toBe(
      "insecure_redirect_uri",
    );
  });
});

describe("buildAuthorizationUrl", () => {
  it("sends the exact redirect URI, state and scopes without PKCE", () => {
    const url = new URL(buildAuthorizationUrl("state-abc"));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}${LINKEDIN_CALLBACK_PATH}`);
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("scope")).toBe("openid profile email w_member_social");
    // LinkedIn answers 401 invalid_client when PKCE is used, so it must be off.
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("code_challenge_method")).toBe(false);
  });

  it("accepts an explicit personal-only scope list for the fallback attempt", () => {
    const url = new URL(
      buildAuthorizationUrl(
        "state-abc",
        `${APP}${LINKEDIN_CALLBACK_PATH}`,
        "openid profile email w_member_social",
      ),
    );
    expect(url.searchParams.get("scope")).toBe("openid profile email w_member_social");
    expect(url.searchParams.get("scope")).not.toContain("w_organization_social");
  });

  it("refuses to build an authorization URL for an insecure redirect", () => {
    env({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(errorCode(() => buildAuthorizationUrl("state"))).toBe(
      "insecure_redirect_uri",
    );
  });

  it("refuses to build without a client id", () => {
    env({ LINKEDIN_CLIENT_ID: undefined });
    expect(errorCode(() => buildAuthorizationUrl("state"))).toBe("not_configured");
  });
});

describe("exchangeCodeForToken", () => {
  it("posts the same redirect URI and never sends a PKCE verifier", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("redirect_uri")).toBe(`${APP}${LINKEDIN_CALLBACK_PATH}`);
      expect(body.get("client_id")).toBe("client-123");
      expect(body.get("client_secret")).toBe("secret-456");
      // Regression guard: LinkedIn returns 401 invalid_client if this is sent.
      expect(body.has("code_verifier")).toBe(false);
      return new Response(
        JSON.stringify({ access_token: "token", expires_in: 3600, scope: "openid profile" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeCodeForToken("auth-code");
    expect(token.access_token).toBe("token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps invalid_grant to a retryable-by-user error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );
    await expect(exchangeCodeForToken("expired")).rejects.toMatchObject({
      code: "invalid_grant",
    });
  });

  it("explains unapproved organization scopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"invalid_scope"}', { status: 400 })),
    );
    await expect(exchangeCodeForToken("code")).rejects.toMatchObject({
      code: "invalid_scope",
    });
  });

  it("explains an invalid client secret instead of a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"error":"invalid_client","error_description":"Client authentication failed"}',
            { status: 401 },
          ),
      ),
    );
    await expect(exchangeCodeForToken("code")).rejects.toMatchObject({
      code: "invalid_client",
    });
  });

  it("refuses to exchange without server credentials", async () => {
    env({ LINKEDIN_CLIENT_SECRET: undefined });
    await expect(exchangeCodeForToken("code")).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

describe("probeAuthorizationRequest", () => {
  it("passes when LinkedIn accepts the request and redirects to consent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { Location: "/login" } })),
    );
    await expect(probeAuthorizationRequest()).resolves.toEqual({ ok: true });
  });

  it("probes with an explicit scope list for the fallback attempt", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("scope")).toBe(
        "openid profile email w_member_social",
      );
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      probeAuthorizationRequest({ scopes: "openid profile email w_member_social" }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("detects an unregistered redirect URL and blocks the connect attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><body>Bummer, something went wrong. The redirect_uri does not match the registered value</body></html>",
            { status: 200 },
          ),
      ),
    );
    const result = await probeAuthorizationRequest();
    expect(result).toMatchObject({ ok: false, code: "redirect_uri_mismatch", blocking: true });
    if (!result.ok) expect(result.detail).toMatch(/does not have this callback URL registered/i);
  });

  it("detects an invalid client id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>The passed in client_id is invalid</p>", { status: 200 })),
    );
    await expect(probeAuthorizationRequest()).resolves.toMatchObject({
      ok: false,
      code: "invalid_client",
      blocking: true,
    });
  });

  it("does not block connecting when the probe itself cannot reach LinkedIn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    await expect(probeAuthorizationRequest()).resolves.toMatchObject({
      ok: false,
      code: "probe_unavailable",
      blocking: false,
    });
  });

  it("reports missing configuration instead of throwing", async () => {
    env({ LINKEDIN_CLIENT_ID: undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("should not be called");
      }),
    );
    await expect(probeAuthorizationRequest()).resolves.toMatchObject({
      ok: false,
      code: "not_configured",
      blocking: true,
    });
  });
});

describe("scope parsing", () => {
  it("splits on spaces, commas and newlines", () => {
    expect(parseScopeList("openid profile,email\nw_member_social")).toEqual([
      "openid",
      "profile",
      "email",
      "w_member_social",
    ]);
    expect(parseScopeList(null)).toEqual([]);
  });

  it("never drops the requested scopes when LinkedIn omits them", () => {
    const requested = ["openid", "profile", "email", "w_member_social"];
    expect(resolveGrantedScopes(undefined, requested)).toEqual(requested);
    expect(resolveGrantedScopes("", requested)).toEqual(requested);
    expect(resolveGrantedScopes("  ", requested)).toEqual(requested);
    expect(resolveGrantedScopes("openid w_member_social", requested)).toEqual([
      "openid",
      "w_member_social",
    ]);
  });

  it("returns a copy so callers cannot mutate the requested list", () => {
    const requested = ["openid"];
    const resolved = resolveGrantedScopes(undefined, requested);
    resolved.push("w_member_social");
    expect(requested).toEqual(["openid"]);
  });
});
