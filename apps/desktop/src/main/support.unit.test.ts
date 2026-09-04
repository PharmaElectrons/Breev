import { describe, expect, it } from "vitest";

import {
  createSupportDestination,
  readSupportConfiguration,
} from "./support.js";

const metadata = {
  appVersion: "1.2.3",
  architecture: "x64",
  platform: "win32",
};

describe("desktop support destination", () => {
  it("is unavailable without an approved configuration", () => {
    const configuration = readSupportConfiguration({});
    expect(configuration).toEqual({});
    expect(
      createSupportDestination(configuration, { locale: "en" }, metadata),
    ).toBeUndefined();
  });

  it("builds an encoded mailto without accepting renderer destinations", () => {
    const destination = createSupportDestination(
      readSupportConfiguration({ BREEV_SUPPORT_EMAIL: "help@example.test" }),
      { incidentCode: "VIEW-0123ABCD", locale: "ar" },
      metadata,
    );
    expect(destination?.channel).toBe("email");
    expect(destination?.url).toContain("mailto:help@example.test?");
    expect(destination?.url).toContain("VIEW-0123ABCD");
    expect(destination?.url).not.toContain("\r");
  });

  it("accepts only credential-free HTTPS portals and appends safe metadata", () => {
    const destination = createSupportDestination(
      readSupportConfiguration({
        BREEV_SUPPORT_PORTAL_URL: "https://support.example.test/new",
      }),
      { locale: "en" },
      metadata,
    );
    expect(destination).toEqual({
      channel: "portal",
      url: "https://support.example.test/new?reference=not-provided&version=1.2.3",
    });
    for (const value of [
      "http://support.example.test",
      "https://user:secret@support.example.test",
      "https://support.example.test/#unsafe",
      "javascript:alert(1)",
    ]) {
      expect(
        readSupportConfiguration({ BREEV_SUPPORT_PORTAL_URL: value }),
      ).toEqual({});
    }
  });
});
