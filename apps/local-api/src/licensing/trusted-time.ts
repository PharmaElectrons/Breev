const PERSISTENCE_CADENCE_MS = 60 * 60 * 1_000;

export interface TrustedTimeObservation {
  readonly rollbackDetected: boolean;
  readonly trustedNow: Date;
  readonly nextHighWater: Date;
  readonly persistLowerBound: Date | undefined;
}

export function observeTrustedTime(input: {
  readonly now: Date;
  readonly inMemoryHighWater?: Date;
  readonly persistedLowerBound?: Date;
}): TrustedTimeObservation {
  assertDate(input.now);
  if (input.inMemoryHighWater !== undefined)
    assertDate(input.inMemoryHighWater);
  if (input.persistedLowerBound !== undefined)
    assertDate(input.persistedLowerBound);

  const previous = maxDate(input.inMemoryHighWater, input.persistedLowerBound);
  if (previous !== undefined && input.now.getTime() < previous.getTime()) {
    return {
      rollbackDetected: true,
      trustedNow: previous,
      nextHighWater: previous,
      persistLowerBound: undefined,
    };
  }

  const now = new Date(input.now);
  const persistedAt = input.persistedLowerBound?.getTime();
  const shouldPersist =
    persistedAt === undefined ||
    now.getTime() - persistedAt >= PERSISTENCE_CADENCE_MS;
  return {
    rollbackDetected: false,
    trustedNow: now,
    nextHighWater: now,
    persistLowerBound: shouldPersist ? now : undefined,
  };
}

function maxDate(left?: Date, right?: Date): Date | undefined {
  if (left === undefined)
    return right === undefined ? undefined : new Date(right);
  if (right === undefined) return new Date(left);
  return new Date(Math.max(left.getTime(), right.getTime()));
}

function assertDate(value: Date): void {
  if (!Number.isFinite(value.getTime()))
    throw new TypeError("Trusted time must be valid");
}
