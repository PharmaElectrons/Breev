import { hash as argonHash, argon2id } from "argon2";
import { describe, expect, it } from "vitest";

import {
  ARGON2ID_PARAMETERS,
  hashPassword,
  verifyPassword,
} from "./password.js";

describe("password storage", () => {
  it("stores a salted Argon2id PHC value with the selected OWASP parameters", async () => {
    const first = await hashPassword("عبارة مرور طويلة وآمنة");
    const second = await hashPassword("عبارة مرور طويلة وآمنة");

    expect(first.algorithm).toBe("argon2id");
    expect(first.parameters).toEqual({
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
      version: 19,
    });
    expect(first.hash.toString("utf8")).toMatch(
      /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u,
    );
    expect(first.hash.equals(second.hash)).toBe(false);
  });

  it("verifies Unicode passwords without reducing their input", async () => {
    const stored = await hashPassword("كلمة سر مع مسافة 🔐");

    await expect(
      verifyPassword("كلمة سر مع مسافة 🔐", stored.hash),
    ).resolves.toEqual({ matches: true, needsRehash: false });
    await expect(
      verifyPassword("كلمة سر مختلفة تماماً", stored.hash),
    ).resolves.toEqual({ matches: false, needsRehash: false });
  });

  it("marks an older successful hash for upgrade on login", async () => {
    const legacy = await argonHash("correct horse battery staple", {
      memoryCost: 12_288,
      parallelism: 1,
      timeCost: 3,
      type: argon2id,
      version: ARGON2ID_PARAMETERS.version,
    });

    await expect(
      verifyPassword("correct horse battery staple", Buffer.from(legacy)),
    ).resolves.toEqual({ matches: true, needsRehash: true });
  });
});
