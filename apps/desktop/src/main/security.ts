import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import {
  desktopStartupConfigRequestSchema,
  type DesktopStartupConfigRequest,
} from "@breev/contracts/desktop-preload";

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
  "connect-src 'self' http://127.0.0.1:* http://localhost:*",
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
