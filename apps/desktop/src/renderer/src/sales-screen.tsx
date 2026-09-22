import type {
  IdentityDenial,
  InventoryDenial,
  LicensingDenial,
  ProductSearchResponse,
  SaleDraft,
  SalesDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";

import { basketMessages } from "./basket-messages";
import { searchProducts } from "./catalog-api";
import { useCommittedFocus } from "./committed-focus";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { useIdentityState } from "./identity-state-provider";
import {
  addReorderItem,
  InventoryApiDenied,
  inventoryCommandAttempt,
  type InventoryCommandAttempt,
} from "./inventory-api";
import { formatDateTime, formatNumber } from "./preferences";
import { usePreferences } from "./preferences-provider";
import {
  createSaleDraft,
  newSalesIdempotencyKey,
  readSaleDraft,
  readSaleDrafts,
  resumeSaleDraft,
  SalesApiDenied,
} from "./sales-api";
import { salesMessages, type SalesCopy } from "./sales-messages";

type AnyDenial =
  IdentityDenial | InventoryDenial | LicensingDenial | SalesDenial;

export type SalesRoute =
  | { readonly draftId: string; readonly kind: "draft" }
  | { readonly kind: "index" };

/**
 * `#/sales` lists the open drafts; `#/sales/drafts/<id>` is one draft.
 *
 * The draft id is the only path part this slice reads. #31 adds the rest of
 * the sale to the same route rather than a new one.
 */
export function salesRoute(hash: string): SalesRoute {
  const withoutMarker = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = /^\/sales\/drafts\/([^/]+)\/?$/u.exec(withoutMarker);
  return match?.[1] === undefined
    ? { kind: "index" }
    : { draftId: match[1], kind: "draft" };
}

export function SalesRouteView({
  baseUrl,
  hash,
}: {
  readonly baseUrl: string;
  readonly hash: string;
}): React.JSX.Element {
  const { state: identity } = useIdentityState();
  const authenticated = identity?.state === "authenticated";
  const canManageDrafts =
    authenticated &&
    identity.allowedPermissions.includes("sales.drafts.manage");
  const canSearch =
    authenticated &&
    identity.allowedPermissions.includes("catalog.item.search");
  const canAddToBasket =
    authenticated &&
    identity.allowedPermissions.includes("inventory.reorder.manage");
  const route = salesRoute(hash);
  const { locale } = usePreferences();
  const copy = salesMessages[locale];

  if (!canManageDrafts) {
    // Hiding the tab is a convenience; a deep link still reaches this view and
    // the local API still authorizes every request it would make.
    return (
      <section className="sales-screen" aria-labelledby="sales-title">
        <h2 id="sales-title">{copy.title}</h2>
        <p className="denial-alert" role="status" aria-live="polite">
          {copy.permissionDenied}
        </p>
      </section>
    );
  }

  return route.kind === "draft" ? (
    <SaleDraftScreen
      baseUrl={baseUrl}
      canAddToBasket={canAddToBasket}
      canSearch={canSearch}
      draftId={route.draftId}
    />
  ) : (
    <SaleDraftIndex baseUrl={baseUrl} />
  );
}

function SaleDraftIndex({
  baseUrl,
}: {
  readonly baseUrl: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = salesMessages[locale];
  const commitFocus = useCommittedFocus();
  const [drafts, setDrafts] = useState<readonly SaleDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<AnyDenial | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setDenial(null);
    try {
      const response = await readSaleDrafts(baseUrl, { status: "active" });
      setDrafts(response.drafts);
      commitFocus(() =>
        document.querySelector<HTMLElement>(
          response.drafts.length === 1
            ? '[data-sale-draft-control="resume"]'
            : '[data-sale-draft-control="new"]',
        ),
      );
    } catch (caught) {
      setDrafts([]);
      recordFailure(caught, copy, setDenial, setError);
    }
  }, [baseUrl, commitFocus, copy]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDraft(): Promise<void> {
    setBusy(true);
    setError(null);
    setDenial(null);
    try {
      const draft = await createSaleDraft(baseUrl, {
        idempotencyKey: newSalesIdempotencyKey(),
      });
      window.location.hash = `#/sales/drafts/${draft.id}`;
    } catch (caught) {
      recordFailure(caught, copy, setDenial, setError);
    } finally {
      setBusy(false);
    }
  }

  async function resume(draft: SaleDraft): Promise<void> {
    setBusy(true);
    setError(null);
    setDenial(null);
    try {
      await resumeSaleDraft(baseUrl, draft.id, {
        expectedVersion: draft.version,
        idempotencyKey: newSalesIdempotencyKey(),
      });
      window.location.hash = `#/sales/drafts/${draft.id}`;
    } catch (caught) {
      recordFailure(caught, copy, setDenial, setError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sales-screen" aria-labelledby="sales-title">
      <header className="sales-header">
        <h2 id="sales-title">{copy.title}</h2>
        <p className="sales-description">{copy.description}</p>
      </header>

      <div className="sales-actions" data-tour="sales-new-draft">
        <button
          data-sale-draft-control="new"
          disabled={busy}
          type="button"
          onClick={() => {
            void openDraft();
          }}
        >
          {copy.newDraft}
        </button>
      </div>

      <StatusRegion denial={denial} error={error} onReload={load} copy={copy} />

      <h3>{copy.draftsHeading}</h3>
      {drafts === null ? (
        <p>{copy.loading}</p>
      ) : drafts.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ul className="sale-draft-list" data-tour="sales-draft-list">
          {drafts.map((draft) => (
            <li className="sale-draft-row" key={draft.id}>
              <span className="sale-draft-facts">
                <span>
                  {copy.draftHeading(
                    formatDateTime(new Date(draft.createdAt), locale),
                  )}
                </span>
                <span className="sale-draft-meta">
                  {copy.openedBy(draft.createdBy.displayName)} ·{" "}
                  {copy.versionLabel(
                    formatNumber(BigInt(draft.version), locale),
                  )}
                </span>
              </span>
              <button
                aria-label={copy.resumeAriaLabel(
                  formatDateTime(new Date(draft.createdAt), locale),
                )}
                data-sale-draft-control="resume"
                disabled={busy}
                type="button"
                onClick={() => {
                  void resume(draft);
                }}
              >
                {copy.resume}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SaleDraftScreen({
  baseUrl,
  canAddToBasket,
  canSearch,
  draftId,
}: {
  readonly baseUrl: string;
  readonly canAddToBasket: boolean;
  readonly canSearch: boolean;
  readonly draftId: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = salesMessages[locale];
  const basketCopy = basketMessages[locale];
  const commitFocus = useCommittedFocus();
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const attemptRef = useRef<InventoryCommandAttempt | null>(null);

  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [basketError, setBasketError] = useState<string | null>(null);
  const [basketDenial, setBasketDenial] = useState<AnyDenial | null>(null);
  const [retryProductId, setRetryProductId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await readSaleDraft(baseUrl, draftId);
        if (cancelled) return;
        setDraft(loaded);
        setDraftError(null);
        // The search field owns focus the moment the draft is actionable.
        commitFocus(() => searchRef.current);
      } catch (caught) {
        if (cancelled) return;
        setDraftError(
          caught instanceof SalesApiDenied
            ? copy.denialMessages[caught.denial.code]
            : copy.draftUnavailable,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, commitFocus, copy, draftId]);

  const performSearch = useCallback(async (): Promise<void> => {
    const normalized = query.trim();
    const sequence = ++requestSequence.current;
    if (normalized.length === 0) {
      setResults(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const response = await searchProducts(baseUrl, {
        limit: "50",
        query: normalized,
      });
      if (sequence !== requestSequence.current) return;
      setResults(response);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setSearchError(
        caught instanceof IdentityApiDenied
          ? copy.searchDenied
          : copy.searchUnavailable,
      );
    } finally {
      if (sequence === requestSequence.current) setSearching(false);
    }
  }, [baseUrl, copy, query]);

  useEffect(() => {
    if (!canSearch) return;
    const timer = window.setTimeout(() => {
      void performSearch();
    }, 100);
    return () => {
      window.clearTimeout(timer);
    };
  }, [canSearch, performSearch]);

  async function addToBasket(productId: string, name: string): Promise<void> {
    if (!canAddToBasket) return;
    const attempt = inventoryCommandAttempt(attemptRef.current, productId);
    attemptRef.current = attempt;
    setBasketError(null);
    setBasketDenial(null);
    setAnnouncement(null);
    try {
      const result = await addReorderItem(baseUrl, {
        idempotencyKey: attempt.idempotencyKey,
        productId,
      });
      // Only a completed add finishes the intent. A failed one keeps the key so
      // the retry below is a retry, never a second basket row.
      attemptRef.current = null;
      setRetryProductId(null);
      const quantity = formatNumber(BigInt(result.item.quantity), locale);
      const unit = result.item.product.inventoryUnitName;
      const displayName = result.item.product.displayName;
      setAnnouncement(
        result.outcome === "already-ordered"
          ? basketCopy.alreadyOrderedAnnouncement(displayName)
          : result.outcome === "updated"
            ? basketCopy.alreadyInBasketAnnouncement(
                displayName,
                quantity,
                unit,
              )
            : basketCopy.addedAnnouncement(displayName, quantity, unit),
      );
    } catch (caught) {
      if (
        caught instanceof InventoryApiDenied ||
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setBasketDenial(caught.denial);
      } else {
        // Unreachable API: keep the query, the rows, and the draft exactly as
        // they are and offer this row's action again.
        setBasketError(basketCopy.reviewUnavailable);
        setRetryProductId(productId);
      }
    } finally {
      commitFocus(() =>
        document.querySelector<HTMLElement>(
          `[data-sale-basket-add="${productId}"]`,
        ),
      );
      void name;
    }
  }

  const inactiveDenial =
    basketDenial !== null &&
    "code" in basketDenial &&
    basketDenial.code === "reorder-product-inactive";

  return (
    <section className="sales-screen" aria-labelledby="sales-draft-title">
      <header className="sales-header">
        <h2 id="sales-draft-title">
          {draft === null
            ? copy.title
            : copy.draftHeading(
                formatDateTime(new Date(draft.createdAt), locale),
              )}
        </h2>
        {draft === null ? null : (
          <p className="sale-draft-meta">
            <span data-sale-draft-id={draft.id}>
              {copy.openedBy(draft.createdBy.displayName)}
            </span>{" "}
            ·{" "}
            <span data-sale-draft-version={draft.version}>
              {copy.versionLabel(formatNumber(BigInt(draft.version), locale))}
            </span>
          </p>
        )}
      </header>

      {draftError === null ? null : (
        <p className="denial-alert" role="status" aria-live="polite">
          {draftError}
        </p>
      )}

      {canSearch ? (
        <div className="sales-search" data-tour="sales-search">
          <label className="sales-search-label" htmlFor="sale-draft-search">
            {copy.searchLabel}
          </label>
          <input
            aria-label={copy.searchLabel}
            dir="auto"
            id="sale-draft-search"
            placeholder={copy.searchPlaceholder}
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
      ) : (
        <p className="denial-alert" role="status" aria-live="polite">
          {copy.searchDenied}
        </p>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {searching
          ? copy.searching
          : results === null
            ? ""
            : copy.searchResultCount(results.resultCount)}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement ?? ""}
      </p>

      {searchError === null ? null : (
        <p className="denial-alert" role="status" aria-live="polite">
          {searchError}
        </p>
      )}

      {basketError === null ? null : (
        <p className="denial-alert" role="status" aria-live="polite">
          {basketError}
          {retryProductId === null ? null : (
            <button
              data-sale-basket-retry={retryProductId}
              type="button"
              onClick={() => {
                void addToBasket(retryProductId, "");
              }}
            >
              {basketCopy.actions.retry}
            </button>
          )}
        </p>
      )}

      {basketDenial === null ? null : (
        <p className="denial-alert" role="status" aria-live="polite">
          {denialText(basketDenial, basketCopy, copy)}
          {inactiveDenial ? (
            <button
              data-sale-search-again
              type="button"
              onClick={() => {
                setBasketDenial(null);
                void performSearch();
              }}
            >
              {copy.searchAgain}
            </button>
          ) : null}
        </p>
      )}

      {results === null ? null : results.results.length === 0 ? (
        <p>{copy.noResults}</p>
      ) : (
        <div className="sales-results" data-tour="sales-results">
          <table className="sales-results-table">
            <caption className="visually-hidden">
              {copy.searchResultCount(results.resultCount)}
            </caption>
            <thead>
              <tr>
                <th scope="col">{copy.itemColumn}</th>
                <th scope="col">{copy.addToBasket}</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((result) => (
                <tr key={result.product.id}>
                  <td>
                    <span className="sale-result-name">
                      {result.product.displayName}
                    </span>
                    {result.product.arabicSearchName === null ? null : (
                      <span className="sale-result-arabic" lang="ar">
                        {result.product.arabicSearchName}
                      </span>
                    )}
                  </td>
                  <td>
                    {canAddToBasket ? (
                      <button
                        aria-label={copy.addToBasketAriaLabel(
                          result.product.displayName,
                        )}
                        data-sale-basket-add={result.product.id}
                        type="button"
                        onClick={() => {
                          void addToBasket(
                            result.product.id,
                            result.product.displayName,
                          );
                        }}
                      >
                        {copy.addToBasket}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusRegion({
  copy,
  denial,
  error,
  onReload,
}: {
  readonly copy: SalesCopy;
  readonly denial: AnyDenial | null;
  readonly error: string | null;
  readonly onReload: () => Promise<void>;
}): React.JSX.Element | null {
  if (denial === null && error === null) return null;
  const message =
    denial === null
      ? error
      : "code" in denial && isSalesDenialCode(denial.code)
        ? copy.denialMessages[denial.code]
        : copy.draftUnavailable;
  return (
    <p className="denial-alert" role="status" aria-live="polite">
      {message}
      <button
        data-sale-draft-control="reload"
        type="button"
        onClick={() => {
          void onReload();
        }}
      >
        {copy.reload}
      </button>
    </p>
  );
}

function isSalesDenialCode(
  code: string,
): code is keyof SalesCopy["denialMessages"] {
  return (
    code === "body-invalid" ||
    code === "idempotency-conflict" ||
    code === "sale-draft-not-found" ||
    code === "version-conflict"
  );
}

function denialText(
  denial: AnyDenial,
  basketCopy: (typeof basketMessages)["en"],
  copy: SalesCopy,
): string {
  if (!("code" in denial)) return copy.draftUnavailable;
  const code = denial.code;
  if (code in basketCopy.denialMessages) {
    return basketCopy.denialMessages[
      code as keyof typeof basketCopy.denialMessages
    ];
  }
  if (isSalesDenialCode(code)) return copy.denialMessages[code];
  return basketCopy.permissionDenied;
}

function recordFailure(
  caught: unknown,
  copy: SalesCopy,
  setDenial: (denial: AnyDenial | null) => void,
  setError: (message: string | null) => void,
): void {
  if (
    caught instanceof SalesApiDenied ||
    caught instanceof IdentityApiDenied ||
    caught instanceof LicensingApiDenied
  ) {
    setDenial(caught.denial);
    return;
  }
  setError(copy.draftUnavailable);
}
