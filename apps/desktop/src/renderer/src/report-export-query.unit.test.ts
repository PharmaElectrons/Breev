import { describe, expect, it } from "vitest";
import { inventoryReportQueryFor } from "@breev/contracts/local-rest";
import { ordinaryReportExport } from "./report-export-query";
describe("ordinary export criteria", () => {
  it.each(["closingValueFils", "closingAverageCostScaled"] as const)(
    "normalizes sensitive sort %s explicitly",
    (sort) => {
      const query = inventoryReportQueryFor(
        sort.endsWith("Scaled") ? "average-cost" : "value",
      ).parse({ sort, direction: "descending" });
      const result = ordinaryReportExport(query);
      expect(result).toMatchObject({
        blocked: false,
        reordered: true,
        query: { sort: "item", direction: "ascending" },
      });
      expect(query.sort).toBe(sort);
    },
  );
  it("refuses sensitive membership without removing the criterion", () => {
    const query = inventoryReportQueryFor("value").parse({
      filters: [{ column: "closingValueFils", operator: "gte", value: "1000" }],
    });
    const result = ordinaryReportExport(query);
    expect(result.blocked).toBe(true);
    expect(result.query.filters).toEqual(query.filters);
  });
});
