import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as localRest from "@breev/contracts/local-rest";
import { RENDERER_CONTRACTS } from "@breev/contracts/local-rest";

/*
 * The CORS mutation allowlist is derived from `RENDERER_CONTRACTS`, so the
 * remaining way to ship a mutation the packaged renderer cannot reach is a
 * controller route that does not come from a registered renderer contract:
 * a path literal, a contract exported under another name, or a decorator
 * whose method differs from the contract. This test reads every controller
 * source file and proves the two surfaces are the same set, in both
 * directions, so the original drift (a module shipping routes the allowlist
 * never learned about) cannot recur silently.
 */

const DECORATOR_METHODS: Record<string, string> = {
  Delete: "DELETE",
  Patch: "PATCH",
  Post: "POST",
  Put: "PUT",
};

interface ControllerMutation {
  readonly argument: string;
  readonly file: string;
  readonly method: string;
}

function listControllerFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listControllerFiles(entryPath));
    } else if (entry.name.endsWith(".controller.ts")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function readControllerMutations(sourceRoot: string): ControllerMutation[] {
  const mutations: ControllerMutation[] = [];
  for (const file of listControllerFiles(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /@(Post|Put|Patch|Delete)\(\s*([^)]*?)\s*\)/gu,
    )) {
      mutations.push({
        argument: match[2] ?? "",
        file: path.relative(sourceRoot, file),
        method: DECORATOR_METHODS[match[1] ?? ""] ?? match[1] ?? "",
      });
    }
  }
  return mutations;
}

describe("renderer mutation parity between controllers and the contract registry", () => {
  const sourceRoot = path.resolve(import.meta.dirname, "..");
  const controllerMutations = readControllerMutations(sourceRoot);
  const rendererMutations = RENDERER_CONTRACTS.filter(
    (contract) => contract.method !== "GET",
  );
  const contractNames = new Map<unknown, string>(
    Object.entries(localRest as Record<string, unknown>).map(
      ([name, value]) => [value, name],
    ),
  );

  it("finds the controller surface", () => {
    expect(controllerMutations.length).toBeGreaterThanOrEqual(53);
    expect(rendererMutations.length).toBe(controllerMutations.length);
  });

  it("routes every controller mutation through a registered renderer contract", () => {
    const problems: string[] = [];
    for (const mutation of controllerMutations) {
      const reference = /^([A-Za-z]+Contract)\.path$/u.exec(mutation.argument);
      if (reference === null) {
        problems.push(
          `${mutation.file}: @${mutation.method}(${mutation.argument}) must reference <name>Contract.path`,
        );
        continue;
      }
      const contractName = reference[1] ?? "";
      const contract = (localRest as Record<string, unknown>)[contractName] as
        { readonly method: string; readonly path: string } | undefined;
      if (contract === undefined) {
        problems.push(`${mutation.file}: ${contractName} is not exported`);
        continue;
      }
      if (contract.method !== mutation.method) {
        problems.push(
          `${mutation.file}: ${contractName} declares ${contract.method} but the controller uses ${mutation.method}`,
        );
      }
      if (!rendererMutations.includes(contract as never)) {
        problems.push(
          `${mutation.file}: ${contractName} is not in RENDERER_CONTRACTS`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("never exposes a hard delete", () => {
    expect(
      controllerMutations.filter((mutation) => mutation.method === "DELETE"),
    ).toEqual([]);
  });

  it("serves every registered renderer mutation from exactly one controller", () => {
    const usage = new Map<string, number>();
    for (const mutation of controllerMutations) {
      const name = mutation.argument.replace(/\.path$/u, "");
      usage.set(name, (usage.get(name) ?? 0) + 1);
    }
    const unmatched = rendererMutations
      .map((contract) => contractNames.get(contract) ?? contract.path)
      .filter((name) => usage.get(name) !== 1);
    expect(unmatched).toEqual([]);
  });
});
