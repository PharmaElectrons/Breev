import type {
  BatchEligibilityStatus,
  InventoryRiskIndicator,
  ProductStateColour,
} from "@breev/contracts/local-rest";

type StateIndicatorProps =
  | {
      readonly assistiveLabel?: string;
      readonly colour: ProductStateColour;
      readonly kind: "state";
      readonly label: string;
    }
  | {
      readonly assistiveLabel?: string;
      readonly indicator: InventoryRiskIndicator;
      readonly kind: "risk";
      readonly label: string;
    }
  | {
      readonly assistiveLabel?: string;
      readonly kind: "eligibility";
      readonly label: string;
      readonly status: BatchEligibilityStatus;
    };

export function StateIndicator(props: StateIndicatorProps): React.JSX.Element {
  const token =
    props.kind === "state"
      ? props.colour
      : props.kind === "risk"
        ? riskToken(props.indicator)
        : eligibilityToken(props.status);
  const assistiveLabel = props.assistiveLabel ?? props.label;
  return (
    <span
      className={`state-indicator state-indicator-${token}`}
      data-eligibility={props.kind === "eligibility" ? props.status : undefined}
      data-indicator={props.kind === "risk" ? props.indicator : undefined}
      data-state-colour={props.kind === "state" ? props.colour : undefined}
    >
      <svg
        aria-hidden="true"
        className="state-indicator-icon"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        {indicatorIcon(
          props.kind === "state"
            ? props.colour
            : props.kind === "risk"
              ? props.indicator
              : props.status,
        )}
      </svg>
      <span>{props.label}</span>
      <span className="visually-hidden">{assistiveLabel}</span>
    </span>
  );
}

function eligibilityToken(status: BatchEligibilityStatus): ProductStateColour {
  switch (status) {
    case "eligible":
      return "green";
    case "near-expiry":
      return "yellow";
    case "expired":
      return "red";
    case "recalled":
      return "purple";
    case "quarantined":
      return "orange";
    case "postponed-blocked":
      return "blue";
  }
}

function riskToken(indicator: InventoryRiskIndicator): ProductStateColour {
  switch (indicator) {
    case "above-maximum":
      return "purple";
    case "at-or-below-reorder-point":
    case "below-minimum":
      return "orange";
    case "cold-storage":
      return "blue";
    case "expired":
    case "out-of-stock":
      return "red";
    case "expiring-soon":
      return "yellow";
    case "missing-barcode":
      return "grey";
  }
}

function indicatorIcon(
  value: ProductStateColour | InventoryRiskIndicator | BatchEligibilityStatus,
): React.JSX.Element {
  switch (value) {
    case "eligible":
      return <path d="m5 12 4 4L19 6" />;
    case "near-expiry":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "expired":
      return (
        <>
          <path d="M6 4h12M6 20h12" />
          <path d="M8 4c0 4 4 4 4 8s-4 4-4 8" />
          <path d="M16 4c0 4-4 4-4 8s4 4 4 8" />
        </>
      );
    case "recalled":
      return (
        <>
          <path d="M8 7H4v4" />
          <path d="M4 11a8 8 0 1 0 2-5" />
        </>
      );
    case "quarantined":
      return (
        <>
          <path d="M12 3 19 6v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6l7-3Z" />
          <path d="M9 12h6" />
        </>
      );
    case "postponed-blocked":
      return (
        <>
          <path d="M7 5v14M17 5v14" />
          <path d="M5 5h14M5 19h14" />
        </>
      );
    case "green":
    case "cold-storage":
      return <path d="m5 12 4 4L19 6" />;
    case "red":
    case "out-of-stock":
      return (
        <>
          <path d="M12 4v10" />
          <path d="M12 18h.01" />
          <path d="M5 20h14L12 4 5 20Z" />
        </>
      );
    case "orange":
    case "yellow":
    case "expiring-soon":
    case "below-minimum":
    case "at-or-below-reorder-point":
      return (
        <>
          <path d="M4 12h16" />
          <path d="m8 8-4 4 4 4" />
        </>
      );
    case "blue":
      return (
        <>
          <path d="M12 3v18" />
          <path d="M5 8h14M5 16h14" />
        </>
      );
    case "grey":
    case "missing-barcode":
      return (
        <>
          <path d="M5 5v14M8 5v14M12 5v14M16 5v14M19 5v14" />
          <path d="m4 4 16 16" />
        </>
      );
    case "purple":
    case "above-maximum":
      return (
        <>
          <path d="M12 20V4" />
          <path d="m6 10 6-6 6 6" />
        </>
      );
  }
}
