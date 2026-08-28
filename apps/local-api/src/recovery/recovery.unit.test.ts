import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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
  readMachineRecoveryKey,
  type RecoveryKeyMaterial,
} from "./recovery-crypto.js";
import { assertStrictRestoreIsolation } from "./restore-isolation.js";
import { RestoreQuarantineService } from "./restore-quarantine.service.js";
import { archiveWalSegment, isValidWalFileName } from "./wal-archiver.js";

const SYSTEM_IDENTIFIER = "7400000000000000001";

function testKey(): RecoveryKeyMaterial {
  return { kek: randomBytes(32), protectionLevel: "software-test" };
}

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "breev-recovery-test-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

async function withTempDirAsync<T>(
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "breev-recovery-test-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

describe("Recovery foundation", () => {
  describe("WAL archiver", () => {
    it("validates standard WAL, history, and backup label filenames", () => {
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

    it("refuses to archive a partial WAL segment as a complete one", () => {
      expect(isValidWalFileName("000000010000000000000001.partial")).toBe(
        false,
      );
    });

    it("publishes the archived segment durably and leaves no temporary file", async () => {
      await withTempDirAsync(async (testDir) => {
        const sourceDir = path.join(testDir, "pg_wal");
        const archiveDir = path.join(testDir, "archive");
        mkdirSync(sourceDir, { recursive: true });

        const walFileName = "000000010000000000000002";
        const sourceWalPath = path.join(sourceDir, walFileName);
        const walContent = randomBytes(1024 * 16);
        writeFileSync(sourceWalPath, walContent);

        const result = await archiveWalSegment({
          destinationDir: archiveDir,
          sourceWalPath,
          walFileName,
        });

        expect(result.alreadyArchived).toBe(false);
        expect(statSync(result.destinationPath).size).toBe(walContent.length);
        expect(readFileSync(result.destinationPath).equals(walContent)).toBe(
          true,
        );
        expect(readdirSync(archiveDir)).toEqual([walFileName]);
      });
    });

    it("accepts an identical retry and rejects a different segment under the same name", async () => {
      await withTempDirAsync(async (testDir) => {
        const sourceDir = path.join(testDir, "pg_wal");
        const archiveDir = path.join(testDir, "archive");
        mkdirSync(sourceDir, { recursive: true });

        const walFileName = "000000010000000000000003";
        const sourceWalPath = path.join(sourceDir, walFileName);
        const walContent = randomBytes(1024 * 16);
        writeFileSync(sourceWalPath, walContent);

        const first = await archiveWalSegment({
          destinationDir: archiveDir,
          sourceWalPath,
          walFileName,
        });
        const retry = await archiveWalSegment({
          destinationDir: archiveDir,
          sourceWalPath,
          walFileName,
        });
        expect(retry.alreadyArchived).toBe(true);
        expect(retry.destinationPath).toBe(first.destinationPath);

        // A different segment of the same length must never replace an
        // archived segment: PostgreSQL requires the archive command to fail.
        const conflicting = randomBytes(walContent.length);
        writeFileSync(sourceWalPath, conflicting);
        await expect(
          archiveWalSegment({
            destinationDir: archiveDir,
            sourceWalPath,
            walFileName,
          }),
        ).rejects.toThrow("already archived with different content");
        expect(readFileSync(first.destinationPath).equals(walContent)).toBe(
          true,
        );
      });
    });

    it("rejects a source WAL file that does not exist", async () => {
      await withTempDirAsync(async (testDir) => {
        await expect(
          archiveWalSegment({
            destinationDir: path.join(testDir, "archive"),
            sourceWalPath: path.join(testDir, "non_existent"),
            walFileName: "000000010000000000000004",
          }),
        ).rejects.toThrow("Source WAL file does not exist");
      });
    });
  });

  describe("Recovery envelope encryption", () => {
    it("round-trips a payload through single-use data encryption keys", () => {
      const key = testKey();
      const keyId = "breev-recovery-kek";
      const payload = Buffer.from("pharmacy operational snapshot", "utf8");

      const first = encryptRecoveryPayload(payload, keyId, key);
      const second = encryptRecoveryPayload(payload, keyId, key);

      expect(first.metadata.algorithm).toBe("aes-256-gcm");
      expect(first.metadata.ivHex).not.toBe(second.metadata.ivHex);
      expect(first.metadata.wrappedKeyHex).not.toBe(
        second.metadata.wrappedKeyHex,
      );
      expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
      expect(first.ciphertext.equals(payload)).toBe(false);

      expect(
        decryptRecoveryPayload({
          ciphertext: first.ciphertext,
          key,
          metadata: first.metadata,
        }).equals(payload),
      ).toBe(true);
    });

    it("refuses a key that is not a 256-bit machine key", () => {
      const key = testKey();
      const encrypted = encryptRecoveryPayload(
        Buffer.from("sensitive recovery data", "utf8"),
        "breev-recovery-kek",
        key,
      );

      expect(() =>
        decryptRecoveryPayload({
          ciphertext: encrypted.ciphertext,
          key: { kek: Buffer.alloc(0), protectionLevel: "software-test" },
          metadata: encrypted.metadata,
        }),
      ).toThrow("RECOVERY_KEY_UNAVAILABLE");
    });

    it("fails authentication for the wrong machine key", () => {
      const encrypted = encryptRecoveryPayload(
        Buffer.from("intact recovery data", "utf8"),
        "breev-recovery-kek",
        testKey(),
      );

      expect(() =>
        decryptRecoveryPayload({
          ciphertext: encrypted.ciphertext,
          key: testKey(),
          metadata: encrypted.metadata,
        }),
      ).toThrow("RECOVERY_AUTHENTICATION_FAILED");
    });

    it("fails authentication for a tampered ciphertext, wrapped key, or key identifier", () => {
      const key = testKey();
      const payload = Buffer.from("intact recovery data", "utf8");
      const encrypted = encryptRecoveryPayload(
        payload,
        "breev-recovery-kek",
        key,
      );

      const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
      tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 0xff;
      expect(() =>
        decryptRecoveryPayload({
          ciphertext: tamperedCiphertext,
          key,
          metadata: encrypted.metadata,
        }),
      ).toThrow("RECOVERY_AUTHENTICATION_FAILED");

      const wrapped = Buffer.from(encrypted.metadata.wrappedKeyHex, "hex");
      wrapped[wrapped.length - 1] = (wrapped[wrapped.length - 1] ?? 0) ^ 0xff;
      expect(() =>
        decryptRecoveryPayload({
          ciphertext: encrypted.ciphertext,
          key,
          metadata: {
            ...encrypted.metadata,
            wrappedKeyHex: wrapped.toString("hex"),
          },
        }),
      ).toThrow("RECOVERY_AUTHENTICATION_FAILED");

      // The wrap is bound to the key identifier, so a recovery point cannot be
      // replayed under a different key name.
      const otherIdentifier = encryptRecoveryPayload(
        payload,
        "breev-recovery-kek-2",
        key,
      );
      expect(() =>
        decryptRecoveryPayload({
          ciphertext: otherIdentifier.ciphertext,
          key,
          metadata: {
            ...otherIdentifier.metadata,
            keyIdentifier: "breev-recovery-kek",
          },
        }),
      ).toThrow("RECOVERY_AUTHENTICATION_FAILED");
    });

    it("rejects an unsupported key identifier instead of passing it to the key store", () => {
      expect(() => readMachineRecoveryKey('a"; rm -rf /; #')).toThrow(
        "RECOVERY_KEY_UNAVAILABLE",
      );
    });

    it("has no software key path outside Windows machine key custody", () => {
      if (process.platform === "win32") {
        return;
      }
      expect(() => readMachineRecoveryKey("breev-recovery-kek")).toThrow(
        "RECOVERY_KEY_UNAVAILABLE",
      );
    });
  });

  describe("Manifest verification", () => {
    it("verifies an intact backup and reports its WAL range", () => {
      withTempDir((testDir) => {
        const files = [
          {
            data: Buffer.from("table data 1", "utf8"),
            relativePath: "tables/main_devices.json",
          },
          {
            data: Buffer.from("table data 2", "utf8"),
            relativePath: "tables/pharmacy_ca.json",
          },
        ];
        for (const file of files) {
          const full = path.join(testDir, file.relativePath);
          mkdirSync(path.dirname(full), { recursive: true });
          writeFileSync(full, file.data);
        }

        const { manifestJson } = createBackupManifest({
          files,
          systemIdentifier: SYSTEM_IDENTIFIER,
          walEndLsn: "0/16B0000",
          walStartLsn: "0/1600000",
        });
        writeFileSync(
          path.join(testDir, "backup_manifest"),
          manifestJson,
          "utf8",
        );

        const result = verifyBackupManifest(testDir);
        expect(result.violations).toEqual([]);
        expect(result.isValid).toBe(true);
        expect(result.fileCount).toBe(2);
        expect(result.walStartLsn).toBe("0/1600000");
        expect(result.walEndLsn).toBe("0/16B0000");
      });
    });

    it("rejects a corrupted file, a missing file, and an unaccounted extra file", () => {
      withTempDir((testDir) => {
        const file = {
          data: Buffer.from("authentic database block", "utf8"),
          relativePath: "tables/main_devices.json",
        };
        const full = path.join(testDir, file.relativePath);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, file.data);

        const { manifestJson } = createBackupManifest({
          files: [file],
          systemIdentifier: SYSTEM_IDENTIFIER,
        });
        writeFileSync(
          path.join(testDir, "backup_manifest"),
          manifestJson,
          "utf8",
        );
        expect(verifyBackupManifest(testDir).isValid).toBe(true);

        const corrupted = Buffer.from(file.data);
        corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
        writeFileSync(full, corrupted);
        const corruptedResult = verifyBackupManifest(testDir);
        expect(corruptedResult.isValid).toBe(false);
        expect(corruptedResult.violations[0]).toContain(
          "Checksum verification failed",
        );

        writeFileSync(full, file.data);
        writeFileSync(path.join(testDir, "tables", "smuggled.json"), "{}");
        const extraResult = verifyBackupManifest(testDir);
        expect(extraResult.isValid).toBe(false);
        expect(extraResult.violations[0]).toContain("Extra file present");

        rmSync(path.join(testDir, "tables"), { force: true, recursive: true });
        const missingResult = verifyBackupManifest(testDir);
        expect(missingResult.isValid).toBe(false);
        expect(missingResult.violations[0]).toContain("Missing backup file");
      });
    });

    it("rejects a missing manifest and a manifest that records no files", () => {
      withTempDir((testDir) => {
        expect(verifyBackupManifest(testDir).violations[0]).toContain(
          "Missing backup_manifest",
        );

        const { manifestJson } = createBackupManifest({
          files: [],
          systemIdentifier: SYSTEM_IDENTIFIER,
        });
        writeFileSync(
          path.join(testDir, "backup_manifest"),
          manifestJson,
          "utf8",
        );
        const result = verifyBackupManifest(testDir);
        expect(result.isValid).toBe(false);
        expect(result.violations).toContain(
          "The backup manifest records no files",
        );
      });
    });
  });

  describe("Restore isolation boundary", () => {
    const live = { dataDirectory: "/var/breev/postgresql", port: 31_311 };

    it("refuses a target that is, contains, or sits inside the live data directory", () => {
      expect(() =>
        assertStrictRestoreIsolation({
          live,
          targetDataDir: "/var/breev/postgresql",
          targetPort: 31_312,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
      expect(() =>
        assertStrictRestoreIsolation({
          live,
          targetDataDir: "/var/breev/postgresql/restore",
          targetPort: 31_312,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
      expect(() =>
        assertStrictRestoreIsolation({
          live,
          targetDataDir: "/var/breev",
          targetPort: 31_312,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
    });

    it("refuses a target that reaches the live data directory through a link", () => {
      withTempDir((testDir) => {
        const liveDir = path.join(testDir, "live");
        mkdirSync(liveDir, { recursive: true });
        const linkPath = path.join(testDir, "innocent");
        symlinkSync(liveDir, linkPath, "dir");

        expect(() =>
          assertStrictRestoreIsolation({
            live: { dataDirectory: liveDir, port: 31_311 },
            targetDataDir: path.join(linkPath, "data"),
            targetPort: 31_312,
          }),
        ).toThrow("RESTORE_SAFETY_VIOLATION");
      });
    });

    it("refuses a target that binds the live port", () => {
      expect(() =>
        assertStrictRestoreIsolation({
          live,
          targetDataDir: "/var/breev/isolated",
          targetPort: 31_311,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
    });

    it("refuses a restore that cannot name the live cluster", () => {
      expect(() =>
        assertStrictRestoreIsolation({
          live: { dataDirectory: "  ", port: 31_311 },
          targetDataDir: "/var/breev/isolated",
          targetPort: 31_312,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
      expect(() =>
        assertStrictRestoreIsolation({
          live,
          targetDataDir: "/var/breev/isolated",
          targetPort: Number.NaN,
        }),
      ).toThrow("RESTORE_SAFETY_VIOLATION");
    });

    it("allows an isolated directory on a distinct port", () => {
      expect(() =>
        assertStrictRestoreIsolation({
          live,
          targetDataDir: "/var/breev/isolated",
          targetPort: 31_312,
        }),
      ).not.toThrow();
    });
  });

  describe("Restore quarantine verification", () => {
    function quarantineServiceWithoutDatabase(): RestoreQuarantineService {
      return new RestoreQuarantineService({
        ensureReady: async () => undefined,
        requirePool: () => {
          throw new Error("no database");
        },
      } as never);
    }

    it("clears the quarantine only when every hook passes", async () => {
      const service = quarantineServiceWithoutDatabase();
      const statements: string[] = [];
      const client = {
        query: async (text: string) => {
          statements.push(text);
          if (text.includes("from main_devices")) {
            return { rowCount: 1, rows: [{ count: "1" }] };
          }
          if (text.includes("from terminal_devices")) {
            return {
              rowCount: 1,
              rows: [
                {
                  active_count: "2",
                  inconsistent_count: "0",
                  revoked_count: "1",
                },
              ],
            };
          }
          if (text.includes("from pharmacy_ca")) {
            return {
              rowCount: 1,
              rows: [{ ca_count: "1", max_created: new Date() }],
            };
          }
          return { rowCount: 1, rows: [] };
        },
      };

      const report = await service.verifyAndClearQuarantine(
        client as never,
        "test_operator",
      );

      expect(report.overallPassed).toBe(true);
      expect(report.checks).toHaveLength(3);
      expect(
        statements.some((text) =>
          text.includes("update system_quarantine_state"),
        ),
      ).toBe(true);
    });

    it("keeps the quarantine when a hook detects a clock rollback", async () => {
      const service = quarantineServiceWithoutDatabase();
      const client = {
        query: async (text: string) => {
          if (text.includes("from main_devices")) {
            return { rowCount: 1, rows: [{ count: "1" }] };
          }
          if (text.includes("from terminal_devices")) {
            return {
              rowCount: 1,
              rows: [
                {
                  active_count: "1",
                  inconsistent_count: "0",
                  revoked_count: "0",
                },
              ],
            };
          }
          if (text.includes("from pharmacy_ca")) {
            return {
              rowCount: 1,
              rows: [
                {
                  ca_count: "1",
                  max_created: new Date(Date.now() + 86_400_000),
                },
              ],
            };
          }
          return { rowCount: 1, rows: [] };
        },
      };

      const report = await service.verifyAndClearQuarantine(
        client as never,
        "test_operator",
      );

      expect(report.overallPassed).toBe(false);
      expect(
        report.checks.find(
          (check) => check.name === "licence_time_verification",
        )?.details,
      ).toContain("Clock rollback detected");
    });

    it("keeps the quarantine when a hook itself fails", async () => {
      const service = quarantineServiceWithoutDatabase();
      const client = {
        query: async (text: string) => {
          if (text.includes("update system_quarantine_state")) {
            return { rowCount: 1, rows: [] };
          }
          throw new Error("relation does not exist");
        },
      };

      const report = await service.verifyAndClearQuarantine(
        client as never,
        "test_operator",
      );

      expect(report.overallPassed).toBe(false);
      expect(report.checks.every((check) => !check.passed)).toBe(true);
    });

    it("treats a missing quarantine record as quarantined", async () => {
      const service = quarantineServiceWithoutDatabase();
      const state = await service.getQuarantineState({
        query: async () => ({ rowCount: 0, rows: [] }),
      } as never);

      expect(state.isQuarantined).toBe(true);
    });
  });
});
