import {
  DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
  DESKTOP_MANUAL_ENDPOINT_CHANNEL,
  DESKTOP_PAIRING_INVITATION_CHANNEL,
  DESKTOP_STARTUP_CONFIG_CHANNEL,
  DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
  desktopCancelTerminalPairingRequestSchema,
  desktopManualEndpointRequestSchema,
  desktopPairingInvitationRequestSchema,
  desktopStartupConfigResponseSchema,
  desktopTerminalPairingStateRequestSchema,
  terminalPairingStateResponseSchema,
  type DesktopDeviceRole,
} from "@breev/contracts/desktop-preload";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
} from "electron";
import { hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  APP_CONTENT_SECURITY_POLICY,
  addMainDeviceRequestHeaders,
  addTerminalBridgeRequestHeaders,
  createHardenedWindowOptions,
  createIpcGuard,
  createStartupConfigIpcGuard,
  readMainDeviceBinding,
  resolveAppAssetPath,
  resolveRendererEntry,
} from "./security.js";
import {
  readDeviceRole,
  readTerminalDeviceName,
  resolveTerminalStateDirectory,
} from "./terminal-role.js";
import {
  startTerminalRuntime,
  type TerminalRuntime,
} from "./terminal-runtime.js";

const DEFAULT_LOCAL_API_ORIGIN = "http://127.0.0.1:31310";

const TERMINAL_CHANNELS = [
  DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
  DESKTOP_MANUAL_ENDPOINT_CHANNEL,
  DESKTOP_PAIRING_INVITATION_CHANNEL,
  DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
] as const;

let mainWindow: BrowserWindow | undefined;
let terminalRuntime: TerminalRuntime | undefined;

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

function createWindow(role: DesktopDeviceRole, localApiOrigin: string): void {
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
    { localApiOrigin, role },
    rendererEntry.origin,
    rendererEntry.url,
  );
  if (role === "terminal" && terminalRuntime !== undefined) {
    registerTerminalPairingHandlers(
      window,
      terminalRuntime,
      rendererEntry.origin,
      rendererEntry.url,
    );
    registerTerminalBridgeHeaderInjection(window, terminalRuntime);
  } else {
    registerMainDeviceHeaderInjection(window, localApiOrigin);
  }
  hardenWebContents(window);

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
      ipcMain.removeHandler(DESKTOP_STARTUP_CONFIG_CHANNEL);
      for (const channel of TERMINAL_CHANNELS) {
        ipcMain.removeHandler(channel);
      }
    }
  });

  void window.loadURL(rendererEntry.url);
}

