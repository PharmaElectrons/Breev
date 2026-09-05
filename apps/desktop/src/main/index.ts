import {
  DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
  DESKTOP_COPY_IDENTIFIER_CHANNEL,
  DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL,
  DESKTOP_MANUAL_ENDPOINT_CHANNEL,
  DESKTOP_OPEN_SUPPORT_CHANNEL,
  DESKTOP_PAIRING_INVITATION_CHANNEL,
  DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL,
  DESKTOP_STARTUP_CONFIG_CHANNEL,
  DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL,
  DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
  desktopCancelTerminalPairingRequestSchema,
  desktopCopyIdentifierResponseSchema,
  desktopExportDiagnosticsRequestSchema,
  desktopExportDiagnosticsResponseSchema,
  desktopManualEndpointRequestSchema,
  desktopOpenSupportRequestSchema,
  desktopOpenSupportResponseSchema,
  desktopPairingInvitationRequestSchema,
  desktopReportRendererIncidentRequestSchema,
  desktopReportRendererIncidentResponseSchema,
  desktopStartupConfigResponseSchema,
  desktopSubmitDiagnosticsRequestSchema,
  desktopSubmitDiagnosticsResponseSchema,
  desktopTerminalPairingStateRequestSchema,
  terminalPairingStateResponseSchema,
  type DesktopDeviceRole,
} from "@breev/contracts/desktop-preload";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import { arch, hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DesktopDiagnostics,
  createRendererRecoveryPolicy,
  incidentCode,
  processGoneReason,
  processType,
  resolveDesktopLogDirectory,
} from "./diagnostics.js";
import {
  createDiagnosticBundle,
  diagnosticFileName,
  writeDiagnosticBundle,
} from "./diagnostic-bundle.js";
import {
  createSupportDestination,
  readSupportConfiguration,
} from "./support.js";
import {
  readCentralDiagnosticConfiguration,
  submitCentralDiagnostic,
} from "./central-diagnostics.js";

