import type {
  IdentityDenial,
  InventoryDenial,
  LicensingDenial,
  SaleProductSearchResponse,
  SaleProductContext,
  SaleQuickAccess,
  SaleDraft,
  SalesDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { basketMessages } from "./basket-messages";
import { useCommittedFocus } from "./committed-focus";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { useIdentityState } from "./identity-state-provider";
import {
  addReorderItem,
  InventoryApiDenied,
  inventoryCommandAttempt,
  type InventoryCommandAttempt,
} from "./inventory-api";
import {
  formatCurrencyFromFils,
  formatDateTime,
  formatNumber,
} from "./preferences";
import { usePreferences } from "./preferences-provider";
import { ProductForm } from "./product-form";
import { SalesCalculator } from "./sales-calculator";
import {
  addSaleDraftMiscLine,
  addSaleDraftLine,
  changeSaleDraftLine,
  clearSaleDraft,
  createSaleDraft,
  discardSaleDraft,
  newSalesIdempotencyKey,
  readSaleDraft,
  readSaleDrafts,
  removeSaleDraftLine,
  overrideSaleDraftLinePrice,
  resumeSaleDraft,
  SalesApiDenied,
  setSaleDraftDiscount,
  searchSaleProducts,
  readSaleProductContext,
  readSaleQuickAccess,
  replaceSaleQuickAccess,
  suspendSaleDraft,
} from "./sales-api";
import { SalesInvoiceView } from "./sales-invoice-view";
import { SaleQuickAccessPanel } from "./sales-quick-access-panel";
import { SalePriceDialog } from "./sales-price-dialog";
import {
  SalesDraftContextPanel,
  SalesWorkspaceView,
} from "./sales-workspace-view";
import {
  salesLoadMoreMessage,
  salesMessages,
  type SalesCopy,
} from "./sales-messages";

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
  const canCreateProduct =
    authenticated &&
    identity.allowedPermissions.includes("catalog.item.manage");
  const canAddMiscLine =
    authenticated && identity.allowedPermissions.includes("sales.misc.manage");
  const canManageQuickAccess =
    authenticated &&
    identity.allowedPermissions.includes("sales.quick_access.manage");
  const canOverridePrice =
    authenticated &&
    identity.allowedPermissions.includes("draft.price.override");
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

  return (
    <SaleDraftWorkspace
      baseUrl={baseUrl}
      canAddToBasket={canAddToBasket}
      canCreateProduct={canCreateProduct}
      canAddMiscLine={canAddMiscLine}
      canManageQuickAccess={canManageQuickAccess}
      canOverridePrice={canOverridePrice}
      canSearch={canSearch}
      route={route}
    />
  );
}

