import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createFixtureAuthority,
  createFixtureDeviceCertificate,
  createFixtureServerCertificate,
} from "./pairing-certificates.fixture.js";
import { subjectPublicKeyInfoDer } from "./pairing-transcript.js";
import {
  collectPeerChain,
  createPairingServerIdentityChecker,
  fingerprintOfCertificate,
  verifyIssuedDeviceCertificate,
  verifyPairingServerChain,
} from "./pairing-trust.js";

const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const otherInstallationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0d";
const deviceId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0e";
const pharmacyId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0f";
const licenceId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a10";

const authority = createFixtureAuthority({ installationId });
const server = createFixtureServerCertificate({ authority, installationId });
const impostor = createFixtureAuthority({ installationId });
const impostorServer = createFixtureServerCertificate({
  authority: impostor,
  installationId,
});

describe("pairing server chain verification", () => {
  it("accepts the chain the pinned authority signed for this installation", () => {
    const verified = verifyPairingServerChain({
      caFingerprint: authority.fingerprint,
      chain: [server.der, authority.der],
      installationId,
    });

    expect(verified.caFingerprint).toBe(authority.fingerprint);
    expect(fingerprintOfCertificate(verified.caCertificatePem)).toBe(
      authority.fingerprint,
    );
  });

  it("refuses a chain whose authority does not match the invitation pin", () => {
    expect(() =>
      verifyPairingServerChain({
        caFingerprint: authority.fingerprint,
        chain: [impostorServer.der, impostor.der],
        installationId,
      }),
    ).toThrow(/pin/iu);
  });

  it("refuses a chain that names another installation", () => {
    expect(() =>
      verifyPairingServerChain({
        caFingerprint: authority.fingerprint,
        chain: [server.der, authority.der],
        installationId: otherInstallationId,
      }),
    ).toThrow();
  });

  it("refuses a leaf the pinned authority did not sign", () => {
    expect(() =>
      verifyPairingServerChain({
        caFingerprint: authority.fingerprint,
        chain: [impostorServer.der, authority.der],
        installationId,
      }),
    ).toThrow(/issued/iu);
  });

  it("refuses a bare leaf with no authority to pin", () => {
    expect(() =>
      verifyPairingServerChain({
        caFingerprint: authority.fingerprint,
        chain: [server.der],
        installationId,
      }),
    ).toThrow();
  });

  it("refuses a device certificate offered as the server identity", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const device = createFixtureDeviceCertificate({
      authority,
      deviceId,
      devicePublicKey: keys.publicKey,
      installationId,
      licenceId,
      pharmacyId,
    });

    expect(() =>
      verifyPairingServerChain({
        caFingerprint: authority.fingerprint,
        chain: [device.der, authority.der],
        installationId,
      }),
    ).toThrow(/server role/iu);
  });

  it("refuses a chain outside its validity window", () => {
    const expiredAuthority = createFixtureAuthority({
      installationId,
      notAfter: new Date(Date.now() - 1_000),
      notBefore: new Date(Date.now() - 10_000),
    });
    const expiredServer = createFixtureServerCertificate({
      authority: expiredAuthority,
      installationId,
      notAfter: new Date(Date.now() - 1_000),
      notBefore: new Date(Date.now() - 10_000),
    });

    expect(() =>
      verifyPairingServerChain({
        caFingerprint: expiredAuthority.fingerprint,
        chain: [expiredServer.der, expiredAuthority.der],
        installationId,
      }),
    ).toThrow(/validity/iu);
  });
});

describe("pairing server identity check", () => {
  const check = createPairingServerIdentityChecker({
    caFingerprint: authority.fingerprint,
    installationId,
  });

  it("passes the pinned authority and this installation's leaf", () => {
    expect(
      check("192.168.1.5", {
        issuerCertificate: { raw: authority.der },
        raw: server.der,
      }),
    ).toBeUndefined();
  });

  it("fails when the chain ends at another authority", () => {
    expect(
      check("192.168.1.5", {
        issuerCertificate: { raw: impostor.der },
        raw: impostorServer.der,
      }),
    ).toBeInstanceOf(Error);
  });

  it("fails when the leaf names another installation", () => {
    const otherServer = createFixtureServerCertificate({
      authority,
      installationId: otherInstallationId,
    });
    expect(
      check("192.168.1.5", {
        issuerCertificate: { raw: authority.der },
        raw: otherServer.der,
      }),
    ).toBeInstanceOf(Error);
  });

  it("stops walking a chain that points at itself", () => {
    const root: { issuerCertificate?: unknown; raw: Buffer } = {
      raw: authority.der,
    };
    root.issuerCertificate = root;
    expect(collectPeerChain(root as never)).toHaveLength(1);
  });
});

describe("issued device certificate verification", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = subjectPublicKeyInfoDer(keys.publicKey);
  const device = createFixtureDeviceCertificate({
    authority,
    deviceId,
    devicePublicKey: keys.publicKey,
    installationId,
    licenceId,
    pharmacyId,
  });

  it("accepts a certificate for this key, this authority, and this terminal", () => {
    expect(
      verifyIssuedDeviceCertificate({
        caCertificatePem: authority.pem,
        caFingerprint: authority.fingerprint,
        certificatePem: device.pem,
        expectedInstallationId: installationId,
        subjectPublicKeyInfoDer: spki,
      }),
    ).toEqual({ deviceId, installationId });
  });

  it("refuses a certificate issued for another key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      verifyIssuedDeviceCertificate({
        caCertificatePem: authority.pem,
        caFingerprint: authority.fingerprint,
        certificatePem: device.pem,
        expectedInstallationId: installationId,
        subjectPublicKeyInfoDer: subjectPublicKeyInfoDer(other.publicKey),
      }),
    ).toThrow(/public key/iu);
  });

  it("refuses a certificate delivered with an unpinned authority", () => {
    expect(() =>
      verifyIssuedDeviceCertificate({
        caCertificatePem: impostor.pem,
        caFingerprint: authority.fingerprint,
        certificatePem: device.pem,
        expectedInstallationId: installationId,
        subjectPublicKeyInfoDer: spki,
      }),
    ).toThrow(/pin/iu);
  });

  it("refuses a certificate for another installation", () => {
    expect(() =>
      verifyIssuedDeviceCertificate({
        caCertificatePem: authority.pem,
        caFingerprint: authority.fingerprint,
        certificatePem: device.pem,
        expectedInstallationId: otherInstallationId,
        subjectPublicKeyInfoDer: spki,
      }),
    ).toThrow();
  });
});