import {
  APP_CONTENT_SECURITY_POLICY,
  addMainDeviceRequestHeaders,
  addTerminalBridgeRequestHeaders,
  createDesktopStartupConfig,
  createHardenedWindowOptions,
  createIdentifierCopyIpcGuard,
  createIpcGuard,
  createStartupConfigIpcGuard,
  readInstallationId,
  readMainDeviceBinding,
  resolveAppAssetPath,
  resolveRendererEntry,
} from "./security.js";
import {
  readTerminalDeviceName,
  resolveDesktopDeviceRole,
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

const diagnosticLogDirectory = resolveDesktopLogDirectory(
  process.env,
  process.platform,
  app.getPath("userData"),
);
const programDataDirectory = process.env.ProgramData ?? process.env.PROGRAMDATA;
const diagnostics = new DesktopDiagnostics(diagnosticLogDirectory);
const supportConfiguration = readSupportConfiguration(process.env);
const centralDiagnosticConfiguration = readCentralDiagnosticConfiguration(
  process.env,
);

process.on("uncaughtExceptionMonitor", (error) => {
  diagnostics.fatal(incidentCode(error), "uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  const code = incidentCode(reason);
  diagnostics.fatal(code, "unhandledRejection");
  diagnostics.log({ code, event: "main-unhandled-rejection" });
});

app.on("child-process-gone", (_event, details) => {
  diagnostics.log({
    event: "child-process-gone",
    processType: processType(details.type),
    reason: processGoneReason(details.reason),
  });
});

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
  const recoverRenderer = createRendererRecoveryPolicy();
  const mainBinding =
    role === "main"
      ? readMainDeviceBinding(process.env, {
          allowDefaultFile: app.isPackaged,
        })
      : undefined;

  registerStartupConfigHandler(
    window,
    () =>
      createDesktopStartupConfig({
        diagnosticReporting:
          centralDiagnosticConfiguration === undefined ? "disabled" : "manual",
        identity:
          role === "main"
            ? {
                deviceId: mainBinding?.deviceId,
                installationId: readInstallationId(process.env, {
                  allowDefaultFile: app.isPackaged,
                }),
              }
            : {
                deviceId: terminalRuntime?.deviceId,
                installationId: terminalRuntime?.installationId,
              },
        localApiOrigin,
        role,
      }),
    rendererEntry.origin,
    rendererEntry.url,
  );
  registerIdentifierCopyHandler(
    window,
    rendererEntry.origin,
    rendererEntry.url,
  );
  registerRendererIncidentHandler(
    window,
    rendererEntry.origin,
    rendererEntry.url,
  );
  registerDiagnosticExportHandler(
    window,
    { localApiOrigin, role },
    rendererEntry.origin,
    rendererEntry.url,
  );
  registerSupportHandler(window, rendererEntry.origin, rendererEntry.url);
  registerCentralDiagnosticHandler(
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
    registerMainDeviceHeaderInjection(window, localApiOrigin, mainBinding);
  }
  hardenWebContents(window);
  window.webContents.on("render-process-gone", (_event, details) => {
    diagnostics.log({
      event: "renderer-process-gone",
      reason: processGoneReason(details.reason),
    });
    const recovery = recoverRenderer(details.reason);
    if (recovery === "reload" && !window.isDestroyed()) {
      window.webContents.reload();
    } else if (recovery === "terminate") {
      dialog.showErrorBox(
        "Breev stopped safely / توقف Breev بأمان",
        "The application screen failed repeatedly. Restart Breev and provide the incident time to support.\n\nتعطلت شاشة التطبيق بشكل متكرر. أعد تشغيل Breev وقدم وقت الحادث إلى الدعم.",
      );
      app.exit(1);
    }
  });
  window.webContents.on("preload-error", (_event, _preloadPath, error) => {
    const code = incidentCode(error);
    diagnostics.fatal(code, "preloadError");
    diagnostics.log({ code, event: "preload-failed" });
    dialog.showErrorBox(
      "Breev could not start / تعذر بدء Breev",
      "The secure desktop bridge failed to load. Restart Breev or contact support.\n\nتعذر تحميل جسر سطح المكتب الآمن. أعد تشغيل Breev أو تواصل مع الدعم.",
    );
    app.exit(1);
  });
  window.webContents.on("unresponsive", () => {
    diagnostics.log({ event: "renderer-unresponsive" });
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
      ipcMain.removeHandler(DESKTOP_STARTUP_CONFIG_CHANNEL);
      ipcMain.removeHandler(DESKTOP_COPY_IDENTIFIER_CHANNEL);
      ipcMain.removeHandler(DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL);
      ipcMain.removeHandler(DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL);
      ipcMain.removeHandler(DESKTOP_OPEN_SUPPORT_CHANNEL);
      ipcMain.removeHandler(DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL);
      for (const channel of TERMINAL_CHANNELS) {
        ipcMain.removeHandler(channel);
      }
    }
  });

  void window.loadURL(rendererEntry.url);
}

function registerIdentifierCopyHandler(
  window: BrowserWindow,
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_COPY_IDENTIFIER_CHANNEL);
  const guard = createIdentifierCopyIpcGuard({
    now: Date.now,
    trustedOrigin,
    trustedProcessId: () => window.webContents.mainFrame.processId,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });

  ipcMain.handle(DESKTOP_COPY_IDENTIFIER_CHANNEL, (event, payload: unknown) => {
    const request = guard(toIpcInvocation(event), payload);
    clipboard.writeText(request.identifier);
    return desktopCopyIdentifierResponseSchema.parse({ copied: true });
  });
}

