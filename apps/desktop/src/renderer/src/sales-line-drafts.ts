import type { SaleDraft, SaleDraftLine } from "@breev/contracts/local-rest";

export interface SaleLineEdit {
  readonly quantity: string;
  readonly unitId: string;
  readonly lineDiscountPercentage: string;
}

// Transient input only: confirmed draft facts remain authoritative on the API.
// The scope includes the endpoint, pharmacy, actor and authenticated session.
type DirtySaleLineEdit = { -readonly [Field in keyof SaleLineEdit]?: string };
const drafts = new Map<string, Map<string, Map<string, DirtySaleLineEdit>>>();
const fields = ["quantity", "unitId", "lineDiscountPercentage"] as const;

export function saleLineEditValues(line: SaleDraftLine): SaleLineEdit {
  return {
    quantity: line.quantity,
    unitId: line.kind === "catalog" ? (line.unitId ?? "") : "",
    lineDiscountPercentage: line.lineDiscountPercentage,
  };
}

export function readSaleLineEdit(
  scope: string,
  draftId: string,
  line: SaleDraftLine,
): SaleLineEdit {
  return {
    ...saleLineEditValues(line),
    ...drafts.get(scope)?.get(draftId)?.get(line.id),
  };
}

export function saveSaleLineEdit(
  scope: string,
  draftId: string,
  line: SaleDraftLine,
  edit: SaleLineEdit,
): void {
  const baseline = saleLineEditValues(line);
  const dirty: DirtySaleLineEdit = {};
  for (const field of fields) {
    if (edit[field] !== baseline[field]) dirty[field] = edit[field];
  }
  if (Object.keys(dirty).length === 0) {
    drafts.get(scope)?.get(draftId)?.delete(line.id);
    return;
  }
  let workspace = drafts.get(scope);
  if (workspace === undefined) {
    workspace = new Map();
    drafts.set(scope, workspace);
  }
  let lines = workspace.get(draftId);
  if (lines === undefined) {
    lines = new Map();
    workspace.set(draftId, lines);
  }
  lines.set(line.id, dirty);
}

export function reconcileSaleLineEdits(
  scope: string,
  draft: Pick<SaleDraft, "id" | "lines" | "status">,
): void {
  const workspace = drafts.get(scope);
  const lines = workspace?.get(draft.id);
  if (lines === undefined) return;
  for (const [lineId, dirty] of lines) {
    const line = draft.lines.find((candidate) => candidate.id === lineId);
    if (line === undefined || draft.status === "discarded") {
      lines.delete(lineId);
      continue;
    }
    const baseline = saleLineEditValues(line);
    for (const field of fields) {
      if (dirty[field] === baseline[field]) delete dirty[field];
    }
    if (Object.keys(dirty).length === 0) lines.delete(lineId);
  }
  if (lines.size === 0) workspace?.delete(draft.id);
  if (workspace?.size === 0) drafts.delete(scope);
}

export function clearSaleLineEdits(): void {
  drafts.clear();
}
