/**
 * Development/test issuer only. Production issuer selection remains gated by
 * open decision G04. Breev artifacts contain verification keys, never signing
 * material.
 */
export const OFFLINE_LICENCE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  "breev-test-ed25519-2026-01": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA1wWvHTIyPkrG5Qai4hMnBTtWDFdAtDfsQr3yGdhxPMA=
-----END PUBLIC KEY-----
`,
};
