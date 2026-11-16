/**
 * Resolve the public origin of the current request.
 *
 * Next.js's `request.nextUrl.origin` is derived from the internal URL. Behind a
 * reverse proxy, tunnel (cloudflared, ngrok) or Vercel's edge, that can be
 * `http://localhost:3000` even though the browser is on HTTPS. Building OAuth
 * redirects from that value sends the browser to the wrong host and rotates the
 * auth cookie on the wrong domain.
 *
 * Precedence:
 *   1. x-forwarded-host / x-forwarded-proto — set by tunnels and proxies.
 *   2. The request's own origin.
 *
 * NEXT_PUBLIC_APP_URL is intentionally *not* used here: it is the canonical
 * deployment origin for OAuth and email links, while this helper must keep the
 * browser on the host it is actually using (for example a temporary tunnel).
 */
export function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function resolveRequestOrigin(request: {
  headers: Headers;
  nextUrl: URL;
}): string {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = (
    forwardedProto ||
    request.nextUrl.protocol ||
    "http:"
  ).replace(/:$/, "");

  if (host) return normalizeOrigin(`${protocol}://${host}`);
  return normalizeOrigin(request.nextUrl.origin);
}
