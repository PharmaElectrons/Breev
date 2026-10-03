import { useEffect, useState } from "react";
import { readBatchSafetyStatus } from "./inventory-api";
import { useIdentityState } from "./identity-state-provider";
import {
  formatDate,
  formatDateTime,
  formatTime,
  type Locale,
} from "./preferences";

/** This authorized read is local to Inventory surfaces, never a shell dependency. */
export function useInventoryTimeZone(
  baseUrl: string,
  enabled = true,
): string | null {
  const { state } = useIdentityState();
  const allowed =
    enabled &&
    state?.state === "authenticated" &&
    state.allowedPermissions.includes("inventory.review");
  const [zone, setZone] = useState<{ scope: string; value: string } | null>(
    null,
  );
  const scope =
    state?.state === "authenticated"
      ? `${baseUrl}:${state.pharmacy.id}:${state.user.id}`
      : "";
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void readBatchSafetyStatus(baseUrl)
      .then((status) => {
        if (active) setZone({ scope, value: status.businessTimeZone });
      })
      .catch(() => {
        if (active) setZone(null);
      });
    return () => {
      active = false;
    };
  }, [allowed, baseUrl, scope]);
  return allowed && zone?.scope === scope ? zone.value : null;
}

export function formatInventoryTimestamp(
  value: string,
  locale: Locale,
  zone: string | null,
  part: "date" | "time" | "dateTime" = "dateTime",
): string {
  if (zone) {
    try {
      const date = new Date(value);
      return part === "date"
        ? formatDate(date, locale, zone)
        : part === "time"
          ? formatTime(date, locale, zone)
          : formatDateTime(date, locale, zone);
    } catch {
      /* Invalid source/zone never falls back to workstation time. */
    }
  }
  return locale === "ar"
    ? "توقيت الصيدلية غير متاح"
    : "Pharmacy time unavailable";
}
