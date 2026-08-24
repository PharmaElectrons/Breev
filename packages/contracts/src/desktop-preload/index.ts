import { z } from "zod";

export const DESKTOP_API_GLOBAL = "breevDesktop" as const;
export const DESKTOP_STARTUP_CONFIG_CHANNEL =
  "breev:desktop:get-startup-config" as const;
export const DESKTOP_API_METHODS = ["getStartupConfig"] as const;

export const desktopStartupConfigRequestSchema = z.strictObject({});

export const desktopStartupConfigResponseSchema = z.strictObject({
  localApiOrigin: z.string().max(128).refine(isLocalApiOrigin),
});

export type DesktopStartupConfigRequest = z.infer<
  typeof desktopStartupConfigRequestSchema
>;
export type DesktopStartupConfig = z.infer<
  typeof desktopStartupConfigResponseSchema
>;

export interface BreevDesktopApi {
  getStartupConfig(): Promise<DesktopStartupConfig>;
}

function isLocalApiOrigin(value: string): boolean {
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9]\d{0,4})$/u.exec(
    value,
  );
  return match !== null && Number(match[1]) <= 65_535;
}
