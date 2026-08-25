import { packager } from "@electron/packager";
import path from "node:path";

await packager({
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
    /playwright\.config\.ts$/,
    /tsconfig(?:\.[^.]+)?\.json$/,
    /vitest\.config\.ts$/,
  ],
  name: "Breev",
  out: path.resolve(import.meta.dirname, "../../../artifacts"),
  overwrite: true,
  platform: process.platform,
  prune: false,
});
