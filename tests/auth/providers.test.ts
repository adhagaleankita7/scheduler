import { afterEach, describe, expect, it } from "vitest";
import {
  getEnabledOAuthProviders,
  isOAuthProvider,
  parseOAuthProviders,
} from "@/lib/auth/providers";

const saved = process.env.NEXT_PUBLIC_AUTH_PROVIDERS;

afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
  else process.env.NEXT_PUBLIC_AUTH_PROVIDERS = saved;
});

describe("parseOAuthProviders", () => {
  it("defaults to Google when unset", () => {
    expect(parseOAuthProviders(undefined)).toEqual(["google"]);
  });

  it("hides the section for an empty value or `none`", () => {
    expect(parseOAuthProviders("")).toEqual([]);
    expect(parseOAuthProviders("none")).toEqual([]);
  });

  it("parses a comma-separated list, trimming and lowercasing", () => {
    expect(parseOAuthProviders(" Google, GitHub ")).toEqual(["google", "github"]);
  });

  it("ignores unknown providers and removes duplicates", () => {
    expect(parseOAuthProviders("google,myspace,google,linkedin_oidc")).toEqual([
      "google",
      "linkedin_oidc",
    ]);
  });
});

describe("isOAuthProvider", () => {
  it("recognises supported providers only", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("github")).toBe(true);
    expect(isOAuthProvider("linkedin_oidc")).toBe(true);
    expect(isOAuthProvider("facebook")).toBe(false);
    expect(isOAuthProvider(null)).toBe(false);
  });
});

describe("getEnabledOAuthProviders", () => {
  it("reads NEXT_PUBLIC_AUTH_PROVIDERS", () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = "github";
    expect(getEnabledOAuthProviders()).toEqual(["github"]);

    delete process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
    expect(getEnabledOAuthProviders()).toEqual(["google"]);
  });
});
