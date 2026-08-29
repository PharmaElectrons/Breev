import type { TLSSocket } from "node:tls";

/**
 * The open TLS connections of each verified terminal.
 *
 * Revocation has to end a device's *connections*, not only its next request:
 * a keep-alive connection that was authenticated before the revocation
 * committed would otherwise keep carrying traffic. The mTLS middleware records
 * a socket the first time it verifies a request on it, and revocation destroys
 * every socket the revoked device still holds.
 */
export interface TerminalSocketRegistry {
  readonly destroyAll: () => void;
  readonly openSocketCount: (deviceId: string) => number;
  readonly register: (deviceId: string, socket: TLSSocket) => void;
  readonly revoke: (deviceId: string) => number;
}

export function createTerminalSocketRegistry(): TerminalSocketRegistry {
  const socketsByDevice = new Map<string, Set<TLSSocket>>();
  /**
   * Every device revoked since this process started.
   *
   * The mTLS boundary reads the device record and registers the socket as two
   * steps, so a request that read the device as live can be paused between them
   * long enough for a revocation to commit and destroy an empty entry. Without
   * this set, that late registration would leave an open connection nothing
   * ever closes. It only ever grows by one entry per revocation, and a revoked
   * device is never un-revoked, so remembering them for the life of the process
   * costs nothing and can never be wrong.
   */
  const revoked = new Set<string>();

  const forget = (deviceId: string, socket: TLSSocket): void => {
    const sockets = socketsByDevice.get(deviceId);
    if (sockets === undefined) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      socketsByDevice.delete(deviceId);
    }
  };

  return {
    destroyAll(): void {
      for (const sockets of socketsByDevice.values()) {
        for (const socket of sockets) {
          socket.destroy();
        }
      }
      socketsByDevice.clear();
    },
    openSocketCount(deviceId: string): number {
      return socketsByDevice.get(deviceId)?.size ?? 0;
    },
    register(deviceId: string, socket: TLSSocket): void {
      if (revoked.has(deviceId)) {
        socket.destroy();
        return;
      }
      const sockets = socketsByDevice.get(deviceId) ?? new Set<TLSSocket>();
      if (sockets.has(socket)) {
        return;
      }
      sockets.add(socket);
      socketsByDevice.set(deviceId, sockets);
      socket.once("close", () => {
        forget(deviceId, socket);
      });
    },
    /**
     * Ends a revoked device's connections and refuses it new ones. The
     * tombstone is recorded before the sockets are destroyed, so a registration
     * racing this call is refused rather than admitted a moment too late.
     */
    revoke(deviceId: string): number {
      revoked.add(deviceId);
      const sockets = socketsByDevice.get(deviceId);
      if (sockets === undefined) {
        return 0;
      }
      socketsByDevice.delete(deviceId);
      for (const socket of sockets) {
        socket.destroy();
      }
      return sockets.size;
    },
  };
}