function registerCentralDiagnosticHandler(
  window: BrowserWindow,
  config: { readonly localApiOrigin: string; readonly role: DesktopDeviceRole },
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL);
  const guard = createIpcGuard({
    maximumCalls: 1,
    maximumPayloadBytes: 64,
    name: "central diagnostic submission",
    now: Date.now,
    parse: (payload) => desktopSubmitDiagnosticsRequestSchema.parse(payload),
    trustedOrigin,
    trustedProcessId: () => window.webContents.mainFrame.processId,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });
  ipcMain.handle(
    DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL,
    async (event, payload: unknown) => {
      const request = guard(toIpcInvocation(event), payload);
      if (centralDiagnosticConfiguration === undefined) {
        return desktopSubmitDiagnosticsResponseSchema.parse({
          status: "unavailable",
        });
      }
      const pairingStage =
        config.role === "terminal"
          ? (terminalRuntime?.state().stage ?? "failed")
          : "not-applicable";
      try {
        const bundle = await createDiagnosticBundle({
          appVersion: app.getVersion(),
          electronVersion: process.versions.electron ?? "unknown",
          ...(request.incidentCode === undefined
            ? {}
            : { incidentCode: request.incidentCode }),
          localApiOrigin: config.localApiOrigin,
          logDirectory: diagnosticLogDirectory,
          nodeVersion: process.versions.node,
          pairingStage,
          ...(programDataDirectory === undefined
            ? {}
            : { programDataDirectory }),
          role: config.role,
        });
        const result = await submitCentralDiagnostic(
          centralDiagnosticConfiguration,
          {
            appVersion: app.getVersion(),
            bundle,
            ...(request.incidentCode === undefined
              ? {}
              : { incidentCode: request.incidentCode }),
          },
        );
        return desktopSubmitDiagnosticsResponseSchema.parse(
          result.status === "submitted"
            ? result
            : { code: "submit-failed", status: "failed" },
        );
      } catch {
        return desktopSubmitDiagnosticsResponseSchema.parse({
          code: "submit-failed",
          status: "failed",
        });
      }
    },
  );
}

function registerSupportHandler(
  window: BrowserWindow,
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_OPEN_SUPPORT_CHANNEL);
  const guard = createIpcGuard({
    maximumCalls: 2,
    maximumPayloadBytes: 96,
    name: "support handoff",
    now: Date.now,
    parse: (payload) => desktopOpenSupportRequestSchema.parse(payload),
    trustedOrigin,
    trustedProcessId: () => window.webContents.mainFrame.processId,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });
  ipcMain.handle(
    DESKTOP_OPEN_SUPPORT_CHANNEL,
    async (event, payload: unknown) => {
      const request = guard(toIpcInvocation(event), payload);
      const destination = createSupportDestination(
        supportConfiguration,
        request,
        {
          appVersion: app.getVersion(),
          architecture: arch(),
          platform: process.platform,
        },
      );
      if (destination === undefined) {
        return desktopOpenSupportResponseSchema.parse({
          status: "unavailable",
        });
      }
      try {
        await shell.openExternal(destination.url, { activate: true });
        return desktopOpenSupportResponseSchema.parse({
          channel: destination.channel,
          status: "opened",
        });
      } catch {
        return desktopOpenSupportResponseSchema.parse({
          code: "open-failed",
          status: "failed",
        });
      }
    },
  );
}

