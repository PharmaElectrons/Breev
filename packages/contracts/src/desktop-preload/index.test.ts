import { describe, expect, it } from "vitest";

import {
  desktopStartupConfigRequestSchema,
  desktopStartupConfigResponseSchema,
} from "./index.js";

describe("desktop preload contract", () => {
  it("accepts the one named startup configuration exchange", () => {
    expect(desktopStartupConfigRequestSchema.parse({})).toEqual({});
    expect(
      desktopStartupConfigResponseSchema.parse({
        localApiOrigin: "http://127.0.0.1:31310",
      }),
    ).toEqual({ localApiOrigin: "http://127.0.0.1:31310" });
  });

  it.each([
    { request: "generic" },
    { channel: "arbitrary" },
    { path: "/tmp/breev" },
  ])("rejects generic or privileged request fields", (payload) => {
    expect(() => desktopStartupConfigRequestSchema.parse(payload)).toThrow();
  });

  it.each([
    "file:///tmp/breev",
    "https://example.com",
    "http://localhost:31310",
    "http://127.0.0.1:31310/health",
    "http://user:secret@127.0.0.1:31310",
  ])("rejects an unsafe local API origin: %s", (localApiOrigin) => {
    expect(() =>
      desktopStartupConfigResponseSchema.parse({ localApiOrigin }),
    ).toThrow();
  });
});
