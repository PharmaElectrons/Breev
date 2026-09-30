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
import {
  PostedAdjustmentView,
  PostedReturnView,
  PostedPurchaseSnapshot,
} from "./posted-purchase-snapshots";
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
}: {
  readonly baseUrl: string;
  readonly source: InventoryReportSource;
  readonly onClose: () => void;
  readonly returnHash: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = reportMessages[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useCommittedFocus();
  const [view, setView] = useState<DocumentView | null>(null);
  const [error, setError] = useState(false);
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
        onClose={onClose}
      />
    );
  return (
    <dialog
      ref={dialog}
      className="posted-purchase-dialog report-source-dialog"
      aria-labelledby="report-source-title"
      onClose={onClose}
    >
      <header className="posted-review-heading">
        <h2 id="report-source-title">{source.label}</h2>
        <button
          className="quiet-button"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          {copy.close}
        </button>
      </header>
      {error ? (
        <p role="alert">{copy.denied}</p>
      ) : view === null ? (
        <p role="status">{copy.loading}</p>
      ) : view.kind === "invoice" ? (
        <PostedPurchaseSnapshot detail={view.document} />
      ) : view.kind === "adjustment" ? (
        <PostedAdjustmentView
          adjustment={view.document}
          onBack={() => dialog.current?.close()}
        />
      ) : (
        <PostedReturnView
          purchaseReturn={view.document}
          onBack={() => dialog.current?.close()}
        />
      )}
    </dialog>
  );
}
