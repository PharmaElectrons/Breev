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

export function createStartupConfigIpcGuard({
  now,
  trustedSenderId,
  trustedOrigin = "breev://app",
  trustedUrl = "breev://app/index.html",
}: StartupConfigIpcGuardOptions): (
  invocation: IpcInvocation,
  payload: unknown,
) => DesktopStartupConfigRequest {
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
      throw new Error("Breev denied startup configuration IPC from this frame");
    }

    const serializedPayload = serializeIpcPayload(payload);
    if (Buffer.byteLength(serializedPayload, "utf8") > 64) {
      throw new Error(
        "Breev denied an oversized startup configuration payload",
      );
    }
    const request = desktopStartupConfigRequestSchema.parse(payload);

    const currentTime = now();
    acceptedCallTimes = acceptedCallTimes.filter(
      (callTime) => currentTime - callTime < 10_000,
    );
    if (acceptedCallTimes.length >= 4) {
      throw new Error("Breev denied the startup configuration IPC rate");
    }
    acceptedCallTimes.push(currentTime);

    return request;
  };
}

function serializeIpcPayload(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) {
      throw new Error("not serializable");
    }
    return serialized;
  } catch {
    throw new Error(
      "Breev denied a non-serializable startup configuration payload",
    );
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
    return undefined;
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
