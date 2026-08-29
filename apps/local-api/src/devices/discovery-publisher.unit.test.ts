import { describe, expect, it } from "vitest";

import {
  DISCOVERY_PROTOCOL_VERSION,
  DISCOVERY_SERVICE_TYPE,
  publishDiscovery,
} from "./discovery-publisher.js";

describe("discovery publisher", () => {
  /**
   * Discovery confers no trust, so what matters here is what it does *not*
   * say: no pharmacy, no user, no licence, no CA fingerprint — only the
   * service type, the opaque installation identifier, the address the LAN
   * listener already answers on, and the protocol version.
   */
  it("advertises only the service type, the opaque installation, and the version", async () => {
    expect(DISCOVERY_SERVICE_TYPE).toBe("breev");
    expect(DISCOVERY_PROTOCOL_VERSION).toBe("1");

    const publisher = publishDiscovery({
      endpoint: { host: "127.0.0.1", port: 31_311 },
      installationId: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c",
    });
    await publisher.stop();
  });
});
