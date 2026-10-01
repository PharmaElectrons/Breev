import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Adjustment control inventory regression", () => {
  it("contains no old placeholder, permanently disabled duplicate or arithmetic path", () => {
    const source = readFileSync(
      new URL(
        "./src/renderer/src/purchase-adjustment-workflow.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    for (const forbidden of [
      "onClick={leave}",
      "draftGrandTotalFils",
      "BigInt(row.enteredQuantity",
      "alert(",
      "copy.editInvoice",
      "<td>0</td>",
      "String(caught)",
      "form-error-tracking",
      "onFocus={() =>",
    ])
      expect(source).not.toContain(forbidden);
    for (const action of [
      "previous",
      "next",
      "search",
      "new-invoice",
      "return",
      "cancel-adjustment",
      "back",
      "save-review",
      "close-summary",
      "continue-editing",
      "keep-leave",
      "save-leave",
      "discard-leave",
    ])
      expect(source).toContain(`data-adjustment-action="${action}"`);
  });
});
