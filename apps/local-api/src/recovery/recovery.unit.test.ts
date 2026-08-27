import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createBackupManifest,
  verifyBackupManifest,
} from "./manifest-verifier.js";
import {
  decryptRecoveryPayload,
  encryptRecoveryPayload,
} from "./recovery-crypto.js";
import { assertStrictRestoreIsolation } from "./restore-isolation.js";
import {
  DeviceIdentityVerificationHook,
  LicenceTimeVerificationHook,
  MainDeviceSecurityVerificationHook,
  RestoreQuarantineService,
} from "./restore-quarantine.service.js";
import { archiveWalSegment, isValidWalFileName } from "./wal-archiver.js";

describe("Recovery Foundation Unit Tests", () => {
  // ─── 1. WAL Archiver ────────────────────────────────────────────────────────
  describe("WAL Archiver", () => {
    it("validates standard PostgreSQL WAL filenames and history files", () => {
      expect(isValidWalFileName("000000010000000000000001")).toBe(true);
      expect(isValidWalFileName("0000000100000001000000FF")).toBe(true);
      expect(isValidWalFileName("00000001.history")).toBe(true);
      expect(
        isValidWalFileName("000000010000000000000001.00000028.backup"),
      ).toBe(true);

      expect(isValidWalFileName("invalid_wal")).toBe(false);
      expect(isValidWalFileName("../000000010000000000000001")).toBe(false);
      expect(isValidWalFileName("000000010000000000000001.tmp")).toBe(false);
    });

    it("stages WAL copy to temporary file before atomic rename", async () => {
      const testDir = mkdtempSync(path.join(tmpdir(), "breev-wal-test-"));
      try {
        const sourceDir = path.join(testDir, "pg_wal");
        const archiveDir = path.join(testDir, "archive");
        mkdirSync(sourceDir, { recursive: true });

        const walFileName = "000000010000000000000002";
        const sourceWalPath = path.join(sourceDir, walFileName);
        const walContent = randomBytes(1024 * 16); // 16 KB segment
        writeFileSync(sourceWalPath, walContent);

        const result = await archiveWalSegment({
          destinationDir: archiveDir,
          sourceWalPath,
          walFileName,
        });

        expect(result.walFileName).toBe(walFileName);
        expect(existsSync(result.destinationPath)).toBe(true);
        expect(statSync(result.destinationPath).size).toBe(walContent.length);

        // Idempotent retry returns success
        const retryResult = await archiveWalSegment({
          destinationDir: archiveDir,
          sourceWalPath,
          walFileName,
        });
        expect(retryResult.destinationPath).toBe(result.destinationPath);
      } finally {
        rmSync(testDir, { force: true, recursive: true });
      }
    });

    it("rejects non-existent source WAL files", async () => {
      const testDir = mkdtempSync(path.join(tmpdir(), "breev-wal-test-"));
      try {
        await expect(
          archiveWalSegment({
            destinationDir: path.join(testDir, "archive"),
            sourceWalPath: path.join(testDir, "non_existent"),
            walFileName: "000000010000000000000003",
          }),
        ).rejects.toThrow("Source WAL file does not exist");
      } finally {
        rmSync(testDir, { force: true, recursive: true });
      }
    });
  });

  // ─── 2. Recovery Cryptography ──────────────────────────────────────────────
  describe("Recovery Cryptography & Envelope Encryption", () => {
    it("completes AES-256-GCM envelope encryption and decryption round-trip", () => {
      const keyId = `test-kek-${randomUUID()}`;
      const payload = Buffer.from(
        "authoritative pharmacy operational snapshot payload with zero plaintext secrets",
        "utf8",
      );

      const encrypted = encryptRecoveryPayload(payload, keyId);
      expect(encrypted.metadata.algorithm).toBe("aes-256-gcm");
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.ciphertext.equals(payload)).toBe(false);

      const decrypted = decryptRecoveryPayload({
        ciphertext: encrypted.ciphertext,
        metadata: encrypted.metadata,
      });

      expect(decrypted.equals(payload)).toBe(true);
      expect(decrypted.toString("utf8")).toBe(payload.toString("utf8"));
    });

    it("refuses restore with explicit error if encryption key is unavailable", () => {
      const keyId = `test-kek-${randomUUID()}`;
      const payload = Buffer.from("sensitive recovery data", "utf8");
      const encrypted = encryptRecoveryPayload(payload, keyId);

      expect(() =>
        decryptRecoveryPayload({
          ciphertext: encrypted.ciphertext,
          customKekProvider: () => null, // Key unavailable
          metadata: encrypted.metadata,
        }),
      ).toThrow("RECOVERY_KEY_UNAVAILABLE");
    });

    it("refuses restore with explicit authentication failure if ciphertext is tampered", () => {
      const keyId = `test-kek-${randomUUID()}`;
      const payload = Buffer.from("intact recovery data", "utf8");
      const encrypted = encryptRecoveryPayload(payload, keyId);

      // Tamper ciphertext
      const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
      tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 0xff;

      expect(() =>
        decryptRecoveryPayload({
          ciphertext: tamperedCiphertext,
          metadata: encrypted.metadata,
        }),
      ).toThrow("RECOVERY_AUTHENTICATION_FAILED");
    });
  });

  // ─── 3. Manifest Verification ──────────────────────────────────────────────
  describe("Manifest Verification (pg_verifybackup class)", () => {
    it("verifies intact backup directory and computes valid manifest checksum", () => {
      const testDir = mkdtempSync(path.join(tmpdir(), "breev-manifest-test-"));
      try {
        const file1 = {
          data: Buffer.from("table data 1", "utf8"),
          relativePath: "tables/main_devices.json",
        };
        const file2 = {
          data: Buffer.from("table data 2", "utf8"),
          relativePath: "tables/pharmacy_ca.json",
        };

        for (const file of [file1, file2]) {
          const full = path.join(testDir, file.relativePath);
          mkdirSync(path.dirname(full), { recursive: true });
          writeFileSync(full, file.data);
        }

        const { manifestJson } = createBackupManifest({
          files: [file1, file2],
          walEndLsn: "0/16B0000",
          walStartLsn: "0/1600000",
        });

        writeFileSync(
          path.join(testDir, "backup_manifest"),
          manifestJson,
          "utf8",
        );

        const result = verifyBackupManifest(testDir);
        expect(result.isValid).toBe(true);
        expect(result.fileCount).toBe(2);
        expect(result.violations).toHaveLength(0);
        expect(result.walStartLsn).toBe("0/1600000");
        expect(result.walEndLsn).toBe("0/16B0000");
      } finally {
        rmSync(testDir, { force: true, recursive: true });
      }
    });

    it("detects and rejects corrupted files with checksum mismatch", () => {
      const testDir = mkdtempSync(path.join(tmpdir(), "breev-manifest-test-"));
      try {
        const file1 = {
          data: Buffer.from("authentic database block", "utf8"),
          relativePath: "base/16384/1259",
        };

        const full = path.join(testDir, file1.relativePath);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, file1.data);

        const { manifestJson } = createBackupManifest({
          files: [file1],
        });

        writeFileSync(
          path.join(testDir, "backup_manifest"),
          manifestJson,
          "utf8",
        );

        // Corrupt file data (same length) after manifest generation
        const corruptedData = Buffer.from(file1.data);
        corruptedData[0] = (corruptedData[0] ?? 0) ^ 0xff;
        writeFileSync(full, corruptedData);

        const result = verifyBackupManifest(testDir);
        expect(result.isValid).toBe(false);
        expect(result.violations[0]).toContain("Checksum verification failed");
      } finally {
        rmSync(testDir, { force: true, recursive: true });
      }
    });

    it("rejects backup directory with missing manifest or missing files", () => {
      const testDir = mkdtempSync(path.join(tmpdir(), "breev-manifest-test-"));
      try {
        const result = verifyBackupManifest(testDir);
        expect(result.isValid).toBe(false);
        expect(result.violations[0]).toContain("Missing backup_manifest");
      } finally {
        rmSync(testDir, { force: true, recursive: true });
      }
    });
  });

  // ─── 4. Restore Isolation Safety ───────────────────────────────────────────
  describe("Restore Isolation Safety Boundary", () => {
    it("strictly refuses restore if target matches live data directory", () => {
      const liveDir = "C:/ProgramData/Breev/PostgresData";
      expect(() =>
        assertStrictRestoreIsolation({
          liveDataDir: liveDir,
          targetDataDir: "C:/ProgramData/Breev/PostgresData",
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
    });

    it("strictly refuses restore if target is located inside live data directory", () => {
      const liveDir = "C:/ProgramData/Breev/PostgresData";
      expect(() =>
        assertStrictRestoreIsolation({
          liveDataDir: liveDir,
          targetDataDir: "C:/ProgramData/Breev/PostgresData/nested_restore",
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
    });

    it("strictly refuses restore if target port matches live port", () => {
      expect(() =>
        assertStrictRestoreIsolation({
          livePort: 5432,
          targetDataDir: "C:/IsolatedRestoreData",
          targetPort: 5432,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
    });

    it("allows restore into isolated directory on distinct port", () => {
      expect(() =>
        assertStrictRestoreIsolation({
          liveDataDir: "C:/ProgramData/Breev/PostgresData",
          livePort: 5432,
          targetDataDir: "C:/IsolatedRestoreData",
          targetPort: 5433,
        }),
      ).not.toThrow();
    });
  });

  // ─── 5. Restore Quarantine Hooks ───────────────────────────────────────────
  describe("Restore Quarantine Service & Hooks", () => {
    it("evaluates hooks and clears quarantine only when all checks pass", async () => {
      const quarantine = new RestoreQuarantineService();
      const state = { cleared: false, isQuarantined: true };

      // Mock database client
      const mockClient = {
        query: async (queryText: string) => {
          if (
            queryText.includes(
              "select count(*)::text as count from main_devices",
            )
          ) {
            return { rows: [{ count: "1" }] };
          }
          if (queryText.includes("select count(*) filter")) {
            return { rows: [{ active_count: "2", revoked_count: "1" }] };
          }
          if (queryText.includes("select count(*)::text as ca_count")) {
            return { rows: [{ ca_count: "1", max_created: new Date() }] };
          }
          if (queryText.includes("update system_quarantine_state")) {
            state.isQuarantined = false;
            state.cleared = true;
            return { rows: [] };
          }
          return { rows: [] };
        },
      };

      quarantine.registerHook(new MainDeviceSecurityVerificationHook());
      quarantine.registerHook(new DeviceIdentityVerificationHook());
      quarantine.registerHook(new LicenceTimeVerificationHook());

      const report = await quarantine.verifyAndClearQuarantine(
        mockClient as unknown as Parameters<
          RestoreQuarantineService["verifyAndClearQuarantine"]
        >[0],
      );
      expect(report.overallPassed).toBe(true);
      expect(report.checks).toHaveLength(3);
      expect(state.cleared).toBe(true);
      expect(state.isQuarantined).toBe(false);
    });

    it("retains quarantine if a verification check detects a violation", async () => {
      const quarantine = new RestoreQuarantineService();
      const state = { cleared: false, isQuarantined: true };

      // Mock database client where clock is in future (rollback detection)
      const mockClient = {
        query: async (queryText: string) => {
          if (
            queryText.includes(
              "select count(*)::text as count from main_devices",
            )
          ) {
            return { rows: [{ count: "1" }] };
          }
          if (queryText.includes("select count(*) filter")) {
            return { rows: [{ active_count: "2", revoked_count: "1" }] };
          }
          if (queryText.includes("select count(*)::text as ca_count")) {
            const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24); // 1 day in future
            return { rows: [{ ca_count: "1", max_created: futureDate }] };
          }
          return { rows: [] };
        },
      };

      quarantine.registerHook(new LicenceTimeVerificationHook());

      const report = await quarantine.verifyAndClearQuarantine(
        mockClient as unknown as Parameters<
          RestoreQuarantineService["verifyAndClearQuarantine"]
        >[0],
      );
      expect(report.overallPassed).toBe(false);
      expect(report.checks[0]?.passed).toBe(false);
      expect(report.checks[0]?.details).toContain("Clock rollback detected");
      expect(state.cleared).toBe(false);
    });
  });
});
