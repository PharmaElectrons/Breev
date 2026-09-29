import {
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  DEFAULT_PRODUCT_PRICING_METHOD,
  PRICE_ROUNDING_SETTINGS,
  PRODUCT_DEFINITION_MODES,
  PRODUCT_FOOD_TIMINGS,
  PRODUCT_NAME_TEMPLATES,
  PRODUCT_PRICING_METHODS,
  composeDisplayName,
  type CatalogFieldError,
  type GeneralItemNameFields,
  type InventoryCapableUnit,
  type MedicationNameFields,
  type PriceRoundingSetting,
  type Product,
  type ProductBarcodeInput,
  type ProductBarcodeKind,
  type ProductCreateRequest,
  type ProductDefinitionMode,
  type ProductEditRequest,
  type ProductFoodTiming,
  type ProductStateColour,
  type ProductPackaging,
  type ProductPricingInput,
  type ProductPricingMethod,
  type ProductManualStateColour,
} from "@breev/contracts/local-rest";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Barcode,
  ChevronDown,
  ChevronUp,
  History,
  LogOut,
  Plus,
  Printer,
  Save,
  ScanBarcode,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import {
  archiveProduct,
  CatalogApiDenied,
  createProduct,
  editProduct,
  mergeProduct,
  newIdempotencyKey,
  requestBarcodePrint,
  suggestProductBarcode,
} from "./catalog-api";
import { catalogMessages, type CatalogCopy } from "./catalog-messages";
import { ProductMovementHistory } from "./product-movement-history";
import { ProductInventoryBatches } from "./product-inventory-batches";
import { ProductSupplierLinks } from "./product-supplier-links";
import {
  clearProductFormDraft,
  getProductFormDraft,
  saveProductFormDraft,
  type ProductFormDraft,
} from "./product-form-drafts";
import { usePreferences } from "./preferences-provider";
import { useIdentityState } from "./identity-state-provider";
import { formatFilsToIqd } from "./product-record";
import { calculateRetailPricePreview } from "./product-pricing";

/**
 * Deterministically map server field error path to the corresponding form input key.
 * This ensures nested errors on package units, default units, and pricing focus the
 * exact indexed input instead of collapsing to a shared field name.
 */
export function serverPathToFormKey(
  path: readonly (string | number)[],
): string {
  if (path.length >= 3 && path[0] === "definition" && path[1] === "fields") {
    return String(path[2]);
  }
  if (
    (path.length >= 3 &&
      path[0] === "packaging" &&
      path[1] === "defaultUnits") ||
    (path.length >= 2 && path[0] === "defaultUnits")
  ) {
    const interfaceName = path[0] === "packaging" ? path[2] : path[1];
    return `packaging.defaultUnits.${interfaceName}`;
  }
  if (
    (path.length === 2 && path[0] === "packaging" && path[1] === "thirdUnit") ||
    (path.length === 1 && path[0] === "thirdUnit")
  ) {
    return "packaging.thirdUnit.name";
  }
  if (path[0] === "packageUnits") {
    return `packaging.${path.join(".")}`;
  }
  return path.join(".");
}

/**
 * Safely revert any default unit selector pointing to a removed package unit
 * back to the base inventory unit.
 */
export function cleanDefaultUnitsOnPackageRemoval(
  defaultUnits: {
    readonly count: InventoryCapableUnit;
    readonly purchase: InventoryCapableUnit;
    readonly sale: InventoryCapableUnit;
  },
  removedPackageName: string,
): {
  count: InventoryCapableUnit;
  purchase: InventoryCapableUnit;
  sale: InventoryCapableUnit;
} {
  const sanitize = (unit: InventoryCapableUnit): InventoryCapableUnit =>
    unit.kind === "package-unit" && unit.packageUnitName === removedPackageName
      ? { kind: "inventory-unit" }
      : unit;

  return {
    count: sanitize(defaultUnits.count),
    purchase: sanitize(defaultUnits.purchase),
    sale: sanitize(defaultUnits.sale),
  };
}

/**
 * Construct contract-compliant packaging payload preserving exact canonical strings.
 */
export function buildPackagingPayload({
  defaultUnits,
  hasThirdUnit,
  inventoryUnitName,
  packageUnits,
  thirdUnitName,
}: {
  readonly defaultUnits: {
    readonly count: InventoryCapableUnit;
    readonly purchase: InventoryCapableUnit;
    readonly sale: InventoryCapableUnit;
  };
  readonly hasThirdUnit: boolean;
  readonly inventoryUnitName: string;
  readonly packageUnits: readonly {
    readonly baseUnitsPerPackage: string;
    readonly name: string;
  }[];
  readonly thirdUnitName: string;
}): ProductPackaging {
  const normalizedDefault = (
    unit: InventoryCapableUnit,
  ): InventoryCapableUnit =>
    unit.kind === "inventory-unit"
      ? unit
      : { kind: "package-unit", packageUnitName: unit.packageUnitName.trim() };

  return {
    defaultUnits: {
      count: normalizedDefault(defaultUnits.count),
      purchase: normalizedDefault(defaultUnits.purchase),
      sale: normalizedDefault(defaultUnits.sale),
    },
    inventoryUnitName: inventoryUnitName.trim(),
    packageUnits: packageUnits.map((u) => ({
      baseUnitsPerPackage: u.baseUnitsPerPackage.trim(),
      name: u.name.trim(),
    })),
    thirdUnit:
      hasThirdUnit && thirdUnitName.trim().length > 0
        ? { name: thirdUnitName.trim() }
        : null,
  };
}

/**
 * Construct contract-compliant pricing discriminated union payload.
 */
export function buildPricingPayload({
  costFils,
  marginPercentage,
  method,
  retailPriceFils,
  rounding,
  wholesalePriceFils,
}: {
  readonly costFils: string;
  readonly marginPercentage: string;
  readonly method: ProductPricingMethod;
  readonly retailPriceFils: string;
  readonly rounding: PriceRoundingSetting;
  readonly wholesalePriceFils: string;
}): ProductPricingInput {
  const trimmedWholesale = wholesalePriceFils.trim();
  const wholesale = trimmedWholesale.length > 0 ? trimmedWholesale : null;

  if (method === "by-price") {
    return {
      method: "by-price",
      retailPriceFils: retailPriceFils.trim(),
      wholesalePriceFils: wholesale,
    };
  }

  return {
    costFils: costFils.trim(),
    marginPercentage: marginPercentage.trim(),
    method: "by-percentage",
    rounding,
    wholesalePriceFils: wholesale,
  };
}

export interface ProductFormProps {
  readonly baseUrl: string;
  readonly categoryOptions?: readonly string[];
  readonly initialBarcode?: string;
  readonly initialProduct?: Product | null;
  readonly onCancel?: () => void;
  readonly onProductChanged?: (product: Product) => void;
  readonly onReload?: () => Promise<void>;
  readonly onSuccess?: (product: Product) => void;
}

/**
 * The live preview the pharmacist watches assemble as they type.
 */
export function composeProductDisplayName(
  mode: ProductDefinitionMode,
  fields: Readonly<Record<string, string | null | undefined>>,
): string {
  return composeDisplayName(
    PRODUCT_NAME_TEMPLATES[CURRENT_PRODUCT_NAME_TEMPLATE_VERSION][mode],
    fields,
  );
}

export interface AbandonedField {
  readonly fieldKey: string;
  readonly label: string;
  readonly value: string;
}

export function getAbandonedDirtyFields(
  currentMode: ProductDefinitionMode,
  medicationFields: {
    readonly dosageForm: string;
    readonly manufacturer: string;
    readonly strength: string;
    readonly tradeName: string;
  },
  generalItemFields: {
    readonly company: string;
    readonly property: string;
    readonly size: string;
    readonly subBrand: string;
    readonly targetAudience: string;
    readonly typeOfUse: string;
  },
  copy: CatalogCopy,
): AbandonedField[] {
  if (currentMode === "medication") {
    const dirty: AbandonedField[] = [];
    if (medicationFields.tradeName.trim().length > 0) {
      dirty.push({
        fieldKey: "tradeName",
        label: copy.definition.medication.tradeName,
        value: medicationFields.tradeName.trim(),
      });
    }
    if (medicationFields.strength.trim().length > 0) {
      dirty.push({
        fieldKey: "strength",
        label: copy.definition.medication.strength,
        value: medicationFields.strength.trim(),
      });
    }
    if (medicationFields.dosageForm.trim().length > 0) {
      dirty.push({
        fieldKey: "dosageForm",
        label: copy.definition.medication.dosageForm,
        value: medicationFields.dosageForm.trim(),
      });
    }
    if (medicationFields.manufacturer.trim().length > 0) {
      dirty.push({
        fieldKey: "manufacturer",
        label: copy.definition.medication.manufacturer,
        value: medicationFields.manufacturer.trim(),
      });
    }
    return dirty;
  }

  const dirty: AbandonedField[] = [];
  if (generalItemFields.company.trim().length > 0) {
    dirty.push({
      fieldKey: "company",
      label: copy.definition.generalItem.company,
      value: generalItemFields.company.trim(),
    });
  }
  if (generalItemFields.subBrand.trim().length > 0) {
    dirty.push({
      fieldKey: "subBrand",
      label: copy.definition.generalItem.subBrand,
      value: generalItemFields.subBrand.trim(),
    });
  }
  if (generalItemFields.typeOfUse.trim().length > 0) {
    dirty.push({
      fieldKey: "typeOfUse",
      label: copy.definition.generalItem.typeOfUse,
      value: generalItemFields.typeOfUse.trim(),
    });
  }
  if (generalItemFields.property.trim().length > 0) {
    dirty.push({
      fieldKey: "property",
      label: copy.definition.generalItem.property,
      value: generalItemFields.property.trim(),
    });
  }
  if (generalItemFields.targetAudience.trim().length > 0) {
    dirty.push({
      fieldKey: "targetAudience",
      label: copy.definition.generalItem.targetAudience,
      value: generalItemFields.targetAudience.trim(),
    });
  }
  if (generalItemFields.size.trim().length > 0) {
    dirty.push({
      fieldKey: "size",
      label: copy.definition.generalItem.size,
      value: generalItemFields.size.trim(),
    });
  }
  return dirty;
}

