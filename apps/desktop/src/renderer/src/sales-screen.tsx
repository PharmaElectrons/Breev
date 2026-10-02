import {
  DEFAULT_SALE_PANEL_SETTINGS,
  type IdentityDenial,
  type InventoryDenial,
  type LicensingDenial,
  type SaleProductSearchResponse,
  type SaleProductContext,
  type SaleQuickAccess,
  type SalePanelSettings,
  type SaleQuickAccessReplaceRequest,
  type SaleDraft,
  type SalesDenial,
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
  type Locale,
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
  readSaleDrawerBalance,
  removeSaleDraftLine,
  overrideSaleDraftLinePrice,
  resumeSaleDraft,
  SalesApiDenied,
  SalesRequestTooLarge,
  setSaleDraftDiscount,
  searchSaleProducts,
  readSaleProductContext,
  readSaleQuickAccess,
  replaceSaleQuickAccess,
  suspendSaleDraft,
} from "./sales-api";
import { SalesInvoiceView } from "./sales-invoice-view";
import {
  readSaleLineEdit,
  reconcileSaleLineEdits,
  saveSaleLineEdit,
} from "./sales-line-drafts";
import { getSalesPanelMessages } from "./sales-panel-messages";
import { SalesPresentationSettings } from "./sales-presentation-settings";
import { SalePriceDialog } from "./sales-price-dialog";
import {
  SalesDraftContextPanel,
  SalesWorkspaceView,
} from "./sales-workspace-view";
import "./sales-panel.css";
import {
  salesLoadMoreMessage,
  salesMessages,
  type SalesCopy,
} from "./sales-messages";
import "./sales-quick-create.css";

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
  const canViewDrawerBalance =
    authenticated &&
    identity.allowedPermissions.includes("sales.drawer_balance.view");
  const actorId = authenticated ? identity.user.id : null;
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
      actorId={actorId}
      baseUrl={baseUrl}
      canAddToBasket={canAddToBasket}
      canCreateProduct={canCreateProduct}
      canAddMiscLine={canAddMiscLine}
      canManageQuickAccess={canManageQuickAccess}
      canOverridePrice={canOverridePrice}
      canSearch={canSearch}
      canViewDrawerBalance={canViewDrawerBalance}
      route={route}
    />
  );
}

