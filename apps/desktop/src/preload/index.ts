import {
  DESKTOP_API_GLOBAL,
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
} from "@breev/contracts/desktop-preload";
import { contextBridge, ipcRenderer } from "electron";

import { createBreevDesktopApi } from "./api.js";

/**
 * The renderer never names a channel. Only these named channels are reachable, and only
 * through the method that owns each one.
 */
const CHANNELS: ReadonlySet<string> = new Set([
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
]);

contextBridge.exposeInMainWorld(
  DESKTOP_API_GLOBAL,
  createBreevDesktopApi(async (channel, payload) => {
    if (!CHANNELS.has(channel)) {
      throw new Error("Breev denied an unknown desktop channel");
    }
    return ipcRenderer.invoke(channel, payload);
  }),
);
