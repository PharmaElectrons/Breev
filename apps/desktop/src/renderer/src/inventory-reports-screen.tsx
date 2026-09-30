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
} from "./report-api";
import { reportMessages } from "./report-messages";
import {
  pharmacyLocalDateTime,
  pharmacyLocalToInstant,
  reportTimestamp,
} from "./report-time";
import { ReportColumnFilters, ReportTable } from "./report-workspace";
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
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState<InventoryReportQuery["filters"]>([]);
  const [activity, setActivity] = useState<InventoryReportRow | null>(null);
  const [source, setSource] = useState<InventoryReportSource | null>(null);
  const [stepUpDenial, setStepUpDenial] = useState<StepUpDenial | null>(null);
  const activityDialog = useRef<HTMLDialogElement>(null);
  const activityOpener = useRef<HTMLElement | null>(null);
  const sourceOpener = useRef<HTMLElement | null>(null);
  const focus = useCommittedFocus();
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setReport(null);
    void readInventoryReport(
      baseUrl,
      kind,
      JSON.parse(queryKey) as Partial<InventoryReportQuery>,
    )
      .then((value) => {
        if (live) setReport(value);
      })
      .catch((caught: unknown) => {
        if (live)
          setError(
            caught instanceof IdentityApiDenied
              ? copy.denied
              : caught instanceof ReportApiDenied &&
                  caught.code === "future-cutoff"
                ? copy.invalidPeriod
                : copy.unavailable,
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    baseUrl,
    kind,
    queryKey,
    copy.denied,
    copy.invalidPeriod,
    copy.unavailable,
  ]);
  const reportFrom = report?.query.from;
  const reportTo = report?.query.to;
  const timeZone = report?.timeZone;
  useEffect(() => {
    if (
      reportFrom !== undefined &&
      reportTo !== undefined &&
      timeZone !== undefined
    ) {
      setFrom(pharmacyLocalDateTime(reportFrom, timeZone));
      setTo(pharmacyLocalDateTime(reportTo, timeZone));
    }
  }, [reportFrom, reportTo, timeZone]);
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
        else setError(copy.unavailable);
        return undefined;
      }
    },
    [copy.unavailable],
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
    if (report === null) return;
    setExporting(true);
    setExportStatus("");
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
          : await exportInventoryReport(baseUrl, kind, report.query);
      const result = await window.breevDesktop.saveInventoryExport({
        bundle,
        format: "csv",
        locale,
      });
      setExportStatus(
        result.status === "saved"
          ? copy.saved
          : result.status === "cancelled"
            ? copy.cancelled
            : result.status === "export-too-large"
              ? copy.tooLarge
              : copy.unavailable,
      );
    } catch (caught) {
      setError(
        caught instanceof ReportApiDenied && caught.code.endsWith("too-large")
          ? copy.tooLarge
          : caught instanceof IdentityApiDenied ||
              caught instanceof ReportApiDenied
            ? copy.denied
            : copy.unavailable,
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
        filters,
        sort: String(data.get("sort")),
        direction: String(data.get("direction")),
        columns: data.getAll("column"),
        windowDays: Number(data.get("windowDays") ?? 90),
        page: 1,
      });
      setQuery(value);
      setError(null);
    } catch {
      setError(copy.invalidPeriod);
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
            <bdi>{report.timeZone}</bdi>
          </span>
        )}
      </header>
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
      {loading ? <p role="status">{copy.loading}</p> : null}
      {error === null ? null : (
        <p className="denial-alert" role="alert">
          {error}
        </p>
      )}
      {report === null ? null : (
        <>
          <form
            className="report-controls"
            key={kind}
            onSubmit={(e) => {
              e.preventDefault();
              apply(e.currentTarget);
            }}
          >
            <div className="report-filter-grid">
              <label>
                {copy.from}
                <input
                  type="datetime-local"
                  step="0.001"
                  required
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                {copy.to}
                <input
                  type="datetime-local"
                  step="0.001"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label>
                {copy.actor}
                <select name="actor" defaultValue={report.query.actorId ?? ""}>
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
                <select name="group" defaultValue={report.query.groupBy ?? ""}>
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
                <select name="sort" defaultValue={report.query.sort}>
                  {allowedColumns.map((c) => (
                    <option key={c} value={c}>
                      {copy.columns[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy.direction}
                <select name="direction" defaultValue={report.query.direction}>
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
                <legend className="visually-hidden">{copy.columnsLabel}</legend>
                {allowedColumns.map((c) => (
                  <label key={c}>
                    <input
                      name="column"
                      type="checkbox"
                      value={c}
                      defaultChecked={report.columns.includes(c)}
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
              onChange={setFilters}
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
              {copy.categories[kind]} ·{" "}
              {reportTimestamp(report.query.from, locale, report.timeZone)} →{" "}
              {reportTimestamp(report.query.to, locale, report.timeZone)}
            </summary>
            {report.explanations.map((key) => (
              <p key={key}>{copy.explanations[key]}</p>
            ))}
          </details>
          {report.groups.length === 0 ? null : (
            <ul className="report-groups" aria-label={copy.group}>
              {report.groups.map((group) => (
                <li key={`${group.key}:${group.productId}`}>
                  <bdi>{group.key ?? "—"}</bdi> ·{" "}
                  {formatNumber(group.rowCount, locale)} {copy.rows}
                  {Object.entries(group.totals).map(([column, total]) => (
                    <span key={column}>
                      {" "}
                      · {copy.columns[column as InventoryReportColumn]}:{" "}
                      <bdi>{total}</bdi>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {report.rows.length === 0 ? (
            <p role="status">{copy.empty}</p>
          ) : (
            <ReportTable
              report={report}
              locale={locale}
              onSort={(column) =>
                setQuery({
                  ...report.query,
                  sort: column,
                  direction:
                    report.query.sort === column &&
                    report.query.direction === "ascending"
                      ? "descending"
                      : "ascending",
                  page: 1,
                })
              }
              onActivity={(row, opener) => {
                activityOpener.current = opener;
                setActivity(row);
              }}
              onSource={openSource}
            />
          )}
          <footer className="report-actions">
            <p role="status">
              {copy.rows}: {formatNumber(report.totalRows, locale)} ·{" "}
              {formatNumber(report.query.page, locale)}
            </p>
            <button
              className="quiet-button"
              type="button"
              disabled={report.query.page <= 1}
              onClick={() =>
                setQuery({ ...report.query, page: report.query.page - 1 })
              }
            >
              {copy.previous}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={!report.hasMore}
              onClick={() =>
                setQuery({ ...report.query, page: report.query.page + 1 })
              }
            >
              {copy.next}
            </button>
            {permissions.includes("reports.inventory.export") ? (
              <button
                className="quiet-button"
                type="button"
                disabled={exporting}
                onClick={() => {
                  void saveExport(false);
                }}
              >
                {copy.export}
              </button>
            ) : null}
            {identity?.state === "authenticated" &&
            identity.user.role.kind === "built-in" &&
            identity.user.role.key === "owner" &&
            valuation &&
            permissions.includes("reports.inventory.export") ? (
              <button
                id="report-sensitive-export"
                className="quiet-button"
                type="button"
                disabled={exporting}
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
            <p role="status">{exportStatus}</p>
          </footer>
        </>
      )}
      <dialog
        ref={activityDialog}
        className="posted-purchase-dialog report-activity-dialog"
        aria-labelledby="report-activity-title"
        onClose={() => {
          setActivity(null);
          focus(() => activityOpener.current);
        }}
      >
        <header className="posted-review-heading">
          <h2 id="report-activity-title">{copy.activity}</h2>
          <button
            className="quiet-button"
            type="button"
            onClick={() => activityDialog.current?.close()}
          >
            {copy.close}
          </button>
        </header>
        {activity?.activities.length === 0 ? (
          <p role="status">{copy.noActivity}</p>
        ) : (
          <ol className="report-activity-list">
            {activity?.activities.map((a) => (
              <li key={a.id}>
                <p>
                  {copy.states[a.reason]} ·{" "}
                  {a.actor === "system" ? copy.system : a.actor} ·{" "}
                  <bdi>
                    {reportTimestamp(a.postedAt, locale, timeZone ?? "UTC")}
                  </bdi>
                </p>
                <p>
                  {copy.columns.activityQuantity}:{" "}
                  <bdi>{formatNumber(BigInt(a.quantity), locale)}</bdi> ·{" "}
                  {copy.columns.businessDate}:{" "}
                  <bdi>{a.businessDate ?? "—"}</bdi>
                </p>
                {a.source === null ? null : (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={!a.source.openable}
                    onClick={(e) => {
                      if (a.source !== null)
                        openSource(a.source, e.currentTarget);
                    }}
                  >
                    {a.source.label}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </dialog>
      {source === null ? null : (
        <ReportSourceReview
          key={`${source.documentType}:${source.documentId}`}
          baseUrl={baseUrl}
          source={source}
          returnHash={`#/reports/inventory/${kind}`}
          onClose={() => {
            setSource(null);
            focus(() => sourceOpener.current);
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
