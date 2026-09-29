import type { CatalogSupplierOption } from "@breev/contracts/local-rest";
import { useCallback, useEffect, useId, useState } from "react";

import { requestCatalogSupplierOptions } from "./catalog-api";
import { catalogMessages } from "./catalog-messages";
import { useIdentityState } from "./identity-state-provider";
import { usePreferences } from "./preferences-provider";

type LoadState = "idle" | "loading" | "loaded" | "error";

export function ProductSupplierLinks({
  baseUrl,
  editable,
  onChange,
  supplierIds,
}: {
  readonly baseUrl: string;
  readonly editable: boolean;
  readonly onChange?: (supplierIds: string[]) => void;
  readonly supplierIds: readonly string[];
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const { state: identityState } = useIdentityState();
  const copy = catalogMessages[locale].suppliers;
  const selectId = useId();
  const [options, setOptions] = useState<readonly CatalogSupplierOption[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");

  const canManageCatalog =
    identityState?.state === "authenticated" &&
    identityState.allowedPermissions.includes("catalog.item.manage");

  const loadOptions = useCallback(async (): Promise<void> => {
    setLoadState("loading");
    try {
      const response = await requestCatalogSupplierOptions(baseUrl);
      setOptions(response.suppliers);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  }, [baseUrl]);

  useEffect(() => {
    if (canManageCatalog) void loadOptions();
  }, [canManageCatalog, loadOptions]);

  if (!canManageCatalog) return null;

  const optionById = new Map(options.map((option) => [option.id, option]));
  const activeCandidates = options
    .filter(
      (option) =>
        option.status === "active" && !supplierIds.includes(option.id),
    )
    .sort((left, right) => left.name.localeCompare(right.name, locale));

  const addSupplier = (): void => {
    if (
      !candidateId ||
      !activeCandidates.some((option) => option.id === candidateId) ||
      !onChange
    ) {
      return;
    }
    onChange([...supplierIds, candidateId]);
    setCandidateId("");
  };

  const removeSupplier = (supplierId: string): void => {
    if (!onChange || loadState !== "loaded") return;
    onChange(supplierIds.filter((id) => id !== supplierId));
  };

  return (
    <section
      aria-labelledby={`${selectId}-heading`}
      className="catalog-supplier-panel"
      data-field-key="supplierIds"
      tabIndex={-1}
    >
      <div className="catalog-supplier-heading">
        <div>
          <h3 id={`${selectId}-heading`}>{copy.title}</h3>
          <p>{copy.referenceOnly}</p>
        </div>
        {!editable ? <span>{copy.readOnly}</span> : null}
      </div>

      {loadState === "loading" || loadState === "idle" ? (
        <p className="field-note" role="status">
          {copy.loading}
        </p>
      ) : loadState === "error" ? (
        <div className="catalog-supplier-error" role="alert">
          <p>{copy.loadFailed}</p>
          <button
            className="quiet-button"
            type="button"
            onClick={() => void loadOptions()}
          >
            {copy.retry}
          </button>
        </div>
      ) : null}

      {supplierIds.length === 0 ? (
        <p className="field-note" role="status">
          {copy.empty}
        </p>
      ) : (
        <ul className="catalog-supplier-list">
          {supplierIds.map((supplierId) => {
            const supplier = optionById.get(supplierId);
            const name = supplier?.name ?? supplierId;
            return (
              <li key={supplierId}>
                <span className="catalog-supplier-name">{name}</span>
                {supplier ? (
                  <span className="catalog-supplier-status">
                    {copy.status[supplier.status]}
                  </span>
                ) : null}
                {editable && loadState === "loaded" ? (
                  <button
                    aria-label={`${copy.remove} ${name}`}
                    className="quiet-button catalog-supplier-remove"
                    type="button"
                    onClick={() => removeSupplier(supplierId)}
                  >
                    {copy.remove}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editable && loadState === "loaded" && activeCandidates.length > 0 ? (
        <div className="catalog-supplier-add">
          <label className="field-label" htmlFor={selectId}>
            {copy.add}
          </label>
          <select
            id={selectId}
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
          >
            <option value="">{copy.add}</option>
            {activeCandidates.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <button
            className="quiet-button"
            disabled={!candidateId}
            type="button"
            onClick={addSupplier}
          >
            {copy.add}
          </button>
        </div>
      ) : null}
      {editable && loadState === "loaded" && activeCandidates.length === 0 ? (
        <p className="field-note" role="status">
          {copy.noActiveOptions}
        </p>
      ) : null}
    </section>
  );
}