function registerMainDeviceHeaderInjection(
  window: BrowserWindow,
  localApiOrigin: string,
): void {
  const binding = readMainDeviceBinding(process.env, {
    allowDefaultFile: app.isPackaged,
  });
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

function registerTerminalBridgeHeaderInjection(
  window: BrowserWindow,
  runtime: TerminalRuntime,
): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${runtime.bridgeOrigin}/*`] },
    (details, callback) => {
      callback({
        requestHeaders: addTerminalBridgeRequestHeaders(details, {
          bridgeOrigin: runtime.bridgeOrigin,
          token: runtime.bridgeToken,
          trustedWebContentsId: window.webContents.id,
        }),
      });
    },
  );
}

function registerStartupConfigHandler(
  window: BrowserWindow,
  config: { readonly localApiOrigin: string; readonly role: DesktopDeviceRole },
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
    guard(toIpcInvocation(event), payload);
    return desktopStartupConfigResponseSchema.parse(config);
  });
}

/**
 * The pairing channels exist only in the terminal role, so a Main
 * installation cannot be asked to pair itself even by a compromised renderer.
 */
function registerTerminalPairingHandlers(
  window: BrowserWindow,
  runtime: TerminalRuntime,
  trustedOrigin: string,
  trustedUrl: string,
): void {
  const guardOptions = {
    now: Date.now,
    trustedOrigin,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  };

  handleTerminalChannel(
    DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
    createIpcGuard({
      ...guardOptions,
      maximumCalls: 40,
      maximumPayloadBytes: 64,
      name: "terminal pairing state",
      parse: (payload) =>
        desktopTerminalPairingStateRequestSchema.parse(payload),
    }),
    () => runtime.state(),
  );

  handleTerminalChannel(
    DESKTOP_PAIRING_INVITATION_CHANNEL,
    createIpcGuard({
      ...guardOptions,
      maximumCalls: 6,
      maximumPayloadBytes: 4_096,
      name: "pairing invitation",
      parse: (payload) => desktopPairingInvitationRequestSchema.parse(payload),
    }),
    (request) => runtime.submitInvitation(request.invitation),
  );

  handleTerminalChannel(
    DESKTOP_MANUAL_ENDPOINT_CHANNEL,
    createIpcGuard({
      ...guardOptions,
      maximumCalls: 6,
      maximumPayloadBytes: 4_096,
      name: "manual pairing endpoint",
      parse: (payload) => desktopManualEndpointRequestSchema.parse(payload),
    }),
    (request) => runtime.submitManualEndpoint(request),
  );

  handleTerminalChannel(
    DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
    createIpcGuard({
      ...guardOptions,
      maximumCalls: 6,
      maximumPayloadBytes: 64,
      name: "terminal pairing cancellation",
      parse: (payload) =>
        desktopCancelTerminalPairingRequestSchema.parse(payload),
    }),
    () => runtime.cancelPairing(),
  );
}

function handleTerminalChannel<T>(
  channel: string,
  guard: (
    invocation: ReturnType<typeof toIpcInvocation>,
    payload: unknown,
  ) => T,
  respond: (request: T) => unknown,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, payload: unknown) =>
    terminalPairingStateResponseSchema.parse(
      respond(guard(toIpcInvocation(event), payload)),
    ),
  );
}

function toIpcInvocation(event: Electron.IpcMainInvokeEvent): {
  readonly senderFrame: {
    readonly isMainFrame: boolean;
    readonly origin: string;
    readonly url: string;
  } | null;
  readonly senderId: number;
} {
  const frame = event.senderFrame;
  return {
    senderFrame:
      frame === null
        ? null
        : {
          isMainFrame: frame === event.sender.mainFrame,
          origin: frame.origin,
          url: frame.url,
        },
    senderId: event.sender.id,
  };
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
    role: "main",
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

/**
 * The terminal runtime must exist before the window opens: its bridge origin
 * is the local API origin the renderer receives, and its pairing state decides
 * whether the shell shows the pairing ceremony or the ordinary handshake.
 */
async function startRoleRuntime(): Promise<{
  readonly localApiOrigin: string;
  readonly role: DesktopDeviceRole;
}> {
  const role = readDeviceRole(process.env);
  if (role === "main") {
    return {
      localApiOrigin: readLocalApiOrigin(process.env.BREEV_LOCAL_API_URL),
      role,
    };
  }

  const rendererEntry = resolveRendererEntry(
    app.isPackaged,
    process.env.ELECTRON_RENDERER_URL,
  );
  terminalRuntime = await startTerminalRuntime({
    allowedOrigin: rendererEntry.origin,
    deviceName: readTerminalDeviceName(process.env, hostname()),
    protector: {
      decryptString: (value) => safeStorage.decryptString(value),
      encryptString: (value) => safeStorage.encryptString(value),
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    },
    stateDirectory: resolveTerminalStateDirectory(process.env, {
      platform: process.platform,
    }),
  });
  return { localApiOrigin: terminalRuntime.bridgeOrigin, role };
}

void app.whenReady().then(async () => {
  await registerAppProtocol();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  let startup: Awaited<ReturnType<typeof startRoleRuntime>>;
  try {
    startup = await startRoleRuntime();
    createWindow(startup.role, startup.localApiOrigin);
  } catch (error) {
    // A packaged build without a valid device binding or terminal state cannot
    // reach the local API. Surfacing the defect beats an unauthenticated
    // spinner.
    dialog.showErrorBox(
      "Breev cannot start",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(startup.role, startup.localApiOrigin);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void terminalRuntime?.close();
    terminalRuntime = undefined;
    app.quit();
  }
});
