import type {
  InventoryColumnField,
  InventoryReviewPreferences,
  InventoryReviewPreferencesUpdateRequest,
} from "@breev/contracts/local-rest";

export interface InventoryPreferenceRevisionRef {
  current: string;
}

export interface InventoryPreferenceColumnsRef {
  current: InventoryReviewPreferences["columns"];
}

type SaveInventoryPreferences = (
  request: InventoryReviewPreferencesUpdateRequest,
) => Promise<InventoryReviewPreferences>;
type ReadInventoryPreferences = () => Promise<InventoryReviewPreferences>;

export interface InventoryPreferenceSaveQueue {
  enqueue(
    field: InventoryColumnField,
    visible: boolean,
  ): Promise<InventoryReviewPreferences>;
}

export function createInventoryPreferenceSaveQueue(
  revision: InventoryPreferenceRevisionRef,
  columns: InventoryPreferenceColumnsRef,
  save: SaveInventoryPreferences,
  read: ReadInventoryPreferences,
  onPreferencesChanged: (preferences: InventoryReviewPreferences) => void,
  createIdempotencyKey: () => string,
): InventoryPreferenceSaveQueue {
  let chain = Promise.resolve();
  let latestEnqueuedSequence = 0;

  return {
    enqueue(field, visible) {
      const sequence = ++latestEnqueuedSequence;
      const result = chain.then(async () => {
        try {
          const nextColumns = columns.current.map((column) =>
            column.field === field ? { ...column, visible } : column,
          );
          const saved = await save({
            columns: nextColumns,
            expectedRevision: revision.current,
            idempotencyKey: createIdempotencyKey(),
          });
          revision.current = saved.revision;
          columns.current = saved.columns;
          if (sequence === latestEnqueuedSequence) {
            onPreferencesChanged(saved);
          }
          return saved;
        } catch (caught) {
          try {
            const reconciled = await read();
            revision.current = reconciled.revision;
            columns.current = reconciled.columns;
            if (sequence === latestEnqueuedSequence) {
              onPreferencesChanged(reconciled);
            }
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
