import { describe, expect, it } from "vitest";
import { normalizeOrigin, resolveRequestOrigin } from "@/lib/http/origin";

function request(headers: Record<string, string>, nextUrl = "http://localhost:3000/api/linkedin/connect") {
  return { headers: new Headers(headers), nextUrl: new URL(nextUrl) };
}

describe("normalizeOrigin", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeOrigin("  https://example.com///  ")).toBe("https://example.com");
  });
});

describe("resolveRequestOrigin", () => {
  it("honours a tunnel's forwarded host and proto", () => {
    expect(
      resolveRequestOrigin(
        request({
          host: "localhost:3000",
          "x-forwarded-host": "abc-def.trycloudflare.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://abc-def.trycloudflare.com");
  });

  it("uses the first forwarded host when a proxy appends a list", () => {
    expect(
      resolveRequestOrigin(
        request({
          "x-forwarded-host": "linkflow.example.com, internal.local",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://linkflow.example.com");
  });

  it("uses the request host when no proxy headers exist", () => {
    expect(resolveRequestOrigin(request({ host: "app.example.com" }))).toBe(
      "http://app.example.com",
    );
  });

  it("falls back to nextUrl when the host header is absent", () => {
    expect(
      resolveRequestOrigin(
        request({}, "http://127.0.0.1:3100/api/linkedin/connect"),
      ),
    ).toBe("http://127.0.0.1:3100");
  });

  it("handles a proxy that sends a protocol with a trailing colon", () => {
    expect(
      resolveRequestOrigin(
        request({ "x-forwarded-host": "example.com", "x-forwarded-proto": "https:" }),
      ),
    ).toBe("https://example.com");
  });
});
