import { describe, expect, it } from "vitest";

import {
  DISCOVERY_CANDIDATE_LIMIT,
  mergeDiscoveryCandidates,
  toDiscoveryCandidate,
} from "./terminal-discovery.js";

const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";

const service = {
  addresses: ["fe80::1", "192.168.1.5"],
  host: "breev-main.local",
  name: "breev-0192f0a0",
  port: 31_311,
  txt: { iid: installationId, v: "1" },
};

describe("terminal discovery candidates", () => {
  it("prefers an IPv4 address and keeps the advertised installation", () => {
    expect(toDiscoveryCandidate(service)).toEqual({
      host: "192.168.1.5",
      installationId,
      name: "breev-0192f0a0",
      port: 31_311,
    });
  });

  it("falls back to the advertised host when no address resolved", () => {
    expect(
      toDiscoveryCandidate({ ...service, addresses: undefined })?.host,
    ).toBe("breev-main.local");
  });

  it.each([
    ["no TXT record", { txt: undefined }],
    ["another TXT version", { txt: { iid: installationId, v: "2" } }],
    ["no installation", { txt: { v: "1" } }],
    [
      "a version 4 installation",
      { txt: { iid: "0192f0a0-1c2d-4e3f-8a4b-5c6d7e8f9a0c", v: "1" } },
    ],
    ["no port", { port: undefined }],
    ["a port outside the range", { port: 0 }],
    ["no location", { addresses: undefined, host: undefined }],
    ["an unusable location", { addresses: ["192.168.1.5/x"], host: undefined }],
    ["no name", { name: undefined }],
  ])("drops an answer with %s", (_label, overrides) => {
    expect(toDiscoveryCandidate({ ...service, ...overrides })).toBeUndefined();
  });

  it("strips separators out of an advertised name", () => {
    expect(
      toDiscoveryCandidate({ ...service, name: "<b>main</b>" })?.name,
    ).toBe("bmainb");
    expect(toDiscoveryCandidate({ ...service, name: "***" })?.name).toBe(
      "Breev",
    );
  });

  it("keeps one candidate per address and bounds the list", () => {
    const answers = Array.from({ length: 40 }, (_value, index) => ({
      ...service,
      port: 31_311 + index,
    }));
    expect(mergeDiscoveryCandidates([...answers, ...answers]).length).toBe(
      DISCOVERY_CANDIDATE_LIMIT,
    );
    expect(mergeDiscoveryCandidates([service, service])).toHaveLength(1);
  });
});