function SaleDraftWorkspace({
  actorId,
  baseUrl,
  canAddToBasket,
  canCreateProduct,
  canAddMiscLine,
  canManageQuickAccess,
  canOverridePrice,
  canSearch,
  canViewDrawerBalance,
  route,
}: {
  readonly actorId: string | null;
  readonly baseUrl: string;
  readonly canAddToBasket: boolean;
  readonly canCreateProduct: boolean;
  readonly canAddMiscLine: boolean;
  readonly canManageQuickAccess: boolean;
  readonly canOverridePrice: boolean;
  readonly canSearch: boolean;
  readonly canViewDrawerBalance: boolean;
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
        const combined = [...active.drafts, ...suspended.drafts].sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        );
        setDrafts(combined);
        setNewDraftReconciliationRequired(false);
        if (focusDraftList) {
          commitFocus(() =>
            document.querySelector<HTMLElement>(
              combined.length > 0
                ? '[data-sale-draft-control="select"]'
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
      onSelectDraft={(draft) => {
        window.location.hash = `#/sales/drafts/${draft.id}`;
      }}
      onFocusEditor={() => {
        document.querySelector<HTMLInputElement>("#sale-draft-search")?.focus();
      }}
    >
      {route.kind === "draft" ? (
        <SaleDraftScreen
          actionDenial={actionDenial}
          actionError={actionError}
          actorId={actorId}
          baseUrl={baseUrl}
          canAddToBasket={canAddToBasket}
          canCreateProduct={canCreateProduct}
          canAddMiscLine={canAddMiscLine}
          canManageQuickAccess={canManageQuickAccess}
          canOverridePrice={canOverridePrice}
          canSearch={canSearch}
          canViewDrawerBalance={canViewDrawerBalance}
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
          <SalesFooter locale={locale} state="no-draft" />
        </section>
      )}
    </SalesWorkspaceView>
  );
}

function SaleDraftScreen({
  actionDenial,
  actionError,
  actorId,
  baseUrl,
  canAddToBasket,
  canCreateProduct,
  canAddMiscLine,
  canManageQuickAccess,
  canOverridePrice,
  canSearch,
  canViewDrawerBalance,
  draftId,
  onReloadDrafts,
  resumeToken,
}: {
  readonly actionDenial: AnyDenial | null;
  readonly actionError: string | null;
  readonly actorId: string | null;
  readonly baseUrl: string;
  readonly canAddToBasket: boolean;
  readonly canCreateProduct: boolean;
  readonly canAddMiscLine: boolean;
  readonly canManageQuickAccess: boolean;
  readonly canOverridePrice: boolean;
  readonly canSearch: boolean;
  readonly canViewDrawerBalance: boolean;
  readonly draftId: string;
  readonly onReloadDrafts: () => Promise<void>;
  readonly resumeToken: number;
}): React.JSX.Element {
  const { state: identity } = useIdentityState();
  const lineEditScope =
    identity?.state === "authenticated"
      ? JSON.stringify([
          baseUrl,
          identity.pharmacy.id,
          identity.user.id,
          identity.session.id,
        ])
      : null;
  const [, refreshLineEdits] = useState(0);
  const { locale } = usePreferences();
  const copy = salesMessages[locale];
  const basketCopy = basketMessages[locale];
  const commitFocus = useCommittedFocus();
  const searchRef = useRef<HTMLInputElement>(null);
  const quickToggleRef = useRef<HTMLButtonElement>(null);
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
  const priceDialogReturnFocus = useRef<HTMLElement | null>(null);
  const openPriceDialog = (lineId: string, initialPriceFils: string): void => {
    const activeElement = document.activeElement;
    priceDialogReturnFocus.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    setPriceDialog({ lineId, initialPriceFils });
    commitFocus(() =>
      document.querySelector<HTMLElement>(".sales-price-dialog"),
    );
  };
  const closePriceDialog = (): void => {
    const returnTarget = priceDialogReturnFocus.current;
    priceDialogReturnFocus.current = null;
    setPriceDialog(null);
    commitFocus(() =>
      returnTarget?.isConnected ? returnTarget : searchRef.current,
    );
  };
  const recordDialogRef = useRef<HTMLDivElement>(null);
  const [itemContext, setItemContext] = useState<SaleProductContext | null>(
    null,
  );
  const [itemContextUnavailable, setItemContextUnavailable] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scanQuery, setScanQuery] = useState("");
  const [focusedResult, setFocusedResult] = useState(0);
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => {
    if (!quickLinksOpen) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]') !== null
      )
        return;
      setQuickLinksOpen(false);
      commitFocus(() => quickToggleRef.current);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [quickLinksOpen, commitFocus]);
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createdBarcode, setCreatedBarcode] = useState<string | null>(null);
  const [miscOpen, setMiscOpen] = useState(false);
  const [miscName, setMiscName] = useState("");
  const [miscUnit, setMiscUnit] = useState("");
  const [miscQuantity, setMiscQuantity] = useState("1");
  const [miscPrice, setMiscPrice] = useState("");
  const [miscCost, setMiscCost] = useState("");
  const [miscValidation, setMiscValidation] = useState<string | null>(null);
  const resolvingRef = useRef(false);
  const [resolving, setResolving] = useState(false);
  const createProductReturnFocus = useRef<HTMLElement | null>(null);
  const createDialogRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const openCreateProductDialog = useCallback(
    (barcode?: string): void => {
      createProductReturnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setCreatedBarcode(barcode ?? null);
      setCreateProductOpen(true);
      commitFocus(() => createDialogRef.current);
    },
    [commitFocus],
  );

  const closeCreateProductDialog = useCallback((): void => {
    const returnTarget = createProductReturnFocus.current;
    createProductReturnFocus.current = null;
    setCreateProductOpen(false);
    setCreatedBarcode(null);
    commitFocus(() => returnTarget ?? searchRef.current);
  }, [commitFocus]);
  const [quickAccess, setQuickAccess] = useState<SaleQuickAccess | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [presentationSettingsOpen, setPresentationSettingsOpen] =
    useState(false);
  const presentationSettingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const panelMessages = getSalesPanelMessages(locale);

  // Drawer balance state & effect
  const [drawerBalance, setDrawerBalance] = useState<{
    actorId: string | null;
    value: bigint;
  } | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const shouldQueryDrawer =
      canViewDrawerBalance &&
      quickAccess !== null &&
      quickAccess.panelSettings.showDrawerBalance;

    if (!shouldQueryDrawer) {
      setDrawerBalance(null);
      setDrawerLoading(false);
      setDrawerError(null);
      return () => {
        live = false;
      };
    }

    setDrawerLoading(true);
    setDrawerBalance(null);
    setDrawerError(null);
    void readSaleDrawerBalance(baseUrl)
      .then((result) => {
        if (!live) return;
        setDrawerBalance({ actorId, value: BigInt(result.balanceFils) });
        setDrawerLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setDrawerBalance(null);
        setDrawerLoading(false);
        setDrawerError(panelMessages.drawerBalanceError);
      });

    return () => {
      live = false;
    };
  }, [
    baseUrl,
    actorId,
    canViewDrawerBalance,
    quickAccess?.panelSettings.showDrawerBalance,
    panelMessages.drawerBalanceError,
  ]);

  const [pinContext, setPinContext] = useState<SaleProductContext | null>(null);
  const [pinCategory, setPinCategory] = useState("");
  const [pinUnitId, setPinUnitId] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const pendingQuick = useRef<{
    readonly categories: SaleQuickAccessReplaceRequest["categories"];
    readonly expectedVersion: string;
    readonly idempotencyKey: string;
    readonly panelSettings?: SalePanelSettings;
  } | null>(null);
  const loadQuickAccess = useCallback(async (): Promise<void> => {
    setQuickError(null);
    try {
      setQuickAccess(await readSaleQuickAccess(baseUrl));
    } catch {
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
  const [isContextCollapsed, setIsContextCollapsed] = useState(false);
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
      if (lineEditScope !== null) reconcileSaleLineEdits(lineEditScope, loaded);
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
  }, [baseUrl, commitFocus, copy, draftId, lineEditScope]);

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
  const [itemContextRevision, setItemContextRevision] = useState(0);
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
  }, [baseUrl, selectedProductId, itemContextRevision]);

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
    debounceTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      debounceTimerRef.current = null;
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
      if (lineEditScope !== null)
        reconcileSaleLineEdits(lineEditScope, updated);
      setDraft(updated);
      attempt.onSuccess?.();
      await onReloadDrafts();
      if (updated.status === "active") commitFocus(() => searchRef.current);
      else window.location.hash = "#/sales";
    } catch (caught) {
      if (caught instanceof SalesApiDenied) {
        if (caught.denial.currentDraft !== undefined) {
          if (lineEditScope !== null)
            reconcileSaleLineEdits(lineEditScope, caught.denial.currentDraft);
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
    void mutateDraft(
      (expectedVersion, idempotencyKey) =>
        addSaleDraftLine(baseUrl, draftId, {
          productId,
          expectedVersion,
          idempotencyKey,
        }),
      () => {
        setQuery("");
        setScanQuery("");
        setResults(null);
        commitFocus(() => searchRef.current);
      },
    );
  }

  const resolveAndSubmit = useCallback(
    async (rawTerm: string, isBarcode: boolean): Promise<void> => {
      if (editBusy || pendingEdit.current !== null || resolvingRef.current)
        return;
      const term = rawTerm.trim();
      if (term.length === 0) {
        if (!isBarcode && canCreateProduct) {
          openCreateProductDialog();
        }
        return;
      }

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (results !== null && results.query === term && !searching) {
        if (results.results.length === 0) {
          if (canCreateProduct) {
            openCreateProductDialog(
              isBarcode || /^[0-9]{6,64}$/u.test(term) ? term : undefined,
            );
          }
          return;
        }
        if (isBarcode) {
          const match = results.results.find(
            (r) => r.matchedField === "barcode",
          );
          if (match !== undefined) addToSale(match.product.id);
          else if (canCreateProduct) openCreateProductDialog(term);
          return;
        }
        const selected = results.results[focusedResult] ?? results.results[0]!;
        addToSale(selected.product.id);
        return;
      }

      resolvingRef.current = true;
      setResolving(true);
      const sequence = ++requestSequence.current;
      setSearching(true);
      setSearchError(null);
      try {
        const response = await searchSaleProducts(baseUrl, {
          limit: "50",
          query: term,
        });
        if (sequence !== requestSequence.current) return;
        setResults(response);
        if (isBarcode) {
          setQuery(term);
        }
        if (response.results.length === 0) {
          if (canCreateProduct) {
            openCreateProductDialog(
              isBarcode || /^[0-9]{6,64}$/u.test(term) ? term : undefined,
            );
          }
        } else {
          if (isBarcode) {
            const match = response.results.find(
              (r) => r.matchedField === "barcode",
            );
            if (match !== undefined) addToSale(match.product.id);
            else if (canCreateProduct) openCreateProductDialog(term);
          } else {
            addToSale(response.results[0]!.product.id);
          }
        }
      } catch (caught) {
        if (sequence !== requestSequence.current) return;
        setSearchError(
          caught instanceof IdentityApiDenied
            ? copy.searchDenied
            : copy.searchUnavailable,
        );
      } finally {
        resolvingRef.current = false;
        setResolving(false);
        if (sequence === requestSequence.current) {
          setSearching(false);
        }
      }
    },
    [
      baseUrl,
      canCreateProduct,
      copy,
      editBusy,
      focusedResult,
      openCreateProductDialog,
      results,
      searching,
    ],
  );

  const handleAddClick = useCallback((): void => {
    if (query.trim().length > 0 && query.trim() !== scanQuery.trim()) {
      void resolveAndSubmit(query, false);
    } else if (scanQuery.trim().length > 0) {
      void resolveAndSubmit(scanQuery, true);
    } else {
      void resolveAndSubmit(query, false);
    }
  }, [query, resolveAndSubmit, scanQuery]);

  function addMiscLine(): void {
    const price = miscPrice.trim();
    const cost = miscCost.trim();
    const validPrice = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(price);
    const validCost =
      cost.length === 0 || /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(cost);
    if (
      miscName.trim().length === 0 ||
      miscUnit.trim().length === 0 ||
      !/^[1-9][0-9]*$/u.test(miscQuantity) ||
      !validPrice ||
      !validCost
    ) {
      setMiscValidation(copy.miscValidationMessage);
      return;
    }
    const [whole = "0", fractional = ""] = price.split(".");
    const unitPriceFils = (
      BigInt(whole) * 1_000n +
      BigInt(fractional.padEnd(3, "0"))
    ).toString();
    if (BigInt(unitPriceFils) > 9_223_372_036_854_775_807n) {
      setMiscValidation(copy.miscPriceTooLargeMessage);
      return;
    }
    let costFils = "0";
    if (cost.length > 0) {
      const [costWhole = "0", costFractional = ""] = cost.split(".");
      const parsedCostFils = (
        BigInt(costWhole) * 1_000n +
        BigInt(costFractional.padEnd(3, "0"))
      ).toString();
      if (BigInt(parsedCostFils) > 9_223_372_036_854_775_807n) {
        setMiscValidation(copy.miscCostTooLargeMessage);
        return;
      }
      costFils = parsedCostFils;
    }
    setMiscValidation(null);
    void mutateDraft(
      (expectedVersion, idempotencyKey) =>
        addSaleDraftMiscLine(baseUrl, draftId, {
          displayName: miscName.trim(),
          unitName: miscUnit.trim(),
          quantity: miscQuantity,
          unitPriceFils,
          costFils,
          expectedVersion,
          idempotencyKey,
        }),
      () => {
        setMiscOpen(false);
        setMiscName("");
        setMiscUnit("");
        setMiscQuantity("1");
        setMiscPrice("");
        setMiscCost("");
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

  function quickCategories(): SaleQuickAccessReplaceRequest["categories"] {
    return (quickAccess?.categories ?? []).map((category) => ({
      name: category.name,
      tiles: category.tiles.map(({ productId, unitId, thumbnailDataUrl }) => ({
        productId,
        unitId,
        ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
      })),
    }));
  }

  async function sendPendingQuick(isSettingsSave = false): Promise<void> {
    const attempt = pendingQuick.current;
    if (attempt === null) return;
    setQuickBusy(true);
    setQuickError(null);
    if (isSettingsSave || presentationSettingsOpen) {
      commitFocus(() =>
        document.querySelector<HTMLElement>(".sales-presentation-dialog"),
      );
    }
    try {
      const saved = await replaceSaleQuickAccess(baseUrl, {
        categories: attempt.categories,
        expectedVersion: attempt.expectedVersion,
        idempotencyKey: attempt.idempotencyKey,
        ...(attempt.panelSettings
          ? { panelSettings: attempt.panelSettings }
          : {}),
      });
      pendingQuick.current = null;
      setQuickAccess(saved);
      setPinContext(null);
      setPinError(null);
      if (isSettingsSave || presentationSettingsOpen) {
        setPresentationSettingsOpen(false);
        commitFocus(() => presentationSettingsTriggerRef.current);
      }
      setItemContextRevision((revision) => revision + 1);
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
      } else if (caught instanceof SalesRequestTooLarge) {
        pendingQuick.current = null;
        setQuickError(panelMessages.quickAccessPayloadTooLargeError);
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

  function handleSavePresentationSettings(input: {
    categories: SaleQuickAccessReplaceRequest["categories"];
    panelSettings: SalePanelSettings;
  }): void {
    if (quickBusy) return;
    if (pendingQuick.current === null) {
      pendingQuick.current = {
        categories: input.categories,
        panelSettings: input.panelSettings,
        expectedVersion: quickAccess!.version,
        idempotencyKey: newSalesIdempotencyKey(),
      };
    }
    void sendPendingQuick(true);
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
      ...(quickAccess.panelSettings
        ? { panelSettings: quickAccess.panelSettings }
        : {}),
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
    category.tiles.push({
      productId: pinContext.id,
      unitId: pinUnitId,
      ...(pinContext.thumbnailDataUrl
        ? { thumbnailDataUrl: pinContext.thumbnailDataUrl }
        : {}),
    });
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
      data-has-selection={selectedLine === null ? "false" : "true"}
      data-context-collapsed={isContextCollapsed ? "true" : undefined}
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
          <div className="sales-entry-row">
            <button
              aria-controls="sale-quick-links-panel"
              aria-expanded={quickLinksOpen}
              className="sales-quick-toggle"
              data-sale-quick-toggle
              ref={quickToggleRef}
              onClick={() => setQuickLinksOpen((open) => !open)}
              type="button"
            >
              {locale === "ar" ? "روابط سريعة" : "Quick Links"}
            </button>
            {canManageQuickAccess ? (
              <button
                aria-haspopup="dialog"
                aria-label={panelMessages.settingsModalTitle}
                className="sales-presentation-settings-trigger"
                data-sale-presentation-settings-trigger
                disabled={quickAccess === null || quickBusy}
                type="button"
                onClick={(event) => {
                  presentationSettingsTriggerRef.current = event.currentTarget;
                  setPresentationSettingsOpen(true);
                }}
              >
                <span aria-hidden="true">⚙</span>
              </button>
            ) : null}
            <div className="sales-search">
              <label className="sales-search-label" htmlFor="sale-draft-search">
                {copy.searchLabel}
              </label>
              <input
                aria-label={copy.searchLabel}
                aria-controls="sale-search-results"
                dir="auto"
                id="sale-draft-search"
                placeholder={copy.searchPlaceholder}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  requestSequence.current += 1;
                  setResults(null);
                  setSearchError(null);
                  setSearching(false);
                  setFocusedResult(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && results?.results.length) {
                    event.preventDefault();
                    setFocusedResult((index) =>
                      Math.min(index + 1, results.results.length - 1),
                    );
                    return;
                  }
                  if (event.key === "ArrowUp" && results?.results.length) {
                    event.preventDefault();
                    setFocusedResult((index) => Math.max(index - 1, 0));
                    return;
                  }
                  if (event.key === "Escape") {
                    setResults(null);
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void resolveAndSubmit(query, false);
                  }
                }}
              />
            </div>
            <div className="sales-search sales-scan">
              <label className="sales-search-label" htmlFor="sale-draft-scan">
                {locale === "ar" ? "الباركود / مسح" : "Barcode / scan"}
              </label>
              <input
                id="sale-draft-scan"
                ref={searchRef}
                type="search"
                autoComplete="off"
                value={scanQuery}
                onChange={(event) => setScanQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void resolveAndSubmit(scanQuery, true);
                }}
              />
            </div>
            <button
              className="sales-scan-add-btn"
              data-sale-entry-add
              disabled={editBusy || pendingEdit.current !== null || resolving}
              type="button"
              onClick={handleAddClick}
            >
              {copy.scanAddButton}
            </button>
          </div>
        ) : draft?.status === "suspended" ? (
          <p className="sales-selection-prompt" role="status">
            {locale === "ar"
              ? "هذه المسودة معلقة. اضغط تعديل لاستئنافها."
              : "This draft is suspended. Press Edit to resume it."}
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
                  {copy.miscNameLabel}
                  <input
                    maxLength={160}
                    required
                    value={miscName}
                    onChange={(event) => setMiscName(event.target.value)}
                  />
                </label>
                <label>
                  {copy.miscUnitLabel}
                  <input
                    maxLength={64}
                    required
                    value={miscUnit}
                    onChange={(event) => setMiscUnit(event.target.value)}
                  />
                </label>
                <label>
                  {copy.miscQuantityLabel}
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
                  {copy.miscPriceLabel}
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
                <label>
                  {copy.miscCostLabel}
                  <input
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    type="number"
                    value={miscCost}
                    onChange={(event) => setMiscCost(event.target.value)}
                  />
                </label>
                <button
                  disabled={editBusy || pendingEdit.current !== null}
                  type="submit"
                >
                  {copy.miscSubmitButton}
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
          {results?.results[focusedResult]
            ? `${formatNumber(BigInt(focusedResult + 1), locale)}: ${results.results[focusedResult]!.product.displayName}`
            : ""}
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
              <button
                type="button"
                onClick={() =>
                  openCreateProductDialog(
                    /^[0-9]{6,64}$/u.test(query.trim())
                      ? query.trim()
                      : undefined,
                  )
                }
              >
                {copy.createNewItemButton}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="sales-results" id="sale-search-results">
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
                {results.results.map((result, index) => (
                  <tr
                    data-focused={focusedResult === index ? "true" : undefined}
                    id={`sale-search-result-${index}`}
                    key={result.product.id}
                  >
                    <td>
                      <span className="sale-result-name">
                        {result.product.displayName}
                      </span>
                      <span className="sale-result-code" dir="ltr">
                        {result.product.barcodeValue ??
                          (locale === "ar" ? "بلا باركود" : "No barcode")}
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
          <div
            id="sale-quick-links-panel"
            className="sales-quick-panel"
            hidden={!quickLinksOpen}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuickLinksOpen(false);
                document
                  .querySelector<HTMLElement>("[data-sale-quick-toggle]")
                  ?.focus();
              }
            }}
          >
            <section
              className="sales-quick-access"
              aria-label={locale === "ar" ? "الوصول السريع" : "Quick access"}
            >
              <header>
                <div className="sales-quick-access-title-wrap">
                  <h3>{locale === "ar" ? "الوصول السريع" : "Quick access"}</h3>
                  {(quickAccess?.categories.reduce(
                    (acc, cat) => acc + cat.tiles.length,
                    0,
                  ) ?? 0) > 0 ? (
                    <span className="sales-quick-count-pill">
                      {locale === "ar"
                        ? `${quickAccess!.categories.reduce((acc, cat) => acc + cat.tiles.length, 0)} مادة`
                        : `${quickAccess!.categories.reduce((acc, cat) => acc + cat.tiles.length, 0)} items`}
                    </span>
                  ) : null}
                </div>
                <div className="sales-quick-access-header-actions">
                  {canManageQuickAccess ? (
                    <button
                      aria-haspopup="dialog"
                      aria-label={panelMessages.settingsModalTitle}
                      className="sales-presentation-settings-trigger"
                      data-sale-presentation-settings-trigger
                      disabled={quickAccess === null || quickBusy}
                      type="button"
                      onClick={(event) => {
                        presentationSettingsTriggerRef.current =
                          event.currentTarget;
                        setPresentationSettingsOpen(true);
                      }}
                    >
                      <span aria-hidden="true">⚙</span>
                    </button>
                  ) : null}
                  {quickError === null ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        void loadQuickAccess();
                      }}
                    >
                      {locale === "ar" ? "إعادة التحميل" : "Reload"}
                    </button>
                  )}
                </div>
              </header>
              {quickError === null ? null : <p role="status">{quickError}</p>}
              {quickAccess !== null &&
              quickAccess.categories.length === 0 &&
              canManageQuickAccess ? (
                <p>
                  {locale === "ar"
                    ? "ابحث عن مادة ثم ثبّتها هنا."
                    : "Search for an item, then pin it here."}
                </p>
              ) : null}
              {quickAccess === null || quickAccess.categories.length === 0
                ? null
                : quickAccess.categories.map((category, categoryIndex) => (
                    <div
                      className="sales-quick-category"
                      key={`${category.name}-${categoryIndex}`}
                    >
                      <div className="sales-quick-category-header">
                        <strong>{category.name}</strong>
                        {canManageQuickAccess ? (
                          <span className="sales-quick-order">
                            <button
                              aria-label={`${locale === "ar" ? "نقل الفئة للأعلى" : "Move category up"}: ${category.name}`}
                              disabled={
                                quickBusy ||
                                pendingQuick.current !== null ||
                                categoryIndex === 0
                              }
                              type="button"
                              onClick={() => {
                                const categories = quickCategories();
                                const other = categoryIndex - 1;
                                if (other < 0) return;
                                [categories[categoryIndex], categories[other]] =
                                  [
                                    categories[other]!,
                                    categories[categoryIndex]!,
                                  ];
                                replaceQuickCategories(categories);
                              }}
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`${locale === "ar" ? "نقل الفئة للأسفل" : "Move category down"}: ${category.name}`}
                              disabled={
                                quickBusy ||
                                pendingQuick.current !== null ||
                                categoryIndex ===
                                  quickAccess.categories.length - 1
                              }
                              type="button"
                              onClick={() => {
                                const categories = quickCategories();
                                const other = categoryIndex + 1;
                                if (other >= categories.length) return;
                                [categories[categoryIndex], categories[other]] =
                                  [
                                    categories[other]!,
                                    categories[categoryIndex]!,
                                  ];
                                replaceQuickCategories(categories);
                              }}
                            >
                              ↓
                            </button>
                            <button
                              aria-label={`${locale === "ar" ? "إزالة الفئة" : "Remove category"}: ${category.name}`}
                              disabled={
                                quickBusy || pendingQuick.current !== null
                              }
                              type="button"
                              onClick={() => {
                                const categories = quickCategories();
                                categories.splice(categoryIndex, 1);
                                replaceQuickCategories(categories);
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ) : null}
                      </div>
                      <div className="sales-quick-tiles">
                        {category.tiles.map((tile, tileIndex) => (
                          <div
                            className="sales-quick-tile"
                            key={`${tile.productId}-${tile.unitId}`}
                          >
                            <button
                              aria-label={`${locale === "ar" ? "إضافة إلى الفاتورة" : "Add to sale"}: ${tile.displayName ?? (locale === "ar" ? "مادة غير متاحة" : "Unavailable item")} (${tile.unitName ?? ""})`}
                              className="sales-quick-tile-add"
                              data-sale-quick-add={tile.productId}
                              disabled={
                                quickBusy ||
                                pendingQuick.current !== null ||
                                !tile.available
                              }
                              type="button"
                              onClick={() => {
                                void mutateDraft(
                                  (expectedVersion, idempotencyKey) =>
                                    addSaleDraftLine(baseUrl, draftId, {
                                      productId: tile.productId,
                                      unitId: tile.unitId,
                                      expectedVersion,
                                      idempotencyKey,
                                    }),
                                );
                              }}
                            >
                              {tile.thumbnailDataUrl ? (
                                <img
                                  alt=""
                                  className="sales-quick-tile-thumbnail"
                                  src={tile.thumbnailDataUrl}
                                />
                              ) : null}
                              <strong>
                                {tile.displayName ??
                                  (locale === "ar"
                                    ? "مادة غير متاحة"
                                    : "Unavailable item")}
                              </strong>
                              <span>
                                {tile.currentUnitPriceFils === null
                                  ? locale === "ar"
                                    ? "تحتاج إلى مراجعة المدير"
                                    : "Manager review needed"
                                  : `${tile.unitName} · ${formatCurrencyFromFils(BigInt(tile.currentUnitPriceFils), locale)}`}
                              </span>
                            </button>
                            {canManageQuickAccess ? (
                              <div className="sales-quick-order">
                                <button
                                  aria-label={`${locale === "ar" ? "نقل المادة للأعلى" : "Move item up"}: ${tile.displayName ?? tile.productId}`}
                                  disabled={
                                    quickBusy ||
                                    pendingQuick.current !== null ||
                                    tileIndex === 0
                                  }
                                  type="button"
                                  onClick={() => {
                                    const categories = quickCategories();
                                    const tiles =
                                      categories[categoryIndex]?.tiles;
                                    if (tiles === undefined) return;
                                    const other = tileIndex - 1;
                                    if (other < 0) return;
                                    [tiles[tileIndex], tiles[other]] = [
                                      tiles[other]!,
                                      tiles[tileIndex]!,
                                    ];
                                    replaceQuickCategories(categories);
                                  }}
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`${locale === "ar" ? "نقل المادة للأسفل" : "Move item down"}: ${tile.displayName ?? tile.productId}`}
                                  disabled={
                                    quickBusy ||
                                    pendingQuick.current !== null ||
                                    tileIndex === category.tiles.length - 1
                                  }
                                  type="button"
                                  onClick={() => {
                                    const categories = quickCategories();
                                    const tiles =
                                      categories[categoryIndex]?.tiles;
                                    if (tiles === undefined) return;
                                    const other = tileIndex + 1;
                                    if (other >= tiles.length) return;
                                    [tiles[tileIndex], tiles[other]] = [
                                      tiles[other]!,
                                      tiles[tileIndex]!,
                                    ];
                                    replaceQuickCategories(categories);
                                  }}
                                >
                                  ↓
                                </button>
                                <button
                                  aria-label={`${locale === "ar" ? "إزالة المادة" : "Remove item"}: ${tile.displayName ?? tile.productId}`}
                                  disabled={
                                    quickBusy || pendingQuick.current !== null
                                  }
                                  type="button"
                                  onClick={() => {
                                    const categories = quickCategories();
                                    categories[categoryIndex]?.tiles.splice(
                                      tileIndex,
                                      1,
                                    );
                                    if (
                                      categories[categoryIndex]?.tiles
                                        .length === 0
                                    )
                                      categories.splice(categoryIndex, 1);
                                    replaceQuickCategories(categories);
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
            </section>
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
          </div>
        ) : null}
        {draft === null ? null : (
          <SalesInvoiceView
            busy={editBusy || pendingEdit.current !== null}
            readOnly={draft.status === "suspended"}
            canOverridePrice={canOverridePrice}
            pendingConfirmation={!editBusy && pendingEdit.current !== null}
            selectedLineId={selectedLine?.id ?? null}
            lineEdit={
              selectedLine === null || lineEditScope === null
                ? null
                : readSaleLineEdit(lineEditScope, draftId, selectedLine)
            }
            onEditLine={(lineId, edit) => {
              const line = draft.lines.find(
                (candidate) => candidate.id === lineId,
              );
              if (line === undefined || lineEditScope === null) return;
              saveSaleLineEdit(lineEditScope, draftId, line, edit);
              refreshLineEdits((revision) => revision + 1);
            }}
            onSelectLine={setSelectedLineId}
            onOpenProduct={(line) => {
              if (line.productId === null) return;
              setSelectedLineId(line.id);
              setRecordProductId(line.productId);
              commitFocus(() => recordDialogRef.current);
            }}
            onOpenPrice={(line) => {
              setSelectedLineId(line.id);
              openPriceDialog(line.id, line.unitPriceFils);
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
          />
        )}
        <SalesFooter
          locale={locale}
          state={
            draft?.status === "active" || draft?.status === "suspended"
              ? draft.status
              : "no-draft"
          }
          busy={editBusy || pendingEdit.current !== null}
          deleteConfirm={deleteConfirm}
          onPause={() => {
            void mutateDraft((expectedVersion, idempotencyKey) =>
              suspendSaleDraft(baseUrl, draftId, {
                expectedVersion,
                idempotencyKey,
              }),
            );
          }}
          onDelete={() => {
            void mutateDraft((expectedVersion, idempotencyKey) =>
              discardSaleDraft(baseUrl, draftId, {
                expectedVersion,
                idempotencyKey,
              }),
            );
            setDeleteConfirm(false);
          }}
          onRequestDelete={() => setDeleteConfirm(true)}
          onCancelDelete={() => setDeleteConfirm(false)}
        />
      </section>
      <div className="sales-side-stack">
        {draft === null || selectedLine === null ? null : (
          <SalesDraftContextPanel
            copy={copy}
            draft={draft}
            locale={locale}
            selectedLine={selectedLine}
            itemContext={
              itemContext?.id === selectedLine.productId ? itemContext : null
            }
            itemContextUnavailable={itemContextUnavailable}
            panelSettings={
              quickAccess?.panelSettings ?? DEFAULT_SALE_PANEL_SETTINGS
            }
            onToggleCollapse={() => setIsContextCollapsed((prev) => !prev)}
          />
        )}
        <div className="sales-calculator-slot-wrap">
          {canViewDrawerBalance &&
          (quickAccess?.panelSettings.showDrawerBalance ?? false) ? (
            <div
              className="sales-drawer-balance"
              data-sales-drawer-balance
              role="status"
              aria-live="polite"
              data-testid="sales-drawer-balance"
            >
              <span className="sales-drawer-balance-label">
                {panelMessages.currentEmployeeDrawer}
              </span>
              <span className="sales-drawer-balance-value">
                {drawerLoading
                  ? panelMessages.drawerBalanceLoading
                  : drawerError !== null
                    ? drawerError
                    : drawerBalance !== null &&
                        drawerBalance.actorId === actorId
                      ? formatCurrencyFromFils(drawerBalance.value, locale)
                      : "—"}
              </span>
            </div>
          ) : null}
          <div
            className="sales-calculator-slot"
            id="sales-calculator-slot"
            ref={setCalculatorSlot}
          />
        </div>
      </div>
      {isContextCollapsed && draft !== null ? (
        <button
          type="button"
          className="sales-context-toggle-btn"
          aria-label={
            locale === "ar" ? "إظهار تفاصيل المادة" : "Show product details"
          }
          title={
            locale === "ar" ? "إظهار تفاصيل المادة" : "Show product details"
          }
          onClick={() => setIsContextCollapsed(false)}
        >
          <span className="sales-context-toggle-icon" aria-hidden="true">
            ℹ
          </span>
          <span>{locale === "ar" ? "تفاصيل المادة" : "Product details"}</span>
          {selectedLine !== null ? (
            <span className="sales-context-toggle-badge" aria-hidden="true" />
          ) : null}
        </button>
      ) : null}
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
                  openPriceDialog(selectedLine.id, value);
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
          onCancel={closePriceDialog}
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
              closePriceDialog,
            );
          }}
        />
      ) : null}
      {createProductOpen ? (
        <div className="sales-create-backdrop">
          <div
            aria-label={copy.createNewItemButton}
            aria-modal="true"
            className="sales-create-dialog"
            ref={createDialogRef}
            role="dialog"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeCreateProductDialog();
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = Array.from(
                createDialogRef.current?.querySelectorAll<HTMLElement>(
                  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
                ) ?? [],
              ).filter(
                (element) =>
                  element.getClientRects().length > 0 &&
                  getComputedStyle(element).visibility !== "hidden",
              );
              if (focusable.length === 0) {
                event.preventDefault();
                createDialogRef.current?.focus();
                return;
              }
              const activeIndex = focusable.indexOf(
                document.activeElement as HTMLElement,
              );
              if (event.shiftKey && activeIndex <= 0) {
                event.preventDefault();
                focusable[focusable.length - 1]?.focus();
              } else if (
                !event.shiftKey &&
                (activeIndex === -1 || activeIndex === focusable.length - 1)
              ) {
                event.preventDefault();
                focusable[0]?.focus();
              }
            }}
          >
            <ProductForm
              baseUrl={baseUrl}
              {...(createdBarcode !== null
                ? { initialBarcode: createdBarcode }
                : /^[0-9]{6,64}$/u.test(query.trim())
                  ? { initialBarcode: query.trim() }
                  : {})}
              onCancel={closeCreateProductDialog}
              onSuccess={(created) => {
                setCreateProductOpen(false);
                setCreatedBarcode(null);
                createProductReturnFocus.current = null;
                addToSale(created.id);
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
            ref={recordDialogRef}
            role="dialog"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeRecord();
              } else if (event.key === "Tab") {
                event.preventDefault();
                recordDialogRef.current?.querySelector("button")?.focus();
              }
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
      {presentationSettingsOpen && quickAccess !== null ? (
        <SalesPresentationSettings
          key={quickAccess.version}
          value={quickAccess}
          locale={locale}
          busy={quickBusy}
          retryRequired={pendingQuick.current !== null}
          error={quickError}
          onSave={handleSavePresentationSettings}
          onClose={() => {
            if (quickBusy || pendingQuick.current !== null) return;
            setPresentationSettingsOpen(false);
            commitFocus(() => presentationSettingsTriggerRef.current);
          }}
        />
      ) : null}
    </div>
  );
}

function SalesFooter({
  locale,
  state,
  busy = false,
  deleteConfirm = false,
  onPause,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}: {
  readonly locale: Locale;
  readonly state: "active" | "suspended" | "no-draft";
  readonly busy?: boolean;
  readonly deleteConfirm?: boolean;
  readonly onPause?: () => void;
  readonly onDelete?: () => void;
  readonly onRequestDelete?: () => void;
  readonly onCancelDelete?: () => void;
}): React.JSX.Element {
  const ar = locale === "ar";
  const [returnOpen, setReturnOpen] = useState(false);
  const disabledReason = ar
    ? "إتمام البيع والبحث في الفواتير والطباعة غير متاحة حتى اعتماد قواعد المحاسبة والصلاحيات. تغييرات المسودة المؤكدة محفوظة تلقائياً."
    : "Checkout, completed invoices, and printing are unavailable until accounting rules and permissions are approved. Confirmed draft edits are saved automatically.";
  return (
    <footer
      className="sales-action-footer"
      aria-label={ar ? "إجراءات البيع" : "Sales actions"}
    >
      <div className="sales-action-buttons">
        <button disabled type="button">
          {ar ? "طباعة" : "Print"}
        </button>
        <button disabled type="button">
          {ar ? "بحث" : "Search"}
        </button>
        <button disabled type="button">
          {ar ? "نقد" : "Cash"}
        </button>
        <button
          aria-expanded={returnOpen}
          disabled={state === "no-draft"}
          onClick={() => setReturnOpen((open) => !open)}
          type="button"
        >
          {ar ? "إرجاع" : "Return"}
        </button>
        <button disabled aria-describedby="sales-save-gate" type="button">
          {ar ? "حفظ" : "Save"}
        </button>
        <button
          disabled={busy || state !== "active"}
          onClick={onPause}
          type="button"
        >
          {ar ? "تعليق" : "Pause"}
        </button>
        <button
          disabled={busy || state === "no-draft"}
          onClick={onRequestDelete}
          type="button"
        >
          {ar ? "حذف" : "Delete"}
        </button>
      </div>
      {deleteConfirm ? (
        <div
          role="group"
          className="sales-footer-confirm"
          aria-label={ar ? "تأكيد الحذف" : "Confirm delete"}
        >
          <span>
            {ar ? "استبعاد هذه المسودة فقط؟" : "Discard this draft only?"}
          </span>
          <button disabled={busy} onClick={onDelete} type="button">
            {ar ? "تأكيد الحذف" : "Confirm delete"}
          </button>
          <button onClick={onCancelDelete} type="button">
            {ar ? "إلغاء" : "Cancel"}
          </button>
        </div>
      ) : null}
      {returnOpen ? (
        <p role="status">
          {ar
            ? "يفتح الإرجاع من فاتورة مكتملة. نشر الإرجاع ينتظر اعتماد قواعد التصرف في البضاعة G-02 وأمثلة المحاسبة G-01."
            : "Start a return from a completed invoice. Return posting awaits approved G-02 disposition rules and G-01 accounting examples."}
        </p>
      ) : null}
      <p id="sales-save-gate" role="status">
        {disabledReason}
      </p>
    </footer>
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
