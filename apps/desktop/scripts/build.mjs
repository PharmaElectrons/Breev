import { execSync } from "node:child_process";
import path from "node:path";

const rootNodeModules = path.resolve(import.meta.dirname, "../../node_modules");
const desktopNodeModules = path.resolve(import.meta.dirname, "../node_modules");
const nodePath = [rootNodeModules, desktopNodeModules].join(path.delimiter);

execSync("electron-vite build", {
  env: {
    ...process.env,
    ELECTRON_MAJOR_VER: process.env.ELECTRON_MAJOR_VER || "43",
    NODE_PATH: process.env.NODE_PATH
      ? `${nodePath}${path.delimiter}${process.env.NODE_PATH}`
      : nodePath,
  },
  stdio: "inherit",
});
