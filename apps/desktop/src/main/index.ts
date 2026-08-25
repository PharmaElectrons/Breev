import {
  DESKTOP_STARTUP_CONFIG_CHANNEL,
  desktopStartupConfigResponseSchema,
} from "@breev/contracts/desktop-preload";
import { app, BrowserWindow, ipcMain, net, protocol, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  APP_CONTENT_SECURITY_POLICY,
  addMainDeviceRequestHeaders,
  createHardenedWindowOptions,
  createStartupConfigIpcGuard,
  readMainDeviceBinding,
  resolveAppAssetPath,
  resolveRendererEntry,
} from "./security.js";

const DEFAULT_LOCAL_API_ORIGIN = "http://127.0.0.1:31310";

let mainWindow: BrowserWindow | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "breev",
    privileges: {
      codeCache: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

function createWindow(): void {
  const localApiOrigin = readLocalApiOrigin(process.env.BREEV_LOCAL_API_URL);
  const preloadPath = path.join(import.meta.dirname, "../preload/index.cjs");
  const rendererEntry = resolveRendererEntry(
    app.isPackaged,
    process.env.ELECTRON_RENDERER_URL,
  );

  mainWindow = new BrowserWindow(
    createHardenedWindowOptions(preloadPath, app.isPackaged),
  );
  const window = mainWindow;

  registerStartupConfigHandler(
    window,
    localApiOrigin,
    rendererEntry.origin,
    rendererEntry.url,
  );
  registerMainDeviceHeaderInjection(window, localApiOrigin);
  hardenWebContents(window);

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
      ipcMain.removeHandler(DESKTOP_STARTUP_CONFIG_CHANNEL);
    }
  });

  void window.loadURL(rendererEntry.url);
}

function registerMainDeviceHeaderInjection(
  window: BrowserWindow,
  localApiOrigin: string,
): void {
  const binding = readMainDeviceBinding(process.env);
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${localApiOrigin}/*`] },
    (details, callback) => {
      callback({
        requestHeaders:
          binding === undefined
            ? details.requestHeaders
            : addMainDeviceRequestHeaders(details, {
                binding,
                localApiOrigin,
                trustedWebContentsId: window.webContents.id,
              }),
      });
    },
  );
}

function registerStartupConfigHandler(
  window: BrowserWindow,
  localApiOrigin: string,
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_STARTUP_CONFIG_CHANNEL);
  const guard = createStartupConfigIpcGuard({
    now: Date.now,
    trustedOrigin,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });

  ipcMain.handle(DESKTOP_STARTUP_CONFIG_CHANNEL, (event, payload: unknown) => {
    const frame = event.senderFrame;
    guard(
      {
        senderFrame:
          frame === null
            ? null
            : {
                isMainFrame: frame === event.sender.mainFrame,
                origin: frame.origin,
                url: frame.url,
              },
        senderId: event.sender.id,
      },
      payload,
    );

    return desktopStartupConfigResponseSchema.parse({ localApiOrigin });
  });
}

function hardenWebContents(window: BrowserWindow): void {
  // No external destination is approved for this shell, so #33's explicit
  // HTTPS allowlist is intentionally empty.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
}

function readLocalApiOrigin(value: string | undefined): string {
  return desktopStartupConfigResponseSchema.parse({
    localApiOrigin: value ?? DEFAULT_LOCAL_API_ORIGIN,
  }).localApiOrigin;
}

async function registerAppProtocol(): Promise<void> {
  const rendererRoot = path.resolve(import.meta.dirname, "../renderer");
  await protocol.handle("breev", async (request) => {
    if (request.method !== "GET") {
      return new Response(null, { status: 405 });
    }

    try {
      const assetPath = resolveAppAssetPath(rendererRoot, request.url);
      const response = await net.fetch(pathToFileURL(assetPath).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", APP_CONTENT_SECURITY_POLICY);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch {
      return new Response(null, { status: 403 });
    }
  });
}

void app.whenReady().then(async () => {
  await registerAppProtocol();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

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
