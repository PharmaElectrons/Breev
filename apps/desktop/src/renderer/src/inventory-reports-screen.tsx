import {
  INVENTORY_REPORT_DEFINITIONS,
  INVENTORY_REPORT_KINDS,
  INVENTORY_REPORT_SENSITIVE_COLUMNS,
  inventoryReportKindSchema,
  inventoryReportQueryFor,
  type InventoryReport,
  type InventoryReportColumn,
  type InventoryReportQuery,
  type InventoryReportRow,
  type InventoryReportSource,
  type InventoryReportActivityPage,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentityState } from "./identity-state-provider";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { identityMessages } from "./identity-messages";
import { licensingMessages } from "./licensing-messages";
import { usePreferences } from "./preferences-provider";
import { useCommittedFocus } from "./committed-focus";
import {
  readInventoryReport,
  exportInventoryReport,
  exportProtectedInventoryReport,
  ReportApiDenied,
  readInventoryReportActivity,
} from "./report-api";
import { reportMessages } from "./report-messages";
import {
  pharmacyLocalDateTime,
  pharmacyLocalToInstant,
  reportTimestamp,
  reportTimeZoneLabel,
} from "./report-time";
import {
  ReportColumnFilters,
  ReportTable,
  reportCell,
  reportSourceLabel,
  containReportDialogFocus,
} from "./report-workspace";
import { canonicalReportFilters, ReportFilterError } from "./report-filter";
import { ordinaryReportExport } from "./report-export-query";
import { ReportSourceReview } from "./report-source-review";
import { StepUpDialog, useStepUp, type StepUpDenial } from "./step-up";
import { formatNumber } from "./preferences";
import "./inventory-reports.css";

