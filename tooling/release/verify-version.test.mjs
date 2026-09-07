import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStableReleaseTag,
  validateReleaseChangelog,
  validateReleaseVersion,
} from "./verify-version.mjs";

const rootManifest = Object.freeze({
  name: "breev",
  private: true,
  version: "1.2.3",
});
const desktopManifest = Object.freeze({
  name: "@breev/desktop",
  private: true,
  version: "1.2.3",
});

test("accepts one stable version shared by tag and manifests", () => {
  assert.equal(
    validateReleaseVersion({
      desktopManifest,
      rootManifest,
      tag: "v1.2.3",
    }),
    "1.2.3",
  );
});

test("accepts the current unreleased manifest pair without a tag", () => {
  assert.equal(
    validateReleaseVersion({
      desktopManifest: { ...desktopManifest, version: "0.0.0" },
      rootManifest: { ...rootManifest, version: "0.0.0" },
    }),
    "0.0.0",
  );
});

for (const tag of [
  "1.2.3",
  "v1.2",
  "v01.2.3",
  "v1.02.3",
  "v1.2.03",
  "v1.2.3-beta.1",
  "v1.2.3+build.1",
]) {
  test(`rejects non-stable release tag ${tag}`, () => {
    assert.throws(
      () => parseStableReleaseTag(tag),
      /exact vMAJOR\.MINOR\.PATCH tag/u,
    );
  });
}

test("rejects mismatched package versions", () => {
  assert.throws(
    () =>
      validateReleaseVersion({
        desktopManifest: { ...desktopManifest, version: "1.2.4" },
        rootManifest,
      }),
    /Root and desktop package versions must match/u,
  );
});

test("rejects a tag that does not match the package version", () => {
  assert.throws(
    () =>
      validateReleaseVersion({
        desktopManifest,
        rootManifest,
        tag: "v1.2.4",
      }),
    /release tag and package versions must match/u,
  );
});

test("rejects an unexpected workspace identity", () => {
  assert.throws(
    () =>
      validateReleaseVersion({
        desktopManifest,
        rootManifest: { ...rootManifest, name: "other" },
      }),
    /not the Breev workspace/u,
  );
});

test("accepts a dated changelog section for the release version", () => {
  assert.doesNotThrow(() =>
    validateReleaseChangelog({
      changelog: "# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-09-05\n",
      version: "1.2.3",
    }),
  );
});

test("rejects a release version missing from the changelog", () => {
  assert.throws(
    () =>
      validateReleaseChangelog({
        changelog: "# Changelog\n\n## [Unreleased]\n",
        version: "1.2.3",
      }),
    /dated section for the release version/u,
  );
});

test("rejects a changelog without an Unreleased section", () => {
  assert.throws(
    () =>
      validateReleaseChangelog({
        changelog: "# Changelog\n",
      }),
    /Changelog and Unreleased headings/u,
  );
});
