// Cryptographic v4 UUID, including contexts without crypto.randomUUID.
// Fail closed when Web Crypto is unavailable; never fall back to weak IDs.
export function randomUUID(): string {
  // Tier 1: native randomUUID where the spec lets us.
  if (
    typeof crypto !== 'undefined'
    && typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  // Tier 2: build a v4 UUID from `crypto.getRandomValues`. The byte
  // layout follows RFC 4122 §4.4 — set the version (high nibble of
  // byte 6) to 4 and the variant (high two bits of byte 8) to `10`.
  if (
    typeof crypto !== 'undefined'
    && typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error("Web Crypto is required to create an identifier");
}
