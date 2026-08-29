import { describe, expect, it } from "vitest";

import {
  isPairingHost,
  parsePairingInvitation,
  withPairingEndpoint,
} from "./pairing-invitation.js";

const sessionId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const caFingerprint = "ab".repeat(32);
const joinSecret = Buffer.alloc(32, 7).toString("base64url");

function invitationUri(overrides: Record<string, unknown> = {}): string {
  const payload = {
    f: caFingerprint,
    h: "192.168.1.5",
    i: installationId,
    k: joinSecret,
    p: 31_311,
    s: sessionId,
    v: 1,
    ...overrides,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      delete (payload as Record<string, unknown>)[key];
    }
  }
  return `breev-pair://1/${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

describe("pairing invitation", () => {
  it("reads every trust anchor out of a version 1 invitation", () => {
    expect(parsePairingInvitation(invitationUri())).toEqual({
      caFingerprint,
      endpoint: { host: "192.168.1.5", port: 31_311 },
      installationId,
      joinSecret,
      sessionId,
    });
  });

  it("accepts surrounding whitespace a scanner may append", () => {
    expect(parsePairingInvitation(`  ${invitationUri()}\n`).sessionId).toBe(
      sessionId,
    );
  });

  it.each([
    ["an empty string", ""],
    ["another scheme", invitationUri().replace("breev-pair:", "https:")],
    ["another version", invitationUri().replace("://1/", "://2/")],
    ["a path suffix", `${invitationUri()}/extra`],
    ["a query", `${invitationUri()}?x=1`],
    ["padding characters", invitationUri().replace(/.$/u, "=")],
    ["a truncated payload", "breev-pair://1/aGVsbG8"],
    [
      "an array payload",
      `breev-pair://1/${Buffer.from("[]").toString("base64url")}`,
    ],
    [
      "a null payload",
      `breev-pair://1/${Buffer.from("null").toString("base64url")}`,
    ],
    [
      "a string payload",
      `breev-pair://1/${Buffer.from('"x"').toString("base64url")}`,
    ],
  ])("refuses %s", (_label, value) => {
    expect(() => parsePairingInvitation(value)).toThrow();
  });

  it.each([
    ["an extra field", { extra: "x" }],
    ["a missing session", { s: undefined }],
    ["a missing secret", { k: undefined }],
    ["a string version", { v: "1" }],
    ["a future version", { v: 2 }],
    ["a version 4 installation", { i: "0192f0a0-1c2d-4e3f-8a4b-5c6d7e8f9a0c" }],
    ["a non-hexadecimal pin", { f: "zz".repeat(32) }],
    ["an uppercase pin", { f: "AB".repeat(32) }],
    ["a short pin", { f: "ab".repeat(31) }],
    ["a short secret", { k: Buffer.alloc(16, 7).toString("base64url") }],
    ["a padded secret", { k: `${joinSecret}=` }],
    ["a port of zero", { p: 0 }],
    ["a port above the range", { p: 70_000 }],
    ["a fractional port", { p: 31_311.5 }],
    ["a string port", { p: "31311" }],
    ["a host with a path", { h: "192.168.1.5/admin" }],
    ["a host with credentials", { h: "user@192.168.1.5" }],
    ["a host with a port", { h: "192.168.1.5:31311" }],
    ["an empty host", { h: "" }],
    ["a host with a space", { h: "main pharmacy" }],
  ])("refuses an invitation carrying %s", (_label, overrides) => {
    expect(() => parsePairingInvitation(invitationUri(overrides))).toThrow();
  });

  it("survives malformed payloads without leaking an exception type", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let seed = 0; seed < 400; seed += 1) {
      let payload = "";
      for (let index = 0; index < seed % 64; index += 1) {
        payload += alphabet[(seed * 31 + index * 17) % alphabet.length];
      }
      expect(() => parsePairingInvitation(`breev-pair://1/${payload}`)).toThrow(
        Error,
      );
    }
  });

  it("replaces only the endpoint when the operator types an address", () => {
    const invitation = parsePairingInvitation(invitationUri());
    const moved = withPairingEndpoint(invitation, {
      host: "breev-main.local",
      port: 443,
    });

    expect(moved).toEqual({
      ...invitation,
      endpoint: { host: "breev-main.local", port: 443 },
    });
    expect(moved.caFingerprint).toBe(invitation.caFingerprint);
    expect(moved.joinSecret).toBe(invitation.joinSecret);
    expect(moved.sessionId).toBe(invitation.sessionId);
  });

  it.each([
    { host: "192.168.1.5/x", port: 443 },
    { host: "", port: 443 },
    { host: "192.168.1.5", port: 0 },
    { host: 5, port: 443 },
    { host: "192.168.1.5", port: "443" },
  ])("refuses a manual endpoint that is not a host and port", (endpoint) => {
    const invitation = parsePairingInvitation(invitationUri());
    expect(() => withPairingEndpoint(invitation, endpoint)).toThrow();
  });

  it.each(["192.168.1.5", "10.0.0.1", "breev-main.local", "::1", "main"])(
    "accepts %s as a location",
    (host) => {
      expect(isPairingHost(host)).toBe(true);
    },
  );

  it.each(["", "-main", "main-", "a b", "main/x", "..", "a".repeat(300)])(
    "rejects %s as a location",
    (host) => {
      expect(isPairingHost(host)).toBe(false);
    },
  );
});
