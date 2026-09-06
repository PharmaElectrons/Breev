import {
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  DEFAULT_PRODUCT_PRICING_METHOD,
  PRICE_ROUNDING_SETTINGS,
  PRODUCT_DEFINITION_MODES,
  PRODUCT_FOOD_TIMINGS,
  PRODUCT_NAME_TEMPLATES,
  PRODUCT_PRICING_FIELD_EDITABILITY,
  PRODUCT_PRICING_METHODS,
  PRODUCT_STATE_COLORS,
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
  type ProductPackaging,
  type ProductPricingInput,
  type ProductPricingMethod,
  type ProductStateColour,
} from "@breev/contracts/local-rest";
import { useCallback, useId, useRef, useState } from "react";

import {
  CatalogApiDenied,
  createProduct,
  editProduct,
  newIdempotencyKey,
} from "./catalog-api";
import { catalogMessages, type CatalogCopy } from "./catalog-messages";
import { usePreferences } from "./preferences-provider";
import { formatFilsToIqd } from "./product-record";

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
  readonly initialProduct?: Product | null;
  readonly onCancel?: () => void;
  readonly onSuccess?: (product: Product) => void;
}

/**
 * The live preview the pharmacist watches assemble as they type.
 *
 * The field order is not restated here. It is read from the one approved
 * template in the contract, so the name previewed on screen cannot drift away
 * from the name the server stores.
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

export function ProductForm({
  baseUrl,
  initialProduct,
  onCancel,
  onSuccess,
}: ProductFormProps): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = catalogMessages[locale];
  const formId = useId();

  const isEditing = Boolean(initialProduct);

  const [mode, setMode] = useState<ProductDefinitionMode>(
    initialProduct?.definition.mode ?? "medication",
  );

  const [medicationFields, setMedicationFields] = useState({
    dosageForm:
      initialProduct?.definition.mode === "medication"
        ? (initialProduct.definition.fields.dosageForm ?? "")
        : "",
    manufacturer:
      initialProduct?.definition.mode === "medication"
        ? (initialProduct.definition.fields.manufacturer ?? "")
        : "",
    strength:
      initialProduct?.definition.mode === "medication"
        ? (initialProduct.definition.fields.strength ?? "")
        : "",
    tradeName:
      initialProduct?.definition.mode === "medication"
        ? initialProduct.definition.fields.tradeName
        : "",
  });

  const [generalItemFields, setGeneralItemFields] = useState({
    company:
      initialProduct?.definition.mode === "general-item"
        ? initialProduct.definition.fields.company
        : "",
    property:
      initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.property ?? "")
        : "",
    size:
      initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.size ?? "")
        : "",
    subBrand:
      initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.subBrand ?? "")
        : "",
    targetAudience:
      initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.targetAudience ?? "")
        : "",
    typeOfUse:
      initialProduct?.definition.mode === "general-item"
        ? (initialProduct.definition.fields.typeOfUse ?? "")
        : "",
  });

  const [arabicSearchName, setArabicSearchName] = useState(
    initialProduct?.arabicSearchName ?? "",
  );
  const [scientificName, setScientificName] = useState(
    initialProduct?.scientificName ?? "",
  );
  const [category, setCategory] = useState(initialProduct?.category ?? "");

  const [barcodes, setBarcodes] = useState<ProductBarcodeInput[]>(
    initialProduct?.barcodes.map(({ kind, value }) => ({ kind, value })) ?? [],
  );
  const [newBarcode, setNewBarcode] = useState("");
  const [newBarcodeKind, setNewBarcodeKind] =
    useState<ProductBarcodeKind>("product");

  const [instructions, setInstructions] = useState({
    foodTiming: (initialProduct?.instructions.foodTiming ?? "") as
      ProductFoodTiming | "",
    usesPerDay:
      initialProduct?.instructions.usesPerDay !== null &&
      initialProduct?.instructions.usesPerDay !== undefined
        ? String(initialProduct.instructions.usesPerDay)
        : "",
    usesPerMonth:
      initialProduct?.instructions.usesPerMonth !== null &&
      initialProduct?.instructions.usesPerMonth !== undefined
        ? String(initialProduct.instructions.usesPerMonth)
        : "",
    usesPerWeek:
      initialProduct?.instructions.usesPerWeek !== null &&
      initialProduct?.instructions.usesPerWeek !== undefined
        ? String(initialProduct.instructions.usesPerWeek)
        : "",
  });

  const [sharing, setSharing] = useState({
    aiSharingAllowed: initialProduct?.sharing.aiSharingAllowed ?? false,
    externallyVisible: initialProduct?.sharing.externallyVisible ?? false,
  });

  const [stateColours, setStateColours] = useState<{
    coldStorageRequired: boolean;
    manual: ProductStateColour | "";
  }>({
    coldStorageRequired:
      initialProduct?.stateColours.coldStorageRequired ?? false,
    manual: initialProduct?.stateColours.manual ?? "",
  });

  // Packaging State
  const [inventoryUnitName, setInventoryUnitName] = useState(
    initialProduct?.packaging.inventoryUnitName ?? "",
  );

  interface PackageUnitItem {
    readonly id: string;
    baseUnitsPerPackage: string;
    name: string;
  }

  const [packageUnits, setPackageUnits] = useState<PackageUnitItem[]>(
    () =>
      initialProduct?.packaging.packageUnits.map((u) => ({
        baseUnitsPerPackage: u.baseUnitsPerPackage,
        id: crypto.randomUUID(),
        name: u.name,
      })) ?? [],
  );

  const [hasThirdUnit, setHasThirdUnit] = useState(
    Boolean(initialProduct?.packaging.thirdUnit),
  );
  const [thirdUnitName, setThirdUnitName] = useState(
    initialProduct?.packaging.thirdUnit?.name ?? "",
  );

  const [defaultUnits, setDefaultUnits] = useState<{
    count: InventoryCapableUnit;
    purchase: InventoryCapableUnit;
    sale: InventoryCapableUnit;
  }>(() => ({
    count: initialProduct?.packaging.defaultUnits.count ?? {
      kind: "inventory-unit",
    },
    purchase: initialProduct?.packaging.defaultUnits.purchase ?? {
      kind: "inventory-unit",
    },
    sale: initialProduct?.packaging.defaultUnits.sale ?? {
      kind: "inventory-unit",
    },
  }));

  // Pricing State
  const [pricingMethod, setPricingMethod] = useState<ProductPricingMethod>(
    initialProduct?.pricing.method ?? DEFAULT_PRODUCT_PRICING_METHOD,
  );

  const [retailPriceFils, setRetailPriceFils] = useState(
    initialProduct?.pricing.retailPriceFils ?? "",
  );

  const [wholesalePriceFils, setWholesalePriceFils] = useState(
    initialProduct?.pricing.wholesalePriceFils ?? "",
  );

  // Cost is transient calculation input: begins blank on edit until supplied again
  const [costFils, setCostFils] = useState("");

  const [marginPercentage, setMarginPercentage] = useState(
    initialProduct?.pricing.method === "by-percentage"
      ? initialProduct.pricing.marginPercentage
      : "",
  );

  const [rounding, setRounding] = useState<PriceRoundingSetting>(
    initialProduct?.pricing.method === "by-percentage"
      ? initialProduct.pricing.rounding
      : "off",
  );

  const pricingFieldEditability =
    PRODUCT_PRICING_FIELD_EDITABILITY[pricingMethod];
  const isMarginPercentageAvailable =
    pricingFieldEditability.marginPercentage !== "unavailable";
  const isRetailPriceLocked = pricingFieldEditability.retailPrice === "locked";

  const [pendingModeSwitch, setPendingModeSwitch] =
    useState<ProductDefinitionMode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const generatedDisplayName = composeProductDisplayName(
    mode,
    mode === "medication" ? medicationFields : generalItemFields,
  );

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
      setBarcodes([...barcodes, { kind: newBarcodeKind, value: trimmed }]);
      setNewBarcode("");
    }
  };

  const handleRemoveBarcode = (index: number): void => {
    setBarcodes(barcodes.filter((_, i) => i !== index));
  };

  const handleAddPackageUnit = (): void => {
    setPackageUnits((prev) => [
      ...prev,
      { baseUnitsPerPackage: "", id: crypto.randomUUID(), name: "" },
    ]);
  };

  const handleRemovePackageUnit = (index: number): void => {
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

  const handleDefaultUnitChange = (
    interfaceName: "count" | "purchase" | "sale",
    value: string,
  ): void => {
    setDefaultUnits((prev) => ({
      ...prev,
      [interfaceName]:
        value === "__inventory_unit__"
          ? { kind: "inventory-unit" }
          : { kind: "package-unit", packageUnitName: value },
    }));
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
    for (const key of keys) {
      const element =
        document.querySelector<HTMLElement>(`[name="${key}"]`) ||
        document.getElementById(`${formId}-${key}`) ||
        document.querySelector<HTMLElement>(`[data-field-key="${key}"]`);
      if (element) {
        element.focus();
        return;
      }
    }
    errorSummaryRef.current?.focus();
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const localErrors: Record<string, string> = {};
    if (mode === "medication") {
      if (medicationFields.tradeName.trim().length === 0) {
        localErrors.tradeName = copy.fieldErrors.required;
      }
    } else {
      if (generalItemFields.company.trim().length === 0) {
        localErrors.company = copy.fieldErrors.required;
      }
    }

    if (inventoryUnitName.trim().length === 0) {
      localErrors["packaging.inventoryUnitName"] = copy.fieldErrors.required;
    }
    if (hasThirdUnit && thirdUnitName.trim().length === 0) {
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
      defaultUnits,
      hasThirdUnit,
      inventoryUnitName,
      packageUnits,
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

    const payloadAttributes = {
      arabicSearchName: arabicSearchName.trim() || null,
      barcodes,
      category: category.trim() || null,
      definition,
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
    };

    setBusy(true);
    try {
      let savedProduct: Product;
      if (isEditing && initialProduct) {
        const editBody: ProductEditRequest = {
          ...payloadAttributes,
          expectedRevision: initialProduct.revision,
          idempotencyKey: newIdempotencyKey(),
        };
        savedProduct = await editProduct(baseUrl, initialProduct.id, editBody);
      } else {
        const createBody: ProductCreateRequest = {
          ...payloadAttributes,
          idempotencyKey: newIdempotencyKey(),
        };
        savedProduct = await createProduct(baseUrl, createBody);
      }
      onSuccess?.(savedProduct);
    } catch (error) {
      if (error instanceof CatalogApiDenied) {
        if (
          error.denial.code === "body-invalid" &&
          error.denial.fieldErrors.length > 0
        ) {
          const mapped = mapFieldErrors(error.denial.fieldErrors);
          setFieldErrors(mapped);
          setGeneralError(copy.denials["body-invalid"]);
          focusFirstErrorField(mapped);
        } else {
          setGeneralError(
            copy.denials[error.denial.code] ??
              `Error (${error.denial.code}): ${error.message}`,
          );
          errorSummaryRef.current?.focus();
        }
      } else if (error instanceof Error) {
        setGeneralError(error.message);
        errorSummaryRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  const abandonedFields = pendingModeSwitch
    ? getAbandonedDirtyFields(mode, medicationFields, generalItemFields, copy)
    : [];

  return (
    <div
      className="identity-region"
      aria-label={
        isEditing ? copy.titles.editProduct : copy.titles.createProduct
      }
    >
      {pendingModeSwitch !== null ? (
        <ModeSwitchConfirmationDialog
          abandonedFields={abandonedFields}
          copy={copy}
          onCancel={cancelModeSwitch}
          onConfirm={confirmModeSwitch}
        />
      ) : null}

      <article className="identity-card p-5 max-w-4xl w-full mx-auto animate-reveal">
        <header className="identity-heading">
          <span className="identity-symbol" aria-hidden="true">
            {isEditing ? "✎" : "+"}
          </span>
          <div>
            <h2>
              {isEditing ? copy.titles.editProduct : copy.titles.createProduct}
            </h2>
          </div>
        </header>

        {generalError !== null ? (
          <div
            ref={errorSummaryRef}
            aria-live="polite"
            className="denial-alert mb-6"
            role="alert"
            tabIndex={-1}
          >
            <span className="denial-icon" aria-hidden="true">
              !
            </span>
            <div>
              <p>{generalError}</p>
            </div>
            <button
              aria-label="Dismiss error"
              className="dismiss-button"
              type="button"
              onClick={() => setGeneralError(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <form className="identity-form" noValidate onSubmit={handleSubmit}>
          {/* 1. Mode Switch - Single Clear Control */}
          <div className="field-label">
            <label htmlFor={`${formId}-mode-select`}>
              <span>{copy.definition.modeLabel}</span>
            </label>
            <select
              id={`${formId}-mode-select`}
              name="definitionMode"
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
          </div>

          {/* 2. Mode Definition Fields */}
          {mode === "medication" ? (
            <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-[color:var(--border)] p-3 rounded-lg">
              <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
                {copy.definition.modes.medication}
              </legend>

              <div className="field-label">
                <label htmlFor={`${formId}-tradeName`}>
                  <span>{copy.definition.medication.tradeName} *</span>
                </label>
                <input
                  id={`${formId}-tradeName`}
                  aria-describedby={
                    fieldErrors.tradeName
                      ? `${formId}-tradeName-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.tradeName)}
                  aria-required="true"
                  maxLength={120}
                  name="tradeName"
                  required
                  type="text"
                  value={medicationFields.tradeName}
                  onChange={(e) =>
                    setMedicationFields((prev) => ({
                      ...prev,
                      tradeName: e.target.value,
                    }))
                  }
                />
                {fieldErrors.tradeName ? (
                  <p
                    id={`${formId}-tradeName-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.tradeName}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-strength`}>
                  <span>{copy.definition.medication.strength}</span>
                </label>
                <input
                  id={`${formId}-strength`}
                  aria-describedby={
                    fieldErrors.strength
                      ? `${formId}-strength-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.strength)}
                  maxLength={120}
                  name="strength"
                  type="text"
                  value={medicationFields.strength}
                  onChange={(e) =>
                    setMedicationFields((prev) => ({
                      ...prev,
                      strength: e.target.value,
                    }))
                  }
                />
                {fieldErrors.strength ? (
                  <p
                    id={`${formId}-strength-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.strength}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-dosageForm`}>
                  <span>{copy.definition.medication.dosageForm}</span>
                </label>
                <input
                  id={`${formId}-dosageForm`}
                  aria-describedby={
                    fieldErrors.dosageForm
                      ? `${formId}-dosageForm-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.dosageForm)}
                  maxLength={120}
                  name="dosageForm"
                  type="text"
                  value={medicationFields.dosageForm}
                  onChange={(e) =>
                    setMedicationFields((prev) => ({
                      ...prev,
                      dosageForm: e.target.value,
                    }))
                  }
                />
                {fieldErrors.dosageForm ? (
                  <p
                    id={`${formId}-dosageForm-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.dosageForm}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-manufacturer`}>
                  <span>{copy.definition.medication.manufacturer}</span>
                </label>
                <input
                  id={`${formId}-manufacturer`}
                  aria-describedby={
                    fieldErrors.manufacturer
                      ? `${formId}-manufacturer-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.manufacturer)}
                  maxLength={120}
                  name="manufacturer"
                  type="text"
                  value={medicationFields.manufacturer}
                  onChange={(e) =>
                    setMedicationFields((prev) => ({
                      ...prev,
                      manufacturer: e.target.value,
                    }))
                  }
                />
                {fieldErrors.manufacturer ? (
                  <p
                    id={`${formId}-manufacturer-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.manufacturer}
                  </p>
                ) : null}
              </div>
            </fieldset>
          ) : (
            <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-[color:var(--border)] p-3 rounded-lg">
              <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
                {copy.definition.modes["general-item"]}
              </legend>

              <div className="field-label">
                <label htmlFor={`${formId}-company`}>
                  <span>{copy.definition.generalItem.company} *</span>
                </label>
                <input
                  id={`${formId}-company`}
                  aria-describedby={
                    fieldErrors.company ? `${formId}-company-error` : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.company)}
                  aria-required="true"
                  maxLength={120}
                  name="company"
                  required
                  type="text"
                  value={generalItemFields.company}
                  onChange={(e) =>
                    setGeneralItemFields((prev) => ({
                      ...prev,
                      company: e.target.value,
                    }))
                  }
                />
                {fieldErrors.company ? (
                  <p
                    id={`${formId}-company-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.company}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-subBrand`}>
                  <span>{copy.definition.generalItem.subBrand}</span>
                </label>
                <input
                  id={`${formId}-subBrand`}
                  aria-describedby={
                    fieldErrors.subBrand
                      ? `${formId}-subBrand-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.subBrand)}
                  maxLength={120}
                  name="subBrand"
                  type="text"
                  value={generalItemFields.subBrand}
                  onChange={(e) =>
                    setGeneralItemFields((prev) => ({
                      ...prev,
                      subBrand: e.target.value,
                    }))
                  }
                />
                {fieldErrors.subBrand ? (
                  <p
                    id={`${formId}-subBrand-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.subBrand}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-typeOfUse`}>
                  <span>{copy.definition.generalItem.typeOfUse}</span>
                </label>
                <input
                  id={`${formId}-typeOfUse`}
                  aria-describedby={
                    fieldErrors.typeOfUse
                      ? `${formId}-typeOfUse-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.typeOfUse)}
                  maxLength={120}
                  name="typeOfUse"
                  type="text"
                  value={generalItemFields.typeOfUse}
                  onChange={(e) =>
                    setGeneralItemFields((prev) => ({
                      ...prev,
                      typeOfUse: e.target.value,
                    }))
                  }
                />
                {fieldErrors.typeOfUse ? (
                  <p
                    id={`${formId}-typeOfUse-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.typeOfUse}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-property`}>
                  <span>{copy.definition.generalItem.property}</span>
                </label>
                <input
                  id={`${formId}-property`}
                  aria-describedby={
                    fieldErrors.property
                      ? `${formId}-property-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.property)}
                  maxLength={120}
                  name="property"
                  type="text"
                  value={generalItemFields.property}
                  onChange={(e) =>
                    setGeneralItemFields((prev) => ({
                      ...prev,
                      property: e.target.value,
                    }))
                  }
                />
                {fieldErrors.property ? (
                  <p
                    id={`${formId}-property-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.property}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-targetAudience`}>
                  <span>{copy.definition.generalItem.targetAudience}</span>
                </label>
                <input
                  id={`${formId}-targetAudience`}
                  aria-describedby={
                    fieldErrors.targetAudience
                      ? `${formId}-targetAudience-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.targetAudience)}
                  maxLength={120}
                  name="targetAudience"
                  type="text"
                  value={generalItemFields.targetAudience}
                  onChange={(e) =>
                    setGeneralItemFields((prev) => ({
                      ...prev,
                      targetAudience: e.target.value,
                    }))
                  }
                />
                {fieldErrors.targetAudience ? (
                  <p
                    id={`${formId}-targetAudience-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.targetAudience}
                  </p>
                ) : null}
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-size`}>
                  <span>{copy.definition.generalItem.size}</span>
                </label>
                <input
                  id={`${formId}-size`}
                  aria-describedby={
                    fieldErrors.size ? `${formId}-size-error` : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.size)}
                  maxLength={120}
                  name="size"
                  type="text"
                  value={generalItemFields.size}
                  onChange={(e) =>
                    setGeneralItemFields((prev) => ({
                      ...prev,
                      size: e.target.value,
                    }))
                  }
                />
                {fieldErrors.size ? (
                  <p
                    id={`${formId}-size-error`}
                    className="field-error"
                    role="alert"
                  >
                    {fieldErrors.size}
                  </p>
                ) : null}
              </div>
            </fieldset>
          )}

          {/*
            3. The generated English display name.
            The client's own Add-Material panel assembles this while the
            pharmacist types, and this keeps that behaviour. It is an <output>,
            never an input: the display name is generated from the approved
            field template and is never unrelated free text (docs/domain.md).
          */}
          <div className="field-label generated-name-banner">
            <span className="generated-name-label">
              {copy.fields.generatedDisplayName}
            </span>
            <span className="field-note">
              {copy.fields.generatedDisplayNameHint}
            </span>
            <output
              aria-live="polite"
              data-testid="generated-display-name"
              name="generatedDisplayName"
            >
              {generatedDisplayName || (
                <span className="field-note">
                  {copy.fields.generatedDisplayNameEmpty}
                </span>
              )}
            </output>
          </div>

          {/* 4. Arabic Search Name - on its own line BELOW the generated English name */}
          <div className="field-label">
            <label htmlFor={`${formId}-arabicSearchName`}>
              <span>{copy.fields.arabicSearchName}</span>
            </label>
            <span className="field-note">
              {copy.fields.arabicSearchNameHint}
            </span>
            <input
              id={`${formId}-arabicSearchName`}
              aria-describedby={
                fieldErrors.arabicSearchName
                  ? `${formId}-arabicSearchName-error`
                  : undefined
              }
              aria-invalid={Boolean(fieldErrors.arabicSearchName)}
              dir="rtl"
              maxLength={160}
              name="arabicSearchName"
              type="text"
              value={arabicSearchName}
              onChange={(e) => setArabicSearchName(e.target.value)}
            />
            {fieldErrors.arabicSearchName ? (
              <p
                id={`${formId}-arabicSearchName-error`}
                className="field-error"
                role="alert"
              >
                {fieldErrors.arabicSearchName}
              </p>
            ) : null}
          </div>

          {/* 5. Supporting Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="field-label">
              <label htmlFor={`${formId}-scientificName`}>
                <span>{copy.fields.scientificName}</span>
              </label>
              <input
                id={`${formId}-scientificName`}
                aria-describedby={
                  fieldErrors.scientificName
                    ? `${formId}-scientificName-error`
                    : undefined
                }
                aria-invalid={Boolean(fieldErrors.scientificName)}
                maxLength={160}
                name="scientificName"
                type="text"
                value={scientificName}
                onChange={(e) => setScientificName(e.target.value)}
              />
              {fieldErrors.scientificName ? (
                <p
                  id={`${formId}-scientificName-error`}
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.scientificName}
                </p>
              ) : null}
            </div>

            <div className="field-label">
              <label htmlFor={`${formId}-category`}>
                <span>{copy.fields.category}</span>
              </label>
              <input
                id={`${formId}-category`}
                aria-describedby={
                  fieldErrors.category ? `${formId}-category-error` : undefined
                }
                aria-invalid={Boolean(fieldErrors.category)}
                maxLength={96}
                name="category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              {fieldErrors.category ? (
                <p
                  id={`${formId}-category-error`}
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors.category}
                </p>
              ) : null}
            </div>
          </div>

          {/* 6. Barcodes Storage */}
          <fieldset className="border border-[color:var(--border)] p-3 rounded-lg">
            <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
              {copy.barcodes.label}
            </legend>
            <div className="flex gap-2 mb-3">
              <select
                aria-label={locale === "ar" ? "نوع الباركود" : "Barcode kind"}
                className="min-h-[2.5rem] px-2 border border-[color:var(--control-border)] rounded-lg bg-background"
                value={newBarcodeKind}
                onChange={(event) =>
                  setNewBarcodeKind(event.target.value as ProductBarcodeKind)
                }
              >
                <option value="product">
                  {locale === "ar" ? "منتج" : "Product"}
                </option>
                <option value="package">
                  {locale === "ar" ? "عبوة" : "Package"}
                </option>
              </select>
              <input
                aria-label={copy.barcodes.label}
                className="flex-1 min-h-[2.5rem] px-3 border border-[color:var(--control-border)] rounded-lg bg-background"
                maxLength={64}
                name="newBarcode"
                placeholder={copy.barcodes.placeholder}
                type="text"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBarcode();
                  }
                }}
              />
              <button
                className="quiet-button"
                type="button"
                onClick={handleAddBarcode}
              >
                {copy.barcodes.add}
              </button>
            </div>

            {barcodes.length === 0 ? (
              <p className="field-note">{copy.barcodes.empty}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                {barcodes.map((barcode, idx) => (
                  <li
                    key={barcode.value}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[color:var(--border)] font-mono text-sm"
                  >
                    <span>{barcode.value}</span>
                    <span className="text-muted-foreground">
                      {barcode.kind === "product"
                        ? locale === "ar"
                          ? "منتج"
                          : "Product"
                        : locale === "ar"
                          ? "عبوة"
                          : "Package"}
                    </span>
                    <button
                      aria-label={`${copy.barcodes.remove} ${barcode.value}`}
                      className="font-bold px-1 text-[color:var(--danger)]"
                      type="button"
                      onClick={() => handleRemoveBarcode(idx)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {/* 7. Packaging & Units */}
          <fieldset className="border border-[color:var(--border)] p-3 rounded-lg space-y-4">
            <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
              {copy.packaging.title}
            </legend>
            <p className="field-note">{copy.packaging.description}</p>

            {/* Required Inventory Unit */}
            <div className="field-label">
              <label htmlFor={`${formId}-packaging.inventoryUnitName`}>
                <span>{copy.packaging.inventoryUnitName} *</span>
              </label>
              <span className="field-note">
                {copy.packaging.inventoryUnitHelp}
              </span>
              <input
                id={`${formId}-packaging.inventoryUnitName`}
                aria-describedby={
                  fieldErrors["packaging.inventoryUnitName"]
                    ? `${formId}-packaging.inventoryUnitName-error`
                    : undefined
                }
                aria-invalid={Boolean(
                  fieldErrors["packaging.inventoryUnitName"],
                )}
                aria-required="true"
                data-field-key="packaging.inventoryUnitName"
                maxLength={40}
                name="packaging.inventoryUnitName"
                placeholder={copy.packaging.inventoryUnitNamePlaceholder}
                required
                type="text"
                value={inventoryUnitName}
                onChange={(e) => setInventoryUnitName(e.target.value)}
              />
              {fieldErrors["packaging.inventoryUnitName"] ? (
                <p
                  id={`${formId}-packaging.inventoryUnitName-error`}
                  className="field-error"
                  role="alert"
                >
                  {fieldErrors["packaging.inventoryUnitName"]}
                </p>
              ) : null}
            </div>

            {/* Repeatable Larger Package Units */}
            <div className="space-y-3 pt-2 border-t border-[color:var(--border)]">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-[color:var(--card-foreground)]">
                  {copy.packaging.packageUnitsTitle}
                </h3>
                <button
                  className="quiet-button text-xs"
                  type="button"
                  onClick={handleAddPackageUnit}
                >
                  {copy.packaging.addPackageUnit}
                </button>
              </div>

              {packageUnits.length === 0 ? (
                <p className="field-note">{copy.packaging.noPackageUnits}</p>
              ) : (
                <div className="space-y-3">
                  {packageUnits.map((pkg, idx) => (
                    <div
                      key={pkg.id}
                      className="p-3 rounded-lg border border-[color:var(--control-border)] bg-[color:var(--surface)] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-muted-foreground">
                          #{idx + 1}
                        </span>
                        <button
                          aria-label={`${copy.packaging.removePackageUnit} #${idx + 1}`}
                          className="quiet-button text-xs text-[color:var(--danger)]"
                          type="button"
                          onClick={() => handleRemovePackageUnit(idx)}
                        >
                          {copy.packaging.removePackageUnit}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="field-label">
                          <label
                            htmlFor={`${formId}-packaging.packageUnits.${idx}.name`}
                          >
                            <span>{copy.packaging.packageUnitName} *</span>
                          </label>
                          <input
                            id={`${formId}-packaging.packageUnits.${idx}.name`}
                            aria-describedby={
                              fieldErrors[`packaging.packageUnits.${idx}.name`]
                                ? `${formId}-packaging.packageUnits.${idx}.name-error`
                                : undefined
                            }
                            aria-invalid={Boolean(
                              fieldErrors[`packaging.packageUnits.${idx}.name`],
                            )}
                            data-field-key={`packaging.packageUnits.${idx}.name`}
                            maxLength={40}
                            name={`packaging.packageUnits.${idx}.name`}
                            placeholder={
                              copy.packaging.packageUnitNamePlaceholder
                            }
                            type="text"
                            value={pkg.name}
                            onChange={(e) =>
                              handleUpdatePackageUnit(
                                idx,
                                "name",
                                e.target.value,
                              )
                            }
                          />
                          {fieldErrors[`packaging.packageUnits.${idx}.name`] ? (
                            <p
                              id={`${formId}-packaging.packageUnits.${idx}.name-error`}
                              className="field-error"
                              role="alert"
                            >
                              {
                                fieldErrors[
                                  `packaging.packageUnits.${idx}.name`
                                ]
                              }
                            </p>
                          ) : null}
                        </div>

                        <div className="field-label">
                          <label
                            htmlFor={`${formId}-packaging.packageUnits.${idx}.baseUnitsPerPackage`}
                          >
                            <span>{copy.packaging.baseUnitsPerPackage} *</span>
                          </label>
                          <input
                            id={`${formId}-packaging.packageUnits.${idx}.baseUnitsPerPackage`}
                            aria-describedby={
                              fieldErrors[
                                `packaging.packageUnits.${idx}.baseUnitsPerPackage`
                              ]
                                ? `${formId}-packaging.packageUnits.${idx}.baseUnitsPerPackage-error`
                                : undefined
                            }
                            aria-invalid={Boolean(
                              fieldErrors[
                                `packaging.packageUnits.${idx}.baseUnitsPerPackage`
                              ],
                            )}
                            data-field-key={`packaging.packageUnits.${idx}.baseUnitsPerPackage`}
                            inputMode="numeric"
                            maxLength={19}
                            name={`packaging.packageUnits.${idx}.baseUnitsPerPackage`}
                            placeholder={
                              copy.packaging.baseUnitsPerPackagePlaceholder
                            }
                            type="text"
                            value={pkg.baseUnitsPerPackage}
                            onChange={(e) =>
                              handleUpdatePackageUnit(
                                idx,
                                "baseUnitsPerPackage",
                                e.target.value,
                              )
                            }
                          />
                          {fieldErrors[
                            `packaging.packageUnits.${idx}.baseUnitsPerPackage`
                          ] ? (
                            <p
                              id={`${formId}-packaging.packageUnits.${idx}.baseUnitsPerPackage-error`}
                              className="field-error"
                              role="alert"
                            >
                              {
                                fieldErrors[
                                  `packaging.packageUnits.${idx}.baseUnitsPerPackage`
                                ]
                              }
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Optional Third Unit (explicitly non-stock) */}
            <div className="space-y-2 pt-2 border-t border-[color:var(--border)]">
              <label className="check-row flex items-center gap-2 cursor-pointer">
                <input
                  checked={hasThirdUnit}
                  name="hasThirdUnit"
                  type="checkbox"
                  onChange={(e) => {
                    setHasThirdUnit(e.target.checked);
                    if (!e.target.checked) {
                      setThirdUnitName("");
                    }
                  }}
                />
                <span className="font-semibold text-sm">
                  {copy.packaging.enableThirdUnit}
                </span>
              </label>
              <p className="field-note">{copy.packaging.thirdUnitNotice}</p>

              {hasThirdUnit ? (
                <div className="field-label mt-2">
                  <label htmlFor={`${formId}-packaging.thirdUnit.name`}>
                    <span>{copy.packaging.thirdUnitName} *</span>
                  </label>
                  <input
                    id={`${formId}-packaging.thirdUnit.name`}
                    aria-describedby={
                      fieldErrors["packaging.thirdUnit.name"]
                        ? `${formId}-packaging.thirdUnit.name-error`
                        : undefined
                    }
                    aria-invalid={Boolean(
                      fieldErrors["packaging.thirdUnit.name"],
                    )}
                    data-field-key="packaging.thirdUnit.name"
                    maxLength={40}
                    name="packaging.thirdUnit.name"
                    placeholder={copy.packaging.thirdUnitNamePlaceholder}
                    type="text"
                    value={thirdUnitName}
                    onChange={(e) => setThirdUnitName(e.target.value)}
                  />
                  {fieldErrors["packaging.thirdUnit.name"] ? (
                    <p
                      id={`${formId}-packaging.thirdUnit.name-error`}
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors["packaging.thirdUnit.name"]}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Interface Default Units */}
            <div className="space-y-3 pt-2 border-t border-[color:var(--border)]">
              <div>
                <h3 className="font-bold text-sm text-[color:var(--card-foreground)]">
                  {copy.packaging.defaultUnitsTitle}
                </h3>
                <p className="field-note">
                  {copy.packaging.defaultUnitsDescription}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Count Default */}
                <div className="field-label">
                  <label htmlFor={`${formId}-packaging.defaultUnits.count`}>
                    <span>{copy.packaging.countDefault}</span>
                  </label>
                  <select
                    id={`${formId}-packaging.defaultUnits.count`}
                    aria-describedby={
                      fieldErrors["packaging.defaultUnits.count"]
                        ? `${formId}-packaging.defaultUnits.count-error`
                        : undefined
                    }
                    aria-invalid={Boolean(
                      fieldErrors["packaging.defaultUnits.count"],
                    )}
                    data-field-key="packaging.defaultUnits.count"
                    name="packaging.defaultUnits.count"
                    value={
                      defaultUnits.count.kind === "inventory-unit"
                        ? "__inventory_unit__"
                        : defaultUnits.count.packageUnitName
                    }
                    onChange={(e) =>
                      handleDefaultUnitChange("count", e.target.value)
                    }
                  >
                    <option value="__inventory_unit__">
                      {inventoryUnitName.trim() ||
                        copy.packaging.inventoryUnitName}
                    </option>
                    {packageUnits
                      .filter((u) => u.name.trim().length > 0)
                      .map((u) => (
                        <option key={u.id} value={u.name.trim()}>
                          {u.name.trim()} ({u.baseUnitsPerPackage || "?"}{" "}
                          {inventoryUnitName.trim() ||
                            copy.packaging.inventoryUnitName}
                          )
                        </option>
                      ))}
                  </select>
                  {fieldErrors["packaging.defaultUnits.count"] ? (
                    <p
                      id={`${formId}-packaging.defaultUnits.count-error`}
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors["packaging.defaultUnits.count"]}
                    </p>
                  ) : null}
                </div>

                {/* Purchase Default */}
                <div className="field-label">
                  <label htmlFor={`${formId}-packaging.defaultUnits.purchase`}>
                    <span>{copy.packaging.purchaseDefault}</span>
                  </label>
                  <select
                    id={`${formId}-packaging.defaultUnits.purchase`}
                    aria-describedby={
                      fieldErrors["packaging.defaultUnits.purchase"]
                        ? `${formId}-packaging.defaultUnits.purchase-error`
                        : undefined
                    }
                    aria-invalid={Boolean(
                      fieldErrors["packaging.defaultUnits.purchase"],
                    )}
                    data-field-key="packaging.defaultUnits.purchase"
                    name="packaging.defaultUnits.purchase"
                    value={
                      defaultUnits.purchase.kind === "inventory-unit"
                        ? "__inventory_unit__"
                        : defaultUnits.purchase.packageUnitName
                    }
                    onChange={(e) =>
                      handleDefaultUnitChange("purchase", e.target.value)
                    }
                  >
                    <option value="__inventory_unit__">
                      {inventoryUnitName.trim() ||
                        copy.packaging.inventoryUnitName}
                    </option>
                    {packageUnits
                      .filter((u) => u.name.trim().length > 0)
                      .map((u) => (
                        <option key={u.id} value={u.name.trim()}>
                          {u.name.trim()} ({u.baseUnitsPerPackage || "?"}{" "}
                          {inventoryUnitName.trim() ||
                            copy.packaging.inventoryUnitName}
                          )
                        </option>
                      ))}
                  </select>
                  {fieldErrors["packaging.defaultUnits.purchase"] ? (
                    <p
                      id={`${formId}-packaging.defaultUnits.purchase-error`}
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors["packaging.defaultUnits.purchase"]}
                    </p>
                  ) : null}
                </div>

                {/* Sale Default */}
                <div className="field-label">
                  <label htmlFor={`${formId}-packaging.defaultUnits.sale`}>
                    <span>{copy.packaging.saleDefault}</span>
                  </label>
                  <select
                    id={`${formId}-packaging.defaultUnits.sale`}
                    aria-describedby={
                      fieldErrors["packaging.defaultUnits.sale"]
                        ? `${formId}-packaging.defaultUnits.sale-error`
                        : undefined
                    }
                    aria-invalid={Boolean(
                      fieldErrors["packaging.defaultUnits.sale"],
                    )}
                    data-field-key="packaging.defaultUnits.sale"
                    name="packaging.defaultUnits.sale"
                    value={
                      defaultUnits.sale.kind === "inventory-unit"
                        ? "__inventory_unit__"
                        : defaultUnits.sale.packageUnitName
                    }
                    onChange={(e) =>
                      handleDefaultUnitChange("sale", e.target.value)
                    }
                  >
                    <option value="__inventory_unit__">
                      {inventoryUnitName.trim() ||
                        copy.packaging.inventoryUnitName}
                    </option>
                    {packageUnits
                      .filter((u) => u.name.trim().length > 0)
                      .map((u) => (
                        <option key={u.id} value={u.name.trim()}>
                          {u.name.trim()} ({u.baseUnitsPerPackage || "?"}{" "}
                          {inventoryUnitName.trim() ||
                            copy.packaging.inventoryUnitName}
                          )
                        </option>
                      ))}
                  </select>
                  {fieldErrors["packaging.defaultUnits.sale"] ? (
                    <p
                      id={`${formId}-packaging.defaultUnits.sale-error`}
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors["packaging.defaultUnits.sale"]}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </fieldset>

          {/* 8. Pricing & Commercial Terms */}
          <fieldset className="border border-[color:var(--border)] p-3 rounded-lg space-y-4">
            <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
              {copy.pricing.title}
            </legend>
            <p className="field-note">{copy.pricing.description}</p>

            {/* Pricing Method Selector */}
            <div className="field-label">
              <label htmlFor={`${formId}-pricing.method`}>
                <span>{copy.pricing.methodLabel}</span>
              </label>
              <select
                id={`${formId}-pricing.method`}
                data-field-key="pricing.method"
                name="pricing.method"
                value={pricingMethod}
                onChange={(e) =>
                  setPricingMethod(e.target.value as ProductPricingMethod)
                }
              >
                {PRODUCT_PRICING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {copy.pricing.methods[m]}
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic Mode Fields using PRODUCT_PRICING_FIELD_EDITABILITY */}
            {!isMarginPercentageAvailable ? (
              /* By Price Mode */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="field-label">
                  <label htmlFor={`${formId}-pricing.retailPriceFils`}>
                    <span>{copy.pricing.retailPriceFils} *</span>
                  </label>
                  <input
                    id={`${formId}-pricing.retailPriceFils`}
                    aria-describedby={
                      fieldErrors["pricing.retailPriceFils"]
                        ? `${formId}-pricing.retailPriceFils-error`
                        : undefined
                    }
                    aria-invalid={Boolean(
                      fieldErrors["pricing.retailPriceFils"],
                    )}
                    aria-required="true"
                    data-field-key="pricing.retailPriceFils"
                    inputMode="numeric"
                    maxLength={19}
                    name="pricing.retailPriceFils"
                    placeholder={copy.pricing.retailPricePlaceholder}
                    required
                    type="text"
                    value={retailPriceFils}
                    onChange={(e) => setRetailPriceFils(e.target.value)}
                  />
                  {fieldErrors["pricing.retailPriceFils"] ? (
                    <p
                      id={`${formId}-pricing.retailPriceFils-error`}
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors["pricing.retailPriceFils"]}
                    </p>
                  ) : null}
                </div>

                <div className="field-label">
                  <label htmlFor={`${formId}-pricing.wholesalePriceFils`}>
                    <span>{copy.pricing.wholesalePriceFils}</span>
                  </label>
                  <input
                    id={`${formId}-pricing.wholesalePriceFils`}
                    aria-describedby={
                      fieldErrors["pricing.wholesalePriceFils"]
                        ? `${formId}-pricing.wholesalePriceFils-error`
                        : undefined
                    }
                    aria-invalid={Boolean(
                      fieldErrors["pricing.wholesalePriceFils"],
                    )}
                    data-field-key="pricing.wholesalePriceFils"
                    inputMode="numeric"
                    maxLength={19}
                    name="pricing.wholesalePriceFils"
                    placeholder={copy.pricing.wholesalePricePlaceholder}
                    type="text"
                    value={wholesalePriceFils}
                    onChange={(e) => setWholesalePriceFils(e.target.value)}
                  />
                  {fieldErrors["pricing.wholesalePriceFils"] ? (
                    <p
                      id={`${formId}-pricing.wholesalePriceFils-error`}
                      className="field-error"
                      role="alert"
                    >
                      {fieldErrors["pricing.wholesalePriceFils"]}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              /* By Percentage Mode */
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Transient Cost */}
                  <div className="field-label">
                    <label htmlFor={`${formId}-pricing.costFils`}>
                      <span>{copy.pricing.costFils} *</span>
                    </label>
                    <input
                      id={`${formId}-pricing.costFils`}
                      aria-describedby={
                        fieldErrors["pricing.costFils"]
                          ? `${formId}-pricing.costFils-error`
                          : undefined
                      }
                      aria-invalid={Boolean(fieldErrors["pricing.costFils"])}
                      aria-required="true"
                      data-field-key="pricing.costFils"
                      inputMode="numeric"
                      maxLength={19}
                      name="pricing.costFils"
                      placeholder={copy.pricing.costFilsPlaceholder}
                      required
                      type="text"
                      value={costFils}
                      onChange={(e) => setCostFils(e.target.value)}
                    />
                    <span className="field-note">
                      {copy.pricing.costFilsHelp}
                    </span>
                    {fieldErrors["pricing.costFils"] ? (
                      <p
                        id={`${formId}-pricing.costFils-error`}
                        className="field-error"
                        role="alert"
                      >
                        {fieldErrors["pricing.costFils"]}
                      </p>
                    ) : null}
                  </div>

                  {/* Margin Percentage */}
                  <div className="field-label">
                    <label htmlFor={`${formId}-pricing.marginPercentage`}>
                      <span>{copy.pricing.marginPercentage} *</span>
                    </label>
                    <input
                      id={`${formId}-pricing.marginPercentage`}
                      aria-describedby={
                        fieldErrors["pricing.marginPercentage"]
                          ? `${formId}-pricing.marginPercentage-error`
                          : undefined
                      }
                      aria-invalid={Boolean(
                        fieldErrors["pricing.marginPercentage"],
                      )}
                      aria-required="true"
                      data-field-key="pricing.marginPercentage"
                      maxLength={10}
                      name="pricing.marginPercentage"
                      placeholder={copy.pricing.marginPercentagePlaceholder}
                      required
                      type="text"
                      value={marginPercentage}
                      onChange={(e) => setMarginPercentage(e.target.value)}
                    />
                    <span className="field-note">
                      {copy.pricing.marginPercentageHelp}
                    </span>
                    {fieldErrors["pricing.marginPercentage"] ? (
                      <p
                        id={`${formId}-pricing.marginPercentage-error`}
                        className="field-error"
                        role="alert"
                      >
                        {fieldErrors["pricing.marginPercentage"]}
                      </p>
                    ) : null}
                  </div>

                  {/* Rounding Step */}
                  <div className="field-label">
                    <label htmlFor={`${formId}-pricing.rounding`}>
                      <span>{copy.pricing.rounding}</span>
                    </label>
                    <select
                      id={`${formId}-pricing.rounding`}
                      data-field-key="pricing.rounding"
                      name="pricing.rounding"
                      value={rounding}
                      onChange={(e) =>
                        setRounding(e.target.value as PriceRoundingSetting)
                      }
                    >
                      {PRICE_ROUNDING_SETTINGS.map((r) => (
                        <option key={r} value={r}>
                          {copy.pricing.roundings[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Locked Retail Price (calculated by server) */}
                  <div className="field-label">
                    <label htmlFor={`${formId}-pricing.retailPrice-locked`}>
                      <span>{copy.pricing.retailPriceCalculatedPreview}</span>
                    </label>
                    <input
                      id={`${formId}-pricing.retailPrice-locked`}
                      aria-readonly={isRetailPriceLocked}
                      className="opacity-70 cursor-not-allowed bg-muted font-mono"
                      readOnly={isRetailPriceLocked}
                      type="text"
                      value={
                        initialProduct?.pricing.method === "by-percentage"
                          ? formatFilsToIqd(
                              initialProduct.pricing.retailPriceFils,
                              locale,
                            )
                          : copy.pricing.retailPricePendingCalculation
                      }
                    />
                    <span className="field-note">
                      {copy.pricing.retailPriceLockedNotice}
                    </span>
                  </div>

                  {/* Optional Wholesale Price */}
                  <div className="field-label">
                    <label htmlFor={`${formId}-pricing.wholesalePriceFils`}>
                      <span>{copy.pricing.wholesalePriceFils}</span>
                    </label>
                    <input
                      id={`${formId}-pricing.wholesalePriceFils`}
                      aria-describedby={
                        fieldErrors["pricing.wholesalePriceFils"]
                          ? `${formId}-pricing.wholesalePriceFils-error`
                          : undefined
                      }
                      aria-invalid={Boolean(
                        fieldErrors["pricing.wholesalePriceFils"],
                      )}
                      data-field-key="pricing.wholesalePriceFils"
                      inputMode="numeric"
                      maxLength={19}
                      name="pricing.wholesalePriceFils"
                      placeholder={copy.pricing.wholesalePricePlaceholder}
                      type="text"
                      value={wholesalePriceFils}
                      onChange={(e) => setWholesalePriceFils(e.target.value)}
                    />
                    {fieldErrors["pricing.wholesalePriceFils"] ? (
                      <p
                        id={`${formId}-pricing.wholesalePriceFils-error`}
                        className="field-error"
                        role="alert"
                      >
                        {fieldErrors["pricing.wholesalePriceFils"]}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* Wholesale Open Decision Notice */}
            <div className="pt-2 border-t border-[color:var(--border)]">
              <p
                className="text-xs text-muted-foreground flex items-center gap-1.5"
                data-testid="pricing-wholesale-notice"
              >
                <span className="font-semibold">ⓘ</span>
                <span>{copy.pricing.wholesalePriceNotice}</span>
              </p>
            </div>
          </fieldset>

          {/* 9. Item Instructions */}
          <fieldset className="border border-[color:var(--border)] p-3 rounded-lg">
            <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
              {copy.instructions.title}
            </legend>
            <p className="field-note mb-3">{copy.instructions.description}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="field-label">
                <label htmlFor={`${formId}-usesPerDay`}>
                  <span>{copy.instructions.usesPerDay}</span>
                </label>
                <input
                  id={`${formId}-usesPerDay`}
                  max={99}
                  min={1}
                  name="usesPerDay"
                  type="number"
                  value={instructions.usesPerDay}
                  onChange={(e) =>
                    setInstructions((prev) => ({
                      ...prev,
                      usesPerDay: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-usesPerWeek`}>
                  <span>{copy.instructions.usesPerWeek}</span>
                </label>
                <input
                  id={`${formId}-usesPerWeek`}
                  max={99}
                  min={1}
                  name="usesPerWeek"
                  type="number"
                  value={instructions.usesPerWeek}
                  onChange={(e) =>
                    setInstructions((prev) => ({
                      ...prev,
                      usesPerWeek: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="field-label">
                <label htmlFor={`${formId}-usesPerMonth`}>
                  <span>{copy.instructions.usesPerMonth}</span>
                </label>
                <input
                  id={`${formId}-usesPerMonth`}
                  max={99}
                  min={1}
                  name="usesPerMonth"
                  type="number"
                  value={instructions.usesPerMonth}
                  onChange={(e) =>
                    setInstructions((prev) => ({
                      ...prev,
                      usesPerMonth: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="field-label">
              <label htmlFor={`${formId}-foodTiming`}>
                <span>{copy.instructions.foodTiming}</span>
              </label>
              <select
                id={`${formId}-foodTiming`}
                name="foodTiming"
                value={instructions.foodTiming}
                onChange={(e) =>
                  setInstructions((prev) => ({
                    ...prev,
                    foodTiming: e.target.value as ProductFoodTiming | "",
                  }))
                }
              >
                <option value="">{copy.instructions.foodTimingNone}</option>
                {PRODUCT_FOOD_TIMINGS.map((ft) => (
                  <option key={ft} value={ft}>
                    {copy.instructions.foodTimings[ft]}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          {/* 8. Sharing & AI Visibility Metadata */}
          <fieldset className="border border-[color:var(--border)] p-3 rounded-lg">
            <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
              {copy.sharing.title}
            </legend>
            <p className="field-note mb-3">{copy.sharing.metadataNotice}</p>

            <div className="space-y-2">
              <label className="check-row flex items-center gap-2 cursor-pointer">
                <input
                  checked={sharing.externallyVisible}
                  name="externallyVisible"
                  type="checkbox"
                  onChange={(e) =>
                    setSharing((prev) => ({
                      ...prev,
                      externallyVisible: e.target.checked,
                    }))
                  }
                />
                <span>{copy.sharing.externallyVisible}</span>
              </label>

              <label className="check-row flex items-center gap-2 cursor-pointer">
                <input
                  checked={sharing.aiSharingAllowed}
                  name="aiSharingAllowed"
                  type="checkbox"
                  onChange={(e) =>
                    setSharing((prev) => ({
                      ...prev,
                      aiSharingAllowed: e.target.checked,
                    }))
                  }
                />
                <span>{copy.sharing.aiSharingAllowed}</span>
              </label>
            </div>
          </fieldset>

          {/* 9. State Indicators */}
          <fieldset className="border border-[color:var(--border)] p-3 rounded-lg">
            <legend className="px-2 font-bold text-xs uppercase tracking-widest text-[color:var(--primary)]">
              {copy.stateColours.title}
            </legend>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="field-label">
                <label htmlFor={`${formId}-manualColor`}>
                  <span>{copy.stateColours.manualColor}</span>
                </label>
                <select
                  id={`${formId}-manualColor`}
                  name="manualColor"
                  value={stateColours.manual}
                  onChange={(e) =>
                    setStateColours((prev) => ({
                      ...prev,
                      manual: e.target.value as ProductStateColour | "",
                    }))
                  }
                >
                  <option value="">{copy.stateColours.manualColorNone}</option>
                  {PRODUCT_STATE_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {copy.stateColours.colors[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center pt-6">
                <label className="check-row flex items-center gap-2 cursor-pointer">
                  <input
                    checked={stateColours.coldStorageRequired}
                    name="coldStorageRequired"
                    type="checkbox"
                    onChange={(e) =>
                      setStateColours((prev) => ({
                        ...prev,
                        coldStorageRequired: e.target.checked,
                      }))
                    }
                  />
                  <span>{copy.stateColours.coldStorageRequired}</span>
                </label>
              </div>
            </div>
          </fieldset>

          {/* Form Actions */}
          <div className="form-actions flex justify-end gap-3 pt-4 border-t border-[color:var(--border)]">
            {onCancel ? (
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={onCancel}
              >
                {copy.actions.cancel}
              </button>
            ) : null}
            <button className="primary-button" disabled={busy} type="submit">
              {busy
                ? "..."
                : isEditing
                  ? copy.actions.saveChanges
                  : copy.actions.create}
            </button>
          </div>
        </form>
      </article>
    </div>
  );
}
