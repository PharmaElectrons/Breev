import type {
  InventoryReviewPreferences,
  InventoryReviewPreferencesUpdateRequest,
} from "@breev/contracts/local-rest";

export interface InventoryPreferenceRevisionRef {
  current: string;
}

type SaveInventoryPreferences = (
  request: InventoryReviewPreferencesUpdateRequest,
) => Promise<InventoryReviewPreferences>;
type ReadInventoryPreferences = () => Promise<InventoryReviewPreferences>;

export interface InventoryPreferenceSaveQueue {
  enqueue(
    columns: InventoryReviewPreferences["columns"],
  ): Promise<InventoryReviewPreferences>;
}

export function createInventoryPreferenceSaveQueue(
  revision: InventoryPreferenceRevisionRef,
  save: SaveInventoryPreferences,
  read: ReadInventoryPreferences,
  onReconciled: (preferences: InventoryReviewPreferences) => void,
  createIdempotencyKey: () => string,
): InventoryPreferenceSaveQueue {
  let chain = Promise.resolve();

  return {
    enqueue(columns) {
      const result = chain.then(async () => {
        try {
          const saved = await save({
            columns,
            expectedRevision: revision.current,
            idempotencyKey: createIdempotencyKey(),
          });
          revision.current = saved.revision;
          return saved;
        } catch (caught) {
          try {
            const reconciled = await read();
            revision.current = reconciled.revision;
            onReconciled(reconciled);
          } catch {
            // Preserve the original denial or save failure for the caller.
          }
          throw caught;
        }
      });
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
