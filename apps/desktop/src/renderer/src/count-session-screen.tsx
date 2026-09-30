import type {
  CountLine,
  CountSession,
  CountSessionSummary,
  Product,
  ProductSearchResult,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { searchProducts } from "./catalog-api";
import { useCommittedFocus } from "./committed-focus";
import {
  applyCountVariance,
  inventoryCommandAttempt,
  InventoryApiDenied,
  listCountSessions,
  readCountSession,
  recordCountLine,
  requestInventoryItems,
  startCountSession,
  completeCountSession,
} from "./inventory-api";
import { CountEntryLabel, CountMeasure } from "./count-entry-label";
import {
  buildCountEntryPreview,
  countEntryUnits,
  countFieldQuantity,
} from "./count-entry";
import { panelUnitLabel } from "./panel-unit-label";
import { inventoryMessages } from "./inventory-messages";
import { usePreferences } from "./preferences-provider";
import { formatDateTime, formatNumber } from "./preferences";

export function CountSessionScreen({
  baseUrl,
  canApprove,
  canRecord,
  canReviewInventory,
  checkNow,
  mode,
  sessionId,
}: {
  readonly baseUrl: string;
  readonly canApprove: boolean;
  readonly canRecord: boolean;
  readonly canReviewInventory: boolean;
  readonly checkNow: () => Promise<void>;
  readonly mode: "start" | "loop";
  readonly sessionId?: string;
}): React.JSX.Element {
  if (mode === "loop" && sessionId !== undefined) {
    return (
      <CountSessionLoop
        baseUrl={baseUrl}
        canApprove={canApprove}
        canRecord={canRecord}
        canReviewInventory={canReviewInventory}
        sessionId={sessionId}
      />
    );
  }
  return (
    <CountSessionStart
      baseUrl={baseUrl}
      canApprove={canApprove}
      canRecord={canRecord}
      checkNow={checkNow}
    />
  );
}

function CountSessionStart({
  baseUrl,
  canApprove,
  canRecord,
  checkNow,
}: {
  readonly baseUrl: string;
  readonly canApprove: boolean;
  readonly canRecord: boolean;
  readonly checkNow: () => Promise<void>;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale].count;
  const requestCommittedFocus = useCommittedFocus();
  const attemptRef = useRef<ReturnType<typeof inventoryCommandAttempt> | null>(
    null,
  );
  const [active, setActive] = useState<CountSessionSummary[] | null>(null);
  const [completed, setCompleted] = useState<CountSessionSummary[] | null>(
    null,
  );
  const [completedCursor, setCompletedCursor] = useState<string | null>(null);
  const [completedHasMore, setCompletedHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const [activeResult, completedResult] = await Promise.all([
        listCountSessions(baseUrl, { status: "active" }),
        listCountSessions(baseUrl, { limit: "25", status: "completed" }),
      ]);
      if (sequence.current !== current) return;
      setActive(activeResult.sessions);
      setCompleted(completedResult.sessions);
      setCompletedHasMore(completedResult.hasMore);
      setCompletedCursor(completedResult.nextCursor);
    } catch (caught) {
      if (sequence.current !== current) return;
      setError(countError(caught, copy));
    }
  }, [baseUrl, copy]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (active === null || completed === null) return;
    const selector =
      active.length > 0
        ? '[data-count-start-control="resume"]'
        : '[data-count-start-control="start"], [data-count-start-control="resume"]';
    requestCommittedFocus(() => document.querySelector<HTMLElement>(selector));
  }, [active, completed, requestCommittedFocus]);

  async function loadMoreCompleted(): Promise<void> {
    if (completedCursor === null || busy) return;
    const current = ++sequence.current;
    setBusy(true);
    try {
      const page = await listCountSessions(baseUrl, {
        cursor: completedCursor,
        limit: "25",
        status: "completed",
      });
      if (sequence.current !== current) return;
      setCompleted((currentSessions) => [
        ...(currentSessions ?? []),
        ...page.sessions,
      ]);
      setCompletedHasMore(page.hasMore);
      setCompletedCursor(page.nextCursor);
    } catch (caught) {
      if (sequence.current !== current) return;
      setError(countError(caught, copy));
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }

  async function start(): Promise<void> {
    if (!canRecord || busy || (active?.length ?? 0) > 0) return;
    const fingerprint = JSON.stringify({ command: "start-count-session" });
    const attempt = inventoryCommandAttempt(attemptRef.current, fingerprint);
    attemptRef.current = attempt;
    setBusy(true);
    setError(null);
    try {
      const session = await startCountSession(baseUrl, {
        idempotencyKey: attempt.idempotencyKey,
      });
      window.location.hash = `#/inventory/count/${session.id}`;
    } catch (caught) {
      setError(countError(caught, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="inventory-workspace count-workspace"
      aria-labelledby="count-title"
    >
      <header className="inventory-heading count-heading">
        <div>
          <p className="inventory-context-label">{copy.title}</p>
          <h2 id="count-title">{copy.startTitle}</h2>
          <p>{copy.description}</p>
        </div>
        {canRecord ? (
          <button
            className="primary-button"
            data-count-start-control="start"
            disabled={busy || (active?.length ?? 0) > 0}
            type="button"
            onClick={() => void start()}
          >
            {copy.start}
          </button>
        ) : null}
      </header>
      {active !== null && active.length > 0 ? (
        <p className="count-active-warning" role="status">
          {copy.activeSessionWarning}
        </p>
      ) : null}
      <p>
        <a className="inventory-chip inventory-chip-primary" href="#/inventory">
          {inventoryMessages[locale].backToInventory}
        </a>
      </p>
      {error === null ? null : (
        <div aria-live="assertive" className="denial-alert" role="alert">
          <p>{error}</p>
          <button
            className="quiet-button"
            type="button"
            onClick={() => {
              void checkNow().then(load);
            }}
          >
            {inventoryMessages[locale].retry}
          </button>
        </div>
      )}
      {active === null || completed === null ? (
        <p role="status">{inventoryMessages[locale].loading}</p>
      ) : (
        <>
          <SessionSummaryList
            canOpen={canRecord || canApprove}
            canRecord={canRecord}
            copy={copy}
            headingId="count-active-sessions"
            locale={locale}
            sessions={active}
            title={copy.activeSessions}
            empty={copy.noActiveSessions}
            onResume={(id) => {
              window.location.hash = `#/inventory/count/${id}`;
            }}
          />
          <SessionSummaryList
            canOpen={canRecord || canApprove}
            canRecord={false}
            copy={copy}
            headingId="count-completed-sessions"
            hasMore={completedHasMore}
            locale={locale}
            sessions={completed}
            title={copy.completedSessions}
            empty={copy.noCompletedSessions}
            onLoadMore={() => void loadMoreCompleted()}
            onResume={(id) => {
              window.location.hash = `#/inventory/count/${id}`;
            }}
          />
        </>
      )}
    </section>
  );
}

function SessionSummaryList({
  canOpen,
  canRecord,
  copy,
  empty,
  hasMore = false,
  headingId,
  locale,
  onLoadMore,
  onResume,
  sessions,
  title,
}: {
  readonly canOpen: boolean;
  readonly canRecord: boolean;
  readonly copy: typeof inventoryMessages.en.count;
  readonly empty: string;
  readonly hasMore?: boolean;
  readonly headingId: string;
  readonly locale: "ar" | "en";
  readonly onLoadMore?: () => void;
  readonly onResume: (id: string) => void;
  readonly sessions: CountSessionSummary[];
  readonly title: string;
}): React.JSX.Element {
  return (
    <section className="count-session-list" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {sessions.length === 0 ? (
        <p role="status">{empty}</p>
      ) : (
        <ul>
          {sessions.map((session) => (
            <li key={session.id}>
              <div>
                <strong>
                  {session.number === null
                    ? copy.title
                    : `C${session.number.value}/${session.number.year}`}
                </strong>
                <span>
                  {copy.startedAt}{" "}
                  {formatDateTime(new Date(session.startedAt), locale)} ·{" "}
                  {session.startedBy.displayName}
                </span>
                <span>
                  {copy.lineCount}:{" "}
                  <bdi>{formatNumber(BigInt(session.lineCount), locale)}</bdi> ·{" "}
                  {copy.pendingVariances}:{" "}
                  <bdi>
                    {formatNumber(BigInt(session.pendingVarianceCount), locale)}
                  </bdi>
                </span>
              </div>
              {canOpen ? (
                <button
                  className="quiet-button"
                  data-count-start-control="resume"
                  type="button"
                  onClick={() => onResume(session.id)}
                >
                  {canRecord ? copy.resume : copy.title}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {hasMore && onLoadMore !== undefined ? (
        <button className="quiet-button" type="button" onClick={onLoadMore}>
          {copy.loadMore}
        </button>
      ) : null}
    </section>
  );
}

function CountSessionLoop({
  baseUrl,
  canApprove,
  canRecord,
  canReviewInventory,
  sessionId,
}: {
  readonly baseUrl: string;
  readonly canApprove: boolean;
  readonly canRecord: boolean;
  readonly canReviewInventory: boolean;
  readonly sessionId: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale].count;
  const requestCommittedFocus = useCommittedFocus();
  const [session, setSession] = useState<CountSession | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [suggestions, setSuggestions] = useState<
    readonly ProductSearchResult[]
  >([]);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const searchSequence = useRef(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [inventoryBalances, setInventoryBalances] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyLine, setApplyLine] = useState<CountLine | null>(null);
  const [blockedProductId, setBlockedProductId] = useState<string | null>(null);
  const applyOpenerRef = useRef<HTMLElement | null>(null);
  const attemptRef = useRef<ReturnType<typeof inventoryCommandAttempt> | null>(
    null,
  );
  const sequence = useRef(0);
  const initialFocusDone = useRef(false);

  const loadSession = useCallback(async (): Promise<CountSession | null> => {
    const current = ++sequence.current;
    try {
      const next = await readCountSession(baseUrl, sessionId);
      if (sequence.current !== current) return null;
      setSession(next);
      return next;
    } catch (caught) {
      if (sequence.current !== current) return null;
      setError(countError(caught, copy));
      return null;
    }
  }, [baseUrl, copy, sessionId]);

  useEffect(() => {
    void loadSession();
    // The grid read needs inventory.review; a count-only user sees the balance
    // once the line is saved, because the server returns it with the line.
    if (!canReviewInventory) return;
    void requestInventoryItems(baseUrl)
      .then((response) => {
        const balances = new Map(
          response.items.map((item) => [item.productId, item.balance]),
        );
        setInventoryBalances(balances);
      })
      .catch(() => {
        // The balance card falls back to the recorded line.
      });
  }, [baseUrl, canReviewInventory, loadSession]);

  useEffect(() => {
    if (session === null || initialFocusDone.current) return;
    initialFocusDone.current = true;
    requestCommittedFocus(() => document.getElementById("count-item"));
  }, [requestCommittedFocus, session]);

  const latestLines = useMemo(() => {
    const byProduct = new Map<string, CountLine>();
    for (const line of session?.lines ?? [])
      byProduct.set(line.productId, line);
    return byProduct;
  }, [session?.lines]);

  const selectedLine =
    selectedProduct === null
      ? null
      : (latestLines.get(selectedProduct.id) ?? null);
  const preview =
    selectedProduct === null
      ? null
      : buildCountEntryPreview(selectedProduct.packaging, fields);
  const selectedBalance =
    selectedLine?.currentBalance ??
    (selectedProduct === null
      ? null
      : (inventoryBalances.get(selectedProduct.id) ?? null));
  const blockedQuantity = selectedLine?.blockedQuantityAtObservation ?? "0";

  useEffect(() => {
    const query = itemQuery.trim();
    if (query.length < 2 || selectedProduct !== null) return;
    const current = ++searchSequence.current;
    const timer = window.setTimeout(() => {
      void searchProducts(baseUrl, { limit: "20", query })
        .then((result) => {
          if (searchSequence.current !== current) return;
          setSuggestions(result.results);
          setHighlightedSuggestion(result.results.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (searchSequence.current === current) setSuggestions([]);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      searchSequence.current++;
    };
  }, [baseUrl, itemQuery, selectedProduct]);

  function focusItem(): void {
    requestCommittedFocus(() => document.getElementById("count-item"));
  }

  function focusUnit(key: string): void {
    requestCommittedFocus(() => findCountUnitField(key));
  }

  function selectItem(product: Product): void {
    setSuggestions([]);
    setHighlightedSuggestion(-1);
    if (product.status !== "active") {
      setError(copy.archivedItem);
      focusItem();
      return;
    }
    setError(null);
    setItemQuery(product.displayName);
    setSelectedProduct(product);
    setFields({});
    const defaultKey = countUnitKey(
      product.packaging.defaultUnits.count,
      product.packaging.inventoryUnitName,
    );
    requestCommittedFocus(() => findCountUnitField(defaultKey));
  }

  async function resolveItem(): Promise<void> {
    const query = itemQuery.trim();
    if (query === "") {
      setError(copy.itemRequired);
      focusItem();
      return;
    }
    if (selectedProduct !== null && query === selectedProduct.displayName) {
      focusUnit(
        countUnitKey(
          selectedProduct.packaging.defaultUnits.count,
          selectedProduct.packaging.inventoryUnitName,
        ),
      );
      return;
    }
    const current = ++sequence.current;
    setBusy(true);
    setError(null);
    setBlockedProductId(null);
    try {
      const result = await searchProducts(baseUrl, { limit: "20", query });
      if (sequence.current !== current) return;
      const exactBarcode = result.results.find(
        ({ matchedBarcode }) => matchedBarcode?.value === query,
      );
      const product = exactBarcode?.product ?? result.results[0]?.product;
      if (product === undefined) {
        setError(copy.itemNotFound);
        focusItem();
        return;
      }
      selectItem(product);
    } catch (caught) {
      if (sequence.current !== current) return;
      setError(countError(caught, copy));
      focusItem();
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }

  async function saveLine(): Promise<void> {
    if (!canRecord || busy) return;
    if (selectedProduct === null || preview === null) {
      setError(copy.itemRequired);
      focusItem();
      return;
    }
    if (preview.invalidField !== null) {
      setError(copy.validationEntryInteger);
      focusUnit(preview.invalidField);
      return;
    }
    if (!preview.hasValue) {
      setError(copy.validationEntryRequired);
      focusUnit(
        countUnitKey(
          selectedProduct.packaging.defaultUnits.count,
          selectedProduct.packaging.inventoryUnitName,
        ),
      );
      return;
    }
    if (session === null) return;
    const request = {
      entries: preview.entries,
      expectedVersion: session.version,
      productId: selectedProduct.id,
    };
    const attempt = inventoryCommandAttempt(
      attemptRef.current,
      JSON.stringify({ command: "record-count-line", sessionId, request }),
    );
    attemptRef.current = attempt;
    const activeField = document.activeElement as HTMLElement | null;
    const activeFieldKey = activeField?.dataset.countField ?? "item";
    const current = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await recordCountLine(baseUrl, sessionId, {
        ...request,
        idempotencyKey: attempt.idempotencyKey,
      });
      if (sequence.current !== current) return;
      setAnnouncement(
        copy.savedAnnouncement(
          result.line.itemDisplayName,
          result.line.countedQuantity,
          panelUnitLabel(
            result.line.inventoryUnitName,
            BigInt(result.line.countedQuantity),
            locale,
          ),
          formatSignedNumber(BigInt(result.line.varianceAtObservation), locale),
        ),
      );
      setSelectedProduct(null);
      setItemQuery("");
      setFields({});
      await loadSession();
      setBusy(false);
      requestCommittedFocus(() => document.getElementById("count-item"));
    } catch (caught) {
      if (sequence.current !== current) return;
      if (isRefetchableCountConflict(caught)) {
        const refreshed = await loadSession();
        const refreshedLine =
          selectedProduct === null
            ? undefined
            : refreshed?.lines.find(
                (line) => line.productId === selectedProduct.id,
              );
        setAnnouncement(
          caught instanceof InventoryApiDenied &&
            caught.denial.code === "count-balance-changed"
            ? copy.balanceChanged(
                refreshedLine?.currentBalance ?? selectedBalance ?? "—",
              )
            : countError(caught, copy),
        );
        setBusy(false);
        requestCommittedFocus(() => countFieldTarget(activeFieldKey));
      } else if (caught instanceof InventoryApiDenied) {
        setError(countError(caught, copy));
        const fieldIndex = caught.denial.fieldErrors[0]?.path[1];
        const entryUnit =
          caught.denial.fieldErrors[0]?.path[0] === "entries" &&
          typeof fieldIndex === "number"
            ? countEntryUnits(selectedProduct.packaging)[fieldIndex]
            : undefined;
        if (entryUnit === undefined) {
          focusUnit(
            countUnitKey(
              selectedProduct.packaging.defaultUnits.count,
              selectedProduct.packaging.inventoryUnitName,
            ),
          );
        } else {
          focusUnit(entryUnit.key);
        }
      } else {
        setError(countError(caught, copy));
        focusItem();
      }
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }

  function onItemChange(value: string): void {
    setItemQuery(value);
    setSuggestions([]);
    setHighlightedSuggestion(-1);
    if (selectedProduct !== null && value !== selectedProduct.displayName) {
      setSelectedProduct(null);
      setFields({});
    }
  }

  function openApply(line: CountLine, opener: HTMLElement): void {
    if (!canApprove) return;
    applyOpenerRef.current = opener;
    setApplyLine(line);
  }

  async function applyLineVariance(
    line: CountLine,
    reason: string,
    evidence: string,
  ): Promise<void> {
    if (session === null) return;
    const request = {
      evidence,
      expectedBalanceBefore: line.currentBalance,
      expectedVersion: session.version,
      reason,
    };
    const attempt = inventoryCommandAttempt(
      attemptRef.current,
      JSON.stringify({
        command: "apply-count-variance",
        sessionId,
        lineId: line.id,
        request,
      }),
    );
    attemptRef.current = attempt;
    const current = ++sequence.current;
    setBusy(true);
    setError(null);
    setBlockedProductId(null);
    try {
      await applyCountVariance(baseUrl, sessionId, line.id, {
        ...request,
        idempotencyKey: attempt.idempotencyKey,
      });
      if (sequence.current !== current) return;
      setApplyLine(null);
      setAnnouncement(copy.applicationSaved);
      await loadSession();
      setBusy(false);
      requestCommittedFocus(() => document.getElementById("count-item"));
    } catch (caught) {
      if (sequence.current !== current) return;
      if (isRefetchableCountConflict(caught)) {
        const refreshed = await loadSession();
        const refreshedLine = refreshed?.lines.find(
          (candidate) => candidate.id === line.id,
        );
        setAnnouncement(
          caught instanceof InventoryApiDenied &&
            caught.denial.code === "count-balance-changed"
            ? copy.balanceChanged(
                refreshedLine?.currentBalance ?? line.currentBalance,
              )
            : countError(caught, copy),
        );
        setApplyLine(null);
        setBusy(false);
        requestCommittedFocus(() => document.getElementById("count-item"));
      } else {
        if (
          caught instanceof InventoryApiDenied &&
          caught.denial.code === "count-blocked-stock"
        ) {
          setBlockedProductId(line.productId);
        }
        setError(countError(caught, copy));
      }
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }

  async function complete(opener: HTMLElement): Promise<void> {
    if (
      session === null ||
      session.status !== "active" ||
      !canApprove ||
      BigInt(session.pendingVarianceCount) > 0n
    ) {
      return;
    }
    const request = {
      expectedVersion: session.version,
    };
    const attempt = inventoryCommandAttempt(
      attemptRef.current,
      JSON.stringify({ command: "complete-count-session", sessionId, request }),
    );
    attemptRef.current = attempt;
    const current = ++sequence.current;
    setBusy(true);
    try {
      await completeCountSession(baseUrl, sessionId, {
        ...request,
        idempotencyKey: attempt.idempotencyKey,
      });
      if (sequence.current !== current) return;
      setAnnouncement(copy.completed);
      await loadSession();
      setBusy(false);
      requestCommittedFocus(() => opener);
    } catch (caught) {
      if (sequence.current !== current) return;
      if (isRefetchableCountConflict(caught)) await loadSession();
      setError(countError(caught, copy));
      requestCommittedFocus(() => opener);
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }

  function closeApply(): void {
    setApplyLine(null);
    requestCommittedFocus(() => applyOpenerRef.current);
  }

  if (session === null) {
    return (
      <section className="inventory-workspace count-workspace">
        {error === null ? (
          <p role="status">{inventoryMessages[locale].loading}</p>
        ) : (
          <p className="denial-alert" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const canEditSession = canRecord && session.status === "active";
  return (
    <section
      className="inventory-workspace count-workspace"
      aria-labelledby="count-loop-title"
    >
      <header className="inventory-heading count-heading">
        <div>
          <p className="inventory-context-label">{copy.title}</p>
          <h2 id="count-loop-title">{copy.loopTitle}</h2>
          <p>
            {session.number === null
              ? ""
              : `C${session.number.value}/${session.number.year} · `}
            {copy.startedAt}{" "}
            {formatDateTime(new Date(session.startedAt), locale)} ·{" "}
            {session.startedBy.displayName}
          </p>
        </div>
        <div className="count-heading-actions">
          <a className="quiet-button" href="#/inventory/count">
            {copy.startTitle}
          </a>
          {session.status === "active" && canApprove ? (
            <button
              aria-describedby={
                BigInt(session.pendingVarianceCount) > 0n
                  ? "count-complete-blocked"
                  : undefined
              }
              className="primary-button"
              disabled={busy || BigInt(session.pendingVarianceCount) > 0n}
              id="count-complete"
              type="button"
              onClick={(event) => void complete(event.currentTarget)}
            >
              {copy.complete}
            </button>
          ) : session.status === "completed" ? (
            <button
              aria-disabled="true"
              className="quiet-button"
              id="count-complete"
              type="button"
            >
              {copy.completed}
            </button>
          ) : null}
        </div>
      </header>
      {session.status === "active" &&
      canApprove &&
      BigInt(session.pendingVarianceCount) > 0n ? (
        <p id="count-complete-blocked" role="status">
          {copy.completionBlocked(session.pendingVarianceCount)}
        </p>
      ) : null}
      {error === null ? null : (
        <div aria-live="assertive" className="denial-alert" role="alert">
          <p>{error}</p>
          {blockedProductId === null ? null : (
            <a href={`#/inventory/items/${blockedProductId}/movements`}>
              {copy.reviewBatches}
            </a>
          )}
        </div>
      )}
      <p className="visually-hidden" aria-live="polite" role="status">
        {announcement}
      </p>
      {canEditSession ? (
        <form
          className="count-entry-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveLine();
          }}
        >
          <div className="count-item-search">
            <label className="count-item-field" htmlFor="count-item">
              <span>{copy.item}</span>
              <input
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="count-item-suggestions"
                aria-expanded={suggestions.length > 0}
                aria-activedescendant={
                  highlightedSuggestion < 0
                    ? undefined
                    : `count-suggestion-${highlightedSuggestion}`
                }
                role="combobox"
                data-count-field="item"
                disabled={busy}
                id="count-item"
                placeholder={copy.itemPlaceholder}
                type="text"
                value={itemQuery}
                onChange={(event) => onItemChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && suggestions.length > 0) {
                    event.preventDefault();
                    setHighlightedSuggestion(
                      (index) => (index + 1) % suggestions.length,
                    );
                  } else if (
                    event.key === "ArrowUp" &&
                    suggestions.length > 0
                  ) {
                    event.preventDefault();
                    setHighlightedSuggestion(
                      (index) =>
                        (index - 1 + suggestions.length) % suggestions.length,
                    );
                  } else if (event.key === "Escape") {
                    setSuggestions([]);
                    setHighlightedSuggestion(-1);
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const suggestion = suggestions[highlightedSuggestion];
                    if (suggestion === undefined) void resolveItem();
                    else selectItem(suggestion.product);
                  }
                }}
              />
            </label>
            {suggestions.length > 0 ? (
              <div
                className="count-item-suggestions"
                id="count-item-suggestions"
                role="listbox"
              >
                {suggestions.map((result, index) => (
                  <button
                    aria-selected={index === highlightedSuggestion}
                    id={`count-suggestion-${index}`}
                    key={result.product.id}
                    role="option"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectItem(result.product)}
                  >
                    <span>{result.product.displayName}</span>
                    <small>
                      {result.matchedBarcode?.value ??
                        result.product.barcodes[0]?.value ??
                        ""}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {selectedProduct === null ? (
            <p className="count-entry-prompt">{copy.itemPlaceholder}</p>
          ) : (
            <div className="count-resolved-item">
              <div className="count-status-card">
                <h3>{selectedProduct.displayName}</h3>
                <div className="count-balance-row">
                  <span>{copy.currentBalance}</span>
                  <strong className="count-balance-value">
                    {selectedBalance === null ? (
                      "—"
                    ) : (
                      <BalanceDecomposition
                        locale={locale}
                        packaging={selectedProduct.packaging}
                        quantity={selectedBalance}
                      />
                    )}
                  </strong>
                </div>
                {BigInt(blockedQuantity) > 0n ? (
                  <p>
                    {copy.blockedStock(
                      formatNumber(BigInt(blockedQuantity), locale),
                    )}
                  </p>
                ) : null}
                <a href={`#/inventory/items/${selectedProduct.id}/movements`}>
                  {copy.reviewBatches}
                </a>
              </div>
              <div className="count-unit-fields">
                {countEntryUnits(selectedProduct.packaging).map((unit) => (
                  <label className="count-unit-field" key={unit.key}>
                    <span>
                      {copy.unitCaption(panelUnitLabel(unit.label, 1n, locale))}
                    </span>
                    <input
                      aria-label={copy.unitCaption(
                        panelUnitLabel(unit.label, 1n, locale),
                      )}
                      data-count-field={`unit:${unit.key}`}
                      disabled={busy}
                      inputMode="numeric"
                      type="text"
                      value={fields[unit.key] ?? ""}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          [unit.key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              {preview === null ? null : (
                <CountCaption
                  fields={fields}
                  locale={locale}
                  packaging={selectedProduct.packaging}
                />
              )}
              <div className="count-entry-actions">
                <button
                  className="primary-button count-save-button"
                  disabled={busy}
                  type="submit"
                >
                  {copy.save}
                </button>
              </div>
            </div>
          )}
        </form>
      ) : null}
      <div className="count-lines-container">
        <h3>{copy.lines}</h3>
        {session.lines.length === 0 ? (
          <p role="status">{copy.emptyLines}</p>
        ) : (
          <CountLinesTable
            canApprove={canApprove}
            copy={copy}
            lines={session.lines}
            locale={locale}
            onApply={openApply}
          />
        )}
      </div>
      {applyLine === null ? null : (
        <ApplyVarianceDialog
          busy={busy}
          copy={copy}
          line={applyLine}
          locale={locale}
          onCancel={closeApply}
          onSubmit={(reason, evidence) =>
            void applyLineVariance(applyLine, reason, evidence)
          }
        />
      )}
    </section>
  );
}

function CountCaption({
  fields,
  locale,
  packaging,
}: {
  readonly fields: Readonly<Record<string, string>>;
  readonly locale: "ar" | "en";
  readonly packaging: Product["packaging"];
}): React.JSX.Element {
  const preview = buildCountEntryPreview(packaging, fields);
  const visible = countEntryUnits(packaging).flatMap((unit) => {
    const quantity = countFieldQuantity(fields[unit.key] ?? "");
    return quantity !== null && quantity > 0n ? [{ quantity, unit }] : [];
  });
  return (
    <p className="count-live-caption" aria-live="polite">
      {visible.length === 0 ? (
        <>
          <bdi>0</bdi> {panelUnitLabel(packaging.inventoryUnitName, 0n, locale)}
        </>
      ) : (
        visible.map(({ quantity, unit }, index) => (
          <span key={unit.key}>
            {index > 0 ? " + " : ""}
            <bdi>{formatNumber(quantity, locale)}</bdi>{" "}
            {panelUnitLabel(unit.label, quantity, locale)}
          </span>
        ))
      )}
      {" = "}
      <bdi>{formatNumber(preview.countedQuantity, locale)}</bdi>{" "}
      {panelUnitLabel(
        packaging.inventoryUnitName,
        preview.countedQuantity,
        locale,
      )}
    </p>
  );
}

function BalanceDecomposition({
  locale,
  packaging,
  quantity,
}: {
  readonly locale: "ar" | "en";
  readonly packaging: Product["packaging"];
  readonly quantity: string;
}): React.JSX.Element {
  let remainder = BigInt(quantity);
  const parts: Array<{ count: bigint; label: string }> = [];
  for (const unit of countEntryUnits(packaging)) {
    const count = remainder / unit.ratio;
    remainder %= unit.ratio;
    if (count > 0n) parts.push({ count, label: unit.label });
  }
  if (parts.length === 0) {
    parts.push({ count: 0n, label: packaging.inventoryUnitName });
  }
  return (
    <span>
      {parts.map((part, index) => (
        <span key={part.label}>
          {index > 0 ? " + " : ""}
          <bdi>{formatNumber(part.count, locale)}</bdi>{" "}
          {panelUnitLabel(part.label, part.count, locale)}
        </span>
      ))}
    </span>
  );
}

function CountLinesTable({
  canApprove,
  copy,
  lines,
  locale,
  onApply,
}: {
  readonly canApprove: boolean;
  readonly copy: typeof inventoryMessages.en.count;
  readonly lines: CountLine[];
  readonly locale: "ar" | "en";
  readonly onApply: (line: CountLine, opener: HTMLElement) => void;
}): React.JSX.Element {
  return (
    <div className="count-lines-table-wrap">
      <table className="count-lines-table">
        <caption className="visually-hidden">{copy.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.columns.item}</th>
            <th scope="col">{copy.columns.recorded}</th>
            <th scope="col">{copy.columns.counted}</th>
            <th scope="col">{copy.columns.before}</th>
            <th scope="col">{copy.columns.after}</th>
            <th scope="col">{copy.columns.variance}</th>
            <th scope="col">{copy.columns.status}</th>
            <th scope="col">{copy.columns.action}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const before =
              line.application?.balanceBefore ?? line.balanceAtObservation;
            const after =
              line.application?.balanceAfter ?? line.countedQuantity;
            const variance = line.application?.variance ?? line.currentVariance;
            return (
              <tr key={line.id}>
                <th scope="row">{line.itemDisplayName}</th>
                <td>
                  <CountEntryLabel label={line.enteredLabel} locale={locale} />
                  {BigInt(line.blockedQuantityAtObservation) > 0n ? (
                    <small className="count-blocked-note">
                      {" "}
                      ·{" "}
                      <CountEntryLabel
                        label={copy.includesBlocked(
                          line.blockedQuantityAtObservation,
                        )}
                        locale={locale}
                      />
                    </small>
                  ) : null}
                  <br />
                  <a href={`#/inventory/items/${line.productId}/movements`}>
                    {copy.reviewBatches}
                  </a>
                </td>
                <td>
                  <bdi>
                    {formatNumber(BigInt(line.countedQuantity), locale)}
                  </bdi>{" "}
                  {panelUnitLabel(
                    line.inventoryUnitName,
                    BigInt(line.countedQuantity),
                    locale,
                  )}
                </td>
                <td>
                  <CountMeasure
                    count={BigInt(before)}
                    locale={locale}
                    unit={line.inventoryUnitName}
                  />
                </td>
                <td>
                  <CountMeasure
                    count={BigInt(after)}
                    locale={locale}
                    unit={line.inventoryUnitName}
                  />
                </td>
                <td>
                  <CountMeasure
                    count={BigInt(variance)}
                    locale={locale}
                    signed
                    unit={line.inventoryUnitName}
                  />
                </td>
                <td>
                  <span aria-hidden="true">{lineStatusIcon(line.status)}</span>{" "}
                  {copy.statusLabels[line.status]}
                </td>
                <td>
                  {canApprove &&
                  (line.status === "pending" || line.status === "stale") ? (
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={(event) => onApply(line, event.currentTarget)}
                    >
                      {copy.applyVariance}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ApplyVarianceDialog({
  busy,
  copy,
  line,
  locale,
  onCancel,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly copy: typeof inventoryMessages.en.count;
  readonly line: CountLine;
  readonly locale: "ar" | "en";
  readonly onCancel: () => void;
  readonly onSubmit: (reason: string, evidence: string) => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const requestCommittedFocus = useCommittedFocus();
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => {
    requestCommittedFocus(() => reasonRef.current);
  }, [requestCommittedFocus]);
  return (
    <div
      ref={dialogRef}
      aria-labelledby="count-variance-dialog-title"
      aria-modal="true"
      className="dialog-backdrop"
      role="dialog"
      onKeyDown={(event) => trapDialogKey(event, dialogRef, onCancel)}
    >
      <section className="identity-card count-variance-dialog">
        <h2 id="count-variance-dialog-title">{copy.applyVariance}</h2>
        <p className="count-variance-sentence">
          <span className="visually-hidden">
            {copy.varianceSentence(
              line.currentBalance,
              line.countedQuantity,
              formatSignedNumber(BigInt(line.currentVariance), locale),
            )}
          </span>
          {copy.columns.before}{" "}
          <CountMeasure
            count={BigInt(line.currentBalance)}
            locale={locale}
            unit={line.inventoryUnitName}
          />
          , {copy.columns.counted}{" "}
          <CountMeasure
            count={BigInt(line.countedQuantity)}
            locale={locale}
            unit={line.inventoryUnitName}
          />
          , {copy.columns.variance}{" "}
          <CountMeasure
            count={BigInt(line.currentVariance)}
            locale={locale}
            signed
            unit={line.inventoryUnitName}
          />
          .
        </p>
        <form
          className="batch-safety-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const reason = String(data.get("reason") ?? "").trim();
            const evidence = String(data.get("evidence") ?? "").trim();
            if (reason === "" || evidence === "") {
              setValidationError(
                reason === "" ? copy.reasonHint : copy.evidenceHint,
              );
              requestCommittedFocus(() =>
                reason === ""
                  ? reasonRef.current
                  : form.querySelector<HTMLTextAreaElement>(
                      'textarea[name="evidence"]',
                    ),
              );
              return;
            }
            onSubmit(reason, evidence);
          }}
        >
          <label className="field-label">
            <span>{copy.applicationReason}</span>
            <textarea ref={reasonRef} aria-required="true" name="reason" />
          </label>
          <p className="field-hint">{copy.reasonHint}</p>
          <label className="field-label">
            <span>{copy.applicationEvidence}</span>
            <textarea aria-required="true" name="evidence" />
          </label>
          <p className="field-hint">{copy.evidenceHint}</p>
          {validationError === null ? null : (
            <p aria-live="assertive" className="form-error" role="alert">
              {validationError}
            </p>
          )}
          <div className="form-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {copy.applyVariance}
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={onCancel}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function trapDialogKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  dialogRef: React.RefObject<HTMLDivElement | null>,
  onCancel: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  );
  if (focusable === undefined || focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function countUnitKey(
  unit: Product["packaging"]["defaultUnits"]["count"],
  inventoryUnitName: string,
): string {
  return unit.kind === "inventory-unit"
    ? inventoryUnitName
    : unit.packageUnitName;
}

function findCountUnitField(key: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-count-field^="unit:"]',
  )) {
    if (element.dataset.countField === `unit:${key}`) return element;
  }
  return null;
}

function countFieldTarget(field: string): HTMLElement | null {
  if (field === "item") return document.getElementById("count-item");
  return findCountUnitField(field.replace(/^unit:/u, ""));
}

function lineStatusIcon(status: CountLine["status"]): string {
  switch (status) {
    case "matched":
      return "✓";
    case "pending":
      return "•";
    case "stale":
      return "!";
    case "applied":
      return "✓";
  }
}

function formatSignedNumber(value: bigint, locale: "ar" | "en"): string {
  return value > 0n
    ? `+${formatNumber(value, locale)}`
    : formatNumber(value, locale);
}

function isRefetchableCountConflict(caught: unknown): boolean {
  return (
    caught instanceof InventoryApiDenied &&
    (caught.denial.code === "version-conflict" ||
      caught.denial.code === "count-balance-changed" ||
      caught.denial.code === "count-variance-already-applied")
  );
}

function countError(
  caught: unknown,
  copy: typeof inventoryMessages.en.count,
): string {
  if (caught instanceof InventoryApiDenied) {
    return (
      copy.denialMessages[
        caught.denial.code as keyof typeof copy.denialMessages
      ] ?? copy.unavailable
    );
  }
  return copy.unavailable;
}
