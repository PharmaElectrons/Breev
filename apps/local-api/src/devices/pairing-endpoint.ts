import { isIP } from "node:net";

/**
 * Where a terminal reaches this installation.
 *
 * The endpoint is the LAN listener's address, and it exists only when that
 * listener is configured. Pairing is refused when it is absent rather than
 * inventing a reachable address the terminal could not use.
 *
 * This is the only reader of that configuration. The address ends up inside the
 * pairing invitation a terminal is asked to trust, and it is the authority the
 * request boundary accepts as a Host on the LAN listener, so a second, laxer
 * parse of the same two variables would be a way to disagree with itself.
 */
export interface PairingEndpoint {
  readonly host: string;
  readonly port: number;
}

export const PAIRING_ENDPOINT = "BREEV_PAIRING_ENDPOINT";

export function readPairingEndpoint(
  environment: NodeJS.ProcessEnv,
): PairingEndpoint | undefined {
  const host = environment.BREEV_LAN_API_HOST;
  const port = environment.BREEV_LAN_API_PORT;
  if (host === undefined && port === undefined) {
    return undefined;
  }
  if (host === undefined || port === undefined) {
    throw new Error(
      "BREEV_LAN_API_HOST and BREEV_LAN_API_PORT must be configured together",
    );
  }
  // A concrete address, never a wildcard: the invitation has to name the
  // address the terminal will actually dial, and binding every interface would
  // put the LAN listener somewhere nobody chose.
  if (isIP(host) === 0 || host === "0.0.0.0" || host === "::") {
    throw new Error("BREEV_LAN_API_HOST must be a concrete IP address");
  }
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(
      "BREEV_LAN_API_PORT must be an integer between 1 and 65535",
    );
  }
  return { host, port: parsedPort };
}
