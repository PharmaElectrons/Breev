import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { inventoryMessages } from "./inventory-messages";
import { StateColourIndicators } from "./state-indicator";

describe.each(["ar", "en"] as const)("state indicators in %s", (locale) => {
  const copy = inventoryMessages[locale];

  it("keeps automatic and manual facts accessible in a compact row", () => {
    const markup = renderToStaticMarkup(
      createElement(StateColourIndicators, {
        compact: true,
        copy,
        riskIndicators: [],
        stateColour: { automatic: "orange", manual: null },
      }),
    );

    expect(markup).toContain("inventory-indicators-compact");
    expect(markup).toContain(copy.stateColours.orange);
    expect(markup).toContain(
      `${copy.automatic}: ${copy.stateColours.orange}. ${copy.manual}: ${copy.manualNone}`,
    );
    expect(markup).not.toContain("<small>");
  });

  it("shows a custom highlight without hiding recall or quarantine warnings", () => {
    const markup = renderToStaticMarkup(
      createElement(StateColourIndicators, {
        compact: true,
        copy,
        riskIndicators: ["recalled", "quarantined"],
        stateColour: { automatic: "red", manual: "#00ff00" },
      }),
    );

    expect(markup).toContain("background-color:#00ff00");
    expect(markup).toContain("color:#000000");
    expect(markup).toContain(`${copy.manual}: #00FF00`);
    expect(markup).toContain(`${copy.automatic}: ${copy.stateColours.red}`);
    expect(markup).toContain('data-indicator="recalled"');
    expect(markup).toContain(copy.riskIndicators.recalled);
    expect(markup).toContain('data-indicator="quarantined"');
    expect(markup).toContain(copy.riskIndicators.quarantined);
    expect(markup).not.toContain("undefined");
  });

  it("retains the full descriptions and readable text on a dark highlight", () => {
    const markup = renderToStaticMarkup(
      createElement(StateColourIndicators, {
        copy,
        riskIndicators: [],
        stateColour: { automatic: "green", manual: "#000000" },
      }),
    );

    expect(markup).toContain("background-color:#000000");
    expect(markup).toContain("color:#ffffff");
    expect(markup).toContain(`${copy.automatic}: ${copy.stateColours.green}`);
    expect(markup).toContain(`${copy.manual}: #000000`);
    expect(markup).not.toContain("inventory-indicators-compact");
  });
});
