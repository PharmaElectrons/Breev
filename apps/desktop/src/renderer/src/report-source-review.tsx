import type {
  InventoryReportSource,
  PostedPurchaseAdjustment,
  PostedPurchaseReturn,
  PurchasePostedDetail,
} from "@breev/contracts/local-rest";
import { useEffect, useRef, useState } from "react";
import { CountSessionReview } from "./count-session-review";
import { useCommittedFocus } from "./committed-focus";
import {
  requestPostedPurchase,
  requestPostedPurchaseAdjustment,
  requestPostedPurchaseReturn,
} from "./purchasing-api";
import { PostedPurchaseSnapshot } from "./posted-purchase-snapshots";
import { ReportCorrectionSnapshot } from "./report-correction-snapshot";
import {
  getAdjustmentReasonLabel,
  purchasingMessages,
} from "./purchasing-messages";
import {
  containReportDialogFocus,
  reportCell,
  reportSourceLabel,
} from "./report-workspace";
import { usePreferences } from "./preferences-provider";
import { reportMessages } from "./report-messages";

type DocumentView =
  | { kind: "invoice"; document: PurchasePostedDetail }
  | { kind: "adjustment"; document: PostedPurchaseAdjustment }
  | { kind: "return"; document: PostedPurchaseReturn };
export function ReportSourceReview({
  baseUrl,
  source,
  onClose,
  returnHash,
  timeZone,
}: {
  readonly baseUrl: string;
  readonly source: InventoryReportSource;
  readonly onClose: () => void;
  readonly returnHash: string;
  readonly timeZone: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = reportMessages[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useCommittedFocus();
  const [view, setView] = useState<DocumentView | null>(null);
  const [error, setError] = useState(false);
  const dismiss = (): void => {
    dialog.current?.close();
    // Commit dismissal with focus restoration; a queued native close event must
    // not clear a source that the operator has already reopened.
    onClose();
  };
  useEffect(() => {
    if (source.documentType === "count-session") return;
    let live = true;
    dialog.current?.showModal();
    focus(() => dialog.current?.querySelector("button"));
    const read = async (): Promise<DocumentView> => {
      if (source.documentType === "purchase-adjustment")
        return {
          kind: "adjustment",
          document: await requestPostedPurchaseAdjustment(
            baseUrl,
            source.documentId,
          ),
        };
      if (source.documentType === "purchase-return")
        return {
          kind: "return",
          document: await requestPostedPurchaseReturn(
            baseUrl,
            source.documentId,
          ),
        };
      return {
        kind: "invoice",
        document: await requestPostedPurchase(baseUrl, source.documentId),
      };
    };
    void read()
      .then((value) => {
        if (live) setView(value);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [baseUrl, source, focus]);
  if (source.documentType === "count-session")
    return (
      <CountSessionReview
        baseUrl={baseUrl}
        open
        address={{ id: source.documentId }}
        returnHash={returnHash}
        className="report-source-dialog"
        onKeyDown={containReportDialogFocus}
        displayUnit={(name) => reportCell(name, "unit", locale, timeZone)}
        onClose={onClose}
      />
    );
  return (
    <dialog
      ref={dialog}
      className="posted-purchase-dialog report-source-dialog"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      onKeyDown={containReportDialogFocus}
      aria-labelledby="report-source-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <header className="posted-review-heading">
        <div>
          <p className="purchase-context-label">
            {purchasingMessages[locale].historicalSnapshot}
          </p>
          <h2 id="report-source-title">
            <bdi>{reportSourceLabel(source.label, locale, timeZone)}</bdi>
          </h2>
        </div>
        <button className="quiet-button" type="button" onClick={dismiss}>
          {copy.close}
        </button>
      </header>
      <div className="report-dialog-body">
        {error ? (
          <p role="alert">{copy.denied}</p>
        ) : view === null ? (
          <p role="status">{copy.loading}</p>
        ) : view.kind === "invoice" ? (
          <PostedPurchaseSnapshot
            detail={view.document}
            display={{
              unit: (name) => reportCell(name, "unit", locale, timeZone),
              adjustmentReason: (reason) =>
                locale === "ar"
                  ? getAdjustmentReasonLabel(reason, locale)
                  : reason,
            }}
          />
        ) : (
          <ReportCorrectionSnapshot document={view.document} />
        )}
      </div>
    </dialog>
  );
}
