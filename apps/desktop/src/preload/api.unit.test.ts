import { describe, expect, it, vi } from "vitest";

import { createBreevDesktopApi } from "./api.js";

describe("desktop preload API", () => {
  it("exposes exactly one named asynchronous method", async () => {
    const invoke = vi.fn().mockResolvedValue({
      localApiOrigin: "http://127.0.0.1:31310",
    });
    const api = createBreevDesktopApi(invoke);

    expect(Object.keys(api)).toEqual(["getStartupConfig"]);
    await expect(api.getStartupConfig()).resolves.toEqual({
      localApiOrigin: "http://127.0.0.1:31310",
    });
    expect(invoke).toHaveBeenCalledWith("breev:desktop:get-startup-config", {});
  });

  it("rejects generic arguments before they cross IPC", async () => {
    const invoke = vi.fn();
    const api = createBreevDesktopApi(invoke);

    await expect(
      Reflect.apply(api.getStartupConfig, api, [{ channel: "generic" }]),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects an invalid response from main", async () => {
    const api = createBreevDesktopApi(
      vi.fn().mockResolvedValue({ localApiOrigin: "file:///etc" }),
    );

    await expect(api.getStartupConfig()).rejects.toThrow();
  });
});
