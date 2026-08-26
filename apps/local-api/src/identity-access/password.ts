import { argon2id, hash, needsRehash, verify, type HashOptions } from "argon2";

export const ARGON2ID_PARAMETERS = {
  iterations: 2,
  memoryKiB: 19_456,
  parallelism: 1,
  version: 19,
} as const;

const HASH_OPTIONS = {
  memoryCost: ARGON2ID_PARAMETERS.memoryKiB,
  parallelism: ARGON2ID_PARAMETERS.parallelism,
  timeCost: ARGON2ID_PARAMETERS.iterations,
  type: argon2id,
  version: ARGON2ID_PARAMETERS.version,
} as const satisfies HashOptions;

export interface StoredPassword {
  readonly algorithm: "argon2id";
  readonly hash: Buffer;
  readonly parameters: typeof ARGON2ID_PARAMETERS;
}

export async function hashPassword(password: string): Promise<StoredPassword> {
  const encoded = await hash(password, HASH_OPTIONS);
  return {
    algorithm: "argon2id",
    hash: Buffer.from(encoded, "utf8"),
    parameters: ARGON2ID_PARAMETERS,
  };
}

export async function verifyPassword(
  password: string,
  storedHash: Buffer,
): Promise<{ matches: boolean; needsRehash: boolean }> {
  const encoded = storedHash.toString("utf8");
  try {
    const matches = await verify(encoded, password);
    return {
      matches,
      needsRehash:
        matches &&
        needsRehash(encoded, {
          memoryCost: HASH_OPTIONS.memoryCost,
          parallelism: HASH_OPTIONS.parallelism,
          timeCost: HASH_OPTIONS.timeCost,
          version: HASH_OPTIONS.version,
        }),
    };
  } catch {
    return { matches: false, needsRehash: false };
  }
}
