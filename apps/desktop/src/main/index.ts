import { app, BrowserWindow } from "electron";
import path from "node:path";

const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:31310";

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  const localApiUrl = readLocalApiUrl(process.env.BREEV_LOCAL_API_URL);
  mainWindow = new BrowserWindow({
    height: 640,
    minHeight: 560,
    minWidth: 720,
    show: false,
    title: "Breev",
    webPreferences: {
      additionalArguments: [
        `--breev-local-api-url=${encodeURIComponent(localApiUrl)}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
    },
    width: 960,
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl === undefined) {
    void mainWindow.loadFile(
      path.join(import.meta.dirname, "../renderer/index.html"),
    );
  } else {
    void mainWindow.loadURL(developmentUrl);
  }
}

function readLocalApiUrl(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_LOCAL_API_URL;
  }

  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new Error("BREEV_LOCAL_API_URL must be an HTTP loopback URL");
  }

  return url.origin;
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
