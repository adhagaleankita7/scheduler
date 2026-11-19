import { describe, expect, it } from "vitest";
import {
  hasOrganizationAdminScope,
  hasOrganizationPublishScope,
  hasScope,
  LINKEDIN_MEMBER_SCOPE,
  personalOnlyScopes,
  shouldRetryWithoutOrganizationScopes,
  splitRequestedScopes,
} from "@/lib/linkedin/scopes";

describe("LinkedIn scope helpers", () => {
  it("recognises the personal publishing scope", () => {
    expect(hasScope(["openid", LINKEDIN_MEMBER_SCOPE], LINKEDIN_MEMBER_SCOPE)).toBe(true);
    expect(hasScope(["openid", "profile"], LINKEDIN_MEMBER_SCOPE)).toBe(false);
    expect(hasScope(null, LINKEDIN_MEMBER_SCOPE)).toBe(false);
  });

  it("accepts both organization admin scopes", () => {
    expect(hasOrganizationAdminScope(["r_organization_admin"])).toBe(true);
    expect(hasOrganizationAdminScope(["rw_organization_admin"])).toBe(true);
    expect(hasOrganizationAdminScope(["w_organization_social"])).toBe(false);
  });

  it("keeps page publishing separate from admin discovery", () => {
    expect(hasOrganizationPublishScope(["w_organization_social"])).toBe(true);
    expect(hasOrganizationPublishScope(["r_organization_admin"])).toBe(false);
  });
});

describe("organization scope fallback", () => {
  const requested = [
    "openid",
    "profile",
    "email",
    "w_member_social",
    "w_organization_social",
    "r_organization_admin",
  ];

  it("splits approval-gated scopes from the self-serve set", () => {
    expect(splitRequestedScopes(requested)).toEqual({
      personal: ["openid", "profile", "email", "w_member_social"],
      organization: ["w_organization_social", "r_organization_admin"],
    });
  });

  it("keeps rw_organization_admin in the organization bucket", () => {
    expect(splitRequestedScopes(["openid", "rw_organization_admin"])).toEqual({
      personal: ["openid"],
      organization: ["rw_organization_admin"],
    });
  });

  it("drops only the org scopes for the retry attempt", () => {
    expect(personalOnlyScopes(requested)).toEqual([
      "openid",
      "profile",
      "email",
      "w_member_social",
    ]);
  });

  it("retries only when LinkedIn rejected scopes and org scopes were requested", () => {
    expect(shouldRetryWithoutOrganizationScopes(requested, "invalid_scope")).toBe(true);
    expect(shouldRetryWithoutOrganizationScopes(requested, "unauthorized_scope_error")).toBe(true);
    expect(shouldRetryWithoutOrganizationScopes(requested, "redirect_uri_mismatch")).toBe(false);
    expect(shouldRetryWithoutOrganizationScopes(requested, null)).toBe(false);
    // The fallback attempt itself must not loop.
    expect(shouldRetryWithoutOrganizationScopes(personalOnlyScopes(requested), "invalid_scope")).toBe(
      false,
    );
    expect(
      shouldRetryWithoutOrganizationScopes(personalOnlyScopes(requested), "unauthorized_scope_error"),
    ).toBe(false);
  });
});
