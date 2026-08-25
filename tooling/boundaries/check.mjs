import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const requestedRoots = readRequestedRoots(process.argv.slice(2));
const scanRoots = (
  requestedRoots.length > 0 ? requestedRoots : ["apps", "packages"]
).map((root) => path.resolve(repositoryRoot, root));
const sourceFiles = scanRoots.flatMap((root) => collectSourceFiles(root));
const sourceFileSet = new Set(sourceFiles);
const workspacePackages = readWorkspacePackages();
const graph = new Map(sourceFiles.map((file) => [file, []]));
const violations = [];

for (const sourceFile of sourceFiles) {
  const source = readFileSync(sourceFile, "utf8");
  const imports = ts.preProcessFile(source, true, true).importedFiles;

  for (const imported of imports) {
    const specifier = imported.fileName;
    checkContractRootImport(sourceFile, specifier);
    checkRendererImport(sourceFile, specifier);

    const target = resolveImport(sourceFile, specifier);
    if (target === undefined) {
      continue;
    }

    graph.get(sourceFile)?.push(target);
    checkCrossModuleTableAccess(sourceFile, target);
    checkRendererResolvedImport(sourceFile, specifier, target);
  }
}

checkDependencyCycles(graph);

if (violations.length > 0) {
  for (const violation of violations) {
    process.stderr.write(`${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Boundary check passed (${sourceFiles.length} source files).\n`,
  );
}

function readRequestedRoots(arguments_) {
  const roots = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--root") {
      throw new Error(`Unknown boundary-check argument: ${arguments_[index]}`);
    }
    const root = arguments_[index + 1];
    if (root === undefined) {
      throw new Error("--root requires a path");
    }
    roots.push(root);
    index += 1;
  }
  return roots;
}

function collectSourceFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!["artifacts", "dist", "node_modules", "out"].includes(entry.name)) {
        files.push(...collectSourceFiles(target));
      }
    } else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) {
      files.push(path.resolve(target));
    }
  }
  return files.sort();
}

function readWorkspacePackages() {
  const roots = ["apps/desktop", "apps/local-api", "packages/contracts"];
  const packages = new Map();
  for (const root of roots) {
    const absoluteRoot = path.resolve(repositoryRoot, root);
    const manifestPath = path.join(absoluteRoot, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name === "string") {
      packages.set(manifest.name, absoluteRoot);
    }
  }
  return packages;
}

function checkContractRootImport(sourceFile, specifier) {
  if (specifier === "@breev/contracts") {
    violations.push(
      `Contracts root import is forbidden: ${relative(sourceFile)} imports ${specifier}`,
    );
  }
}

function checkRendererImport(sourceFile, specifier) {
  if (!isRendererFile(sourceFile)) {
    return;
  }

  const normalizedBuiltin = specifier.replace(/^node:/u, "");
  const forbiddenExternal =
    builtinModules.includes(normalizedBuiltin) ||
    specifier === "electron" ||
    specifier === "pg" ||
    specifier.startsWith("drizzle-orm") ||
    specifier.startsWith("@nestjs/");

  if (forbiddenExternal) {
    violations.push(
      `Renderer import is forbidden: ${relative(sourceFile)} imports ${specifier}`,
    );
  }
}

function checkRendererResolvedImport(sourceFile, specifier, target) {
  if (!isRendererFile(sourceFile)) {
    return;
  }

  const normalizedTarget = slash(target);
  if (
    normalizedTarget.includes("/apps/local-api/") ||
    normalizedTarget.includes("/src/main/") ||
    normalizedTarget.includes("/src/preload/") ||
    /\/(?:database|db|schema|tables?)(?:\/|\.)/u.test(normalizedTarget)
  ) {
    violations.push(
      `Renderer import is forbidden: ${relative(sourceFile)} imports ${specifier}`,
    );
  }
}

function checkCrossModuleTableAccess(sourceFile, target) {
  const sourceModule = moduleName(sourceFile);
  const targetModule = moduleName(target);
  if (
    sourceModule !== undefined &&
    targetModule !== undefined &&
    sourceModule !== targetModule &&
    isTableFile(target)
  ) {
    violations.push(
      `Cross-module table access is forbidden: ${relative(sourceFile)} imports ${relative(target)}`,
    );
  }
}

function checkDependencyCycles(dependencyGraph) {
  const state = new Map();
  const stack = [];
  const reported = new Set();

  function visit(file) {
    state.set(file, "visiting");
    stack.push(file);

    for (const dependency of dependencyGraph.get(file) ?? []) {
      if (!dependencyGraph.has(dependency)) {
        continue;
      }

      if (state.get(dependency) === "visiting") {
        const cycleStart = stack.indexOf(dependency);
        const cycle = [...stack.slice(cycleStart), dependency];
        const key = [...new Set(cycle)].sort().join("|");
        if (!reported.has(key)) {
          reported.add(key);
          violations.push(
            `Dependency cycle is forbidden: ${cycle.map(relative).join(" -> ")}`,
          );
        }
      } else if (state.get(dependency) !== "visited") {
        visit(dependency);
      }
    }

    stack.pop();
    state.set(file, "visited");
  }

  for (const file of dependencyGraph.keys()) {
    if (state.get(file) === undefined) {
      visit(file);
    }
  }
}

function resolveImport(sourceFile, specifier) {
  if (specifier.startsWith(".")) {
    return resolveCandidate(path.resolve(path.dirname(sourceFile), specifier));
  }

  if (
    specifier.startsWith("@/") &&
    slash(sourceFile).includes("/apps/desktop/")
  ) {
    return resolveCandidate(
      path.resolve(
        repositoryRoot,
        "apps/desktop/src/renderer/src",
        specifier.slice(2),
      ),
    );
  }

  for (const [packageName, packageRoot] of workspacePackages) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      const subpath = specifier.slice(packageName.length + 1);
      return resolveCandidate(
        subpath.length === 0
          ? path.join(packageRoot, "src/index")
          : path.join(packageRoot, "src", subpath, "index"),
      );
    }
  }

  return undefined;
}

function resolveCandidate(candidate) {
  const extension = path.extname(candidate);
  const withoutJavaScriptExtension = /\.[cm]?jsx?$/u.test(extension)
    ? candidate.slice(0, -extension.length)
    : candidate;
  const candidates = [
    candidate,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    `${withoutJavaScriptExtension}.mts`,
    `${withoutJavaScriptExtension}.cts`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
  ];

  for (const possible of candidates) {
    const absolute = path.resolve(possible);
    if (
      sourceFileSet.has(absolute) ||
      (existsSync(absolute) && statSync(absolute).isFile())
    ) {
      return absolute;
    }
  }
  return undefined;
}

function moduleName(file) {
  return slash(file).match(/\/src\/modules\/([^/]+)\//u)?.[1];
}

function isTableFile(file) {
  return /\/(?:tables?|schema)(?:\/|\.)/u.test(slash(file));
}

function isRendererFile(file) {
  return slash(file).includes("/src/renderer/");
}

function relative(file) {
  return slash(path.relative(repositoryRoot, file));
}

function slash(value) {
  return value.split(path.sep).join("/");
}
