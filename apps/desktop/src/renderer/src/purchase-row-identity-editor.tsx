import { unitDisplayName } from "../../shared/unit-display";
import { formatNumber } from "./preferences";
import { useEffect, useRef, useState } from "react";
import type { Product, PurchaseDraftDetail } from "@breev/contracts/local-rest";
import { requestProduct, searchProducts } from "./catalog-api";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";

type Row = PurchaseDraftDetail["rows"][number];

// An explicit correction in the existing optional-controls surface. The saved
// row stays intact until the parent submits one versioned server command.
export function PurchaseRowIdentityEditor({
  baseUrl,
  row,
  unit,
  onChange,
}: {
  readonly baseUrl: string;
  readonly row: Row;
  readonly unit: Row["unit"];
  readonly onChange: (product: Product, unit: Row["unit"]) => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const [product, setProduct] = useState<Product | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [error, setError] = useState(false);
  const pickedProduct = useRef(false);

  useEffect(() => {
    let live = true;
    void requestProduct(baseUrl, row.itemId)
      .then((value) => {
        if (live && !pickedProduct.current) setProduct(value);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [baseUrl, row.itemId]);

  useEffect(() => {
    let live = true;
    setResults([]);
    if (query.trim() === "") return;
    const timer = setTimeout(() => {
      void searchProducts(baseUrl, { query: query.trim(), limit: "10" })
        .then((response) => {
          if (live) {
            setResults(response.results.map((result) => result.product));
            setError(false);
          }
        })
        .catch(() => {
          if (live) setError(true);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [baseUrl, query]);

  return (
    <>
      <label className="purchase-optional-notes-field">
        <span className="purchase-optional-label-text">
          {copy.correctRowProduct}
        </span>
        <input
          type="search"
          aria-label={copy.correctRowProduct}
          value={query}
          maxLength={160}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {results.length > 0 ? (
        <ul className="purchase-optional-notes-field">
          {results.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  pickedProduct.current = true;
                  setProduct(candidate);
                  setQuery("");
                  setResults([]);
                  onChange(
                    candidate,
                    candidate.packaging.defaultUnits.purchase,
                  );
                }}
              >
                {candidate.displayName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="purchase-optional-notes-field" role="status">
        {product?.displayName ?? row.itemDisplayName}
      </p>
      {error ? (
        <p role="alert" className="purchase-optional-notes-field">
          {copy.apiUnavailable}
        </p>
      ) : null}
      <label>
        <span className="purchase-optional-label-text">{copy.rowUnit}</span>
        <select
          aria-label={copy.rowUnit}
          disabled={product === null}
          value={
            unit.kind === "inventory-unit"
              ? "inventory-unit"
              : `package:${unit.packageUnitName}`
          }
          onChange={(event) => {
            if (product === null) return;
            onChange(
              product,
              event.target.value === "inventory-unit"
                ? { kind: "inventory-unit" }
                : {
                    kind: "package-unit",
                    packageUnitName: event.target.value.slice(8),
                  },
            );
          }}
        >
          <option value="inventory-unit">
            {unitDisplayName(
              product?.packaging.inventoryUnitName ?? row.inventoryUnitName,
              locale,
            )}
          </option>
          {product?.packaging.packageUnits.map((entry) => (
            <option key={entry.name} value={`package:${entry.name}`}>
              {unitDisplayName(entry.name, locale)} (
              {formatNumber(entry.baseUnitsPerPackage, locale)}{" "}
              {unitDisplayName(product.packaging.inventoryUnitName, locale)})
            </option>
          ))}
        </select>
      </label>
      <p className="purchase-optional-notes-field">
        {copy.rowIdentityCorrectionHint}
      </p>
    </>
  );
}
