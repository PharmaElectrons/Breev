import { describe, expect, it } from "vitest";

import { readPairingEndpoint } from "./pairing-endpoint.js";

/**
 * One reader, one answer. The address this returns is put inside the invitation
 * a terminal is asked to trust and is the authority the request boundary
 * accepts as a Host on the LAN listener, so anything it would accept loosely is
 * something two parts of Breev could disagree about.
 */
describe("LAN endpoint configuration", () => {
  it("is absent when the LAN listener is not configured", () => {
    expect(readPairingEndpoint({})).toBeUndefined();
  });

  it("reads a concrete address and port", () => {
    expect(
      readPairingEndpoint({
        BREEV_LAN_API_HOST: "192.168.1.100",
        BREEV_LAN_API_PORT: "31311",
      }),
    ).toEqual({ host: "192.168.1.100", port: 31_311 });
    expect(
      readPairingEndpoint({
        BREEV_LAN_API_HOST: "fd00::1",
        BREEV_LAN_API_PORT: "1",
      }),
    ).toEqual({ host: "fd00::1", port: 1 });
  });

  it.each([
    ["a host without a port", { BREEV_LAN_API_HOST: "192.168.1.100" }],
    ["a port without a host", { BREEV_LAN_API_PORT: "31311" }],
  ])("refuses %s", (_description, environment) => {
    expect(() => readPairingEndpoint(environment)).toThrow(
      "BREEV_LAN_API_HOST and BREEV_LAN_API_PORT must be configured together",
    );
  });

  it.each(["breev.local", "0.0.0.0", "::", "192.168.1.100:31311", ""])(
    "refuses a host that is not a concrete address: %s",
    (host) => {
      expect(() =>
        readPairingEndpoint({
          BREEV_LAN_API_HOST: host,
          BREEV_LAN_API_PORT: "31311",
        }),
      ).toThrow("BREEV_LAN_API_HOST must be a concrete IP address");
    },
  );

  it.each(["0", "65536", "-1", "31311.5", "many", ""])(
    "refuses a port that is not in range: %s",
    (port) => {
      expect(() =>
        readPairingEndpoint({
          BREEV_LAN_API_HOST: "192.168.1.100",
          BREEV_LAN_API_PORT: port,
        }),
      ).toThrow("BREEV_LAN_API_PORT must be an integer between 1 and 65535");
    },
  );
});
