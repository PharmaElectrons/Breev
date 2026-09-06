import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseStableReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error("Stable releases require an exact vMAJOR.MINOR.PATCH tag");
  }

  const version = tag.slice(1);
  if (!stableVersionPattern.test(version)) {
    throw new Error("Stable releases require an exact vMAJOR.MINOR.PATCH tag");
  }
  return version;
}

export function validateReleaseVersion({ desktopManifest, rootManifest, tag }) {
  if (rootManifest.name !== "breev" || rootManifest.private !== true) {
    throw new Error("The root package manifest is not the Breev workspace");
  }
  if (
    desktopManifest.name !== "@breev/desktop" ||
    desktopManifest.private !== true
  ) {
    throw new Error("The desktop package manifest is not @breev/desktop");
  }

  const version = rootManifest.version;
  if (typeof version !== "string" || !stableVersionPattern.test(version)) {
    throw new Error("The root package version must be stable SemVer");
  }
  if (desktopManifest.version !== version) {
    throw new Error("Root and desktop package versions must match");
  }
  if (tag !== undefined && parseStableReleaseTag(tag) !== version) {
    throw new Error("The release tag and package versions must match");
  }
  return version;
}

export function validateReleaseChangelog({ changelog, version }) {
  if (
    typeof changelog !== "string" ||
    !/^# Changelog\r?$/mu.test(changelog) ||
    !/^## \[Unreleased\]\r?$/mu.test(changelog)
  ) {
    throw new Error(
      "CHANGELOG.md must contain Changelog and Unreleased headings",
    );
  }
  if (version === undefined) {
    return;
  }

  const escapedVersion = version.replaceAll(".", "\\.");
  const releaseHeading = new RegExp(
    `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\r?$`,
    "mu",
  );
  if (!releaseHeading.test(changelog)) {
    throw new Error(
      "CHANGELOG.md must contain a dated section for the release version",
    );
  }
}

export async function readAndValidateReleaseVersion({ repoRoot, tag }) {
  const [rootManifest, desktopManifest, changelog] = await Promise.all([
    readJson(path.join(repoRoot, "package.json")),
    readJson(path.join(repoRoot, "apps", "desktop", "package.json")),
    readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8"),
  ]);
  const version = validateReleaseVersion({
    desktopManifest,
    rootManifest,
    tag,
  });
  validateReleaseChangelog({
    changelog,
    version: tag === undefined ? undefined : version,
  });
  return version;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function readOptions(arguments_) {
  let tag;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--tag") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--tag requires a value");
    }
    tag = value;
    index += 1;
  }
  return { tag };
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const { tag } = readOptions(process.argv.slice(2));
  const version = await readAndValidateReleaseVersion({ repoRoot, tag });
  process.stdout.write(`${version}\n`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
