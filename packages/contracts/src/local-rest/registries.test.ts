import { describe, expect, it } from "vitest";

import * as localRest from "./index.js";
import {
  DEVICE_CHANNEL_CONTRACTS,
  RENDERER_CONTRACTS,
  TERMINAL_PAIRING_CONTRACTS,
} from "./index.js";

interface RestContract {
  readonly method: string;
  readonly path: string;
}

function isRestContract(value: unknown): value is RestContract {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { method?: unknown }).method === "string" &&
    typeof (value as { path?: unknown }).path === "string" &&
    /^\//u.test((value as { path: string }).path)
  );
}

/*
 * Every exported value shaped like a contract counts, whatever its name: a
 * contract exported under a name that does not end in `Contract` must still
 * be classified, so a renaming cannot slip a route past the registry.
 */
const exportedContracts = Object.entries(
  localRest as Record<string, unknown>,
).filter((entry): entry is [string, RestContract] => isRestContract(entry[1]));

describe("local REST contract registries", () => {
  it("names every contract export with the Contract suffix", () => {
    expect(
      exportedContracts
        .map(([name]) => name)
        .filter((name) => !name.endsWith("Contract")),
    ).toEqual([]);
  });

  it("classifies every exported contract as renderer-issued or device-channel exactly once", () => {
    expect(exportedContracts.length).toBeGreaterThan(90);
    const renderer = new Set<unknown>(RENDERER_CONTRACTS);
    const deviceChannel = new Set<unknown>(DEVICE_CHANNEL_CONTRACTS);
    const unclassified = exportedContracts
      .filter(
        ([, contract]) =>
          !renderer.has(contract) && !deviceChannel.has(contract),
      )
      .map(([name]) => name);
    const doubleClassified = exportedContracts
      .filter(
        ([, contract]) => renderer.has(contract) && deviceChannel.has(contract),
      )
      .map(([name]) => name);
    expect(unclassified, "add the contract to a registry").toEqual([]);
    expect(doubleClassified).toEqual([]);
    expect(renderer.size + deviceChannel.size).toBe(exportedContracts.length);
  });

  it("keeps each registry free of duplicates and of hard deletes", () => {
    for (const registry of [RENDERER_CONTRACTS, DEVICE_CHANNEL_CONTRACTS]) {
      const keys = registry.map(
        (contract) => `${contract.method} ${contract.path}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
      expect(
        registry.some((contract) => (contract.method as string) === "DELETE"),
      ).toBe(false);
    }
    const mutationMethods = new Set(
      RENDERER_CONTRACTS.filter((contract) => contract.method !== "GET").map(
        (contract) => contract.method,
      ),
    );
    expect([...mutationMethods].sort()).toEqual(["PATCH", "POST", "PUT"]);
  });

  it("never registers one route key under both audiences", () => {
    const rendererKeys = new Set(
      RENDERER_CONTRACTS.map(
        (contract) => `${contract.method} ${contract.path}`,
      ),
    );
    const shared = DEVICE_CHANNEL_CONTRACTS.map(
      (contract) => `${contract.method} ${contract.path}`,
    ).filter((key) => rendererKeys.has(key));
    expect(shared).toEqual([]);
  });

  it("keeps every contract path in the grammar the allowlist compiles", () => {
    // The local API compiles each path segment by segment: a literal segment
    // is lower-case kebab-case and a parameter is a whole `:name` segment.
    // Anything else (a trailing slash, `:id2`, `:draft_id`, an empty segment)
    // would compile into a route no request can match.
    for (const [name, contract] of exportedContracts) {
      const segments = contract.path.split("/");
      expect(segments[0], name).toBe("");
      expect(segments.length, name).toBeGreaterThanOrEqual(2);
      for (const segment of segments.slice(1)) {
        expect(
          /^:[a-zA-Z]+$/u.test(segment) || /^[a-z][a-z0-9-]*$/u.test(segment),
          `${name}: segment "${segment}" in ${contract.path}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the terminal pairing channel out of the renderer registry", () => {
    expect([...DEVICE_CHANNEL_CONTRACTS]).toEqual([
      ...TERMINAL_PAIRING_CONTRACTS,
    ]);
    for (const contract of DEVICE_CHANNEL_CONTRACTS) {
      expect(contract.path.startsWith("/pairing/")).toBe(true);
    }
    expect(
      RENDERER_CONTRACTS.some((contract) =>
        contract.path.startsWith("/pairing/"),
      ),
    ).toBe(false);
  });

  it("pins the renderer mutation surface the local API answers preflights for", () => {
    const mutations = RENDERER_CONTRACTS.filter(
      (contract) => contract.method !== "GET",
    )
      .map((contract) => `${contract.method} ${contract.path}`)
      .sort();
    expect(mutations).toMatchSnapshot();
  });
});
