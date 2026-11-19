import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "@/lib/uuid";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("randomUUID", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when the secure-context API exists", () => {
    const expected = "123e4567-e89b-42d3-a456-426614174000";
    vi.stubGlobal("crypto", {
      randomUUID: () => expected,
      getRandomValues: () => {
        throw new Error("getRandomValues should not be used");
      },
    });

    expect(randomUUID()).toBe(expected);
  });

  it("falls back to getRandomValues in insecure contexts", () => {
    vi.stubGlobal("crypto", {
      // Mirrors browsers on plain HTTP: randomUUID is missing entirely.
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
        return bytes;
      },
    });

    const value = randomUUID();
    expect(value).toMatch(UUID_V4);
    // Version nibble comes from the forced byte 6.
    expect(value.charAt(14)).toBe("4");
  });

  it("falls back to Math.random when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    expect(randomUUID()).toMatch(UUID_V4);
  });
});
