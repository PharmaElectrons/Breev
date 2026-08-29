import { registerHooks } from "node:module";

/**
 * Points a spawned Breev local API at a test licence issuer.
 *
 * Breev ships verification keys only, and no signing key for the published test
 * issuer exists in this repository — by design. Seat allocation has to be
 * proven against real signed licences that differ only in their permitted
 * device count, so the browser seam mints its own issuer and replaces the key
 * registry of the server process it starts. Everything the licence travels
 * through is untouched: the same parser, the same Ed25519 signature check, the
 * same entitlement derivation. The equivalent in-process substitution is
 * documented in apps/local-api/src/devices/devices.integration.test.ts.
 *
 * Nothing here reaches a shipped artifact: the module is a test file, it is
 * loaded only through `node --import`, and it carries a public key it reads out
 * of the environment rather than any signing material.
 */
const encoded = process.env.BREEV_TEST_LICENCE_PUBLIC_KEYS;
if (encoded === undefined || encoded.trim().length === 0) {
  throw new Error(
    "BREEV_TEST_LICENCE_PUBLIC_KEYS must carry the test issuer public keys",
  );
}

const source = `export const OFFLINE_LICENCE_PUBLIC_KEYS = ${JSON.stringify(
  JSON.parse(encoded),
)};\n`;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/licensing/licence-keys.js")) {
      return { format: "module", shortCircuit: true, source };
    }
    return nextLoad(url, context);
  },
});