export function ModeSwitchConfirmationDialog({
  abandonedFields,
  copy,
  onCancel,
  onConfirm,
}: {
  readonly abandonedFields: readonly AbandonedField[];
  readonly copy: CatalogCopy;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        aria-describedby="mode-switch-description"
        aria-labelledby="mode-switch-title"
        aria-modal="true"
        className="identity-card step-up-dialog"
        role="dialog"
      >
        <h3 id="mode-switch-title">{copy.modeSwitchModal.title}</h3>
        <p id="mode-switch-description">{copy.modeSwitchModal.description}</p>
        {abandonedFields.length > 0 ? (
          <div className="abandoned-fields-list my-3">
            <p className="font-semibold text-sm">
              {copy.modeSwitchModal.abandonedFieldsLead}
            </p>
            <ul className="list-disc ps-5 text-sm mt-1 space-y-1">
              {abandonedFields.map((f) => (
                <li key={f.fieldKey}>
                  <strong>{f.label}:</strong> {f.value}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="form-actions mt-4 flex justify-end gap-2">
          <button className="quiet-button" type="button" onClick={onCancel}>
            {copy.modeSwitchModal.cancel}
          </button>
          <button
            className="primary-button"
            data-action="confirm"
            type="button"
            onClick={onConfirm}
          >
            {copy.modeSwitchModal.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

interface StepperInputProps {
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
  readonly "aria-label"?: string;
  readonly "aria-required"?: boolean | "true" | "false";
  readonly className?: string;
  readonly "data-field-key"?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly isBold?: boolean;
  readonly max?: number;
  readonly min?: number;
  readonly name?: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly step?: number;
  readonly value: string;
}

function StepperInput({
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-required": ariaRequired,
  className = "",
  "data-field-key": dataFieldKey,
  disabled = false,
  id,
  isBold = false,
  max,
  min = 0,
  name,
  onChange,
  placeholder,
  step = 1,
  value,
}: StepperInputProps): React.JSX.Element {
  const handleStep = (direction: 1 | -1): void => {
    if (disabled) return;
    const current = Number.parseInt(value, 10);
    const base = Number.isNaN(current) ? 0 : current;
    const next = base + direction * step;
    if (min !== undefined && next < min) return;
    if (max !== undefined && next > max) return;
    onChange(String(next));
  };

  return (
    <div
      className={`relative flex items-center h-[34px] border border-[#D7DEE4] rounded-[6px] bg-white overflow-hidden ${className}`}
    >
      <input
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-required={ariaRequired}
        className={`w-full h-full pl-6 pr-2.5 text-[13px] border-none outline-none bg-transparent ${
          isBold ? "font-bold text-[#1E2A33]" : "text-[#1E2A33]"
        }`}
        data-field-key={dataFieldKey}
        dir="ltr"
        disabled={disabled}
        id={id}
        inputMode="numeric"
        name={name}
        placeholder={placeholder}
        style={{ textAlign: "right" }}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="absolute left-0 top-0 bottom-0 w-5 flex flex-col border-r border-[#CDCDCD] bg-[#FDFDFE]">
        <button
          className="flex-1 flex items-center justify-center hover:bg-[#E5EAEF] text-[#5C7385] cursor-pointer"
          disabled={disabled}
          tabIndex={-1}
          type="button"
          onClick={() => handleStep(1)}
        >
          <ChevronUp size={10} strokeWidth={2.5} />
        </button>
        <button
          className="flex-1 flex items-center justify-center hover:bg-[#E5EAEF] text-[#5C7385] border-t border-[#CDCDCD] cursor-pointer"
          disabled={disabled}
          tabIndex={-1}
          type="button"
          onClick={() => handleStep(-1)}
        >
          <ChevronDown size={10} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

const EMPTY_CATEGORY_OPTIONS: readonly string[] = [];
const LEGACY_MANUAL_STATE_COLOURS: Record<
  ProductStateColour,
  ProductManualStateColour
> = {
  blue: "#0000ff",
  green: "#008000",
  grey: "#808080",
  orange: "#ffa500",
  purple: "#a855f7",
  red: "#ff0000",
  yellow: "#ffff00",
};

function normalizeManualStateColour(
  value: ProductManualStateColour | ProductStateColour | "" | null | undefined,
): ProductManualStateColour | "" {
  if (value === "" || value === null || value === undefined) return "";
  if (
    Object.prototype.hasOwnProperty.call(LEGACY_MANUAL_STATE_COLOURS, value)
  ) {
    return LEGACY_MANUAL_STATE_COLOURS[value as ProductStateColour];
  }
  const normalized = value.toLowerCase();
  return /^#[\da-f]{6}$/u.test(normalized)
    ? (normalized as ProductManualStateColour)
    : "";
}

export function ProductForm({
  baseUrl,
  categoryOptions = EMPTY_CATEGORY_OPTIONS,
  initialBarcode,
  initialProduct,
  onCancel,
  onProductChanged,
  onReload,
  onSuccess,
}: ProductFormProps): React.JSX.Element {
  const { locale } = usePreferences();
  const { state: identityState } = useIdentityState();
  const copy = catalogMessages[locale];
  const formId = useId();
  const categoryListId = useId();
  const mergeInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);

  const isEditing = Boolean(initialProduct);
  const draftKey = initialProduct ? `product:${initialProduct.id}` : "new";
  const restoredDraft = getProductFormDraft(draftKey);
  const draftCleared = useRef(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(
    restoredDraft?.dirty ?? false,
  );
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showBarcodeDialog, setShowBarcodeDialog] = useState(false);
  const [survivorProductId, setSurvivorProductId] = useState("");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [printLabel, setPrintLabel] = useState<Awaited<
    ReturnType<typeof requestBarcodePrint>
  > | null>(null);
  const [createStep, setCreateStep] = useState<1 | 2>(
    () => restoredDraft?.step ?? 1,
  );

  const [mode, setMode] = useState<ProductDefinitionMode>(
    restoredDraft?.mode ?? initialProduct?.definition.mode ?? "medication",
  );

  const [medicationFields, setMedicationFields] = useState({
    dosageForm:
      restoredDraft?.medicationFields.dosageForm ??
      (initialProduct?.definition.mode === "medication"
        ? (initialProduct.definition.fields.dosageForm ?? "")
        : ""),
    manufacturer:
      restoredDraft?.medicationFields.manufacturer ??
      (initialProduct?.definition.mode === "medication"
        ? (initialProduct.definition.fields.manufacturer ?? "")
        : ""),
    strength:
      restoredDraft?.medicationFields.strength ??
      (initialProduct?.definition.mode === "medication"
        ? (initialProduct.definition.fields.strength ?? "")
        : ""),
    tradeName:
      restoredDraft?.medicationFields.tradeName ??
      (initialProduct?.definition.mode === "medication"
        ? initialProduct.definition.fields.tradeName
        : ""),
  });

  const [generalItemFields, setGeneralItemFields] = useState({
    company:
      restoredDraft?.generalItemFields.company ??
      (initialProduct?.definition.mode === "general-item"
        ? initialProduct.definition.fields.company
        : ""),
    property:
      restoredDraft?.generalItemFields.property ??
      (initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.property ?? "")
        : ""),
    size:
      restoredDraft?.generalItemFields.size ??
      (initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.size ?? "")
        : ""),
    subBrand:
      restoredDraft?.generalItemFields.subBrand ??
      (initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.subBrand ?? "")
        : ""),
    targetAudience:
      restoredDraft?.generalItemFields.targetAudience ??
      (initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.targetAudience ?? "")
        : ""),
    typeOfUse:
      restoredDraft?.generalItemFields.typeOfUse ??
      (initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.typeOfUse ?? "")
        : ""),
  });

  const [arabicSearchName, setArabicSearchName] = useState(
    restoredDraft?.arabicSearchName ?? initialProduct?.arabicSearchName ?? "",
  );
  const [scientificName, setScientificName] = useState(
    restoredDraft?.scientificName ?? initialProduct?.scientificName ?? "",
  );
  const [category, setCategory] = useState(
    restoredDraft?.category ?? initialProduct?.category ?? "",
  );
  const [addedCategoryOptions, setAddedCategoryOptions] = useState<string[]>(
    [],
  );
  const [categoryActionStatus, setCategoryActionStatus] = useState("");
  const categorySuggestions = useMemo(() => {
    const categories = new Map<string, string>();
    for (const option of [...categoryOptions, ...addedCategoryOptions]) {
      const value = option.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase(locale);
      if (!categories.has(key)) categories.set(key, value);
    }
    return [...categories.values()].sort((left, right) =>
      left.localeCompare(right, locale),
    );
  }, [addedCategoryOptions, categoryOptions, locale]);
  const categoryKey = category.trim().toLocaleLowerCase(locale);
  const canAddCategory =
    categoryKey !== "" &&
    !categorySuggestions.some(
      (suggestion) => suggestion.toLocaleLowerCase(locale) === categoryKey,
    );
  const [supplierIds, setSupplierIds] = useState<string[]>(() => [
    ...(restoredDraft?.supplierIds ?? initialProduct?.supplierIds ?? []),
  ]);

  const [barcodes, setBarcodes] = useState<ProductBarcodeInput[]>(
    restoredDraft?.barcodes
      ? [...restoredDraft.barcodes]
      : (initialProduct?.barcodes.map(({ kind, value }) => ({ kind, value })) ??
          (initialBarcode === undefined
            ? []
            : [{ kind: "product", value: initialBarcode }])),
  );
  const [newBarcode, setNewBarcode] = useState(restoredDraft?.newBarcode ?? "");
  const [newBarcodeKind, setNewBarcodeKind] = useState<ProductBarcodeKind>(
    restoredDraft?.newBarcodeKind ?? "product",
  );

  const [instructions, setInstructions] = useState({
    foodTiming: (restoredDraft?.instructions.foodTiming ??
      initialProduct?.instructions.foodTiming ??
      "") as ProductFoodTiming | "",
    usesPerDay:
      restoredDraft?.instructions.usesPerDay ??
      (initialProduct?.instructions.usesPerDay !== null &&
      initialProduct?.instructions.usesPerDay !== undefined
        ? String(initialProduct.instructions.usesPerDay)
        : ""),
    usesPerMonth:
      restoredDraft?.instructions.usesPerMonth ??
      (initialProduct?.instructions.usesPerMonth !== null &&
      initialProduct?.instructions.usesPerMonth !== undefined
        ? String(initialProduct.instructions.usesPerMonth)
        : ""),
    usesPerWeek:
      restoredDraft?.instructions.usesPerWeek ??
      (initialProduct?.instructions.usesPerWeek !== null &&
      initialProduct?.instructions.usesPerWeek !== undefined
        ? String(initialProduct.instructions.usesPerWeek)
        : ""),
  });

  const [sharing, setSharing] = useState({
    aiSharingAllowed:
      restoredDraft?.sharing.aiSharingAllowed ??
      initialProduct?.sharing.aiSharingAllowed ??
      false,
    externallyVisible:
      restoredDraft?.sharing.externallyVisible ??
      initialProduct?.sharing.externallyVisible ??
      false,
  });

  const [stateColours, setStateColours] = useState<{
    coldStorageRequired: boolean;
    manual: ProductManualStateColour | "";
  }>({
    coldStorageRequired:
      restoredDraft?.stateColours.coldStorageRequired ??
      initialProduct?.stateColours.coldStorageRequired ??
      false,
    manual: normalizeManualStateColour(
      restoredDraft?.stateColours.manual ??
        initialProduct?.stateColours.manual ??
        "",
    ),
  });
  const [stockLevels, setStockLevels] = useState({
    maximumLevel:
      restoredDraft?.stockLevels.maximumLevel ??
      initialProduct?.stockLevels.maximumLevel ??
      "",
    minimumLevel:
      restoredDraft?.stockLevels.minimumLevel ??
      initialProduct?.stockLevels.minimumLevel ??
      "",
    reorderPoint:
      restoredDraft?.stockLevels.reorderPoint ??
      initialProduct?.stockLevels.reorderPoint ??
      "",
  });

  // Packaging State
  const [inventoryUnitName, setInventoryUnitName] = useState(
    restoredDraft?.inventoryUnitName ??
      initialProduct?.packaging.inventoryUnitName ??
      "",
  );

  interface PackageUnitItem {
    readonly id: string;
    baseUnitsPerPackage: string;
    name: string;
  }

  const [packageUnits, setPackageUnits] = useState<PackageUnitItem[]>(
    () =>
      restoredDraft?.packageUnits.map((unit) => ({ ...unit })) ??
      initialProduct?.packaging.packageUnits.map((u) => ({
        baseUnitsPerPackage: u.baseUnitsPerPackage,
        id: crypto.randomUUID(),
        name: u.name,
      })) ??
      [],
  );

  const [packagingEnabled, setPackagingEnabled] = useState(
    packageUnits.length > 0,
  );

  const [hasThirdUnit, setHasThirdUnit] = useState(
    restoredDraft?.hasThirdUnit ?? Boolean(initialProduct?.packaging.thirdUnit),
  );
  const [thirdUnitName, setThirdUnitName] = useState(
    restoredDraft?.thirdUnitName ??
      initialProduct?.packaging.thirdUnit?.name ??
      "",
  );

  const [defaultUnits, setDefaultUnits] = useState<{
    count: InventoryCapableUnit;
    purchase: InventoryCapableUnit;
    sale: InventoryCapableUnit;
  }>(() => ({
    count: restoredDraft?.defaultUnits.count ??
      initialProduct?.packaging.defaultUnits.count ?? {
        kind: "inventory-unit",
      },
    purchase: restoredDraft?.defaultUnits.purchase ??
      initialProduct?.packaging.defaultUnits.purchase ?? {
        kind: "inventory-unit",
      },
    sale: restoredDraft?.defaultUnits.sale ??
      initialProduct?.packaging.defaultUnits.sale ?? {
        kind: "inventory-unit",
      },
  }));

  // Pricing State
  const [pricingMethod, setPricingMethod] = useState<ProductPricingMethod>(
    restoredDraft?.pricingMethod ??
      initialProduct?.pricing.method ??
      DEFAULT_PRODUCT_PRICING_METHOD,
  );

  const [retailPriceFils, setRetailPriceFils] = useState(
    restoredDraft?.retailPriceFils ??
      initialProduct?.pricing.retailPriceFils ??
      "",
  );

  const [wholesalePriceFils, setWholesalePriceFils] = useState(
    restoredDraft?.wholesalePriceFils ??
      initialProduct?.pricing.wholesalePriceFils ??
      "",
  );

  const [costFils, setCostFils] = useState(restoredDraft?.costFils ?? "");

  const [marginPercentage, setMarginPercentage] = useState(
    restoredDraft?.marginPercentage ??
      (initialProduct?.pricing.method === "by-percentage"
        ? initialProduct.pricing.marginPercentage
        : ""),
  );

  const [rounding, setRounding] = useState<PriceRoundingSetting>(
    restoredDraft?.rounding ??
      (initialProduct?.pricing.method === "by-percentage"
        ? initialProduct.pricing.rounding
        : "off"),
  );

  const calculatedRetailFils = calculateRetailPricePreview(
    costFils,
    marginPercentage,
    rounding,
  );
  const displayRetailPreview =
    calculatedRetailFils !== "0"
      ? formatFilsToIqd(calculatedRetailFils, locale)
      : initialProduct?.pricing.method === "by-percentage"
        ? formatFilsToIqd(initialProduct.pricing.retailPriceFils, locale)
        : copy.pricing.retailPricePendingCalculation;

  const [pendingModeSwitch, setPendingModeSwitch] =
    useState<ProductDefinitionMode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const [pendingFocusKeys, setPendingFocusKeys] = useState<string[] | null>(
    null,
  );

  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingFocusKeys) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      for (const key of pendingFocusKeys) {
        const element =
          document.querySelector<HTMLElement>(`[name="${key}"]`) ||
          document.getElementById(`${formId}-${key}`) ||
          document.querySelector<HTMLElement>(`[data-field-key="${key}"]`);
        if (!element) {
          continue;
        }

        const panel = element.closest("details");
        if (panel && !panel.open) {
          panel.open = true;
        }
        element.focus();
        setPendingFocusKeys(null);
        return;
      }

      errorSummaryRef.current?.focus();
      setPendingFocusKeys(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [createStep, formId, isEditing, pendingFocusKeys]);

  const allowedPermissions = new Set<string>(
    identityState?.state === "authenticated"
      ? identityState.allowedPermissions
      : [],
  );
  const canManageCatalog = allowedPermissions.has("catalog.item.manage");
  const canReviewInventory = allowedPermissions.has("inventory.review");
  const canArchive = isEditing && canManageCatalog;
  const canMerge = isEditing && canManageCatalog;
  const canSuggestBarcode = isEditing && canManageCatalog;
  const canPrintBarcode = isEditing && canManageCatalog;

  const generatedDisplayName = composeProductDisplayName(
    mode,
    mode === "medication" ? medicationFields : generalItemFields,
  );

  useEffect(() => {
    if (draftCleared.current) {
      return;
    }
    const previousDraft = getProductFormDraft(draftKey);
    const snapshot: ProductFormDraft = {
      dirty: hasUnsavedChanges || (previousDraft?.dirty ?? false),
      step: createStep,
      mode,
      medicationFields,
      generalItemFields,
      arabicSearchName,
      scientificName,
      category,
      supplierIds,
      barcodes,
      newBarcode,
      newBarcodeKind,
      instructions,
      sharing,
      stateColours,
      stockLevels,
      inventoryUnitName,
      packageUnits,
      hasThirdUnit,
      thirdUnitName,
      defaultUnits,
      pricingMethod,
      retailPriceFils,
      wholesalePriceFils,
      costFils,
      marginPercentage,
      rounding,
    };
    saveProductFormDraft(draftKey, snapshot);
  });

  const markDraftDirty = (): void => {
    draftCleared.current = false;
    setHasUnsavedChanges(true);
    const savedDraft = getProductFormDraft(draftKey);
    if (savedDraft) {
      saveProductFormDraft(draftKey, { ...savedDraft, dirty: true });
    }
  };

  const focusStepHeading = (step: 1 | 2): void => {
    requestAnimationFrame(() =>
      document.getElementById(`${formId}-step-${step}`)?.focus(),
    );
  };

  const handleContinue = (): void => {
    const identityErrors: Record<string, string> = {};
    if (
      mode === "medication" &&
      medicationFields.tradeName.trim().length === 0
    ) {
      identityErrors.tradeName = copy.fieldErrors.required;
    }
    if (
      mode === "general-item" &&
      generalItemFields.company.trim().length === 0
    ) {
      identityErrors.company = copy.fieldErrors.required;
    }
    setFieldErrors(identityErrors);
    if (Object.keys(identityErrors).length > 0) {
      focusFirstErrorField(identityErrors);
      return;
    }
    setGeneralError(null);
    setCreateStep(2);
    focusStepHeading(2);
  };

  const discardDraft = (): void => {
    draftCleared.current = true;
    clearProductFormDraft(draftKey);
    setHasUnsavedChanges(false);
    setShowDiscardConfirmation(false);
    onCancel?.();
  };

  const clearDraftAfterServerChange = (updated: Product): void => {
    draftCleared.current = true;
    clearProductFormDraft(draftKey);
    setHasUnsavedChanges(false);
    onProductChanged?.(updated);
  };

  const handleCancel = (): void => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirmation(true);
      return;
    }
    discardDraft();
  };

  const handleReload = async (): Promise<void> => {
    if (!onReload) {
      return;
    }
    setGeneralError(null);
    try {
      await onReload();
      draftCleared.current = true;
      clearProductFormDraft(draftKey);
      setHasUnsavedChanges(false);
      setVersionConflict(false);
    } catch (failure) {
      setGeneralError(
        failure instanceof Error ? failure.message : String(failure),
      );
      errorSummaryRef.current?.focus();
    }
  };

  const handleModeChange = (newMode: ProductDefinitionMode): void => {
    if (newMode === mode) {
      return;
    }
    const abandoned = getAbandonedDirtyFields(
      mode,
      medicationFields,
      generalItemFields,
      copy,
    );
    if (abandoned.length > 0) {
      setPendingModeSwitch(newMode);
    } else {
      markDraftDirty();
      setMode(newMode);
    }
  };

  const confirmModeSwitch = (): void => {
    if (pendingModeSwitch === null) {
      return;
    }
    if (mode === "medication") {
      setMedicationFields({
        dosageForm: "",
        manufacturer: "",
        strength: "",
        tradeName: "",
      });
    } else {
      setGeneralItemFields({
        company: "",
        property: "",
        size: "",
        subBrand: "",
        targetAudience: "",
        typeOfUse: "",
      });
    }
    markDraftDirty();
    setMode(pendingModeSwitch);
    setPendingModeSwitch(null);
    setFieldErrors({});
  };

  const cancelModeSwitch = (): void => {
    setPendingModeSwitch(null);
  };

  const handleAddBarcode = (): void => {
    const trimmed = newBarcode.trim();
    if (
      trimmed.length > 0 &&
      !barcodes.some((barcode) => barcode.value === trimmed)
    ) {
      markDraftDirty();
      setBarcodes([...barcodes, { kind: newBarcodeKind, value: trimmed }]);
      setNewBarcode("");
    }
  };

  const handleRemoveBarcode = (index: number): void => {
    markDraftDirty();
    setBarcodes(barcodes.filter((_, i) => i !== index));
  };

  const handleSuggestBarcode = async (): Promise<void> => {
    if (!initialProduct || !canSuggestBarcode || hasUnsavedChanges) {
      return;
    }
    setBusy(true);
    setGeneralError(null);
    try {
      const result = await suggestProductBarcode(baseUrl, initialProduct.id, {
        expectedRevision: initialProduct.revision,
        idempotencyKey: newIdempotencyKey(),
        kind: "product",
      });
      setBarcodes(
        result.product.barcodes.map(({ kind, value }) => ({ kind, value })),
      );
      clearDraftAfterServerChange(result.product);
    } catch (failure) {
      setGeneralError(
        failure instanceof CatalogApiDenied
          ? (copy.denials[failure.denial.code] ?? failure.message)
          : failure instanceof Error
            ? failure.message
            : String(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePrintBarcode = async (value: string): Promise<void> => {
    if (!initialProduct || !canPrintBarcode) {
      return;
    }
    setBusy(true);
    setGeneralError(null);
    try {
      const handoff = await requestBarcodePrint(baseUrl, initialProduct.id, {
        barcode: value,
        idempotencyKey: newIdempotencyKey(),
        locale,
        quantity: 1,
      });
      setPrintLabel(handoff);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const result = await window.breevDesktop.printBarcodeLabel(handoff);
      if (result.status === "failed") {
        throw new Error(result.message);
      }
    } catch (failure) {
      setGeneralError(
        failure instanceof CatalogApiDenied
          ? (copy.denials[failure.denial.code] ?? failure.message)
          : failure instanceof Error
            ? failure.message
            : String(failure),
      );
      errorSummaryRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveConfirm = async (): Promise<void> => {
    if (!initialProduct || !canArchive || hasUnsavedChanges) {
      return;
    }
    setBusy(true);
    setGeneralError(null);
    try {
      const updated = await archiveProduct(baseUrl, initialProduct.id, {
        expectedRevision: initialProduct.revision,
        idempotencyKey: newIdempotencyKey(),
      });
      setShowArchiveDialog(false);
      clearDraftAfterServerChange(updated);
    } catch (failure) {
      setGeneralError(
        failure instanceof CatalogApiDenied
          ? (copy.denials[failure.denial.code] ?? failure.message)
          : failure instanceof Error
            ? failure.message
            : String(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleMergeConfirm = async (): Promise<void> => {
    if (!initialProduct || !canMerge || hasUnsavedChanges) {
      return;
    }
    const trimmedSurvivor = survivorProductId.trim();
    if (trimmedSurvivor.length === 0) {
      setMergeError(copy.fieldErrors.required);
      document.getElementById(mergeInputId)?.focus();
      return;
    }
    setBusy(true);
    setMergeError(null);
    setGeneralError(null);
    try {
      const updated = await mergeProduct(baseUrl, initialProduct.id, {
        expectedRevision: initialProduct.revision,
        idempotencyKey: newIdempotencyKey(),
        survivorProductId: trimmedSurvivor,
      });
      setShowMergeDialog(false);
      clearDraftAfterServerChange(updated);
    } catch (failure) {
      setMergeError(
        failure instanceof CatalogApiDenied
          ? (copy.denials[failure.denial.code] ?? failure.message)
          : failure instanceof Error
            ? failure.message
            : String(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAddPackageUnit = (): void => {
    markDraftDirty();
    setPackageUnits((prev) => [
      ...prev,
      { baseUnitsPerPackage: "", id: crypto.randomUUID(), name: "" },
    ]);
  };

  const handleRemovePackageUnit = (index: number): void => {
    markDraftDirty();
    const removedUnit = packageUnits[index];
    setPackageUnits((prev) => prev.filter((_, i) => i !== index));

    if (removedUnit) {
      setDefaultUnits((prev) =>
        cleanDefaultUnitsOnPackageRemoval(prev, removedUnit.name.trim()),
      );
    }
  };

  const handleUpdatePackageUnit = (
    index: number,
    field: "name" | "baseUnitsPerPackage",
    value: string,
  ): void => {
    setPackageUnits((prev) => {
      const oldName = prev[index]?.name;
      const updated = prev.map((unit, i) => {
        if (i !== index) return unit;
        return { ...unit, [field]: value };
      });
      if (field === "name" && oldName && oldName !== value) {
        setDefaultUnits((du) => {
          const updateName = (u: InventoryCapableUnit): InventoryCapableUnit =>
            u.kind === "package-unit" && u.packageUnitName === oldName
              ? { kind: "package-unit", packageUnitName: value.trim() }
              : u;
          return {
            count: updateName(du.count),
            purchase: updateName(du.purchase),
            sale: updateName(du.sale),
          };
        });
      }
      return updated;
    });
  };

  const handleSecondaryUnitChange = (name: string, count: string): void => {
    markDraftDirty();
    setPackageUnits((prev) => {
      if (prev.length === 0) {
        return [{ baseUnitsPerPackage: count, id: crypto.randomUUID(), name }];
      }
      return prev.map((u, i) =>
        i === 0 ? { ...u, baseUnitsPerPackage: count, name } : u,
      );
    });
  };

  const mapFieldErrors = useCallback(
    (serverErrors: readonly CatalogFieldError[]): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const err of serverErrors) {
        const key = serverPathToFormKey(err.path);
        result[key] = copy.fieldErrors[err.code] ?? err.code;
      }
      return result;
    },
    [copy.fieldErrors],
  );

  const focusFirstErrorField = (errors: Record<string, string>): void => {
    const keys = Object.keys(errors);
    if (keys.length === 0) {
      return;
    }

    const identityFields = new Set([
      "tradeName",
      "strength",
      "dosageForm",
      "manufacturer",
      "company",
      "subBrand",
      "typeOfUse",
      "property",
      "targetAudience",
      "size",
      "arabicSearchName",
      "scientificName",
      "category",
    ]);
    if (
      !isEditing &&
      createStep === 2 &&
      keys.some((key) => identityFields.has(key))
    ) {
      setCreateStep(1);
    }
    setPendingFocusKeys(keys);
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!isEditing && createStep === 1) {
      handleContinue();
      return;
    }
    setGeneralError(null);
    setFieldErrors({});
    setVersionConflict(false);

    const localErrors: Record<string, string> = {};
    if (mode === "medication") {
      if (medicationFields.tradeName.trim().length === 0) {
        localErrors.tradeName = copy.fieldErrors.required;
      }
    } else if (generalItemFields.company.trim().length === 0) {
      localErrors.company = copy.fieldErrors.required;
    }

    if (inventoryUnitName.trim().length === 0) {
      localErrors["packaging.inventoryUnitName"] = copy.fieldErrors.required;
    }
    if (isEditing && hasThirdUnit && thirdUnitName.trim().length === 0) {
      localErrors["packaging.thirdUnit.name"] = copy.fieldErrors.required;
    }

    if (pricingMethod === "by-price") {
      if (retailPriceFils.trim().length === 0) {
        localErrors["pricing.retailPriceFils"] = copy.fieldErrors.required;
      }
    } else {
      if (costFils.trim().length === 0) {
        localErrors["pricing.costFils"] = copy.fieldErrors.required;
      }
      if (marginPercentage.trim().length === 0) {
        localErrors["pricing.marginPercentage"] = copy.fieldErrors.required;
      }
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      focusFirstErrorField(localErrors);
      return;
    }

    const definition =
      mode === "medication"
        ? {
            fields: {
              dosageForm: medicationFields.dosageForm.trim() || null,
              manufacturer: medicationFields.manufacturer.trim() || null,
              strength: medicationFields.strength.trim() || null,
              tradeName: medicationFields.tradeName.trim(),
            } satisfies MedicationNameFields,
            mode: "medication" as const,
          }
        : {
            fields: {
              company: generalItemFields.company.trim(),
              property: generalItemFields.property.trim() || null,
              size: generalItemFields.size.trim() || null,
              subBrand: generalItemFields.subBrand.trim() || null,
              targetAudience: generalItemFields.targetAudience.trim() || null,
              typeOfUse: generalItemFields.typeOfUse.trim() || null,
            } satisfies GeneralItemNameFields,
            mode: "general-item" as const,
          };

    const parseFrequency = (val: string): number | null => {
      const trimmed = val.trim();
      if (!trimmed) {
        return null;
      }
      const num = Number.parseInt(trimmed, 10);
      return Number.isNaN(num) ? null : num;
    };

    const packagingPayload = buildPackagingPayload({
      defaultUnits: isEditing
        ? defaultUnits
        : {
            count: { kind: "inventory-unit" },
            purchase: { kind: "inventory-unit" },
            sale: { kind: "inventory-unit" },
          },
      hasThirdUnit,
      inventoryUnitName,
      packageUnits: packagingEnabled ? packageUnits : [],
      thirdUnitName,
    });

    const pricingPayload = buildPricingPayload({
      costFils,
      marginPercentage,
      method: pricingMethod,
      retailPriceFils,
      rounding,
      wholesalePriceFils,
    });

    setBusy(true);

    try {
      if (isEditing && initialProduct) {
        const request: ProductEditRequest = {
          arabicSearchName: arabicSearchName.trim() || null,
          barcodes,
          category: category.trim() || null,
          supplierIds,
          definition,
          expectedRevision: initialProduct.revision,
          idempotencyKey: newIdempotencyKey(),
          instructions: {
            foodTiming: instructions.foodTiming || null,
            usesPerDay: parseFrequency(instructions.usesPerDay),
            usesPerMonth: parseFrequency(instructions.usesPerMonth),
            usesPerWeek: parseFrequency(instructions.usesPerWeek),
          },
          packaging: packagingPayload,
          pricing: pricingPayload,
          scientificName: scientificName.trim() || null,
          sharing: {
            aiSharingAllowed: sharing.aiSharingAllowed,
            externallyVisible: sharing.externallyVisible,
          },
          stateColours: {
            coldStorageRequired: stateColours.coldStorageRequired,
            manual: stateColours.manual || null,
          },
          stockLevels: {
            maximumLevel: stockLevels.maximumLevel.trim() || null,
            minimumLevel: stockLevels.minimumLevel.trim() || null,
            reorderPoint: stockLevels.reorderPoint.trim() || null,
          },
        };
        const updated = await editProduct(baseUrl, initialProduct.id, request);
        clearDraftAfterServerChange(updated);
      } else {
        const request: ProductCreateRequest = {
          arabicSearchName: arabicSearchName.trim() || null,
          barcodes,
          category: category.trim() || null,
          supplierIds,
          definition,
          idempotencyKey: newIdempotencyKey(),
          instructions: {
            foodTiming: instructions.foodTiming || null,
            usesPerDay: parseFrequency(instructions.usesPerDay),
            usesPerMonth: parseFrequency(instructions.usesPerMonth),
            usesPerWeek: parseFrequency(instructions.usesPerWeek),
          },
          packaging: packagingPayload,
          pricing: pricingPayload,
          scientificName: scientificName.trim() || null,
          sharing: {
            aiSharingAllowed: sharing.aiSharingAllowed,
            externallyVisible: sharing.externallyVisible,
          },
          stateColours: {
            coldStorageRequired: stateColours.coldStorageRequired,
            manual: stateColours.manual || null,
          },
          stockLevels: {
            maximumLevel: stockLevels.maximumLevel.trim() || null,
            minimumLevel: stockLevels.minimumLevel.trim() || null,
            reorderPoint: stockLevels.reorderPoint.trim() || null,
          },
        };
        const created = await createProduct(baseUrl, request);
        draftCleared.current = true;
        clearProductFormDraft(draftKey);
        setHasUnsavedChanges(false);
        onSuccess?.(created);
      }
    } catch (failure) {
      if (failure instanceof CatalogApiDenied) {
        if (failure.denial.code === "version-conflict") {
          setVersionConflict(true);
        }
        if (failure.denial.fieldErrors.length > 0) {
          const mapped = mapFieldErrors(failure.denial.fieldErrors);
          setFieldErrors(mapped);
          focusFirstErrorField(mapped);
        }
        setGeneralError(copy.denials[failure.denial.code] ?? failure.message);
      } else if (failure instanceof Error) {
        setGeneralError(failure.message);
      } else {
        setGeneralError(String(failure));
      }
      errorSummaryRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="product-screen-root flex flex-col h-full bg-white select-none overflow-hidden"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      {/* Dialogs */}
      {pendingModeSwitch ? (
        <ModeSwitchConfirmationDialog
          abandonedFields={getAbandonedDirtyFields(
            mode,
            medicationFields,
            generalItemFields,
            copy,
          )}
          copy={copy}
          onCancel={cancelModeSwitch}
          onConfirm={confirmModeSwitch}
        />
      ) : null}

      {showDiscardConfirmation ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setShowDiscardConfirmation(false);
            }
          }}
        >
          <section
            aria-describedby={`${formId}-discard-description`}
            aria-labelledby={`${formId}-discard-title`}
            aria-modal="true"
            className="identity-card step-up-dialog"
            role="alertdialog"
          >
            <h3 id={`${formId}-discard-title`}>{copy.flow.discardTitle}</h3>
            <p id={`${formId}-discard-description`}>
              {copy.flow.discardDescription}
            </p>
            <div className="form-actions mt-4 flex justify-end gap-2">
              <button
                autoFocus
                className="quiet-button"
                type="button"
                onClick={() => setShowDiscardConfirmation(false)}
              >
                {copy.flow.keepAction}
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={discardDraft}
              >
                {copy.flow.discardAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showArchiveDialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setShowArchiveDialog(false);
            }
          }}
        >
          <section
            aria-describedby={`${formId}-archive-warning`}
            aria-labelledby={`${formId}-archive-title`}
            aria-modal="true"
            className="identity-card step-up-dialog"
            role="dialog"
          >
            <h3 id={`${formId}-archive-title`}>
              {copy.actions.archiveConfirmTitle}
            </h3>
            <p className="my-3 text-sm" id={`${formId}-archive-warning`}>
              {copy.actions.archiveConfirmWarning}
            </p>
            <div className="form-actions mt-4 flex justify-end gap-2">
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => setShowArchiveDialog(false)}
              >
                {copy.actions.cancel}
              </button>
              <button
                className="primary-button"
                disabled={busy}
                type="button"
                onClick={() => void handleArchiveConfirm()}
              >
                {busy ? "..." : copy.actions.archiveConfirmSubmit}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showMergeDialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setShowMergeDialog(false);
            }
          }}
        >
          <section
            aria-describedby={`${formId}-merge-description`}
            aria-labelledby={`${formId}-merge-title`}
            aria-modal="true"
            className="identity-card step-up-dialog"
            role="dialog"
          >
            <h3 id={`${formId}-merge-title`}>{copy.actions.mergeTitle}</h3>
            <p
              className="my-2 text-sm text-muted-foreground"
              id={`${formId}-merge-description`}
            >
              {copy.actions.mergeDescription}
            </p>
            {mergeError ? (
              <p className="field-error mb-3" role="alert">
                {mergeError}
              </p>
            ) : null}
            <div className="field-label my-3">
              <label htmlFor={mergeInputId}>
                <span>{copy.fields.survivorProductId}</span>
              </label>
              <input
                id={mergeInputId}
                aria-invalid={Boolean(mergeError)}
                aria-required="true"
                className="font-mono text-sm"
                maxLength={64}
                name="survivorProductId"
                placeholder={copy.fields.survivorProductPlaceholder}
                type="text"
                value={survivorProductId}
                onChange={(event) => setSurvivorProductId(event.target.value)}
              />
            </div>
            <div className="form-actions mt-4 flex justify-end gap-2">
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => {
                  setShowMergeDialog(false);
                  setMergeError(null);
                }}
              >
                {copy.actions.cancel}
              </button>
              <button
                className="primary-button"
                disabled={busy}
                type="button"
                onClick={() => void handleMergeConfirm()}
              >
                {busy ? "..." : copy.actions.mergeConfirmSubmit}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Barcode Manager Dialog */}
      {showBarcodeDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowBarcodeDialog(false);
          }}
        >
          <section
            aria-modal="true"
            className="identity-card step-up-dialog max-w-md w-full p-4"
            role="dialog"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#D7DEE4]">
              <h3 className="font-bold text-sm text-[#1E2A33]">
                {locale === "ar" ? "إدارة أرقام الباركود" : copy.barcodes.label}
              </h3>
              <button
                className="text-[#5C7385] hover:text-[#1E2A33]"
                type="button"
                onClick={() => setShowBarcodeDialog(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="my-3 space-y-2">
              {barcodes.length === 0 ? (
                <p className="text-xs text-[#5C7385]">
                  {locale === "ar"
                    ? "لا توجد باركودات مسجلة"
                    : "No barcodes registered"}
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {barcodes.map((b, idx) => (
                    <li
                      key={`${b.kind}:${b.value}`}
                      className="flex items-center justify-between p-2 rounded-[6px] bg-[#F6F7F9] border border-[#D7DEE4] text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#1E2A33]">
                          {b.value}
                        </span>
                        <span className="text-[10px] text-[#5C7385] px-1.5 py-0.5 rounded bg-white border border-[#D7DEE4]">
                          {b.kind === "product"
                            ? locale === "ar"
                              ? "منتج"
                              : "Product"
                            : locale === "ar"
                              ? "عبوة"
                              : "Package"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {canPrintBarcode && (
                          <button
                            className="px-2 py-0.5 text-[11px] rounded border border-[#D7DEE4] bg-white hover:bg-[#EDF0F2]"
                            type="button"
                            onClick={() => void handlePrintBarcode(b.value)}
                          >
                            {locale === "ar" ? "طباعة" : "Print"}
                          </button>
                        )}
                        <button
                          className="text-[#DF202E] font-bold px-1 hover:bg-[#FCE8EA] rounded"
                          type="button"
                          onClick={() => handleRemoveBarcode(idx)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-2 border-t border-[#D7DEE4] flex justify-end">
              <button
                className="h-8 px-4 rounded-[6px] bg-[#4A6B82] text-white text-xs font-medium"
                type="button"
                onClick={() => setShowBarcodeDialog(false)}
              >
                {locale === "ar" ? "إغلاق" : "Done"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Screen Form Container */}
      <form
        id={formId}
        ref={formRef}
        aria-label={
          isEditing ? copy.titles.editProduct : copy.titles.createProduct
        }
        className="catalog-product-form flex-1 flex flex-col justify-between overflow-y-auto p-3.5 gap-3"
        data-create-step={!isEditing ? createStep : undefined}
        noValidate
        onSubmit={handleSubmit}
      >
        {/* Hidden Accessibility & Test Helpers */}
        <div className="sr-only">
          <h2
            data-testid={
              isEditing ? "product-display-name" : "product-form-title"
            }
          >
            {isEditing && initialProduct
              ? initialProduct.displayName
              : copy.titles.createProduct}
          </h2>
          <output
            aria-live="polite"
            data-testid="generated-display-name"
            name="generatedDisplayName"
          >
            {generatedDisplayName}
          </output>
          <span id={`${formId}-step-1`} tabIndex={-1}>
            {copy.flow.stepIdentity}
          </span>
          <span id={`${formId}-step-2`} tabIndex={-1}>
            {copy.flow.stepSetup}
          </span>
          {(isEditing || createStep === 2) && (
            <>
              <label htmlFor={`${formId}-sr-pricing-method`}>
                {copy.pricing.methodLabel}
              </label>
              <select
                id={`${formId}-sr-pricing-method`}
                aria-label={copy.pricing.methodLabel}
                value={pricingMethod}
                onChange={(e) => {
                  markDraftDirty();
                  setPricingMethod(e.target.value as ProductPricingMethod);
                }}
              >
                {PRODUCT_PRICING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {copy.pricing.methods[m]}
                  </option>
                ))}
              </select>
              <label htmlFor={`${formId}-sr-pricing-rounding`}>
                {copy.pricing.rounding}
              </label>
              <select
                id={`${formId}-sr-pricing-rounding`}
                aria-label={copy.pricing.rounding}
                value={rounding}
                onChange={(e) => {
                  markDraftDirty();
                  setRounding(e.target.value as PriceRoundingSetting);
                }}
              >
                {PRICE_ROUNDING_SETTINGS.map((r) => (
                  <option key={r} value={r}>
                    {copy.pricing.roundings[r]}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor={`${formId}-definition-mode`}>
            {copy.definition.modeLabel}
          </label>
          <select
            id={`${formId}-definition-mode`}
            aria-label={copy.definition.modeLabel}
            value={mode}
            onChange={(e) =>
              handleModeChange(e.target.value as ProductDefinitionMode)
            }
          >
            {PRODUCT_DEFINITION_MODES.map((m) => (
              <option key={m} value={m}>
                {copy.definition.modes[m]}
              </option>
            ))}
          </select>
          {printLabel !== null ? (
            <section className="barcode-print-label" aria-hidden="true">
              <strong>{printLabel.displayName}</strong>
              <code>{printLabel.barcode.value}</code>
            </section>
          ) : null}
        </div>

        {/* Global Errors and Conflict Alerts */}
        {generalError ? (
          <div
            ref={errorSummaryRef}
            className="p-2.5 rounded-[6px] bg-[#FCE8EA] border border-[#DF202E] text-xs text-[#DF202E] font-medium flex items-center justify-between"
            role="alert"
            tabIndex={-1}
          >
            <span>{generalError}</span>
            {versionConflict && onReload ? (
              <button
                className="px-2 py-1 rounded border border-[#DF202E] bg-white text-[#DF202E] hover:bg-[#fad3d6]"
                type="button"
                onClick={() => void handleReload()}
              >
                {copy.flow.reloadLatest}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {(isEditing || createStep === 1) && (
            <>
              {/* ======================================================== */}
              {/* ROW 1: Action Toolbar (Far Left) + Barcode + Scientific + Trade */}
              {/* ======================================================== */}
              <div className="flex items-end gap-3">
                {/* 4 Tool Buttons (Far Left in RTL) */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    aria-label={
                      locale === "ar"
                        ? "\u0645\u0633\u062d \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f"
                        : "Scan barcode"
                    }
                    className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors"
                    title={locale === "ar" ? "مسح باركود" : "Scan barcode"}
                    type="button"
                    onClick={() => barcodeInputRef.current?.focus()}
                  >
                    <ScanBarcode className="size-4" />
                  </button>
                  <button
                    aria-label={
                      locale === "ar"
                        ? "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f\u0627\u062a"
                        : "Manage barcodes"
                    }
                    className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors"
                    title={
                      locale === "ar" ? "إدارة الباركودات" : "Manage barcodes"
                    }
                    type="button"
                    onClick={() => setShowBarcodeDialog(true)}
                  >
                    <Barcode className="size-4" />
                  </button>
                  <button
                    aria-label={
                      locale === "ar"
                        ? "\u0637\u0628\u0627\u0639\u0629 \u0628\u0627\u0631\u0643\u0648\u062f"
                        : "Print barcode"
                    }
                    className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors disabled:opacity-40"
                    disabled={!isEditing || barcodes.length === 0}
                    title={locale === "ar" ? "طباعة باركود" : "Print barcode"}
                    type="button"
                    onClick={() => {
                      if (barcodes[0])
                        void handlePrintBarcode(barcodes[0].value);
                    }}
                  >
                    <Printer className="size-4" />
                  </button>
                  <button
                    aria-label={
                      locale === "ar"
                        ? "\u0627\u0642\u062a\u0631\u0627\u062d \u0628\u0627\u0631\u0643\u0648\u062f \u062f\u0627\u062e\u0644\u064a"
                        : "Suggest barcode"
                    }
                    className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors disabled:opacity-40"
                    disabled={!canSuggestBarcode || busy || hasUnsavedChanges}
                    title={
                      locale === "ar"
                        ? "توليد باركود تلقائي"
                        : "Suggest barcode"
                    }
                    type="button"
                    onClick={() => void handleSuggestBarcode()}
                  >
                    <Wand2 className="size-4" />
                  </button>
                </div>

                {/* Barcode Input + Kind Selector */}
                <div className="w-[220px]">
                  <div className="flex items-center justify-between mb-1">
                    <label
                      className="text-[11px] font-medium text-[#5C7385]"
                      htmlFor={`${formId}-new-barcode`}
                    >
                      {locale === "ar"
                        ? "الرمز / الباركود"
                        : copy.barcodes.label}
                    </label>
                    <select
                      aria-label={
                        locale === "ar" ? "نوع الباركود" : "Barcode kind"
                      }
                      className="text-[10px] bg-transparent border-none text-[#5C7385] cursor-pointer outline-none"
                      value={newBarcodeKind}
                      onChange={(e) => {
                        markDraftDirty();
                        setNewBarcodeKind(e.target.value as ProductBarcodeKind);
                      }}
                    >
                      <option value="product">
                        {locale === "ar" ? "منتج" : "Product"}
                      </option>
                      <option value="package">
                        {locale === "ar" ? "عبوة" : "Package"}
                      </option>
                    </select>
                  </div>
                  <input
                    id={`${formId}-new-barcode`}
                    ref={barcodeInputRef}
                    aria-label={copy.barcodes.label}
                    className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right font-mono outline-none focus:border-[#4A6B82] transition-colors"
                    placeholder={copy.barcodes.placeholder}
                    type="text"
                    value={newBarcode}
                    onChange={(e) => {
                      markDraftDirty();
                      setNewBarcode(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddBarcode();
                      }
                    }}
                  />
                  {barcodes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {barcodes.map((b, idx) => (
                        <span
                          key={`${b.kind}:${b.value}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#F6F7F9] border border-[#D7DEE4] text-[10px] font-mono text-[#1E2A33]"
                        >
                          <span>{b.value}</span>
                          <button
                            className="text-[#DF202E] hover:font-bold"
                            type="button"
                            onClick={() => handleRemoveBarcode(idx)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scientific Name */}
                <div className="flex-1">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-scientificName`}
                  >
                    {copy.fields.scientificName}{" "}
                    <span className="text-[#DF202E]">*</span>
                  </label>
                  <input
                    id={`${formId}-scientificName`}
                    aria-label={copy.fields.scientificName}
                    className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                    name="scientificName"
                    type="text"
                    value={scientificName}
                    onChange={(e) => {
                      markDraftDirty();
                      setScientificName(e.target.value);
                    }}
                  />
                </div>

                {/* Trade Name */}
                <div className="flex-1">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-tradeName`}
                  >
                    {mode === "medication"
                      ? copy.definition.medication.tradeName
                      : copy.definition.generalItem.company}{" "}
                    <span className="text-[#DF202E]">*</span>
                  </label>
                  {mode === "medication" ? (
                    <input
                      id={`${formId}-tradeName`}
                      aria-invalid={Boolean(fieldErrors.tradeName)}
                      aria-label={copy.definition.medication.tradeName}
                      aria-required="true"
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="tradeName"
                      type="text"
                      value={medicationFields.tradeName}
                      onChange={(e) => {
                        markDraftDirty();
                        setMedicationFields((prev) => ({
                          ...prev,
                          tradeName: e.target.value,
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id={`${formId}-company`}
                      aria-invalid={Boolean(fieldErrors.company)}
                      aria-label={copy.definition.generalItem.company}
                      aria-required="true"
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="company"
                      type="text"
                      value={generalItemFields.company}
                      onChange={(e) => {
                        markDraftDirty();
                        setGeneralItemFields((prev) => ({
                          ...prev,
                          company: e.target.value,
                        }));
                      }}
                    />
                  )}
                </div>
              </div>

              {/* ======================================================== */}
              {/* ROW 2: Compound Color Picker + Classification Fields    */}
              {/* ======================================================== */}
              <div className="flex items-end gap-3">
                {/* Far Left: Compound Highlight Color Control */}
                <div className="flex flex-col gap-1">
                  <label
                    className="text-[11px] font-medium text-[#5C7385] text-right"
                    htmlFor={`${formId}-manualColor`}
                  >
                    {copy.stateColours.manualColor}
                  </label>
                  <div className="relative flex items-center gap-1">
                    <button
                      aria-label={copy.stateColours.clearColor}
                      className="h-[34px] w-[28px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:text-[#DF202E] hover:bg-[#FCE8EA] transition-colors"
                      title={copy.stateColours.clearColor}
                      type="button"
                      onClick={() => {
                        markDraftDirty();
                        setStateColours((prev) => ({ ...prev, manual: "" }));
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                    <input
                      className="h-[34px] w-[48px] cursor-pointer rounded-[6px] border border-[#D7DEE4] bg-white p-1 outline-none transition-colors focus-visible:border-[#4A6B82] focus-visible:ring-2 focus-visible:ring-[#4A6B82]"
                      id={`${formId}-manualColor`}
                      type="color"
                      value={stateColours.manual || "#ffffff"}
                      onChange={(e) => {
                        const value =
                          e.currentTarget.value.toLowerCase() as ProductManualStateColour;
                        markDraftDirty();
                        setStateColours((prev) => ({
                          ...prev,
                          manual: value,
                        }));
                      }}
                    />
                  </div>
                </div>

                {/* Arabic Search Name */}
                <div className="flex-1">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-arabicSearchName`}
                  >
                    {copy.fields.arabicSearchName}
                  </label>
                  <input
                    id={`${formId}-arabicSearchName`}
                    aria-label={copy.fields.arabicSearchName}
                    className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                    dir="rtl"
                    name="arabicSearchName"
                    type="text"
                    value={arabicSearchName}
                    onChange={(e) => {
                      markDraftDirty();
                      setArabicSearchName(e.target.value);
                    }}
                  />
                </div>

                {/* Category */}
                <div className="w-[172px] shrink-0">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-category`}
                  >
                    {copy.fields.category}
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      ref={categoryInputRef}
                      id={`${formId}-category`}
                      aria-autocomplete="list"
                      aria-controls={categoryListId}
                      aria-label={copy.fields.category}
                      className="h-[34px] min-w-0 flex-1 px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      list={categoryListId}
                      maxLength={96}
                      name="category"
                      type="text"
                      value={category}
                      onChange={(e) => {
                        markDraftDirty();
                        setCategoryActionStatus("");
                        setCategory(e.target.value);
                      }}
                    />
                    <button
                      aria-label={copy.fields.addCategory}
                      className="size-[34px] shrink-0 flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] transition-colors hover:border-[#4A6B82] hover:bg-[#F6F7F9] hover:text-[#4A6B82] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B82] disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!canAddCategory}
                      title={copy.fields.addCategory}
                      type="button"
                      onClick={() => {
                        const value = category.trim();
                        if (!value || !canAddCategory) return;
                        markDraftDirty();
                        setCategory(value);
                        setAddedCategoryOptions((current) => [
                          ...current,
                          value,
                        ]);
                        setCategoryActionStatus(copy.fields.categoryAdded);
                        requestAnimationFrame(() =>
                          categoryInputRef.current?.focus(),
                        );
                      }}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                  <datalist id={categoryListId}>
                    {categorySuggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                  <span aria-live="polite" className="visually-hidden">
                    {categoryActionStatus}
                  </span>
                </div>

                {/* Manufacturer / Sub-brand */}
                <div className="w-[150px]">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-manufacturer`}
                  >
                    {mode === "medication"
                      ? copy.definition.medication.manufacturer
                      : copy.definition.generalItem.subBrand}
                  </label>
                  {mode === "medication" ? (
                    <input
                      id={`${formId}-manufacturer`}
                      aria-label={copy.definition.medication.manufacturer}
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="manufacturer"
                      type="text"
                      value={medicationFields.manufacturer}
                      onChange={(e) => {
                        markDraftDirty();
                        setMedicationFields((prev) => ({
                          ...prev,
                          manufacturer: e.target.value,
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id={`${formId}-subBrand`}
                      aria-label={copy.definition.generalItem.subBrand}
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="subBrand"
                      type="text"
                      value={generalItemFields.subBrand}
                      onChange={(e) => {
                        markDraftDirty();
                        setGeneralItemFields((prev) => ({
                          ...prev,
                          subBrand: e.target.value,
                        }));
                      }}
                    />
                  )}
                </div>

                {/* Dosage Form / Type */}
                <div className="w-[140px]">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-dosageForm`}
                  >
                    {mode === "medication"
                      ? copy.definition.medication.dosageForm
                      : copy.definition.generalItem.typeOfUse}
                  </label>
                  {mode === "medication" ? (
                    <input
                      id={`${formId}-dosageForm`}
                      aria-label={copy.definition.medication.dosageForm}
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="dosageForm"
                      type="text"
                      value={medicationFields.dosageForm}
                      onChange={(e) => {
                        markDraftDirty();
                        setMedicationFields((prev) => ({
                          ...prev,
                          dosageForm: e.target.value,
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id={`${formId}-typeOfUse`}
                      aria-label={copy.definition.generalItem.typeOfUse}
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="typeOfUse"
                      type="text"
                      value={generalItemFields.typeOfUse}
                      onChange={(e) => {
                        markDraftDirty();
                        setGeneralItemFields((prev) => ({
                          ...prev,
                          typeOfUse: e.target.value,
                        }));
                      }}
                    />
                  )}
                </div>

                {/* Strength / Size */}
                <div className="w-[100px]">
                  <label
                    className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                    htmlFor={`${formId}-strength`}
                  >
                    {mode === "medication"
                      ? copy.definition.medication.strength
                      : copy.definition.generalItem.size}
                  </label>
                  {mode === "medication" ? (
                    <input
                      id={`${formId}-strength`}
                      aria-label={copy.definition.medication.strength}
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="strength"
                      type="text"
                      value={medicationFields.strength}
                      onChange={(e) => {
                        markDraftDirty();
                        setMedicationFields((prev) => ({
                          ...prev,
                          strength: e.target.value,
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id={`${formId}-size`}
                      aria-label={copy.definition.generalItem.size}
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                      name="size"
                      type="text"
                      value={generalItemFields.size}
                      onChange={(e) => {
                        markDraftDirty();
                        setGeneralItemFields((prev) => ({
                          ...prev,
                          size: e.target.value,
                        }));
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          )}
          {(isEditing || createStep === 2) && (
            <>
              {/* ======================================================== */}
              {/* ROW 3: Unit 1 — "الوحدة الأساسية (الصغرى)"              */}
              {/* ======================================================== */}
              <div className="border border-[#D7DEE4] rounded-[6px] bg-white overflow-hidden">
                {/* Header Bar */}
                <div className="h-[34px] px-3 bg-[#F6F7F9] border-b border-[#D7DEE4] flex items-center justify-between">
                  {/* Left side in RTL: Packaging toggle + Pricing method pill */}
                  <div className="flex items-center gap-3">
                    {/* Packaging Toggle */}
                    <div className="flex items-center gap-1.5">
                      <button
                        className={`relative inline-flex h-[20px] w-[36px] cursor-pointer rounded-full transition-colors ${
                          packagingEnabled ? "bg-[#4A6B82]" : "bg-[#D7DEE4]"
                        }`}
                        type="button"
                        onClick={() => {
                          markDraftDirty();
                          setPackagingEnabled((v) => !v);
                        }}
                      >
                        <span
                          className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white transition-transform mt-[2px] ${
                            packagingEnabled
                              ? "translate-x-[-18px]"
                              : "translate-x-[-2px]"
                          }`}
                        />
                      </button>
                      <span className="text-[12px] text-[#5C7385]">
                        {locale === "ar" ? "تفعيل التعبئة" : "Enable packaging"}
                      </span>
                    </div>

                    {/* Sell Method Segmented Pill */}
                    <div className="flex items-center gap-1.5">
                      <div className="inline-flex items-center rounded-full border border-[#D7DEE4] p-0.5 bg-white">
                        <button
                          className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
                            pricingMethod === "by-price"
                              ? "bg-[#4A6B82] text-white"
                              : "bg-transparent text-[#1E2A33]"
                          }`}
                          type="button"
                          onClick={() => {
                            markDraftDirty();
                            setPricingMethod("by-price");
                          }}
                        >
                          {locale === "ar" ? "وفق مبلغ" : "By price"}
                        </button>
                        <button
                          className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
                            pricingMethod === "by-percentage"
                              ? "bg-[#4A6B82] text-white"
                              : "bg-transparent text-[#1E2A33]"
                          }`}
                          type="button"
                          onClick={() => {
                            markDraftDirty();
                            setPricingMethod("by-percentage");
                          }}
                        >
                          {locale === "ar" ? "وفق نسبة %" : "By %"}
                        </button>
                      </div>
                      <span className="text-[12px] text-[#5C7385]">
                        {locale === "ar" ? "طريقة البيع" : "Sell method"}
                      </span>
                    </div>
                  </div>

                  {/* Right side in RTL: Title */}
                  <span className="text-[13px] font-semibold text-[#1E2A33]">
                    {locale === "ar"
                      ? "الوحدة الأساسية (الصغرى)"
                      : "Base Unit (Smallest)"}
                  </span>
                </div>

                {/* Body (4 Columns) */}
                <div className="p-3 grid grid-cols-4 gap-3">
                  {/* Col 1: Special Price */}
                  <div>
                    <label
                      className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                      htmlFor={`${formId}-pricing.wholesalePriceFils`}
                    >
                      {locale === "ar"
                        ? "سعر خاص"
                        : copy.pricing.wholesalePriceFils}
                    </label>
                    <StepperInput
                      id={`${formId}-pricing.wholesalePriceFils`}
                      name="pricing.wholesalePriceFils"
                      step={500}
                      value={wholesalePriceFils}
                      onChange={(v) => {
                        markDraftDirty();
                        setWholesalePriceFils(v);
                      }}
                    />
                  </div>

                  {/* Col 2: Retail Price (Mode 1) OR Margin % + Live Preview + Rounding (Mode 2) */}
                  {pricingMethod === "by-price" ? (
                    <div>
                      <label
                        className="block text-[11px] font-bold text-[#1E2A33] mb-1 text-right"
                        htmlFor={`${formId}-pricing.retailPriceFils`}
                      >
                        {copy.pricing.retailPriceFils}{" "}
                        <span className="text-[#DF202E]">*</span>
                      </label>
                      <StepperInput
                        id={`${formId}-pricing.retailPriceFils`}
                        aria-label={copy.pricing.retailPriceFils}
                        aria-required="true"
                        data-field-key="pricing.retailPriceFils"
                        isBold
                        name="pricing.retailPriceFils"
                        step={500}
                        value={retailPriceFils}
                        onChange={(v) => {
                          markDraftDirty();
                          setRetailPriceFils(v);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#5C7385]">
                          {locale === "ar" ? "معاينة السعر:" : "Preview:"}{" "}
                          <strong className="text-[#1E2A33] font-bold">
                            {displayRetailPreview}
                          </strong>
                        </span>
                        <label
                          className="block text-[11px] font-bold text-[#1E2A33] text-right"
                          htmlFor={`${formId}-pricing.marginPercentage`}
                        >
                          {copy.pricing.marginPercentage}{" "}
                          <span className="text-[#DF202E]">*</span>
                        </label>
                      </div>
                      <StepperInput
                        id={`${formId}-pricing.marginPercentage`}
                        aria-label={copy.pricing.marginPercentage}
                        aria-required="true"
                        data-field-key="pricing.marginPercentage"
                        name="pricing.marginPercentage"
                        step={5}
                        value={marginPercentage}
                        onChange={(v) => {
                          markDraftDirty();
                          setMarginPercentage(v);
                        }}
                      />
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <label
                          className="text-[10px] text-[#5C7385] shrink-0"
                          htmlFor={`${formId}-pricing.rounding`}
                        >
                          {copy.pricing.rounding}:
                        </label>
                        <select
                          id={`${formId}-pricing.rounding`}
                          aria-label={copy.pricing.rounding}
                          className="h-[24px] flex-1 px-1.5 rounded-[4px] border border-[#D7DEE4] bg-white text-[11px] text-[#1E2A33] text-right outline-none"
                          value={rounding}
                          onChange={(e) => {
                            markDraftDirty();
                            setRounding(e.target.value as PriceRoundingSetting);
                          }}
                        >
                          {PRICE_ROUNDING_SETTINGS.map((r) => (
                            <option key={r} value={r}>
                              {copy.pricing.roundings[r]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Hidden locked preview element for browser test compatibility */}
                      <input
                        id={`${formId}-pricing.retailPrice-locked`}
                        aria-label={copy.pricing.retailPriceCalculatedPreview}
                        aria-readonly="true"
                        className="sr-only"
                        readOnly
                        type="text"
                        value={displayRetailPreview}
                      />
                    </div>
                  )}

                  {/* Col 3: Cost */}
                  <div>
                    <label
                      className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                      htmlFor={`${formId}-pricing.costFils`}
                    >
                      {copy.pricing.costFils}{" "}
                      {pricingMethod === "by-percentage" && (
                        <span className="text-[#DF202E]">*</span>
                      )}
                    </label>
                    <StepperInput
                      id={`${formId}-pricing.costFils`}
                      aria-label={copy.pricing.costFils}
                      data-field-key="pricing.costFils"
                      name="pricing.costFils"
                      step={500}
                      value={costFils}
                      onChange={(v) => {
                        markDraftDirty();
                        setCostFils(v);
                      }}
                    />
                  </div>

                  {/* Col 4: Base Unit Name */}
                  <div>
                    <label
                      className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                      htmlFor={`${formId}-packaging.inventoryUnitName`}
                    >
                      {copy.packaging.inventoryUnitName}{" "}
                      <span className="text-[#DF202E]">*</span>
                    </label>
                    <input
                      id={`${formId}-packaging.inventoryUnitName`}
                      aria-label={copy.packaging.inventoryUnitName}
                      aria-required="true"
                      className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82]"
                      data-field-key="packaging.inventoryUnitName"
                      name="packaging.inventoryUnitName"
                      placeholder={copy.packaging.inventoryUnitNamePlaceholder}
                      type="text"
                      value={inventoryUnitName}
                      onChange={(e) => {
                        markDraftDirty();
                        setInventoryUnitName(e.target.value);
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ======================================================== */}
              {/* ROW 4: Unit 2 — "الوحدة الثانوية (الكبرى)" (Conditional) */}
              {/* ======================================================== */}
              {packagingEnabled && (
                <div className="border border-[#D7DEE4] rounded-[6px] bg-white overflow-hidden">
                  {/* Header Bar */}
                  <div className="h-[34px] px-3 bg-[#F6F7F9] border-b border-[#D7DEE4] flex items-center justify-between">
                    <div />
                    <span className="text-[13px] font-semibold text-[#1E2A33]">
                      {locale === "ar"
                        ? "الوحدة الثانوية (الكبرى)"
                        : "Secondary Unit (Package)"}
                    </span>
                  </div>

                  {/* Package conversion uses quantity ratios; purchase costs stay on invoices. */}
                  <div className="p-3 grid grid-cols-2 gap-3">
                    {/* Package size and conversion */}
                    <div>
                      <label
                        className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                        htmlFor={`${formId}-packaging.packageUnits.0.baseUnitsPerPackage`}
                      >
                        {copy.packaging.baseUnitsPerPackage}
                      </label>
                      <StepperInput
                        id={`${formId}-packaging.packageUnits.0.baseUnitsPerPackage`}
                        aria-label={copy.packaging.baseUnitsPerPackage}
                        data-field-key="packaging.packageUnits.0.baseUnitsPerPackage"
                        min={1}
                        name="packaging.packageUnits.0.baseUnitsPerPackage"
                        step={1}
                        value={packageUnits[0]?.baseUnitsPerPackage ?? ""}
                        onChange={(v) => {
                          markDraftDirty();
                          handleSecondaryUnitChange(
                            packageUnits[0]?.name ?? "",
                            v,
                          );
                        }}
                      />
                    </div>

                    {/* Col 5: Secondary Unit Name */}
                    <div>
                      <label
                        className="block text-[11px] font-medium text-[#5C7385] mb-1 text-right"
                        htmlFor={`${formId}-packaging.packageUnits.0.name`}
                      >
                        {copy.packaging.packageUnitName}
                      </label>
                      <input
                        id={`${formId}-packaging.packageUnits.0.name`}
                        aria-label={copy.packaging.packageUnitName}
                        className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82]"
                        data-field-key="packaging.packageUnits.0.name"
                        name="packaging.packageUnits.0.name"
                        placeholder={copy.packaging.packageUnitNamePlaceholder}
                        type="text"
                        value={packageUnits[0]?.name ?? ""}
                        onChange={(e) => {
                          markDraftDirty();
                          handleSecondaryUnitChange(
                            e.target.value,
                            packageUnits[0]?.baseUnitsPerPackage ?? "10",
                          );
                        }}
                      />
                    </div>
                  </div>

                  {/* Repeatable package units drawer for Unit 3+ and browser test compliance */}
                  {isEditing && (
                    <details className="catalog-secondary-panel border-t border-[#EDF0F2] bg-[#FDFDFE] text-xs">
                      <summary className="px-3 py-1.5 font-medium text-[#5C7385] cursor-pointer">
                        {copy.flow.optionalUnitSettings}
                      </summary>
                      <div className="p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#1E2A33]">
                            {copy.packaging.packageUnitsTitle}
                          </span>
                          <button
                            className="h-7 px-2.5 rounded-[4px] border border-[#D7DEE4] bg-white text-xs text-[#4A6B82] hover:bg-[#F6F7F9]"
                            type="button"
                            onClick={handleAddPackageUnit}
                          >
                            {copy.packaging.addPackageUnit}
                          </button>
                        </div>
                        {packageUnits.slice(1).map((pkg, idx) => (
                          <div
                            key={pkg.id}
                            className="p-2 border border-[#D7DEE4] rounded-[6px] flex items-center gap-3 bg-white"
                          >
                            <input
                              aria-label={copy.packaging.packageUnitName}
                              className="h-8 px-2 text-xs border border-[#D7DEE4] rounded-[4px] flex-1 text-right"
                              placeholder={
                                copy.packaging.packageUnitNamePlaceholder
                              }
                              value={pkg.name}
                              onChange={(e) =>
                                handleUpdatePackageUnit(
                                  idx + 1,
                                  "name",
                                  e.target.value,
                                )
                              }
                            />
                            <input
                              aria-label={copy.packaging.baseUnitsPerPackage}
                              className="h-8 px-2 text-xs border border-[#D7DEE4] rounded-[4px] w-24 text-center font-mono"
                              value={pkg.baseUnitsPerPackage}
                              onChange={(e) =>
                                handleUpdatePackageUnit(
                                  idx + 1,
                                  "baseUnitsPerPackage",
                                  e.target.value,
                                )
                              }
                            />
                            <button
                              className="text-xs text-[#DF202E] px-2 hover:font-bold"
                              type="button"
                              onClick={() => handleRemovePackageUnit(idx + 1)}
                            >
                              {copy.packaging.removePackageUnit}
                            </button>
                          </div>
                        ))}
                        {hasThirdUnit ? (
                          <div className="pt-2 border-t border-[#EDF0F2]">
                            <label
                              className="block text-[11px] font-medium text-[#5C7385] mb-1"
                              htmlFor={`${formId}-packaging.thirdUnit.name`}
                            >
                              {copy.packaging.thirdUnitName}
                            </label>
                            <input
                              id={`${formId}-packaging.thirdUnit.name`}
                              aria-label={copy.packaging.thirdUnitName}
                              className="h-8 px-2 text-xs border border-[#D7DEE4] rounded-[4px] w-full text-right"
                              data-field-key="packaging.thirdUnit.name"
                              name="packaging.thirdUnit.name"
                              placeholder={
                                copy.packaging.thirdUnitNamePlaceholder
                              }
                              value={thirdUnitName}
                              onChange={(e) => {
                                markDraftDirty();
                                setThirdUnitName(e.target.value);
                              }}
                            />
                          </div>
                        ) : (
                          <button
                            className="quiet-button text-xs text-[#4A6B82]"
                            type="button"
                            onClick={() => {
                              markDraftDirty();
                              setHasThirdUnit(true);
                            }}
                          >
                            + {copy.packaging.enableThirdUnit}
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              )}

              <ProductSupplierLinks
                baseUrl={baseUrl}
                editable={canManageCatalog}
                onChange={(nextSupplierIds) => {
                  markDraftDirty();
                  setSupplierIds(nextSupplierIds);
                }}
                supplierIds={supplierIds}
              />

              <section className="catalog-settings-panel">
                <div>
                  <h3>{copy.sharing.title}</h3>
                  <p>{copy.sharing.description}</p>
                  <p className="field-note">{copy.sharing.metadataNotice}</p>
                </div>
                <label className="catalog-setting-option">
                  <input
                    checked={sharing.externallyVisible}
                    type="checkbox"
                    onChange={(event) => {
                      markDraftDirty();
                      setSharing((previous) => ({
                        ...previous,
                        externallyVisible: event.target.checked,
                      }));
                    }}
                  />
                  <span>{copy.sharing.externallyVisible}</span>
                </label>
                <label className="catalog-setting-option">
                  <input
                    checked={sharing.aiSharingAllowed}
                    type="checkbox"
                    onChange={(event) => {
                      markDraftDirty();
                      setSharing((previous) => ({
                        ...previous,
                        aiSharingAllowed: event.target.checked,
                      }));
                    }}
                  />
                  <span>{copy.sharing.aiSharingAllowed}</span>
                </label>
              </section>

              <section className="catalog-settings-panel">
                <div>
                  <h3>{copy.instructions.title}</h3>
                  <p>{copy.instructions.description}</p>
                </div>
                <div className="catalog-instructions-grid">
                  <label className="catalog-setting-field">
                    <span>{copy.instructions.foodTiming}</span>
                    <select
                      value={instructions.foodTiming}
                      onChange={(event) => {
                        markDraftDirty();
                        setInstructions((previous) => ({
                          ...previous,
                          foodTiming: event.target.value as
                            ProductFoodTiming | "",
                        }));
                      }}
                    >
                      <option value="">
                        {copy.instructions.foodTimingNone}
                      </option>
                      {PRODUCT_FOOD_TIMINGS.map((timing) => (
                        <option key={timing} value={timing}>
                          {copy.instructions.foodTimings[timing]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="catalog-setting-field">
                    <span>{copy.instructions.usesPerDay}</span>
                    <StepperInput
                      min={1}
                      value={instructions.usesPerDay}
                      onChange={(value) => {
                        markDraftDirty();
                        setInstructions((previous) => ({
                          ...previous,
                          usesPerDay: value,
                        }));
                      }}
                    />
                  </label>
                  <label className="catalog-setting-field">
                    <span>{copy.instructions.usesPerWeek}</span>
                    <StepperInput
                      min={1}
                      value={instructions.usesPerWeek}
                      onChange={(value) => {
                        markDraftDirty();
                        setInstructions((previous) => ({
                          ...previous,
                          usesPerWeek: value,
                        }));
                      }}
                    />
                  </label>
                  <label className="catalog-setting-field">
                    <span>{copy.instructions.usesPerMonth}</span>
                    <StepperInput
                      min={1}
                      value={instructions.usesPerMonth}
                      onChange={(value) => {
                        markDraftDirty();
                        setInstructions((previous) => ({
                          ...previous,
                          usesPerMonth: value,
                        }));
                      }}
                    />
                  </label>
                </div>
              </section>

              <div
                id={formId + "-movement-section"}
                className="catalog-product-facts-stack"
              >
                {isEditing && initialProduct ? (
                  <>
                    <ProductInventoryBatches
                      baseUrl={baseUrl}
                      productId={initialProduct.id}
                      unitName={initialProduct.packaging.inventoryUnitName}
                    />
                    <ProductMovementHistory
                      baseUrl={baseUrl}
                      productId={initialProduct.id}
                    />
                  </>
                ) : null}
              </div>

              <section
                aria-labelledby={formId + "-stock-levels-heading"}
                className="catalog-settings-panel"
              >
                <h3 id={formId + "-stock-levels-heading"}>
                  {copy.stockLevels.title}
                </h3>
                <div className="catalog-stock-levels-grid">
                  <label className="catalog-setting-field">
                    <span>{copy.stockLevels.reorderPoint}</span>
                    <StepperInput
                      id={formId + "-stockLevels.reorderPoint"}
                      data-field-key="stockLevels.reorderPoint"
                      name="reorderPoint"
                      min={0}
                      step={1}
                      value={stockLevels.reorderPoint}
                      onChange={(value) => {
                        markDraftDirty();
                        setStockLevels((previous) => ({
                          ...previous,
                          reorderPoint: value,
                        }));
                      }}
                    />
                  </label>
                  <label className="catalog-setting-field">
                    <span>{copy.stockLevels.maximum}</span>
                    <StepperInput
                      id={formId + "-stockLevels.maximumLevel"}
                      name="maximumLevel"
                      min={0}
                      step={1}
                      value={stockLevels.maximumLevel}
                      onChange={(value) => {
                        markDraftDirty();
                        setStockLevels((previous) => ({
                          ...previous,
                          maximumLevel: value,
                        }));
                      }}
                    />
                  </label>
                  <label className="catalog-setting-field">
                    <span>{copy.stockLevels.minimum}</span>
                    <StepperInput
                      id={formId + "-stockLevels.minimumLevel"}
                      name="minimumLevel"
                      min={0}
                      step={1}
                      value={stockLevels.minimumLevel}
                      onChange={(value) => {
                        markDraftDirty();
                        setStockLevels((previous) => ({
                          ...previous,
                          minimumLevel: value,
                        }));
                      }}
                    />
                  </label>
                </div>
              </section>
            </>
          )}
        </div>
        <div className="catalog-product-form-actions">
          {!isEditing ? (
            <p className="catalog-step-indicator" aria-live="polite">
              {createStep === 1 ? copy.flow.stepIdentity : copy.flow.stepSetup}
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="catalog-product-form-action-buttons">
            <button
              className="quiet-button"
              type="button"
              onClick={handleCancel}
            >
              <LogOut aria-hidden="true" size={16} />
              {copy.actions.cancel}
            </button>

            {isEditing && canReviewInventory ? (
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  document
                    .getElementById(formId + "-movement-section")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <History aria-hidden="true" size={16} />
                {copy.movementHistory.inventoryFacts}
              </button>
            ) : null}

            {isEditing ? (
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  window.location.hash = "#/catalog/products/new";
                }}
              >
                <Plus aria-hidden="true" size={16} />
                {copy.rail.newShort}
              </button>
            ) : null}

            {canArchive ? (
              <button
                className="quiet-button catalog-archive-action"
                disabled={busy}
                type="button"
                onClick={() => setShowArchiveDialog(true)}
              >
                <Trash2 aria-hidden="true" size={16} />
                {copy.actions.archive}
              </button>
            ) : null}

            {!isEditing && createStep === 2 ? (
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => {
                  setCreateStep(1);
                  setFieldErrors({});
                  setGeneralError(null);
                  focusStepHeading(1);
                }}
              >
                {copy.flow.back}
              </button>
            ) : null}

            {!isEditing && createStep === 1 ? (
              <button className="primary-button" disabled={busy} type="submit">
                {copy.flow.continue}
              </button>
            ) : (
              <button className="primary-button" disabled={busy} type="submit">
                <Save aria-hidden="true" size={16} />
                {busy
                  ? "..."
                  : isEditing
                    ? copy.actions.saveChanges
                    : copy.actions.create}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
