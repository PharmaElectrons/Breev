import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";

declare global {
  interface Window {
    readonly breevDesktop: BreevDesktopApi;
  }
}

export {};
