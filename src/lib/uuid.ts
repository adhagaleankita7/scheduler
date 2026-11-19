/**
 * Fallback-safe UUID v4 generator.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * localhost). When the app is opened over plain HTTP — for example a LAN IP
 * (`http://192.168.1.20:3000`) or a tunnel — the browser leaves it undefined
 * and uploads crash with "crypto.randomUUID is not a function".
 *
 * `crypto.getRandomValues()` is available in every context, and Math.random is
 * a last resort for very old browsers. These values are only used as storage
 * filenames and row ids, never as security tokens.
 */
export function randomUUID(): string {
  const cryptoObj =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // RFC 4122 version 4 + variant bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
