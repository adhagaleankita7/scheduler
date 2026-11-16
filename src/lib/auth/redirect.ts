/**
 * Only allow same-origin, absolute-path redirects.
 *
 * `next` values arrive from query strings and hidden form fields, so never
 * trust them. Besides `//evil.example` and `/\evil.example`, browsers strip
 * ASCII tab/LF/CR from URLs and treat `\` as `/`, so a value like
 * `"/\t/evil.example"` would otherwise be parsed as protocol-relative and leak
 * the user (and their freshly minted session) to another origin.
 */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;

  const next = value.trim();
  if (!next.startsWith("/")) return fallback;
  // Reject control characters (WHATWG URL strips tabs/newlines) and backslashes
  // (treated as path separators, turning "/\evil" into "//evil").
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (next.startsWith("//")) return fallback;

  // Final defence: resolve against a fixed origin and require it to stay there.
  try {
    const base = "http://linkflow.invalid";
    const resolved = new URL(next, base);
    if (resolved.origin !== base) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
