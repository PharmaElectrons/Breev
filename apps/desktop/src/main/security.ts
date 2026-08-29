import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import {
  desktopStartupConfigRequestSchema,
  type DesktopStartupConfigRequest,
} from "@breev/contracts/desktop-preload";
import {
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
} from "@breev/contracts/local-rest";

import { BRIDGE_TOKEN_HEADER as TERMINAL_BRIDGE_TOKEN_HEADER } from "./terminal-bridge.js";

export const PACKAGED_APP_ENTRY_URL = "breev://app/index.html";

export const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self' http://127.0.0.1:*",
].join("; ");

export function createHardenedWindowOptions(
  preloadPath: string,
  isProduction: boolean,
): BrowserWindowConstructorOptions {
  return {
    height: 720,
    minHeight: 560,
    minWidth: 720,
    show: false,
    title: "Breev",
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: !isProduction,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      preload: preloadPath,
      safeDialogs: true,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: false,
    },
    width: 1080,
  };
}

interface RendererEntry {
  readonly origin: string;
  readonly url: string;
}

export function resolveRendererEntry(
  isPackaged: boolean,
  developmentUrl: string | undefined,
): RendererEntry {
  if (isPackaged || developmentUrl === undefined) {
    return { origin: "breev://app", url: PACKAGED_APP_ENTRY_URL };
  }

  const url = new URL(developmentUrl);
  const isLoopbackHost =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]";
  if (
    url.protocol !== "http:" ||
    !isLoopbackHost ||
    url.port.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("The Breev development renderer URL must be loopback HTTP");
  }

  return { origin: url.origin, url: url.toString() };
}

interface IpcInvocation {
  readonly senderFrame: {
    readonly isMainFrame: boolean;
    readonly origin: string;
    readonly url: string;
  } | null;
  readonly senderId: number;
}

interface StartupConfigIpcGuardOptions {
  readonly now: () => number;
  readonly trustedSenderId: number;
  readonly trustedOrigin?: string;
  readonly trustedUrl?: string;
}

interface IpcGuardOptions<T> extends StartupConfigIpcGuardOptions {
  readonly maximumCalls: number;
  readonly maximumPayloadBytes: number;
  readonly name: string;
  readonly parse: (payload: unknown) => T;
}

/**
 * Every preload channel carries the same checks: one trusted sender, one
 * trusted main frame, a bounded payload, a schema, and a rate. Sharing the
 * construction keeps a new channel from quietly skipping one of them.
 */
export function createIpcGuard<T>({
  maximumCalls,
  maximumPayloadBytes,
  name,
  now,
  parse,
  trustedSenderId,
  trustedOrigin = "breev://app",
  trustedUrl = "breev://app/index.html",
}: IpcGuardOptions<T>): (invocation: IpcInvocation, payload: unknown) => T {
  let acceptedCallTimes: number[] = [];

  return (invocation, payload) => {
    const frame = invocation.senderFrame;
    if (
      invocation.senderId !== trustedSenderId ||
      frame === null ||
      !frame.isMainFrame ||
      frame.origin !== trustedOrigin ||
      frame.url !== trustedUrl
    ) {
      throw new Error(`Breev denied ${name} IPC from this frame`);
    }

    const serializedPayload = serializeIpcPayload(payload, name);
    if (Buffer.byteLength(serializedPayload, "utf8") > maximumPayloadBytes) {
      throw new Error(`Breev denied an oversized ${name} payload`);
    }
    const request = parse(payload);

    const currentTime = now();
    acceptedCallTimes = acceptedCallTimes.filter(
      (callTime) => currentTime - callTime < 10_000,
    );
    if (acceptedCallTimes.length >= maximumCalls) {
      throw new Error(`Breev denied the ${name} IPC rate`);
    }
    acceptedCallTimes.push(currentTime);

    return request;
  };
}

export function createStartupConfigIpcGuard(
  options: StartupConfigIpcGuardOptions,
): (
  invocation: IpcInvocation,
  payload: unknown,
) => DesktopStartupConfigRequest {
  return createIpcGuard({
    ...options,
    maximumCalls: 4,
    maximumPayloadBytes: 64,
    name: "startup configuration",
    parse: (payload) => desktopStartupConfigRequestSchema.parse(payload),
  });
}

function serializeIpcPayload(payload: unknown, name: string): string {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) {
      throw new Error("not serializable");
    }
    return serialized;
  } catch {
    throw new Error(`Breev denied a non-serializable ${name} payload`);
  }
}

export function resolveAppAssetPath(
  rendererRoot: string,
  requestUrl: string,
): string {
  const url = new URL(requestUrl);
  if (
    url.protocol !== "breev:" ||
    url.hostname !== "app" ||
    url.port.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("The Breev app asset request is not allowed");
  }

  const decodedPath = decodeURIComponent(url.pathname);
  if (
    decodedPath.includes("\\") ||
    decodedPath.includes("\0") ||
    decodedPath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("The Breev app asset path is invalid");
  }

  const relativePath =
    decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const assetPath = path.resolve(rendererRoot, relativePath);
  const relativeToRoot = path.relative(rendererRoot, assetPath);
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("The Breev app asset path escapes the renderer root");
  }

  return assetPath;
}