export function InventoryReportsScreen({
  baseUrl,
  hash,
}: {
  readonly baseUrl: string;
  readonly hash: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const { state: identity } = useIdentityState();
  const copy = reportMessages[locale];
  const parsedKind = inventoryReportKindSchema.safeParse(
    hash.split("/").at(-1),
  );
  const kind = parsedKind.success ? parsedKind.data : "quantity";
  const permissions =
    identity?.state === "authenticated" ? identity.allowedPermissions : [];
  const valuation = permissions.includes("inventory.valuation.view");
  const allowedColumns = INVENTORY_REPORT_DEFINITIONS[kind].columns.filter(
    (c) => valuation || !INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(c),
  );
  const [query, setQuery] = useState<Partial<InventoryReportQuery>>({});
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<
    | "denied"
    | "invalidPeriod"
    | "unavailable"
    | "tooLarge"
    | "exportFailed"
    | null
  >(null);
  const [committedRequest, setCommittedRequest] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const initializedKind = useRef<string | null>(null);
  const [exportStatus, setExportStatus] = useState<
    "saved" | "cancelled" | "tooLarge" | "exportFailed" | null
  >(null);
  const [exporting, setExporting] = useState(false);
  const [confirmOrdinary, setConfirmOrdinary] = useState(false);
  const ordinaryDialog = useRef<HTMLDialogElement>(null);
  const ordinaryOpener = useRef<HTMLElement | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState<InventoryReportQuery["filters"]>([]);
  const [filterError, setFilterError] = useState<{
    index: number;
    rule: "number" | "precision";
  } | null>(null);
  const [activity, setActivity] = useState<InventoryReportRow | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [activityResult, setActivityResult] =
    useState<InventoryReportActivityPage | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [source, setSource] = useState<InventoryReportSource | null>(null);
  const [stepUpDenial, setStepUpDenial] = useState<StepUpDenial | null>(null);
  const activityDialog = useRef<HTMLDialogElement>(null);
  const activityOpener = useRef<HTMLElement | null>(null);
  const sourceOpener = useRef<HTMLElement | null>(null);
  const focus = useCommittedFocus();
  const queryKey = JSON.stringify(query);
  const previousKind = useRef(kind);
  const categoryMatchesQuery = previousKind.current === kind;
  useEffect(() => {
    if (previousKind.current === kind) return;
    previousKind.current = kind;
    setFilters([]);
    setFilterError(null);
    setDraftDirty(false);
    setQuery((current) => ({
      ...(current.from === undefined ? {} : { from: current.from }),
      ...(current.to === undefined ? {} : { to: current.to }),
      ...(current.actorId === undefined ? {} : { actorId: current.actorId }),
    }));
  }, [kind]);
  const stale =
    report !== null &&
    (draftDirty ||
      loading ||
      error !== null ||
      committedRequest !== `${kind}:${queryKey}`);
  const ordinary = report === null ? null : ordinaryReportExport(report.query);
  useEffect(() => {
    if (
      confirmOrdinary &&
      ordinaryDialog.current !== null &&
      !ordinaryDialog.current.open
    )
      ordinaryDialog.current.showModal();
  }, [confirmOrdinary]);
  useEffect(() => {
    if (!categoryMatchesQuery) return;
    let live = true;
    setLoading(true);
    setError(null);
    void readInventoryReport(
      baseUrl,
      kind,
      JSON.parse(queryKey) as Partial<InventoryReportQuery>,
    )
      .then((value) => {
        if (live) {
          setReport(value);
          setCommittedRequest(`${kind}:${queryKey}`);
          if (initializedKind.current !== kind) {
            initializedKind.current = kind;
            setFrom(pharmacyLocalDateTime(value.query.from, value.timeZone));
            setTo(pharmacyLocalDateTime(value.query.to, value.timeZone));
          }
        }
      })
      .catch((caught: unknown) => {
        if (live)
          setError(
            caught instanceof IdentityApiDenied
              ? "denied"
              : caught instanceof ReportApiDenied &&
                  caught.code === "future-cutoff"
                ? "invalidPeriod"
                : "unavailable",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [baseUrl, categoryMatchesQuery, kind, queryKey, refresh]);
  const timeZone = report?.timeZone;
  useEffect(() => {
    if (activity === null || report === null) return;
    let live = true;
    setActivityResult(null);
    setActivityError(false);
    void readInventoryReportActivity(
      baseUrl,
      report.kind,
      report.query,
      activity.id,
      activityPage,
    )
      .then((result) => {
        if (live) setActivityResult(result);
      })
      .catch(() => {
        if (live) setActivityError(true);
      });
    return () => {
      live = false;
    };
  }, [activity, report, activityPage, baseUrl]);
  useEffect(() => {
    if (
      activity !== null &&
      activityDialog.current !== null &&
      !activityDialog.current.open
    ) {
      activityDialog.current.showModal();
      focus(() => activityDialog.current?.querySelector("button"));
    }
  }, [activity, focus]);
  const runStepUp = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await work();
      } catch (caught) {
        if (
          caught instanceof IdentityApiDenied ||
          caught instanceof LicensingApiDenied
        )
          setStepUpDenial(caught.denial);
        else setError("unavailable");
        return undefined;
      }
    },
    [],
  );
  const stepUp = useStepUp(baseUrl, runStepUp);
  const openSource = (value: InventoryReportSource, opener: HTMLElement) => {
    sourceOpener.current = opener;
    setSource(value);
  };
  async function saveExport(
    protectedExport: boolean,
    challengeId?: string,
  ): Promise<void> {
    if (report === null || stale || (!protectedExport && ordinary?.blocked))
      return;
    setExporting(true);
    setExportStatus(null);
    setError(null);
    try {
      const bundle =
        protectedExport && challengeId !== undefined
          ? await exportProtectedInventoryReport(baseUrl, {
              kind,
              query: report.query,
              challengeId,
              idempotencyKey: crypto.randomUUID(),
            })
          : await exportInventoryReport(
              baseUrl,
              kind,
              ordinaryReportExport(report.query).query,
            );
      const result = await window.breevDesktop.saveInventoryExport({
        bundle,
        format: "csv",
        locale,
      });
      setExportStatus(
        result.status === "saved"
          ? "saved"
          : result.status === "cancelled"
            ? "cancelled"
            : result.status === "export-too-large"
              ? "tooLarge"
              : "exportFailed",
      );
    } catch (caught) {
      setError(
        caught instanceof ReportApiDenied && caught.code.endsWith("too-large")
          ? "tooLarge"
          : caught instanceof IdentityApiDenied ||
              caught instanceof ReportApiDenied
            ? "denied"
            : "exportFailed",
      );
    } finally {
      setExporting(false);
    }
  }
  function apply(form: HTMLFormElement): void {
    if (report === null) return;
    const data = new FormData(form);
    try {
      const group = String(data.get("group") ?? "");
      const actor = String(data.get("actor") ?? "");
      const businessFrom = String(data.get("businessFrom") ?? "");
      const businessTo = String(data.get("businessTo") ?? "");
      const value = inventoryReportQueryFor(kind).parse({
        from: pharmacyLocalToInstant(from, report.timeZone),
        to: pharmacyLocalToInstant(to, report.timeZone),
        ...(actor === "" ? {} : { actorId: actor }),
        ...(businessFrom === "" ? {} : { businessFrom }),
        ...(businessTo === "" ? {} : { businessTo }),
        ...(group === "" ? {} : { groupBy: group }),
        filters: canonicalReportFilters(filters),
        sort: String(data.get("sort")),
        direction: String(data.get("direction")),
        columns: data.getAll("column"),
        windowDays: Number(data.get("windowDays") ?? 90),
        page: 1,
      });
      setQuery(value);
      setFilterError(null);
      setDraftDirty(false);
      setRefresh((n) => n + 1);
      setError(null);
    } catch (caught) {
      if (caught instanceof ReportFilterError)
        setFilterError({
          index: caught.index,
          rule: caught.rule,
        });
      else setError("invalidPeriod");
    }
  }
  return (
    <section
      className="inventory-reports-workspace"
      aria-labelledby="inventory-reports-title"
    >
      <header className="report-heading">
        <div>
          <h1 id="inventory-reports-title">{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        {report === null ? null : (
          <span className="report-timezone">
            <bdi>
              {reportTimeZoneLabel(report.timeZone, locale, report.query.to)}
            </bdi>
          </span>
        )}
      </header>
      <div className="report-layout">
        <aside className="report-sidebar">
          <p>{copy.category}</p>
          <nav aria-label={copy.category}>
            <button type="button" aria-current="page">
              {copy.inventoryCategory}
            </button>
          </nav>
        </aside>
        <div className="report-main">
          <div className="report-date-toolbar">
            <label>
              {copy.from}
              <input
                form="report-filters"
                type="datetime-local"
                step="0.001"
                required
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setDraftDirty(true);
                }}
              />
            </label>
            <label>
              {copy.to}
              <input
                form="report-filters"
                type="datetime-local"
                step="0.001"
                required
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setDraftDirty(true);
                }}
              />
            </label>
            <div className="report-category-label">
              {copy.category}
              <strong>{copy.inventoryCategory}</strong>
            </div>
          </div>
          <nav className="report-categories" aria-label={copy.title}>
            {INVENTORY_REPORT_KINDS.filter(
              (k) => valuation || (k !== "value" && k !== "average-cost"),
            ).map((k) => (
              <button
                type="button"
                key={k}
                aria-current={k === kind ? "page" : undefined}
                onClick={() => {
                  const current = report?.query;
                  setFilters([]);
                  setDraftDirty(false);
                  setQuery(
                    current === undefined
                      ? {}
                      : {
                          from: current.from,
                          to: current.to,
                          ...(current.actorId === undefined
                            ? {}
                            : { actorId: current.actorId }),
                        },
                  );
                  window.location.hash = `#/reports/inventory/${k}`;
                }}
              >
                {copy.categories[k]}
              </button>
            ))}
          </nav>
          <div className="report-content" aria-busy={loading}>
            <p role="status" className="report-load-status">
              {loading ? copy.loading : stale ? copy.stale : ""}
            </p>
            <button
              type="button"
              className="quiet-button report-retry"
              onClick={() => setRefresh((n) => n + 1)}
            >
              {copy.retry}
            </button>
            {error === null ? null : (
              <p className="denial-alert" role="alert">
                {copy[error]}
              </p>
            )}
            {report === null ? null : (
              <>
                <form
                  id="report-filters"
                  className="report-controls"
                  key={kind}
                  onChange={() => setDraftDirty(true)}
                  onSubmit={(e) => {
                    e.preventDefault();
                    apply(e.currentTarget);
                  }}
                >
                  <div className="report-filter-grid">
                    <label>
                      {copy.actor}
                      <select
                        name="actor"
                        defaultValue={report.query.actorId ?? ""}
                      >
                        <option value="">{copy.allActors}</option>
                        {report.actors.map((actor) => (
                          <option key={actor.id} value={actor.id}>
                            {actor.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy.group}
                      <select
                        name="group"
                        defaultValue={report.query.groupBy ?? ""}
                      >
                        <option value="">{copy.noGroup}</option>
                        {INVENTORY_REPORT_DEFINITIONS[kind].groups.map((c) => (
                          <option key={c} value={c}>
                            {copy.columns[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy.businessFrom}
                      <input
                        name="businessFrom"
                        type="date"
                        defaultValue={report.query.businessFrom ?? ""}
                      />
                    </label>
                    <label>
                      {copy.businessTo}
                      <input
                        name="businessTo"
                        type="date"
                        defaultValue={report.query.businessTo ?? ""}
                      />
                    </label>
                    <label>
                      {copy.sort}
                      <select
                        name="sort"
                        defaultValue={
                          report.kind === kind ? report.query.sort : "item"
                        }
                      >
                        {allowedColumns.map((c) => (
                          <option key={c} value={c}>
                            {copy.columns[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy.direction}
                      <select
                        name="direction"
                        defaultValue={report.query.direction}
                      >
                        <option value="ascending">{copy.ascending}</option>
                        <option value="descending">{copy.descending}</option>
                      </select>
                    </label>
                    {kind === "consumption" ? (
                      <label>
                        {copy.window}
                        <select
                          name="windowDays"
                          defaultValue={report.query.windowDays}
                        >
                          {[30, 60, 90].map((n) => (
                            <option key={n} value={n}>
                              {formatNumber(n, locale)} {copy.days}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <details>
                    <summary>{copy.columnsLabel}</summary>
                    <fieldset className="report-columns">
                      <legend className="visually-hidden">
                        {copy.columnsLabel}
                      </legend>
                      {allowedColumns.map((c) => (
                        <label key={c}>
                          <input
                            name="column"
                            type="checkbox"
                            value={c}
                            defaultChecked={
                              report.kind === kind
                                ? report.columns.includes(c)
                                : true
                            }
                          />
                          {copy.columns[c]}
                        </label>
                      ))}
                    </fieldset>
                  </details>
                  <ReportColumnFilters
                    filters={filters}
                    columns={allowedColumns}
                    locale={locale}
                    error={
                      filterError === null
                        ? null
                        : {
                            index: filterError.index,
                            message: `${copy.columns[filters[filterError.index]!.column]}: ${filterError.rule === "precision" ? copy.filterPrecision : copy.filterNumber}`,
                          }
                    }
                    onChange={(values) => {
                      setFilters(values);
                      setDraftDirty(true);
                      setFilterError(null);
                    }}
                  />
                  <button className="primary-button" type="submit">
                    {copy.apply}
                  </button>
                </form>
                <details
                  className="report-explanations"
                  open={kind === "alerts" || kind === "consumption"}
                >
                  <summary>
                    {copy.categories[report.kind]} ·{" "}
                    {reportTimestamp(
                      report.query.from,
                      locale,
                      report.timeZone,
                    )}{" "}
                    →{" "}
                    {reportTimestamp(report.query.to, locale, report.timeZone)}
                  </summary>
                  {report.explanations.map((key) => (
                    <p key={key}>{copy.explanations[key]}</p>
                  ))}
                </details>
                {report.groups.length === 0 ? null : (
                  <ul className="report-groups" aria-label={copy.group}>
                    {report.groups.map((group, index) => (
                      <li key={group.id} id={`report-group-${index}`}>
                        <bdi>
                          {reportCell(
                            group.key,
                            report.query.groupBy ?? "item",
                            locale,
                            report.timeZone,
                          )}
                        </bdi>{" "}
                        · <bdi>{group.item ?? copy.unitUnavailable}</bdi> ·{" "}
                        <bdi>
                          {reportCell(
                            group.unit,
                            "unit",
                            locale,
                            report.timeZone,
                          )}
                        </bdi>{" "}
                        ·{" "}
                        {report.groups.some(
                          (other) =>
                            other.productId !== group.productId &&
                            other.item === group.item &&
                            other.unit === group.unit,
                        ) ? (
                          <bdi>{group.productId}</bdi>
                        ) : null}
                        {formatNumber(group.rowCount, locale)} {copy.rows}
                        {group.continuesBefore || group.continuesAfter ? (
                          <span> · {copy.groupContinued}</span>
                        ) : null}
                        {Object.entries(group.totals).map(([column, total]) => (
                          <span key={column}>
                            {" "}
                            · {
                              copy.columns[column as InventoryReportColumn]
                            }:{" "}
                            <bdi>
                              {reportCell(
                                total,
                                column as InventoryReportColumn,
                                locale,
                                report.timeZone,
                              )}
                            </bdi>
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {report.rows.length === 0 ? (
                  <p role="status">{copy.empty}</p>
                ) : null}
                <ReportTable
                  report={report}
                  locale={locale}
                  onSort={(column) =>
                    setQuery((current) => ({
                      ...report.query,
                      sort: column,
                      direction:
                        (current.sort ?? report.query.sort) === column &&
                        (current.direction ?? report.query.direction) ===
                          "ascending"
                          ? "descending"
                          : "ascending",
                      page: 1,
                    }))
                  }
                  onActivity={(row, opener) => {
                    activityOpener.current = opener;
                    setActivity(row);
                    setActivityPage(1);
                  }}
                  onSource={openSource}
                />
                <footer className="report-actions">
                  <p role="status">
                    {copy.rows}: {formatNumber(report.totalRows, locale)} ·{" "}
                    {formatNumber(report.query.page, locale)}
                  </p>
                  <button
                    className="quiet-button"
                    type="button"
                    aria-disabled={report.query.page <= 1}
                    onClick={() =>
                      report.query.page > 1 &&
                      setQuery({ ...report.query, page: report.query.page - 1 })
                    }
                  >
                    {copy.previous}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    aria-disabled={!report.hasMore}
                    onClick={() =>
                      report.hasMore &&
                      setQuery({ ...report.query, page: report.query.page + 1 })
                    }
                  >
                    {copy.next}
                  </button>
                  {permissions.includes("reports.inventory.export") ? (
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={exporting || stale || ordinary?.blocked}
                      aria-describedby={
                        ordinary?.blocked
                          ? "report-ordinary-blocked"
                          : undefined
                      }
                      onClick={(e) => {
                        if (ordinary?.reordered) {
                          ordinaryOpener.current = e.currentTarget;
                          setConfirmOrdinary(true);
                        } else void saveExport(false);
                      }}
                    >
                      {copy.export}
                    </button>
                  ) : null}
                  {ordinary?.blocked ? (
                    <p id="report-ordinary-blocked">{copy.ordinaryBlocked}</p>
                  ) : null}
                  {identity?.state === "authenticated" &&
                  identity.user.role.kind === "built-in" &&
                  identity.user.role.key === "owner" &&
                  valuation &&
                  permissions.includes("reports.inventory.view") &&
                  permissions.includes("reports.inventory.export") ? (
                    <button
                      id="report-sensitive-export"
                      className="quiet-button"
                      type="button"
                      disabled={exporting || stale}
                      onClick={() => {
                        void stepUp.begin(
                          "inventory.sensitive.export",
                          undefined,
                          async (challenge) => {
                            await saveExport(true, challenge);
                          },
                        );
                      }}
                    >
                      {copy.sensitiveExport}
                    </button>
                  ) : null}
                  <p role="status">
                    {exportStatus === null ? "" : copy[exportStatus]}
                  </p>
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
      <dialog
        ref={ordinaryDialog}
        className="posted-purchase-dialog report-export-dialog"
        aria-labelledby="report-order-title"
        onClose={() => {
          setConfirmOrdinary(false);
          focus(() =>
            document.activeElement === document.body
              ? ordinaryOpener.current
              : null,
          );
        }}
      >
        <h2 id="report-order-title">{copy.export}</h2>
        <p>{copy.ordinaryReordered}</p>
        <button
          type="button"
          className="quiet-button"
          onClick={() => ordinaryDialog.current?.close()}
        >
          {copy.close}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={exporting || stale}
          onClick={() => {
            ordinaryDialog.current?.close();
            void saveExport(false);
          }}
        >
          {copy.continueExport}
        </button>
      </dialog>
      <dialog
        ref={activityDialog}
        className="posted-purchase-dialog report-activity-dialog"
        onKeyDown={containReportDialogFocus}
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
        aria-labelledby="report-activity-title"
        onClose={() => {
          setActivity(null);
          focus(() => {
            const active = document.activeElement;
            return active === document.body ||
              active === activityOpener.current ||
              activityDialog.current?.contains(active)
              ? activityOpener.current
              : null;
          });
        }}
      >
        <header className="posted-review-heading">
          <div>
            <h2 id="report-activity-title">{copy.activity}</h2>
            <p className="report-dialog-context">
              <bdi>{activity?.cells.item ?? copy.unitUnavailable}</bdi> ·{" "}
              <bdi>
                {reportCell(
                  activity?.cells.unit,
                  "unit",
                  locale,
                  timeZone ?? "UTC",
                )}
              </bdi>
            </p>
          </div>
          <button
            className="quiet-button"
            type="button"
            onClick={() => activityDialog.current?.close()}
          >
            {copy.close}
          </button>
        </header>
        <div className="report-dialog-body">
          {activityError ? (
            <p role="alert">{copy.unavailable}</p>
          ) : activityResult === null ? (
            <p role="status">{copy.loading}</p>
          ) : activityResult.rows.length === 0 ? (
            <p role="status">{copy.noActivity}</p>
          ) : (
            <ol className="report-activity-list">
              {activityResult.rows.map((a) => (
                <li key={a.id}>
                  <div className="report-movement-heading">
                    <strong>{copy.states[a.reason]}</strong>
                    <bdi>
                      {reportTimestamp(a.postedAt, locale, timeZone ?? "UTC")}
                    </bdi>
                  </div>
                  <dl className="report-movement-meta">
                    <div>
                      <dt>{copy.columns.actor}</dt>
                      <dd>
                        <bdi>
                          {a.actor === "system" ? copy.system : a.actor}
                        </bdi>
                      </dd>
                    </div>
                    <div>
                      <dt>{copy.columns.activityQuantity}</dt>
                      <dd>
                        <bdi>{formatNumber(BigInt(a.quantity), locale)}</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt>{copy.columns.businessDate}</dt>
                      <dd>
                        <bdi dir="ltr">{a.businessDate ?? "—"}</bdi>
                      </dd>
                    </div>
                    {a.valueFils === null ? null : (
                      <div>
                        <dt>{copy.columns.activityValueFils}</dt>
                        <dd>
                          <bdi>
                            {reportCell(
                              a.valueFils,
                              "activityValueFils",
                              locale,
                              timeZone ?? "UTC",
                            )}
                          </bdi>
                        </dd>
                      </div>
                    )}
                  </dl>
                  {a.source === null ? null : (
                    <button
                      className="quiet-button report-source-reference"
                      title={copy.openSource}
                      type="button"
                      disabled={!a.source.openable}
                      onClick={(e) => {
                        if (a.source !== null)
                          openSource(a.source, e.currentTarget);
                      }}
                    >
                      <bdi>
                        {reportSourceLabel(
                          a.source.label,
                          locale,
                          timeZone ?? "UTC",
                        )}
                      </bdi>
                      <span aria-hidden="true">↗</span>
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <footer className="report-footer">
          <button
            type="button"
            className="quiet-button"
            aria-disabled={activityPage === 1 || activityResult === null}
            onClick={() => {
              if (activityPage > 1 && activityResult !== null)
                setActivityPage((p) => p - 1);
            }}
          >
            {copy.previous}
          </button>
          <span aria-live="polite">
            {copy.page} <bdi>{formatNumber(activityPage, locale)}</bdi>
          </span>
          <button
            type="button"
            className="quiet-button"
            aria-disabled={!activityResult?.hasMore}
            onClick={() => {
              if (activityResult?.hasMore) setActivityPage((p) => p + 1);
            }}
          >
            {copy.next}
          </button>
          {activityError ? (
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setActivity(null);
                setActivityPage(1);
              }}
            >
              {copy.close}
            </button>
          ) : null}
        </footer>
      </dialog>
      {source === null ? null : (
        <ReportSourceReview
          key={`${source.documentType}:${source.documentId}`}
          baseUrl={baseUrl}
          source={source}
          returnHash={`#/reports/inventory/${kind}`}
          timeZone={timeZone ?? "UTC"}
          onClose={() => {
            setSource(null);
            focus(() =>
              document.activeElement === document.body ||
              document.activeElement === sourceOpener.current
                ? sourceOpener.current
                : null,
            );
          }}
        />
      )}
      {stepUp.pending === null ? null : (
        <StepUpDialog
          busy={exporting}
          copy={identityMessages[locale]}
          licensingCopy={licensingMessages[locale]}
          denial={stepUpDenial}
          onCancel={stepUp.cancel}
          onDismissDenial={() => setStepUpDenial(null)}
          onSubmit={stepUp.approve}
        />
      )}
    </section>
  );
}
