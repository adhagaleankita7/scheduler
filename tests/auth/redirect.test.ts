import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps same-origin absolute paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/posts?status=scheduled")).toBe("/posts?status=scheduled");
  });

  it("falls back for missing or non-string values", () => {
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("/dashboard", "")).toBe("/dashboard");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example/login")).toBe("/dashboard");
    expect(safeNextPath("//evil.example/login")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example/login")).toBe("/dashboard");
    expect(safeNextPath("dashboard")).toBe("/dashboard");
  });

  it("uses the provided fallback", () => {
    expect(safeNextPath("//evil.example", "/posts")).toBe("/posts");
  });
});