export interface MainDeviceBinding {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface MainDeviceRequestDetails {
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly url: string;
  readonly webContentsId?: number;
}

interface MainDeviceRequestOptions {
  readonly binding: MainDeviceBinding;
  readonly localApiOrigin: string;
  readonly trustedWebContentsId: number;
}

export function readMainDeviceBinding(
  environment: Readonly<Record<string, string | undefined>>,
  options?: { readonly allowDefaultFile?: boolean },
): MainDeviceBinding | undefined {
  const binding = {
    deviceId: environment.BREEV_MAIN_DEVICE_ID,
    deviceSecret: environment.BREEV_MAIN_DEVICE_SECRET,
    sessionToken: environment.BREEV_MAIN_DEVICE_SESSION,
  };
  const presentCount = Object.values(binding).filter(
    (value) => value !== undefined,
  ).length;
  if (presentCount === 0) {
    // Installed systems have no environment to configure: the desktop app is
    // launched from a shortcut, so the binding the installer generated is
    // read from a file instead. Direct variables win for development. The
    // default path applies only to packaged Windows builds, so a development
    // desktop can never silently consume an installation's credential.
    const configuredPath = environment.BREEV_MAIN_DEVICE_FILE;
    if (configuredPath !== undefined) {
      return readMainDeviceBindingFile(configuredPath);
    }
    if (options?.allowDefaultFile !== true) {
      return undefined;
    }
    const defaultPath = defaultMainDeviceFilePath();
    if (defaultPath === undefined) {
      return undefined;
    }
    // On an installed system a missing or unreadable binding is an
    // installation defect: failing loudly here beats an eternal
    // unauthenticated spinner in the renderer.
    return readMainDeviceBindingFile(defaultPath);
  }
  if (
    presentCount !== 3 ||
    !isUuidV7(binding.deviceId) ||
    !isHighEntropySecret(binding.deviceSecret) ||
    !isHighEntropySecret(binding.sessionToken)
  ) {
    throw new Error("The Main device binding configuration is invalid");
  }
  return {
    deviceId: binding.deviceId,
    deviceSecret: binding.deviceSecret,
    sessionToken: binding.sessionToken,
  };
}

function defaultMainDeviceFilePath(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const programData = process.env.ProgramData;
  if (programData === undefined || programData.length === 0) {
    return undefined;
  }
  return path.join(programData, "Breev", "config", "main-device.json");
}

function readMainDeviceBindingFile(filePath: string): MainDeviceBinding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(
      `The Main device binding file is missing or unreadable: ${filePath}. ` +
        "Repair the Breev installation to restore it.",
    );
  }
  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const binding = {
    deviceId: asBindingString(record.deviceId),
    deviceSecret: asBindingString(record.deviceSecret),
    sessionToken: asBindingString(record.sessionToken),
  };
  if (
    !isUuidV7(binding.deviceId) ||
    !isHighEntropySecret(binding.deviceSecret) ||
    !isHighEntropySecret(binding.sessionToken)
  ) {
    throw new Error("The Main device binding configuration is invalid");
  }
  return {
    deviceId: binding.deviceId,
    deviceSecret: binding.deviceSecret,
    sessionToken: binding.sessionToken,
  };
}

function asBindingString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function addMainDeviceRequestHeaders(
  details: MainDeviceRequestDetails,
  options: MainDeviceRequestOptions,
): Record<string, string> {
  if (
    details.webContentsId !== options.trustedWebContentsId ||
    new URL(details.url).origin !== options.localApiOrigin
  ) {
    return { ...details.requestHeaders };
  }

  const reservedHeaders = new Set([
    "authorization",
    LOCAL_DEVICE_ID_HEADER.toLowerCase(),
    LOCAL_DEVICE_SESSION_HEADER.toLowerCase(),
  ]);
  const requestHeaders = Object.fromEntries(
    Object.entries(details.requestHeaders).filter(
      ([name]) => !reservedHeaders.has(name.toLowerCase()),
    ),
  );
  return {
    ...requestHeaders,
    Authorization: `Breev-Device ${options.binding.deviceSecret}`,
    [LOCAL_DEVICE_ID_HEADER]: options.binding.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: options.binding.sessionToken,
  };
}

interface TerminalBridgeRequestOptions {
  readonly bridgeOrigin: string;
  readonly token: string;
  readonly trustedWebContentsId: number;
}

/**
 * A terminal renderer proves it is this window's renderer with a token the
 * main process mints per boot. Injecting it here, scoped to the bridge origin
 * and the trusted window, mirrors how the Main device credential is attached
 * and keeps the secret out of renderer reach.
 */
export function addTerminalBridgeRequestHeaders(
  details: MainDeviceRequestDetails,
  options: TerminalBridgeRequestOptions,
): Record<string, string> {
  const requestHeaders = Object.fromEntries(
    Object.entries(details.requestHeaders).filter(
      ([name]) => name.toLowerCase() !== TERMINAL_BRIDGE_TOKEN_HEADER,
    ),
  );
  if (
    details.webContentsId !== options.trustedWebContentsId ||
    new URL(details.url).origin !== options.bridgeOrigin
  ) {
    return requestHeaders;
  }
  return { ...requestHeaders, [TERMINAL_BRIDGE_TOKEN_HEADER]: options.token };
}

function isUuidV7(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isHighEntropySecret(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[A-Za-z0-9_-]{43}$/u.test(value) &&
    Buffer.from(value, "base64url").length === 32
  );
}
