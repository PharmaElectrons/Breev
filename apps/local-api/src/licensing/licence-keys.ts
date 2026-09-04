/**
 * Development/test issuer only. Production issuer selection remains gated by
 * open decision G04. Breev artifacts contain verification keys, never signing
 * material.
 */
export const OFFLINE_LICENCE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  "breev-dev-ed25519-2026-02": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEArcgzSr/xEt5CFFLi9lFrye9Ui/JPOG80u4JwP2Qxk38=
-----END PUBLIC KEY-----
`,
  "breev-test-ed25519-2026-01": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA1wWvHTIyPkrG5Qai4hMnBTtWDFdAtDfsQr3yGdhxPMA=
-----END PUBLIC KEY-----
`,
};
