import { describe, expect, it } from "vitest";

import {
  POSTED_PURCHASE_DETAIL_SELECT,
  POSTED_PURCHASE_LIST_SELECT,
  POSTED_PURCHASE_ROWS_SELECT,
} from "./purchasing.service.js";

describe("posted purchase review query boundaries", () => {
  it("reads historical display values exclusively from immutable snapshots", () => {
    for (const statement of [
      POSTED_PURCHASE_DETAIL_SELECT,
      POSTED_PURCHASE_LIST_SELECT,
      POSTED_PURCHASE_ROWS_SELECT,
    ]) {
      expect(statement).not.toMatch(/\bjoin\b/iu);
      expect(statement).not.toMatch(/\bcatalog_products\b/iu);
      expect(statement).not.toMatch(/\bsuppliers\b/iu);
    }
    expect(POSTED_PURCHASE_LIST_SELECT).toMatch(/\bposted_purchases\b/iu);
    expect(POSTED_PURCHASE_ROWS_SELECT).toMatch(/\bposted_purchase_rows\b/iu);
  });
});
