import type {
  InventoryCapableUnit,
  ProductBarcodeInput,
  ProductBarcodeKind,
  ProductDefinitionMode,
  ProductFoodTiming,
  ProductPricingMethod,
  ProductStateColour,
  PriceRoundingSetting,
} from "@breev/contracts/local-rest";

export interface ProductFormDraft {
  readonly dirty: boolean;
  readonly step: 1 | 2;
  readonly mode: ProductDefinitionMode;
  readonly medicationFields: {
    readonly dosageForm: string;
    readonly manufacturer: string;
    readonly strength: string;
    readonly tradeName: string;
  };
  readonly generalItemFields: {
    readonly company: string;
    readonly property: string;
    readonly size: string;
    readonly subBrand: string;
    readonly targetAudience: string;
    readonly typeOfUse: string;
  };
  readonly arabicSearchName: string;
  readonly scientificName: string;
  readonly category: string;
  readonly barcodes: readonly ProductBarcodeInput[];
  readonly newBarcode: string;
  readonly newBarcodeKind: ProductBarcodeKind;
  readonly instructions: {
    readonly foodTiming: ProductFoodTiming | "";
    readonly usesPerDay: string;
    readonly usesPerMonth: string;
    readonly usesPerWeek: string;
  };
  readonly sharing: {
    readonly aiSharingAllowed: boolean;
    readonly externallyVisible: boolean;
  };
  readonly stateColours: {
    readonly coldStorageRequired: boolean;
    readonly manual: ProductStateColour | "";
  };
  readonly stockLevels: {
    readonly maximumLevel: string;
    readonly minimumLevel: string;
    readonly reorderPoint: string;
  };
  readonly inventoryUnitName: string;
  readonly packageUnits: readonly {
    readonly id: string;
    readonly baseUnitsPerPackage: string;
    readonly name: string;
  }[];
  readonly hasThirdUnit: boolean;
  readonly thirdUnitName: string;
  readonly defaultUnits: {
    readonly count: InventoryCapableUnit;
    readonly purchase: InventoryCapableUnit;
    readonly sale: InventoryCapableUnit;
  };
  readonly pricingMethod: ProductPricingMethod;
  readonly retailPriceFils: string;
  readonly wholesalePriceFils: string;
  readonly costFils: string;
  readonly marginPercentage: string;
  readonly rounding: PriceRoundingSetting;
}

const drafts = new Map<string, ProductFormDraft>();

export function getProductFormDraft(key: string): ProductFormDraft | undefined {
  return drafts.get(key);
}

export function saveProductFormDraft(
  key: string,
  draft: ProductFormDraft,
): void {
  drafts.set(key, draft);
}

export function clearProductFormDraft(key: string): void {
  drafts.delete(key);
}

export function clearProductFormDrafts(): void {
  drafts.clear();
}