function SaleDraftWorkspace({
  baseUrl,
  canAddToBasket,
  canCreateProduct,
  canAddMiscLine,
  canManageQuickAccess,
  canOverridePrice,
  canSearch,
  route,
}: {
  readonly baseUrl: string;
  readonly canAddToBasket: boolean;
  readonly canCreateProduct: boolean;
  readonly canAddMiscLine: boolean;
  readonly canManageQuickAccess: boolean;
  readonly canOverridePrice: boolean;
  readonly canSearch: boolean;
  readonly route: SalesRoute;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = salesMessages[locale];
  const commitFocus = useCommittedFocus();
  const [drafts, setDrafts] = useState<readonly SaleDraft[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listDenial, setListDenial] = useState<AnyDenial | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDenial, setActionDenial] = useState<AnyDenial | null>(null);
  const [busy, setBusy] = useState(false);
  const [resumeToken, setResumeToken] = useState(0);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  const [newDraftReconciliationRequired, setNewDraftReconciliationRequired] =
    useState(false);
  const pendingNewDraftIdempotencyKey = useRef<string | null>(null);
  const listRequestSequence = useRef(0);

  const load = useCallback(
    async (
      preserveActionStatus = false,
      focusDraftList = false,
    ): Promise<void> => {
      const sequence = ++listRequestSequence.current;
      setListError(null);
      setListDenial(null);
      if (!preserveActionStatus) {
        setActionError(null);
        setActionDenial(null);
      }
      try {
        const [active, suspended] = await Promise.all([
          readSaleDrafts(baseUrl, { status: "active" }),
          readSaleDrafts(baseUrl, { status: "suspended" }),
        ]);
        if (sequence !== listRequestSequence.current) return;
        const combined = [...active.drafts, ...suspended.drafts];
        setDrafts(combined);
        setNewDraftReconciliationRequired(false);
        if (focusDraftList) {
          commitFocus(() =>
            document.querySelector<HTMLElement>(
              combined.length === 1
                ? '[data-sale-draft-control="resume"]'
                : '[data-sale-draft-control="new"]',
            ),
          );
        }
      } catch (caught) {
        if (sequence !== listRequestSequence.current) return;
        recordFailure(caught, copy, setListDenial, setListError);
      }
    },
    [baseUrl, commitFocus, copy],
  );

  useEffect(() => {
    void load(false, route.kind === "index");
    return () => {
      listRequestSequence.current += 1;
    };
  }, [load, route.kind]);

  async function openDraft(): Promise<void> {
    if (newDraftReconciliationRequired) return;
    setBusy(true);
    setActionError(null);
    setActionDenial(null);
    try {
      const idempotencyKey =
        pendingNewDraftIdempotencyKey.current ?? newSalesIdempotencyKey();
      pendingNewDraftIdempotencyKey.current = idempotencyKey;
      const draft = await createSaleDraft(baseUrl, {
        idempotencyKey,
      });
      pendingNewDraftIdempotencyKey.current = null;
      window.location.hash = `#/sales/drafts/${draft.id}`;
    } catch (caught) {
      recordFailure(caught, copy, setActionDenial, setActionError);
      if (
        caught instanceof SalesApiDenied ||
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        pendingNewDraftIdempotencyKey.current = null;
      } else {
        // Resolve a committed-but-unacknowledged create before allowing another
        // New command. The key remains available if the operator retries it.
        setNewDraftReconciliationRequired(true);
        await load(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resume(draft: SaleDraft): Promise<void> {
    setBusy(true);
    setActionError(null);
    setActionDenial(null);
    try {
      const resumed = await resumeSaleDraft(baseUrl, draft.id, {
        expectedVersion: draft.version,
        idempotencyKey: newSalesIdempotencyKey(),
      });
      setDrafts(
        (current) =>
          current?.map((listed) =>
            listed.id === resumed.id ? resumed : listed,
          ) ?? null,
      );
      setResumeToken((current) => current + 1);
      window.location.hash = `#/sales/drafts/${draft.id}`;
    } catch (caught) {
      recordFailure(caught, copy, setActionDenial, setActionError);
    } finally {
      setBusy(false);
    }
  }

  const localizedListError =
    listDenial === null
      ? listError
      : denialText(listDenial, basketMessages[locale], copy);

  return (
    <SalesWorkspaceView
      activeDraftId={route.kind === "draft" ? route.draftId : null}
      activeDraftLabel={copy.activeDraft}
      busy={busy}
      copy={copy}
      createDisabled={busy || newDraftReconciliationRequired}
      confirmNewDraft={confirmNewDraft}
      drafts={drafts}
      draftsError={localizedListError}
      locale={locale}
      onCreateDraft={() => {
        const current =
          route.kind === "draft"
            ? drafts?.find((draft) => draft.id === route.draftId)
            : undefined;
        if (current !== undefined && current.lines.length > 0) {
          setConfirmNewDraft(true);
        } else {
          void openDraft();
        }
      }}
      onConfirmNewDraft={() => {
        setConfirmNewDraft(false);
        void openDraft();
      }}
      onCancelNewDraft={() => setConfirmNewDraft(false)}
      onReloadDrafts={() => {
        void load();
      }}
      onResumeDraft={(draft) => {
        void resume(draft);
      }}
    >
      {route.kind === "draft" ? (
        <SaleDraftScreen
          actionDenial={actionDenial}
          actionError={actionError}
          baseUrl={baseUrl}
          canAddToBasket={canAddToBasket}
          canCreateProduct={canCreateProduct}
          canAddMiscLine={canAddMiscLine}
          canManageQuickAccess={canManageQuickAccess}
          canOverridePrice={canOverridePrice}
          canSearch={canSearch}
          draftId={route.draftId}
          onReloadDrafts={load}
          resumeToken={resumeToken}
        />
      ) : (
        <section className="sales-screen" aria-labelledby="sales-title">
          <header className="sales-header">
            <h2 id="sales-title">{copy.title}</h2>
            <p className="sales-description">{copy.description}</p>
          </header>
          <StatusRegion
            denial={actionDenial}
            error={actionError}
            onReload={load}
            copy={copy}
          />
          <p className="sales-selection-prompt">{copy.selectDraftPrompt}</p>
        </section>
      )}
    </SalesWorkspaceView>
  );
}

function SaleDraftScreen({
  actionDenial,
  actionError,
  baseUrl,
  canAddToBasket,
  canCreateProduct,
  canAddMiscLine,
  canManageQuickAccess,
  canOverridePrice,
  canSearch,
  draftId,
  onReloadDrafts,
  resumeToken,
}: {
  readonly actionDenial: AnyDenial | null;
  readonly actionError: string | null;
  readonly baseUrl: string;
  readonly canAddToBasket: boolean;
  readonly canCreateProduct: boolean;
  readonly canAddMiscLine: boolean;
  readonly canManageQuickAccess: boolean;
  readonly canOverridePrice: boolean;
  readonly canSearch: boolean;
  readonly draftId: string;
  readonly onReloadDrafts: () => Promise<void>;
  readonly resumeToken: number;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = salesMessages[locale];
  const basketCopy = basketMessages[locale];
  const commitFocus = useCommittedFocus();
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const draftRequestSequence = useRef(0);
  const attemptRef = useRef<InventoryCommandAttempt | null>(null);

  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [recordProductId, setRecordProductId] = useState<string | null>(null);
  const [priceDialog, setPriceDialog] = useState<{
    readonly lineId: string;
    readonly initialPriceFils: string;
  } | null>(null);
  useEffect(() => {
    if (recordProductId !== null)
      commitFocus(() =>
        document.querySelector<HTMLElement>(".sales-item-record-dialog"),
      );
  }, [commitFocus, recordProductId]);
  const [itemContext, setItemContext] = useState<SaleProductContext | null>(
    null,
  );
  const [itemContextUnavailable, setItemContextUnavailable] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const [miscName, setMiscName] = useState("");
  const [miscUnit, setMiscUnit] = useState("");
  const [miscQuantity, setMiscQuantity] = useState("1");
  const [miscPrice, setMiscPrice] = useState("");
  const [miscValidation, setMiscValidation] = useState<string | null>(null);
  const [quickAccess, setQuickAccess] = useState<SaleQuickAccess | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [pinContext, setPinContext] = useState<SaleProductContext | null>(null);
  const [pinCategory, setPinCategory] = useState("");
  const [pinUnitId, setPinUnitId] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const pendingQuick = useRef<{
    readonly categories: {
      name: string;
      tiles: { productId: string; unitId: string }[];
    }[];
    readonly expectedVersion: string;
    readonly idempotencyKey: string;
  } | null>(null);
  const loadQuickAccess = useCallback(async (): Promise<void> => {
    setQuickError(null);
    try {
      setQuickAccess(await readSaleQuickAccess(baseUrl));
    } catch {
      setQuickAccess(null);
      setQuickError(
        locale === "ar"
          ? "تعذر تحميل الوصول السريع."
          : "Quick access is unavailable.",
      );
    }
  }, [baseUrl, locale]);
  useEffect(() => {
    void loadQuickAccess();
  }, [loadQuickAccess]);
  const [calculatorSlot, setCalculatorSlot] = useState<HTMLElement | null>(
    null,
  );
  useEffect(() => {
    setCalculatorSlot(document.getElementById("sales-calculator-slot"));
  }, []);
  useEffect(() => {
    if (createProductOpen)
      commitFocus(() =>
        document.querySelector<HTMLElement>(".sales-create-dialog"),
      );
  }, [commitFocus, createProductOpen]);
  const [results, setResults] = useState<SaleProductSearchResponse | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [announcementProductId, setAnnouncementProductId] = useState<
    string | null
  >(null);
  const [basketError, setBasketError] = useState<string | null>(null);
  const [basketDenial, setBasketDenial] = useState<AnyDenial | null>(null);
  const [retryProductId, setRetryProductId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const pendingEdit = useRef<{
    readonly request: (
      expectedVersion: string,
      idempotencyKey: string,
    ) => Promise<SaleDraft>;
    readonly run: () => Promise<SaleDraft>;
    readonly onSuccess?: () => void;
  } | null>(null);

  const loadDraft = useCallback(async (): Promise<void> => {
    const sequence = ++draftRequestSequence.current;
    setDraft(null);
    setDraftLoading(true);
    setDraftError(null);
    try {
      const loaded = await readSaleDraft(baseUrl, draftId);
      if (sequence !== draftRequestSequence.current) return;
      setDraft(loaded);
      // The search field owns focus the moment the draft is actionable.
      commitFocus(() => searchRef.current);
    } catch (caught) {
      if (sequence !== draftRequestSequence.current) return;
      setDraftError(
        caught instanceof SalesApiDenied
          ? copy.denialMessages[caught.denial.code]
          : copy.draftUnavailable,
      );
    } finally {
      if (sequence === draftRequestSequence.current) setDraftLoading(false);
    }
  }, [baseUrl, commitFocus, copy, draftId]);

  useEffect(() => {
    void loadDraft();
    return () => {
      draftRequestSequence.current += 1;
    };
  }, [loadDraft, resumeToken]);

  const selectedLine =
    draft?.lines.find((line) => line.id === selectedLineId) ??
    draft?.lines[0] ??
    null;
  const priceDialogLine =
    draft?.lines.find((line) => line.id === priceDialog?.lineId) ?? null;
  const selectedProductId = selectedLine?.productId ?? null;
  useEffect(() => {
    let live = true;
    setItemContext(null);
    setItemContextUnavailable(false);
    if (selectedProductId !== null) {
      void readSaleProductContext(baseUrl, selectedProductId).then(
        (value) => {
          if (live) setItemContext(value);
        },
        () => {
          if (live) setItemContextUnavailable(true);
        },
      );
    }
    return () => {
      live = false;
    };
  }, [baseUrl, selectedProductId]);

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
    setResults(null);
    try {
      const response = await searchSaleProducts(baseUrl, {
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

  const loadMoreResults = useCallback(async (): Promise<void> => {
    if (results === null || !results.hasMore || searching) return;
    const sequence = ++requestSequence.current;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await searchSaleProducts(baseUrl, {
        limit: "50",
        offset: String(results.results.length),
        query: results.query,
      });
      if (sequence !== requestSequence.current) return;
      setResults((current) => {
        if (current === null || current.query !== response.query)
          return current;
        const existingIds = new Set(
          current.results.map(({ product }) => product.id),
        );
        const appended = response.results.filter(
          ({ product }) => !existingIds.has(product.id),
        );
        return {
          ...response,
          results: [...current.results, ...appended],
        };
      });
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
  }, [baseUrl, copy, results, searching]);

  useEffect(() => {
    if (!canSearch) return;
    const timer = window.setTimeout(() => {
      void performSearch();
    }, 100);
    return () => {
      window.clearTimeout(timer);
    };
  }, [canSearch, performSearch]);

  async function addToBasket(productId: string): Promise<void> {
    if (!canAddToBasket) return;
    const attempt = inventoryCommandAttempt(attemptRef.current, productId);
    attemptRef.current = attempt;
    setBasketError(null);
    setBasketDenial(null);
    setAnnouncement(null);
    setAnnouncementProductId(null);
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
      setAnnouncementProductId(productId);
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
    }
  }

  async function mutateDraft(
    run: (
      expectedVersion: string,
      idempotencyKey: string,
    ) => Promise<SaleDraft>,
    onSuccess?: () => void,
  ): Promise<void> {
    if (draft === null || editBusy || pendingEdit.current !== null) return;
    const expectedVersion = draft.version;
    const idempotencyKey = newSalesIdempotencyKey();
    pendingEdit.current = {
      request: run,
      run: () => run(expectedVersion, idempotencyKey),
      ...(onSuccess === undefined ? {} : { onSuccess }),
    };
    await sendPendingEdit();
  }

  async function sendPendingEdit(): Promise<void> {
    const attempt = pendingEdit.current;
    if (attempt === null) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const updated = await attempt.run();
      pendingEdit.current = null;
      setDraft(updated);
      attempt.onSuccess?.();
      await onReloadDrafts();
      if (updated.status === "active") commitFocus(() => searchRef.current);
      else window.location.hash = "#/sales";
    } catch (caught) {
      if (caught instanceof SalesApiDenied) {
        if (caught.denial.currentDraft !== undefined) {
          setDraft(caught.denial.currentDraft);
          const nextKey = newSalesIdempotencyKey();
          pendingEdit.current = {
            request: attempt.request,
            run: () =>
              attempt.request(caught.denial.currentDraft!.version, nextKey),
            ...(attempt.onSuccess === undefined
              ? {}
              : { onSuccess: attempt.onSuccess }),
          };
        } else {
          pendingEdit.current = null;
        }
        setEditError(copy.denialMessages[caught.denial.code]);
      } else if (
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        pendingEdit.current = null;
        setEditError(copy.draftUnavailable);
      } else {
        setEditError(copy.draftUnavailable);
      }
    } finally {
      setEditBusy(false);
    }
  }

  function addToSale(productId: string): void {
    void mutateDraft((expectedVersion, idempotencyKey) =>
      addSaleDraftLine(baseUrl, draftId, {
        productId,
        expectedVersion,
        idempotencyKey,
      }),
    );
  }

  function addMiscLine(): void {
    const price = miscPrice.trim();
    const validPrice = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(price);
    if (
      miscName.trim().length === 0 ||
      miscUnit.trim().length === 0 ||
      !/^[1-9][0-9]*$/u.test(miscQuantity) ||
      !validPrice
    ) {
      setMiscValidation(
        locale === "ar"
          ? "تحقق من الاسم والوحدة والكمية والسعر."
          : "Check the name, unit, quantity, and price.",
      );
      return;
    }
    const [whole = "0", fractional = ""] = price.split(".");
    const unitPriceFils = (
      BigInt(whole) * 1_000n +
      BigInt(fractional.padEnd(3, "0"))
    ).toString();
    if (BigInt(unitPriceFils) > 9_223_372_036_854_775_807n) {
      setMiscValidation(
        locale === "ar" ? "السعر كبير جداً." : "Price is too large.",
      );
      return;
    }
    setMiscValidation(null);
    void mutateDraft(
      (expectedVersion, idempotencyKey) =>
        addSaleDraftMiscLine(baseUrl, draftId, {
          displayName: miscName.trim(),
          unitName: miscUnit.trim(),
          quantity: miscQuantity,
          unitPriceFils,
          expectedVersion,
          idempotencyKey,
        }),
      () => {
        setMiscOpen(false);
        setMiscName("");
        setMiscUnit("");
        setMiscQuantity("1");
        setMiscPrice("");
      },
    );
  }

  function changeLine(
    lineId: string,
    change: {
      readonly quantity?: string;
      readonly unitId?: string;
      readonly lineDiscountPercentage?: string;
    },
  ): void {
    void mutateDraft((expectedVersion, idempotencyKey) =>
      changeSaleDraftLine(baseUrl, draftId, lineId, {
        ...change,
        expectedVersion,
        idempotencyKey,
      }),
    );
  }

  function quickCategories(): {
    name: string;
    tiles: { productId: string; unitId: string }[];
  }[] {
    return (quickAccess?.categories ?? []).map((category) => ({
      name: category.name,
      tiles: category.tiles.map(({ productId, unitId }) => ({
        productId,
        unitId,
      })),
    }));
  }

  async function sendPendingQuick(): Promise<void> {
    const attempt = pendingQuick.current;
    if (attempt === null) return;
    setQuickBusy(true);
    setQuickError(null);
    try {
      const saved = await replaceSaleQuickAccess(baseUrl, attempt);
      pendingQuick.current = null;
      setQuickAccess(saved);
      setPinContext(null);
      setPinError(null);
    } catch (caught) {
      if (
        caught instanceof SalesApiDenied &&
        caught.denial.code === "version-conflict"
      ) {
        pendingQuick.current = null;
        await loadQuickAccess();
        setQuickError(
          locale === "ar"
            ? "تغيرت إعدادات الوصول السريع. راجعها وأعد التعديل."
            : "Quick access changed elsewhere. Review it and retry your edit.",
        );
      } else if (
        caught instanceof SalesApiDenied &&
        caught.denial.code === "sale-quick-access-invalid"
      ) {
        pendingQuick.current = null;
        setQuickError(
          locale === "ar"
            ? "إعداد الوصول السريع غير صالح. راجع المواد والوحدات."
            : "Quick access is invalid. Review the items and units.",
        );
      } else if (
        caught instanceof SalesApiDenied ||
        caught instanceof IdentityApiDenied
      ) {
        pendingQuick.current = null;
        setQuickError(
          locale === "ar"
            ? "لا تملك صلاحية تعديل الوصول السريع."
            : "You cannot change quick access.",
        );
      } else {
        setQuickError(
          locale === "ar"
            ? "لم يتأكد حفظ الوصول السريع. أعد المحاولة."
            : "Quick access save is unconfirmed. Retry it.",
        );
      }
    } finally {
      setQuickBusy(false);
    }
  }

  function replaceQuickCategories(
    categories: ReturnType<typeof quickCategories>,
  ): void {
    if (
      !canManageQuickAccess ||
      quickAccess === null ||
      quickBusy ||
      pendingQuick.current !== null
    )
      return;
    pendingQuick.current = {
      categories,
      expectedVersion: quickAccess.version,
      idempotencyKey: newSalesIdempotencyKey(),
    };
    void sendPendingQuick();
  }

  async function openPin(productId: string): Promise<void> {
    setPinError(null);
    try {
      const context = await readSaleProductContext(baseUrl, productId);
      setPinContext(context);
      setPinCategory(quickAccess?.categories[0]?.name ?? "");
      setPinUnitId(context.eligibleUnits[0]?.unitId ?? "");
    } catch {
      setPinError(
        locale === "ar"
          ? "تعذر تحميل وحدات المادة."
          : "Item units are unavailable.",
      );
    }
  }

  function pinProduct(): void {
    if (pinContext === null || pinUnitId === "") return;
    const name = pinCategory.trim();
    if (name.length === 0 || name.length > 64) {
      setPinError(
        locale === "ar"
          ? "أدخل اسم فئة صالحاً."
          : "Enter a valid category name.",
      );
      return;
    }
    const categories = quickCategories();
    let category = categories.find((item) => item.name === name);
    if (category === undefined) {
      if (categories.length >= 12) {
        setPinError(
          locale === "ar"
            ? "الحد الأقصى ١٢ فئة."
            : "Quick access supports up to 12 categories.",
        );
        return;
      }
      category = { name, tiles: [] };
      categories.push(category);
    }
    if (
      category.tiles.some(
        (tile) => tile.productId === pinContext.id && tile.unitId === pinUnitId,
      )
    ) {
      setPinError(
        locale === "ar"
          ? "المادة موجودة بالفعل في هذه الفئة."
          : "This item is already in the category.",
      );
      return;
    }
    if (category.tiles.length >= 30) {
      setPinError(
        locale === "ar"
          ? "الحد الأقصى ٣٠ مادة في الفئة."
          : "A category supports up to 30 items.",
      );
      return;
    }
    category.tiles.push({ productId: pinContext.id, unitId: pinUnitId });
    replaceQuickCategories(categories);
  }

  function closeRecord(): void {
    setRecordProductId(null);
    commitFocus(() =>
      document.querySelector<HTMLElement>(
        `[data-sale-line-record="${selectedLine?.id ?? ""}"]`,
      ),
    );
  }

  const inactiveDenial =
    basketDenial !== null &&
    "code" in basketDenial &&
    basketDenial.code === "reorder-product-inactive";

  return (
    <div
      className="sales-draft-layout"
      data-draft-loaded={draft === null ? "false" : "true"}
    >
      <section
        aria-labelledby="sales-draft-title"
        className="sales-screen"
        data-draft-loaded={draft === null ? "false" : "true"}
      >
        <header className="sales-header">
          <h2 id="sales-draft-title">
            {draft === null
              ? copy.title
              : copy.draftHeading(
                  formatDateTime(new Date(draft.createdAt), locale),
                )}
          </h2>
        </header>

        <StatusRegion
          denial={actionDenial}
          error={actionError}
          onReload={onReloadDrafts}
          copy={copy}
        />

        {draftError === null ? null : (
          <p className="denial-alert" role="status" aria-live="polite">
            {draftError}
            <button
              data-sale-draft-control="draft-reload"
              disabled={draftLoading}
              type="button"
              onClick={() => {
                void loadDraft();
              }}
            >
              {copy.reload}
            </button>
          </p>
        )}

        {draft === null && draftError === null && draftLoading ? (
          <p role="status">{copy.loading}</p>
        ) : null}

        {canSearch && draft?.status === "active" ? (
          <div className="sales-search">
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
                requestSequence.current += 1;
                setResults(null);
                setSearchError(null);
                setSearching(false);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  canCreateProduct &&
                  results?.results.length === 0
                ) {
                  event.preventDefault();
                  setCreateProductOpen(true);
                }
              }}
            />
          </div>
        ) : draft?.status === "suspended" ? (
          <p className="sales-selection-prompt" role="status">
            {locale === "ar"
              ? "هذه المسودة معلقة. اضغط استئناف في قائمة المسودات لتعديلها."
              : "This draft is suspended. Resume it from the draft list to edit it."}
          </p>
        ) : (
          <p className="denial-alert" role="status" aria-live="polite">
            {copy.searchDenied}
          </p>
        )}

        {canAddMiscLine && draft?.status === "active" ? (
          <div className="sales-misc-add">
            <button
              aria-expanded={miscOpen}
              data-sale-misc-open
              type="button"
              onClick={() => setMiscOpen((open) => !open)}
            >
              {locale === "ar" ? "+ إضافة متنوعة" : "+ Quick add"}
            </button>
            {miscOpen ? (
              <form
                className="sales-misc-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  addMiscLine();
                }}
              >
                <label>
                  {locale === "ar" ? "الاسم" : "Name"}
                  <input
                    maxLength={160}
                    required
                    value={miscName}
                    onChange={(event) => setMiscName(event.target.value)}
                  />
                </label>
                <label>
                  {locale === "ar" ? "الوحدة" : "Unit"}
                  <input
                    maxLength={64}
                    required
                    value={miscUnit}
                    onChange={(event) => setMiscUnit(event.target.value)}
                  />
                </label>
                <label>
                  {locale === "ar" ? "الكمية" : "Quantity"}
                  <input
                    inputMode="numeric"
                    min="1"
                    required
                    type="number"
                    value={miscQuantity}
                    onChange={(event) => setMiscQuantity(event.target.value)}
                  />
                </label>
                <label>
                  {locale === "ar" ? "سعر الوحدة (د.ع)" : "Unit price (IQD)"}
                  <input
                    inputMode="decimal"
                    min="0"
                    required
                    step="0.001"
                    type="number"
                    value={miscPrice}
                    onChange={(event) => setMiscPrice(event.target.value)}
                  />
                </label>
                <button
                  disabled={editBusy || pendingEdit.current !== null}
                  type="submit"
                >
                  {locale === "ar" ? "إضافة إلى الفاتورة" : "Add to sale"}
                </button>
                {miscValidation === null ? null : (
                  <p role="alert">{miscValidation}</p>
                )}
              </form>
            ) : null}
          </div>
        ) : null}

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
                  void addToBasket(retryProductId);
                }}
              >
                {basketCopy.actions.retry}
              </button>
            )}
          </p>
        )}

        {editError === null ? null : (
          <p className="denial-alert" role="alert">
            {editError}
            {pendingEdit.current === null ? null : (
              <button
                data-sale-draft-control="edit-retry"
                disabled={editBusy}
                type="button"
                onClick={() => {
                  void sendPendingEdit();
                }}
              >
                {locale === "ar" ? "إعادة المحاولة" : "Retry edit"}
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

        {draft?.status !== "active" || results === null ? null : results.results
            .length === 0 ? (
          <div className="sales-no-results">
            <p>{copy.noResults}</p>
            {canCreateProduct ? (
              <button type="button" onClick={() => setCreateProductOpen(true)}>
                {locale === "ar" ? "إنشاء مادة جديدة" : "Create new item"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="sales-results">
            <table className="sales-results-table">
              <caption className="visually-hidden">
                {copy.searchResultCount(results.resultCount)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{copy.itemColumn}</th>
                  <th scope="col">
                    {locale === "ar" ? "سعر البيع" : "Retail price"}
                  </th>
                  <th scope="col">
                    {locale === "ar" ? "إضافة إلى الفاتورة" : "Add to sale"}
                  </th>
                  {canAddToBasket ? (
                    <th scope="col">{copy.addToBasket}</th>
                  ) : null}
                  {canManageQuickAccess ? (
                    <th scope="col">
                      {locale === "ar" ? "الوصول السريع" : "Quick access"}
                    </th>
                  ) : null}
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
                      {formatCurrencyFromFils(
                        BigInt(result.product.retailPriceFils),
                        locale,
                      )}
                    </td>
                    <td>
                      <button
                        aria-label={`${locale === "ar" ? "إضافة إلى الفاتورة" : "Add to sale"}: ${result.product.displayName}`}
                        className="sales-add-to-sale"
                        data-sale-line-add={result.product.id}
                        disabled={editBusy || pendingEdit.current !== null}
                        type="button"
                        onClick={() => addToSale(result.product.id)}
                      >
                        {locale === "ar" ? "إضافة إلى الفاتورة" : "Add to sale"}
                      </button>
                    </td>
                    {canAddToBasket ? (
                      <td>
                        {canAddToBasket ? (
                          <button
                            aria-label={copy.addToBasketAriaLabel(
                              result.product.displayName,
                            )}
                            data-sale-basket-add={result.product.id}
                            type="button"
                            onClick={() => {
                              void addToBasket(result.product.id);
                            }}
                          >
                            {copy.addToBasket}
                          </button>
                        ) : null}
                        {announcementProductId === result.product.id &&
                        announcement !== null ? (
                          <span
                            aria-hidden="true"
                            className="sale-basket-feedback"
                            data-sale-basket-feedback={result.product.id}
                          >
                            {announcement}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                    {canManageQuickAccess ? (
                      <td>
                        <button
                          aria-label={`${locale === "ar" ? "إضافة إلى الوصول السريع" : "Pin to quick access"}: ${result.product.displayName}`}
                          disabled={
                            quickBusy ||
                            pendingQuick.current !== null ||
                            quickAccess === null
                          }
                          type="button"
                          onClick={() => {
                            void openPin(result.product.id);
                          }}
                        >
                          {locale === "ar" ? "تثبيت" : "Pin"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {results.hasMore ? (
              <button
                className="sales-load-more"
                disabled={searching}
                type="button"
                onClick={() => {
                  void loadMoreResults();
                }}
              >
                {salesLoadMoreMessage(locale)}
              </button>
            ) : null}
          </div>
        )}
        {canManageQuickAccess &&
        pinContext !== null &&
        draft?.status === "active" ? (
          <form
            className="sales-quick-pin-form"
            onSubmit={(event) => {
              event.preventDefault();
              pinProduct();
            }}
          >
            <strong>{pinContext.displayName}</strong>
            <label>
              {locale === "ar" ? "الفئة" : "Category"}
              <input
                list="sale-quick-categories"
                maxLength={64}
                required
                value={pinCategory}
                onChange={(event) => setPinCategory(event.target.value)}
              />
              <datalist id="sale-quick-categories">
                {quickAccess?.categories.map((category) => (
                  <option key={category.name} value={category.name} />
                ))}
              </datalist>
            </label>
            <label>
              {locale === "ar" ? "وحدة البيع" : "Selling unit"}
              <select
                required
                value={pinUnitId}
                onChange={(event) => setPinUnitId(event.target.value)}
              >
                {pinContext.eligibleUnits.map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>
                    {unit.unitName}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={quickBusy || pendingQuick.current !== null}
              type="submit"
            >
              {locale === "ar" ? "حفظ التثبيت" : "Save pin"}
            </button>
            <button type="button" onClick={() => setPinContext(null)}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
            {pinError === null ? null : <span role="alert">{pinError}</span>}
          </form>
        ) : null}
        {pinError !== null && pinContext === null ? (
          <p role="alert">{pinError}</p>
        ) : null}
        {draft?.status === "active" &&
        (canManageQuickAccess ||
          quickAccess?.categories.length ||
          quickError !== null) ? (
          <>
            <SaleQuickAccessPanel
              value={quickAccess}
              locale={locale}
              busy={
                quickBusy ||
                pendingQuick.current !== null ||
                editBusy ||
                pendingEdit.current !== null
              }
              error={quickError}
              canManage={canManageQuickAccess}
              onReload={() => {
                void loadQuickAccess();
              }}
              onAdd={(productId, unitId) => {
                void mutateDraft((expectedVersion, idempotencyKey) =>
                  addSaleDraftLine(baseUrl, draftId, {
                    productId,
                    unitId,
                    expectedVersion,
                    idempotencyKey,
                  }),
                );
              }}
              onRemove={(categoryIndex, tileIndex) => {
                const categories = quickCategories();
                categories[categoryIndex]?.tiles.splice(tileIndex, 1);
                if (categories[categoryIndex]?.tiles.length === 0)
                  categories.splice(categoryIndex, 1);
                replaceQuickCategories(categories);
              }}
              onRemoveCategory={(categoryIndex) => {
                const categories = quickCategories();
                categories.splice(categoryIndex, 1);
                replaceQuickCategories(categories);
              }}
              onMoveTile={(categoryIndex, tileIndex, change) => {
                const categories = quickCategories();
                const tiles = categories[categoryIndex]?.tiles;
                if (tiles === undefined) return;
                const other = tileIndex + change;
                if (other < 0 || other >= tiles.length) return;
                [tiles[tileIndex], tiles[other]] = [
                  tiles[other]!,
                  tiles[tileIndex]!,
                ];
                replaceQuickCategories(categories);
              }}
              onMoveCategory={(categoryIndex, change) => {
                const categories = quickCategories();
                const other = categoryIndex + change;
                if (other < 0 || other >= categories.length) return;
                [categories[categoryIndex], categories[other]] = [
                  categories[other]!,
                  categories[categoryIndex]!,
                ];
                replaceQuickCategories(categories);
              }}
            />
            {pendingQuick.current === null ? null : (
              <button
                disabled={quickBusy}
                type="button"
                onClick={() => {
                  void sendPendingQuick();
                }}
              >
                {locale === "ar"
                  ? "إعادة محاولة حفظ الوصول السريع"
                  : "Retry quick access save"}
              </button>
            )}
          </>
        ) : null}
        {draft?.status !== "active" ? null : (
          <SalesInvoiceView
            busy={editBusy || pendingEdit.current !== null}
            canOverridePrice={canOverridePrice}
            pendingConfirmation={!editBusy && pendingEdit.current !== null}
            selectedLineId={selectedLine?.id ?? null}
            onSelectLine={setSelectedLineId}
            onOpenProduct={(line) => {
              if (line.productId === null) return;
              setSelectedLineId(line.id);
              setRecordProductId(line.productId);
            }}
            onOpenPrice={(line) => {
              setSelectedLineId(line.id);
              setPriceDialog({
                lineId: line.id,
                initialPriceFils: line.unitPriceFils,
              });
            }}
            draft={draft}
            locale={locale}
            onChangeLine={changeLine}
            onRemoveLine={(lineId) => {
              void mutateDraft((expectedVersion, idempotencyKey) =>
                removeSaleDraftLine(baseUrl, draftId, lineId, {
                  expectedVersion,
                  idempotencyKey,
                }),
              );
            }}
            onSetInvoiceDiscount={(invoiceDiscountFils) => {
              void mutateDraft((expectedVersion, idempotencyKey) =>
                setSaleDraftDiscount(baseUrl, draftId, {
                  invoiceDiscountFils,
                  expectedVersion,
                  idempotencyKey,
                }),
              );
            }}
            onClear={() => {
              void mutateDraft((expectedVersion, idempotencyKey) =>
                clearSaleDraft(baseUrl, draftId, {
                  expectedVersion,
                  idempotencyKey,
                }),
              );
            }}
            onSuspend={() => {
              void mutateDraft((expectedVersion, idempotencyKey) =>
                suspendSaleDraft(baseUrl, draftId, {
                  expectedVersion,
                  idempotencyKey,
                }),
              );
            }}
            onDiscard={() => {
              void mutateDraft((expectedVersion, idempotencyKey) =>
                discardSaleDraft(baseUrl, draftId, {
                  expectedVersion,
                  idempotencyKey,
                }),
              );
            }}
          />
        )}
      </section>
      {draft === null ? null : (
        <SalesDraftContextPanel
          copy={copy}
          draft={draft}
          locale={locale}
          selectedLine={selectedLine}
          itemContext={itemContext}
          itemContextUnavailable={itemContextUnavailable}
        />
      )}
      {draft?.status === "active" && calculatorSlot !== null
        ? createPortal(
            <SalesCalculator
              busy={editBusy || pendingEdit.current !== null}
              allowPrice={canOverridePrice}
              line={selectedLine}
              locale={locale}
              onApply={(target, value) => {
                if (target === "quantity" && selectedLine !== null) {
                  changeLine(selectedLine.id, { quantity: value });
                } else if (
                  target === "line-discount" &&
                  selectedLine !== null
                ) {
                  changeLine(selectedLine.id, {
                    lineDiscountPercentage: value,
                  });
                } else if (target === "invoice-discount") {
                  void mutateDraft((expectedVersion, idempotencyKey) =>
                    setSaleDraftDiscount(baseUrl, draftId, {
                      invoiceDiscountFils: value,
                      expectedVersion,
                      idempotencyKey,
                    }),
                  );
                } else if (target === "price" && selectedLine !== null) {
                  setPriceDialog({
                    lineId: selectedLine.id,
                    initialPriceFils: value,
                  });
                }
              }}
            />,
            calculatorSlot,
          )
        : null}
      {draft?.status === "active" &&
      canOverridePrice &&
      priceDialog !== null &&
      priceDialogLine !== null ? (
        <SalePriceDialog
          key={priceDialog.lineId}
          line={priceDialogLine}
          initialPriceFils={priceDialog.initialPriceFils}
          locale={locale}
          busy={editBusy}
          pending={pendingEdit.current !== null}
          error={editError}
          onCancel={() => setPriceDialog(null)}
          onRetry={() => {
            void sendPendingEdit();
          }}
          onSave={(unitPriceFils, reason) => {
            void mutateDraft(
              (expectedVersion, idempotencyKey) =>
                overrideSaleDraftLinePrice(
                  baseUrl,
                  draftId,
                  priceDialog.lineId,
                  {
                    expectedVersion,
                    idempotencyKey,
                    unitPriceFils,
                    reason,
                  },
                ),
              () => setPriceDialog(null),
            );
          }}
        />
      ) : null}
      {createProductOpen ? (
        <div className="sales-create-backdrop">
          <div
            aria-label={
              locale === "ar" ? "إنشاء مادة جديدة" : "Create new item"
            }
            aria-modal="true"
            className="sales-create-dialog"
            role="dialog"
            tabIndex={-1}
          >
            <ProductForm
              baseUrl={baseUrl}
              {...(/^[0-9]{6,64}$/u.test(query.trim())
                ? { initialBarcode: query.trim() }
                : {})}
              onCancel={() => {
                setCreateProductOpen(false);
                commitFocus(() => searchRef.current);
              }}
              onSuccess={(created) => {
                setCreateProductOpen(false);
                setQuery(created.displayName);
                setResults(null);
                commitFocus(() => searchRef.current);
              }}
            />
          </div>
        </div>
      ) : null}
      {recordProductId === null ? null : (
        <div className="sales-create-backdrop">
          <div
            aria-label={locale === "ar" ? "سجل المادة" : "Item record"}
            aria-modal="true"
            className="sales-create-dialog sales-item-record-dialog"
            role="dialog"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeRecord();
            }}
          >
            <h3>{locale === "ar" ? "سجل المادة" : "Item record"}</h3>
            {itemContextUnavailable ? (
              <p role="alert">
                {locale === "ar"
                  ? "تعذر تحميل سجل المادة."
                  : "Item record is unavailable."}
              </p>
            ) : itemContext?.id !== recordProductId ? (
              <p role="status">
                {locale === "ar" ? "جارٍ تحميل السجل…" : "Loading item record…"}
              </p>
            ) : (
              <>
                <strong>{itemContext.displayName}</strong>
                <dl>
                  <div>
                    <dt>
                      {locale === "ar" ? "الاسم العلمي" : "Scientific name"}
                    </dt>
                    <dd>
                      {itemContext.scientificName ??
                        (locale === "ar" ? "غير محدد" : "Not set")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {locale === "ar"
                        ? "سعر البيع الحالي"
                        : "Current retail price"}
                    </dt>
                    <dd>
                      {formatCurrencyFromFils(
                        BigInt(itemContext.currentRetailPriceFils),
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{locale === "ar" ? "الوحدة الأساسية" : "Base unit"}</dt>
                    <dd>{itemContext.inventoryUnitName}</dd>
                  </div>
                  <div>
                    <dt>{locale === "ar" ? "التعبئة" : "Packaging"}</dt>
                    <dd>
                      {itemContext.packageUnits
                        .map(
                          (unit) =>
                            `${unit.name} = ${unit.baseUnitsPerPackage} ${itemContext.inventoryUnitName}`,
                        )
                        .join(" · ") || itemContext.inventoryUnitName}
                    </dd>
                  </div>
                  <div>
                    <dt>{locale === "ar" ? "الحد الأدنى" : "Minimum level"}</dt>
                    <dd>
                      {itemContext.stockLevels.minimumLevel ??
                        (locale === "ar" ? "غير محدد" : "Not set")}
                    </dd>
                  </div>
                  <div>
                    <dt>{locale === "ar" ? "الحد الأقصى" : "Maximum level"}</dt>
                    <dd>
                      {itemContext.stockLevels.maximumLevel ??
                        (locale === "ar" ? "غير محدد" : "Not set")}
                    </dd>
                  </div>
                </dl>
              </>
            )}
            <button type="button" onClick={closeRecord}>
              {locale === "ar"
                ? "العودة إلى الفاتورة"
                : "Return to sale invoice"}
            </button>
          </div>
        </div>
      )}
    </div>
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
  return code in salesMessages.en.denialMessages;
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