function registerDiagnosticExportHandler(
  window: BrowserWindow,
  config: { readonly localApiOrigin: string; readonly role: DesktopDeviceRole },
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL);
  const guard = createIpcGuard({
    maximumCalls: 2,
    maximumPayloadBytes: 96,
    name: "diagnostic export",
    now: Date.now,
    parse: (payload) => desktopExportDiagnosticsRequestSchema.parse(payload),
    trustedOrigin,
    trustedProcessId: () => window.webContents.mainFrame.processId,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });
  ipcMain.handle(
    DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL,
    async (event, payload: unknown) => {
      const request = guard(toIpcInvocation(event), payload);
      const defaultName = diagnosticFileName();
      const selection = await dialog.showSaveDialog(window, {
        defaultPath: path.join(app.getPath("downloads"), defaultName),
        filters: [
          {
            extensions: ["json"],
            name:
              request.locale === "ar" ? "تشخيصات Breev" : "Breev diagnostics",
          },
        ],
        properties: ["createDirectory", "showOverwriteConfirmation"],
        title:
          request.locale === "ar"
            ? "تصدير تشخيصات Breev"
            : "Export Breev diagnostics",
      });
      if (selection.canceled || selection.filePath === "") {
        return desktopExportDiagnosticsResponseSchema.parse({
          status: "cancelled",
        });
      }
      try {
        const pairingStage =
          config.role === "terminal"
            ? (terminalRuntime?.state().stage ?? "failed")
            : "not-applicable";
        const bundle = await createDiagnosticBundle({
          appVersion: app.getVersion(),
          electronVersion: process.versions.electron ?? "unknown",
          ...(request.incidentCode === undefined
            ? {}
            : { incidentCode: request.incidentCode }),
          localApiOrigin: config.localApiOrigin,
          logDirectory: diagnosticLogDirectory,
          nodeVersion: process.versions.node,
          pairingStage,
          ...(programDataDirectory === undefined
            ? {}
            : { programDataDirectory }),
          role: config.role,
        });
        await writeDiagnosticBundle(selection.filePath, bundle);
        return desktopExportDiagnosticsResponseSchema.parse({
          status: "saved",
        });
      } catch {
        return desktopExportDiagnosticsResponseSchema.parse({
          code: "export-failed",
          status: "failed",
        });
      }
    },
  );
}

function registerRendererIncidentHandler(
  window: BrowserWindow,
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL);
  const guard = createIpcGuard({
    maximumCalls: 20,
    maximumPayloadBytes: 128,
    name: "renderer incident report",
    now: Date.now,
    parse: (payload) =>
      desktopReportRendererIncidentRequestSchema.parse(payload),
    trustedOrigin,
    trustedProcessId: () => window.webContents.mainFrame.processId,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });
  ipcMain.handle(
    DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL,
    (event, payload: unknown) => {
      const incident = guard(toIpcInvocation(event), payload);
      diagnostics.log({
        code: incident.code,
        event: "renderer-incident",
        source: incident.source,
      });
      return desktopReportRendererIncidentResponseSchema.parse({
        accepted: true,
      });
    },
  );
}

function registerMainDeviceHeaderInjection(
  window: BrowserWindow,
  localApiOrigin: string,
  binding: ReturnType<typeof readMainDeviceBinding>,
): void {
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
  readConfig: () => ReturnType<typeof createDesktopStartupConfig>,
  trustedOrigin: string,
  trustedUrl: string,
): void {
  ipcMain.removeHandler(DESKTOP_STARTUP_CONFIG_CHANNEL);
  const guard = createStartupConfigIpcGuard({
    now: Date.now,
    trustedOrigin,
    trustedProcessId: () => window.webContents.mainFrame.processId,
    trustedSenderId: window.webContents.id,
    trustedUrl,
  });

  ipcMain.handle(DESKTOP_STARTUP_CONFIG_CHANNEL, (event, payload: unknown) => {
    guard(toIpcInvocation(event), payload);
    return desktopStartupConfigResponseSchema.parse(readConfig());
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
    trustedProcessId: () => window.webContents.mainFrame.processId,
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
    readonly processId: number;
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
            processId: frame.processId,
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
  const role = resolveDesktopDeviceRole(process.env, {
    isPackaged: app.isPackaged,
    platform: process.platform,
  });
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
    diagnostics.log({ event: "app-ready", role: startup.role });
    createWindow(startup.role, startup.localApiOrigin);
  } catch (error) {
    // A packaged build without a valid device binding or terminal state cannot
    // reach the local API. Surfacing the defect beats an unauthenticated
    // spinner.
    const code = incidentCode(error);
    diagnostics.log({ code, event: "startup-failed" });
    dialog.showErrorBox(
      "Breev cannot start | تعذر تشغيل Breev",
      `Error reference: ${code}\nمرجع الخطأ: ${code}`,
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

app.once("before-quit", () => diagnostics.close());
