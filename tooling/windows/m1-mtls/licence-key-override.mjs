/**
 * Test-only public-key substitution for the disposable mTLS proof process.
 *
 * Breev's built licence parser, signature verification, entitlement derivation,
 * and seat allocation remain untouched. This replaces only the verification-key
 * registry, following `apps/desktop/test/licence-key-override.mjs:1-35`, because
 * shipped artifacts intentionally contain no signing key for arbitrary synthetic
 * pharmacy and Main-device identifiers.
 */

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const registryPath = process.env.BREEV_M1_MTLS_LICENCE_PUBLIC_KEYS_FILE;
if (registryPath === undefined || registryPath.trim().length === 0) {
  throw new Error(
    "BREEV_M1_MTLS_LICENCE_PUBLIC_KEYS_FILE is required for the synthetic proof",
  );
}
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
if (
  typeof registry !== "object" ||
  registry === null ||
  Array.isArray(registry) ||
  Object.keys(registry).length !== 1
) {
  throw new Error("The synthetic licence public-key registry is malformed");
}
const source = `export const OFFLINE_LICENCE_PUBLIC_KEYS = ${JSON.stringify(
  registry,
)};\n`;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/licensing/licence-keys.js")) {
      return { format: "module", shortCircuit: true, source };
    }
    return nextLoad(url, context);
  },
});
