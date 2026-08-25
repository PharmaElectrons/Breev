import {
  DESKTOP_STARTUP_CONFIG_CHANNEL,
  desktopStartupConfigRequestSchema,
  desktopStartupConfigResponseSchema,
  type BreevDesktopApi,
} from "@breev/contracts/desktop-preload";

type Invoke = (channel: string, payload: unknown) => Promise<unknown>;

export function createBreevDesktopApi(invoke: Invoke): BreevDesktopApi {
  return Object.freeze({
    getStartupConfig: async (...arguments_: unknown[]) => {
      if (arguments_.length !== 0) {
        throw new Error("getStartupConfig does not accept arguments");
      }

      const request = desktopStartupConfigRequestSchema.parse({});
      const response = await invoke(DESKTOP_STARTUP_CONFIG_CHANNEL, request);
      return desktopStartupConfigResponseSchema.parse(response);
    },
  });
}
