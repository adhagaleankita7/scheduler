/**
 * LINKFLOW · mock account detection (shared by the worker)
 * ============================================================================
 * Mock accounts are created by the Next.js connect routes when
 * `LINKEDIN_MOCK_MODE` / `FACEBOOK_MOCK_MODE` is on and no app credentials
 * exist. Their `provider_account_id` is deterministic and prefixed, so the
 * worker can recognise one from the stored row alone.
 *
 * A mock id can never resolve against the real APIs, so publishing to one is
 * always simulated — even when the worker's own env mock flags are off (for
 * example the hosted production worker while the UI runs locally against a
 * mock account). Those results are still stored with `is_mock = true` and
 * logged with provider `mock`, so they are never mistaken for real output.
 *
 * Keep these prefixes in sync with:
 *   * src/lib/linkedin/mock-account.ts  (MOCK_PROVIDER_PREFIX)
 *   * src/lib/facebook/mock-account.ts  (FACEBOOK_MOCK_PROVIDER_PREFIX)
 */

export const MOCK_PROVIDER_ACCOUNT_PREFIXES = ["mock_member_", "mock_facebook_"] as const;

export function isMockProviderAccountId(
  providerAccountId: string | null | undefined,
): boolean {
  if (!providerAccountId) return false;
  return MOCK_PROVIDER_ACCOUNT_PREFIXES.some((prefix) =>
    providerAccountId.startsWith(prefix)
  );
}
