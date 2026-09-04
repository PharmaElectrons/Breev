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
    if (url.endsWith("/dist/main.cjs")) {
      // The installed proof now runs a bundle, not loose ESM modules. This
      // test-only loader changes the registry in memory, never the artifact.
      const bundled = readFileSync(new URL(url), "utf8");
      const registryDeclaration =
        /^var OFFLINE_LICENCE_PUBLIC_KEYS = \{[\s\S]*?^\};/gm;
      if ([...bundled.matchAll(registryDeclaration)].length !== 1) {
        throw new Error(
          "The bundled proof requires exactly one licence registry",
        );
      }
      return {
        format: "commonjs",
        shortCircuit: true,
        source: bundled.replace(
          registryDeclaration,
          () =>
            `var OFFLINE_LICENCE_PUBLIC_KEYS = ${JSON.stringify(registry)};`,
        ),
      };
    }
    return nextLoad(url, context);
  },
});
