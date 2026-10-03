import type { CountLine } from "@breev/contracts/local-rest";
import { InventoryApiDenied } from "./inventory-api";
import { inventoryMessages } from "./inventory-messages";
import { panelUnitLabel } from "./panel-unit-label";
import { formatNumber, type Locale } from "./preferences";

export type CountNotice =
  | {
      readonly kind: "message";
      readonly key:
        | "unavailable"
        | "archivedItem"
        | "itemRequired"
        | "itemNotFound"
        | "validationEntryInteger"
        | "validationEntryRequired"
        | "applicationSaved"
        | "completed";
    }
  | { readonly kind: "denial"; readonly code: string }
  | { readonly kind: "saved"; readonly line: CountLine }
  | { readonly kind: "balance"; readonly value: string };

export function countFailure(caught: unknown): CountNotice {
  return caught instanceof InventoryApiDenied
    ? { kind: "denial", code: caught.denial.code }
    : { kind: "message", key: "unavailable" };
}
export function countNoticeText(
  notice: CountNotice | null,
  locale: Locale,
): string {
  const copy = inventoryMessages[locale].count;
  if (notice === null) return "";
  switch (notice.kind) {
    case "message":
      return copy[notice.key];
    case "denial":
      return (
        copy.denialMessages[notice.code as keyof typeof copy.denialMessages] ??
        copy.unavailable
      );
    case "balance":
      return copy.balanceChanged(formatNumber(notice.value, locale));
    case "saved": {
      const line = notice.line;
      const variance = BigInt(line.varianceAtObservation);
      return copy.savedAnnouncement(
        line.itemDisplayName,
        formatNumber(line.countedQuantity, locale),
        panelUnitLabel(
          line.inventoryUnitName,
          BigInt(line.countedQuantity),
          locale,
        ),
        (variance > 0n ? "+" : "") + formatNumber(variance, locale),
      );
    }
  }
}
