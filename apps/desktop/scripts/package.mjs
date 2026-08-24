import { packager } from "@electron/packager";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";
import path from "node:path";

const packagedApplications = await packager({
  arch: process.arch,
  asar: true,
  dir: path.resolve(import.meta.dirname, ".."),
  electronVersion: "43.4.1",
  ignore: [
    /[\\/]node_modules[\\/]/,
    /[\\/]scripts[\\/]/,
    /[\\/]src[\\/]/,
    /[\\/]test[\\/]/,
    /components\.json$/,
    /electron\.vite\.config\.ts$/,
    /playwright(?:\.browser)?\.config\.ts$/,
    /tsconfig(?:\.[^.]+)?\.json$/,
    /vitest\.config\.ts$/,
  ],
  name: "Breev",
  out: path.resolve(import.meta.dirname, "../../../artifacts"),
  overwrite: true,
  platform: process.platform,
  prune: false,
});

for (const applicationPath of packagedApplications) {
  await flipFuses(packagedExecutablePath(applicationPath), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
}

function packagedExecutablePath(applicationPath) {
  if (process.platform === "win32") {
    return path.join(applicationPath, "Breev.exe");
  }
  if (process.platform === "darwin") {
    const applicationBundle = applicationPath.endsWith(".app")
      ? applicationPath
      : path.join(applicationPath, "Breev.app");
    return path.join(applicationBundle, "Contents", "MacOS", "Breev");
  }
  return path.join(applicationPath, "Breev");
}
