import type {
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
    };

export function StateIndicator(props: StateIndicatorProps): React.JSX.Element {
  const token =
    props.kind === "state" ? props.colour : riskToken(props.indicator);
  const assistiveLabel = props.assistiveLabel ?? props.label;
  return (
    <span
      className={`state-indicator state-indicator-${token}`}
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
        {indicatorIcon(props.kind === "state" ? props.colour : props.indicator)}
      </svg>
      <span>{props.label}</span>
      <span className="visually-hidden">{assistiveLabel}</span>
    </span>
  );
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
  value: ProductStateColour | InventoryRiskIndicator,
): React.JSX.Element {
  switch (value) {
    case "green":
    case "cold-storage":
      return <path d="m5 12 4 4L19 6" />;
    case "red":
    case "expired":
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
