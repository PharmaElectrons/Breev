import { Bonjour, type Service } from "bonjour-service";

import type { PairingEndpoint } from "./pairing-endpoint.js";

/**
 * Link-local advertisement of the Main service.
 *
 * Discovery confers no trust and must leak nothing. What goes on the wire is
 * the service type, an opaque installation identifier, the address and port the
 * LAN listener already answers on, and the protocol version — nothing about the
 * pharmacy, its users, its licence, or its data. A terminal that finds this
 * still needs the pairing QR to learn the CA fingerprint and the session
 * secret, so an advertisement on its own gets an attacker no further than a
 * port scan would.
 */
export const DISCOVERY_SERVICE_TYPE = "breev";
export const DISCOVERY_PROTOCOL_VERSION = "1";

export interface DiscoveryPublisher {
  readonly stop: () => Promise<void>;
}

export function publishDiscovery(input: {
  readonly endpoint: PairingEndpoint;
  readonly installationId: string;
}): DiscoveryPublisher {
  const bonjour = new Bonjour();
  const service: Service = bonjour.publish({
    host: input.endpoint.host,
    name: `breev-${input.installationId.slice(0, 8)}`,
    port: input.endpoint.port,
    protocol: "tcp",
    txt: { iid: input.installationId, v: DISCOVERY_PROTOCOL_VERSION },
    type: DISCOVERY_SERVICE_TYPE,
  });

  return {
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => {
        if (service.stop === undefined) {
          resolve();
          return;
        }
        service.stop(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        bonjour.destroy(() => {
          resolve();
        });
      });
    },
  };
}
