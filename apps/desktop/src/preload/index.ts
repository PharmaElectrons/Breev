import {
  DESKTOP_API_GLOBAL,
  DESKTOP_STARTUP_CONFIG_CHANNEL,
} from "@breev/contracts/desktop-preload";
import { contextBridge, ipcRenderer } from "electron";

import { createBreevDesktopApi } from "./api.js";

contextBridge.exposeInMainWorld(
  DESKTOP_API_GLOBAL,
  createBreevDesktopApi(async (_channel, payload) =>
    ipcRenderer.invoke(DESKTOP_STARTUP_CONFIG_CHANNEL, payload),
  ),
);
