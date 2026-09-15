import type { ModuleId } from "./module-ids";

/**
 * One step of a tutorial.
 *
 * `anchor` matches a `data-tour` attribute in the renderer, and is also the key
 * into `tourCopy` in `help-content.ts`. One name, so the markup and the copy
 * cannot drift apart without a test noticing.
 */
export interface TourStep {
  readonly anchor: string;
  readonly placement?: "auto" | "bottom" | "center" | "left" | "right" | "top";
}

/**
 * Tutorials, by module. Only a module with a real implementation may appear.
 *
 * Tours are deliberately short. A walkthrough a pharmacist abandons halfway has
 * taught nothing, so each one names the few controls that make the screen make
 * sense and then gets out of the way.
 */
export const tourSteps: Partial<Record<ModuleId, readonly TourStep[]>> = {
  dashboard: [
    { anchor: "dashboard-connection", placement: "bottom" },
    { anchor: "dashboard-identity", placement: "top" },
  ],
  purchases: [
    { anchor: "purchases-view-tabs", placement: "bottom" },
    { anchor: "purchases-header-form", placement: "bottom" },
    { anchor: "purchases-lines-table", placement: "top" },
  ],
  inventory: [
    { anchor: "inventory-actions", placement: "bottom" },
    { anchor: "inventory-columns", placement: "bottom" },
    { anchor: "inventory-stock-table", placement: "top" },
  ],
  products: [
    { anchor: "products-search", placement: "bottom" },
    { anchor: "products-rail", placement: "right" },
    { anchor: "products-canvas", placement: "left" },
  ],
  basket: [
    { anchor: "basket-view-tabs", placement: "bottom" },
    { anchor: "basket-table", placement: "top" },
  ],
  administration: [
    { anchor: "admin-workspace-summary", placement: "bottom" },
    { anchor: "admin-change-password", placement: "bottom" },
    { anchor: "admin-licence", placement: "top" },
  ],
};

/**
 * Modules that deliberately have no tutorial, and why.
 *
 * Every module is either here or in `tourSteps`, and a unit test asserts that
 * partition. A new screen therefore cannot ship without someone recording a
 * decision either way, and the Sales entry cannot be quietly forgotten once its
 * surface arrives.
 */
export const MODULES_WITHOUT_TOUR: Partial<Record<ModuleId, string>> = {
  sales: "Surface arrives with issue/27; guide and steps land with it.",
  patients: "Not implemented.",
  messages: "Not implemented.",
  reports: "Not implemented.",
  accounts: "Not implemented.",
  settings: "Not implemented.",
};
