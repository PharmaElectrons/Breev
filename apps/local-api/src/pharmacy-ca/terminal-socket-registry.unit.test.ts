import type { TLSSocket } from "node:tls";
import { describe, expect, it } from "vitest";

import { createTerminalSocketRegistry } from "./terminal-socket-registry.js";

interface FakeSocket {
  readonly close: () => void;
  readonly destroyed: () => boolean;
  readonly socket: TLSSocket;
}

/**
 * A socket stand-in with the two behaviours the registry depends on: it can be
 * destroyed, and it reports its own close once.
 */
function fakeSocket(): FakeSocket {
  let destroyed = false;
  const listeners: (() => void)[] = [];
  const socket = {
    destroy(): void {
      destroyed = true;
    },
    once(event: string, listener: () => void): void {
      if (event === "close") {
        listeners.push(listener);
      }
    },
  } as unknown as TLSSocket;
  return {
    close(): void {
      for (const listener of listeners) {
        listener();
      }
    },
    destroyed: () => destroyed,
    socket,
  };
}

const DEVICE = "0198e7ce-7685-7000-8000-000000000001";
const OTHER_DEVICE = "0198e7ce-7685-7000-8000-000000000002";

describe("terminal socket registry", () => {
  it("counts a device's open sockets and forgets them when they close", () => {
    const registry = createTerminalSocketRegistry();
    const first = fakeSocket();
    const second = fakeSocket();

    registry.register(DEVICE, first.socket);
    registry.register(DEVICE, second.socket);
    // Registering the same socket twice is what a second request on one
    // keep-alive connection does, and it must not count twice.
    registry.register(DEVICE, second.socket);
    expect(registry.openSocketCount(DEVICE)).toBe(2);

    first.close();
    expect(registry.openSocketCount(DEVICE)).toBe(1);
    second.close();
    expect(registry.openSocketCount(DEVICE)).toBe(0);
  });

  it("destroys the revoked device's connections and leaves the others alone", () => {
    const registry = createTerminalSocketRegistry();
    const revoked = fakeSocket();
    const untouched = fakeSocket();
    registry.register(DEVICE, revoked.socket);
    registry.register(OTHER_DEVICE, untouched.socket);

    expect(registry.revoke(DEVICE)).toBe(1);
    expect(revoked.destroyed()).toBe(true);
    expect(registry.openSocketCount(DEVICE)).toBe(0);
    expect(untouched.destroyed()).toBe(false);
    expect(registry.openSocketCount(OTHER_DEVICE)).toBe(1);
  });

  it("destroys a socket registered after its device was revoked", () => {
    const registry = createTerminalSocketRegistry();
    // The interleaving the tombstone exists for: a request read the device as
    // live, revocation committed and destroyed an empty entry, and only then
    // does the late request try to register its connection.
    expect(registry.revoke(DEVICE)).toBe(0);

    const late = fakeSocket();
    registry.register(DEVICE, late.socket);
    expect(late.destroyed()).toBe(true);
    expect(registry.openSocketCount(DEVICE)).toBe(0);
  });

  it("keeps refusing a revoked device for the life of the process", () => {
    const registry = createTerminalSocketRegistry();
    registry.revoke(DEVICE);
    registry.destroyAll();

    const later = fakeSocket();
    registry.register(DEVICE, later.socket);
    expect(later.destroyed()).toBe(true);
    expect(registry.openSocketCount(DEVICE)).toBe(0);
  });

  it("destroys every open socket when the listener closes", () => {
    const registry = createTerminalSocketRegistry();
    const left = fakeSocket();
    const right = fakeSocket();
    registry.register(DEVICE, left.socket);
    registry.register(OTHER_DEVICE, right.socket);

    registry.destroyAll();
    expect(left.destroyed()).toBe(true);
    expect(right.destroyed()).toBe(true);
    expect(registry.openSocketCount(DEVICE)).toBe(0);
    expect(registry.openSocketCount(OTHER_DEVICE)).toBe(0);
  });
});
