import {
  PAID_CAPABILITY_NAMES,
  type PaidCapabilityName,
} from "@breev/contracts/local-rest";

import type { ModuleId } from "./module-ids";

/**
 * The renderer surfaces a paid capability shows.
 *
 * docs/product.md: "Menus and functions not enabled for a pharmacy are hidden
 * completely, not shown as disabled buttons — and UI hiding is never the
 * enforcement boundary." This registry is the one place that says which
 * screen or panel each signed capability reveals, so the module bar and the
 * administration workspace cannot drift apart. It is presentation only: the
 * local API gates each operation with its own `requireCapability`, and a
 * capability with no built surface yet maps to nothing rather than to a
 * speculative gate.
 */
export type FeatureSurfaceId = "devices-panel" | "messages";

export const FEATURE_SURFACES: Readonly<
  Record<PaidCapabilityName, readonly FeatureSurfaceId[]>
> = {
  "additional-device-pos": ["devices-panel"],
  "ai-services": [],
  "crm-advanced-reports": [],
  "one-way-cloud-sync": [],
  "purchase-invoice-ocr": [],
  "whatsapp-messaging": ["messages"],
};

/**
 * The capability a surface requires, or `null` when the surface is part of
 * Free Core. A surface belongs to at most one capability, which the unit
 * test enforces, so the first match is the only match.
 */
export function requiredCapabilityFor(
  surface: ModuleId | FeatureSurfaceId,
): PaidCapabilityName | null {
  for (const capability of PAID_CAPABILITY_NAMES) {
    if (
      FEATURE_SURFACES[capability].some(
        (namedSurface) => namedSurface === surface,
      )
    ) {
      return capability;
    }
  }
  return null;
}
