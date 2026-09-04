import { build } from "esbuild";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const apiRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(apiRoot, "package.json"));
const optionalPackages = [
  "pg-native",
  "class-transformer",
  "class-validator",
  "file-type",
  "@nestjs/websockets/socket-module",
  "@nestjs/microservices/microservices-module",
  "@nestjs/microservices",
  "@nestjs/platform-socket.io",
];

// The ordinary tsc build remains the development/test-module build. Only these
// compiled JS entrypoints enter the Windows deployment; never bundle raw TS.
export async function buildApiRuntime(
  outputRoot,
  platform = "win32",
  arch = "x64",
) {
  if (
    !(platform === "win32" && arch === "x64") &&
    !(platform === process.platform && arch === process.arch)
  ) {
    throw new Error("Unsupported API runtime target");
  }
  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length !== 0)
    throw new Error("API runtime output must be empty");
  const result = await build({
    absWorkingDir: apiRoot,
    entryPoints: { main: "dist/main.js", migrate: "dist/migrate.js" },
    outdir: path.join(outputRoot, "dist"),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    keepNames: true,
    minify: false,
    sourcemap: false,
    metafile: true,
    write: false,
    logLevel: "silent",
    legalComments: "inline",
    define: { "import.meta.dirname": "__dirname" },
    external: optionalPackages,
    banner: {
      js: 'if (process.env.NODE_PG_FORCE_NATIVE) throw new Error("Breev requires the JavaScript PostgreSQL driver");',
    },
  });
  if (result.warnings.length !== 0)
    throw new Error(JSON.stringify(result.warnings));
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      if (
        imported.external &&
        !imported.path.startsWith("node:") &&
        !require("node:module").isBuiltin(imported.path) &&
        !optionalPackages.includes(imported.path)
      ) {
        throw new Error(`Unreviewed external API dependency: ${imported.path}`);
      }
    }
  }
  for (const file of result.outputFiles) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }

  const argonRoot = path.dirname(await realpath(require.resolve("argon2")));
  const nativeDirectory = `prebuilds/${platform}-${arch}`;
  const nativeFiles = (
    await readdir(path.join(argonRoot, nativeDirectory))
  ).filter((name) => name.endsWith(".node"));
  // Preserve the upstream loader's libc/platform selection for the selected OS.
  await mkdir(path.join(outputRoot, "dist", nativeDirectory), {
    recursive: true,
  });
  if (nativeFiles.length === 0)
    throw new Error("The pinned Argon2 native prebuild is missing");
  for (const name of nativeFiles)
    await copyFile(
      path.join(argonRoot, nativeDirectory, name),
      path.join(outputRoot, "dist", nativeDirectory, name),
    );

  const journalPath = path.join(apiRoot, "drizzle/meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  await mkdir(path.join(outputRoot, "drizzle/meta"), { recursive: true });
  await copyFile(
    journalPath,
    path.join(outputRoot, "drizzle/meta/_journal.json"),
  );
  const tags = new Set();
  for (const { tag } of journal.entries) {
    if (!/^[0-9]{4}_[a-z0-9_]+$/.test(tag) || tags.has(tag))
      throw new Error("Invalid or duplicate migration journal tag");
    tags.add(tag);
    await copyFile(
      path.join(apiRoot, "drizzle", `${tag}.sql`),
      path.join(outputRoot, "drizzle", `${tag}.sql`),
    );
  }
  const sourceSql = (await readdir(path.join(apiRoot, "drizzle"))).filter(
    (name) => name.endsWith(".sql"),
  );
  if (sourceSql.length !== tags.size)
    throw new Error("A SQL migration is absent from the journal");

  await writeFile(
    path.join(outputRoot, "THIRD_PARTY_NOTICES.txt"),
    await collectNotices(result.metafile.inputs, argonRoot),
  );
  return {
    bundleBytes: result.outputFiles.reduce(
      (sum, file) => sum + file.contents.length,
      0,
    ),
    migrations: tags.size,
    nativeFiles,
  };
}

async function collectNotices(inputs, argonRoot) {
  const packages = new Map();
  const visited = new Set();
  for (const input of Object.keys(inputs)) {
    let directory = path.dirname(await realpath(path.resolve(apiRoot, input)));
    while (!visited.has(directory)) {
      visited.add(directory);
      try {
        const manifest = JSON.parse(
          await readFile(path.join(directory, "package.json"), "utf8"),
        );
        if (manifest.name && !manifest.name.startsWith("@breev/"))
          packages.set(directory, manifest);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const notices = [];
  for (const [directory, manifest] of [...packages.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  )) {
    const names = (await readdir(directory)).filter((name) =>
      /^(licen[sc]e|copying|notice)(\.|$)/i.test(name),
    );
    const texts = await Promise.all(
      names.map((name) => readFile(path.join(directory, name), "utf8")),
    );
    notices.push(
      `${manifest.name}@${manifest.version}\nLicense: ${JSON.stringify(manifest.license ?? manifest.licenses)}\n${texts.join("\n")}`,
    );
  }
  notices.push(
    `Argon2 reference implementation\n${await readFile(path.join(argonRoot, "argon2/LICENSE"), "utf8")}`,
  );
  return `${notices.join("\n\n--------------------\n\n")}\n`;
}
