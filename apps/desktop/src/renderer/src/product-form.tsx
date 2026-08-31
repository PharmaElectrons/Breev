import {
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  PRODUCT_DEFINITION_MODES,
  PRODUCT_NAME_TEMPLATES,
  composeDisplayName,
  PRODUCT_FOOD_TIMINGS,
  PRODUCT_STATE_COLORS,
  type CatalogFieldError,
  type GeneralItemNameFields,
  type MedicationNameFields,
  type Product,
  type ProductCreateRequest,
  type ProductDefinitionMode,
  type ProductEditRequest,
  type ProductFoodTiming,
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

  const [barcodes, setBarcodes] = useState<string[]>(
    initialProduct?.barcodes ?? [],
  );
  const [newBarcode, setNewBarcode] = useState("");

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
    if (trimmed.length > 0 && !barcodes.includes(trimmed)) {
      setBarcodes([...barcodes, trimmed]);
      setNewBarcode("");
    }
  };

  const handleRemoveBarcode = (index: number): void => {
    setBarcodes(barcodes.filter((_, i) => i !== index));
  };

  const mapFieldErrors = useCallback(
    (serverErrors: readonly CatalogFieldError[]): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const err of serverErrors) {
        const lastPathSegment = err.path[err.path.length - 1];
        const key =
          typeof lastPathSegment === "string"
            ? lastPathSegment
            : err.path.join(".");
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
    const firstKey = keys[0];
    const element =
      document.querySelector<HTMLElement>(`[name="${firstKey}"]`) ||
      document.getElementById(`${formId}-${firstKey}`);
    if (element) {
      element.focus();
    } else {
      errorSummaryRef.current?.focus();
    }
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

      <article className="identity-card p-6 max-w-4xl w-full mx-auto">
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
            <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-[var(--border)] p-4 rounded-xl">
              <legend className="px-2 font-bold text-sm">
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
                    role="alert"
                  >
                    {fieldErrors.manufacturer}
                  </p>
                ) : null}
              </div>
            </fieldset>
          ) : (
            <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-[var(--border)] p-4 rounded-xl">
              <legend className="px-2 font-bold text-sm">
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
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
                    className="text-red-500 text-xs font-semibold mt-1"
                    role="alert"
                  >
                    {fieldErrors.size}
                  </p>
                ) : null}
              </div>
            </fieldset>
          )}

          {/* 3. Generated English Display Name - Output element (never an input) */}
          <div className="field-label p-4 rounded-xl border border-[var(--border)]">
            <span className="font-bold text-sm">
              {copy.fields.generatedDisplayName}
            </span>
            <span className="text-xs text-muted-foreground">
              {copy.fields.generatedDisplayNameHint}
            </span>
            <output
              aria-live="polite"
              className="block p-3 mt-1 border border-[var(--border)] rounded-lg font-mono text-base font-semibold min-h-[2.8rem] flex items-center"
              data-testid="generated-display-name"
              name="generatedDisplayName"
            >
              {generatedDisplayName || (
                <span className="text-muted-foreground font-normal italic">
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
            <span className="text-xs text-muted-foreground">
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
                className="text-red-500 text-xs font-semibold mt-1"
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
                  className="text-red-500 text-xs font-semibold mt-1"
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
                  className="text-red-500 text-xs font-semibold mt-1"
                  role="alert"
                >
                  {fieldErrors.category}
                </p>
              ) : null}
            </div>
          </div>

          {/* 6. Barcodes Storage */}
          <fieldset className="border border-[var(--border)] p-4 rounded-xl">
            <legend className="px-2 font-bold text-sm">
              {copy.barcodes.label}
            </legend>
            <div className="flex gap-2 mb-3">
              <input
                aria-label={copy.barcodes.label}
                className="flex-1 min-h-[2.8rem] px-3 border border-[var(--border)] rounded-lg bg-background"
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
              <p className="text-sm text-muted-foreground italic">
                {copy.barcodes.empty}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                {barcodes.map((bc, idx) => (
                  <li
                    key={bc}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] font-mono text-sm"
                  >
                    <span>{bc}</span>
                    <button
                      aria-label={`${copy.barcodes.remove} ${bc}`}
                      className="text-red-500 hover:text-red-700 font-bold px-1"
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

          {/* 7. Item Instructions */}
          <fieldset className="border border-[var(--border)] p-4 rounded-xl">
            <legend className="px-2 font-bold text-sm">
              {copy.instructions.title}
            </legend>
            <p className="text-xs text-muted-foreground mb-3">
              {copy.instructions.description}
            </p>

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
          <fieldset className="border border-[var(--border)] p-4 rounded-xl">
            <legend className="px-2 font-bold text-sm">
              {copy.sharing.title}
            </legend>
            <p className="text-xs text-muted-foreground mb-3">
              {copy.sharing.metadataNotice}
            </p>

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
          <fieldset className="border border-[var(--border)] p-4 rounded-xl">
            <legend className="px-2 font-bold text-sm">
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
          <div className="form-actions flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
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
