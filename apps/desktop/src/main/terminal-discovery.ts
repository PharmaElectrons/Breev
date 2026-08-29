import type { TerminalDiscoveryCandidate } from "@breev/contracts/desktop-preload";
import Bonjour from "bonjour-service";
import { isIPv4 } from "node:net";

import { isPairingHost } from "./pairing-invitation.js";
import { isUuidV7 } from "./pairing-transcript.js";

export const DISCOVERY_SERVICE_TYPE = "breev" as const;
export const DISCOVERY_CANDIDATE_LIMIT = 16;

/** The shape of an mDNS answer this module reads, and nothing more. */
export interface DiscoveredService {
  readonly addresses?: readonly string[] | undefined;
  readonly host?: string | undefined;
  readonly name?: string | undefined;
  readonly port?: number | undefined;
  readonly txt?: unknown;
}

export interface TerminalDiscovery {
  readonly candidates: () => readonly TerminalDiscoveryCandidate[];
  readonly stop: () => void;
}

/**
 * A candidate is an address, never a trust decision. The installation
 * identifier it advertises only lets the operator recognise their own
 * pharmacy in the list; the invitation still carries the pin.
 */
export function toDiscoveryCandidate(
  service: DiscoveredService,
): TerminalDiscoveryCandidate | undefined {
  const txt = service.txt;
  const record =
    typeof txt === "object" && txt !== null && !Array.isArray(txt)
      ? (txt as Record<string, unknown>)
      : undefined;
  const installationId = record?.iid;
  const host =
    service.addresses?.find((address) => isIPv4(address)) ??
    service.addresses?.[0] ??
    service.host;
  const name = service.name;

  if (
    record?.v !== "1" ||
    typeof installationId !== "string" ||
    !isUuidV7(installationId) ||
    typeof host !== "string" ||
    !isPairingHost(host) ||
    typeof service.port !== "number" ||
    !Number.isInteger(service.port) ||
    service.port < 1 ||
    service.port > 65_535 ||
    typeof name !== "string"
  ) {
    return undefined;
  }

  const displayName = name.replaceAll(/[^\p{L}\p{N} _-]/gu, "").slice(0, 64);
  return {
    host,
    installationId,
    name: displayName.length > 0 ? displayName : "Breev",
    port: service.port,
  };
}

export function mergeDiscoveryCandidates(
  services: readonly DiscoveredService[],
): readonly TerminalDiscoveryCandidate[] {
  const byKey = new Map<string, TerminalDiscoveryCandidate>();
  for (const service of services) {
    const candidate = toDiscoveryCandidate(service);
    if (candidate !== undefined) {
      byKey.set(`${candidate.host}:${candidate.port}`, candidate);
    }
  }
  return [...byKey.values()].slice(0, DISCOVERY_CANDIDATE_LIMIT);
}

/**
 * Browsing runs only while a terminal is unpaired. A paired terminal already
 * knows its endpoint and has no reason to listen to the network.
 */
export function startTerminalDiscovery(): TerminalDiscovery {
  const bonjour = new Bonjour();
  const browser = bonjour.find({
    protocol: "tcp",
    type: DISCOVERY_SERVICE_TYPE,
  });

  return {
    candidates: () => mergeDiscoveryCandidates(browser.services),
    stop: () => {
      browser.stop();
      bonjour.destroy();
    },
  };
}
