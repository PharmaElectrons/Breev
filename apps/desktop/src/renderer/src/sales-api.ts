import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  saleDraftCreateContract,
  saleDraftClearContract,
  saleDraftClearPath,
  saleDraftDiscardsPath,
  saleDraftDiscardContract,
  saleDraftDiscountPath,
  saleDraftInvoiceDiscountContract,
  saleDraftLineAddContract,
  saleDraftMiscLineAddContract,
  saleDraftMiscLinesPath,
  saleDraftLineChangeContract,
  saleDraftLinePriceOverrideContract,
  saleDraftLinePriceOverridePath,
  saleDraftLineChangesPath,
  saleDraftLineRemoveContract,
  saleDraftLineRemovalsPath,
  saleDraftLinesPath,
  saleDraftListContract,
  saleDraftPath,
  saleDraftReadContract,
  saleDraftResumeContract,
  saleDraftResumptionsPath,
  saleDraftSuspendContract,
  saleDraftSuspensionsPath,
  saleDraftsPath,
  saleProductSearchContract,
  saleProductSearchPath,
  saleProductContextPath,
  saleProductContextContract,
  saleQuickAccessPath,
  saleQuickAccessReadContract,
  saleQuickAccessReplaceContract,
  salesDenialSchema,
  type SaleDraft,
  type SaleDraftLineAddRequest,
  type SaleDraftMiscLineAddRequest,
  type SaleDraftLineChangeRequest,
  type SaleDraftLinePriceOverrideRequest,
  type SaleDraftLineRemoveRequest,
  type SaleDraftInvoiceDiscountRequest,
  type ProductSearchRequest,
  type SaleProductSearchResponse,
  type SaleProductContext,
  type SaleQuickAccess,
  type SaleQuickAccessReplaceRequest,
  type SalesDenial,
} from "@breev/contracts/local-rest";

import { IdentityApiDenied } from "./identity-api";

/**
 * A typed refusal from the Sale Draft routes.
 *
 * Sales owns its own denial vocabulary — `sale-draft-not-found` and
 * `version-conflict` mean nothing to the inventory surfaces — so the screen can
 * name the reason instead of collapsing every failure into one message.
 */
export class SalesApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: SalesDenial,
  ) {
    super(denial.code);
    this.name = "SalesApiDenied";
  }
}

interface PayloadParser<T> {
  parse(value: unknown): T;
}

export async function searchSaleProducts(
  baseUrl: string,
  input: ProductSearchRequest,
): Promise<SaleProductSearchResponse> {
  const query = new URLSearchParams({ query: input.query });
  if (input.limit !== undefined) query.set("limit", input.limit);
  if (input.offset !== undefined) query.set("offset", input.offset);
  return await requestJson(
    baseUrl,
    `${saleProductSearchPath()}?${query.toString()}`,
    saleProductSearchContract.method,
    200,
    saleProductSearchContract.responses[200],
  );
}

export async function readSaleProductContext(
  baseUrl: string,
  productId: string,
): Promise<SaleProductContext> {
  return await requestJson(
    baseUrl,
    saleProductContextPath(productId),
    saleProductContextContract.method,
    200,
    saleProductContextContract.responses[200],
  );
}

export async function readSaleQuickAccess(
  baseUrl: string,
): Promise<SaleQuickAccess> {
  return await requestJson(
    baseUrl,
    saleQuickAccessPath(),
    saleQuickAccessReadContract.method,
    200,
    saleQuickAccessReadContract.responses[200],
  );
}

export async function replaceSaleQuickAccess(
  baseUrl: string,
  body: SaleQuickAccessReplaceRequest,
): Promise<SaleQuickAccess> {
  return await requestJson(
    baseUrl,
    saleQuickAccessPath(),
    saleQuickAccessReplaceContract.method,
    200,
    saleQuickAccessReplaceContract.responses[200],
    body,
  );
}

export async function readSaleDrafts(
  baseUrl: string,
  query: { readonly status?: "active" | "suspended" } = {},
): Promise<{ readonly drafts: readonly SaleDraft[] }> {
  const path =
    query.status === undefined
      ? saleDraftsPath()
      : `${saleDraftsPath()}?status=${query.status}`;
  return await requestJson(
    baseUrl,
    path,
    saleDraftListContract.method,
    200,
    saleDraftListContract.responses[200],
  );
}

export async function readSaleDraft(
  baseUrl: string,
  draftId: string,
): Promise<SaleDraft> {
  return await requestJson(
    baseUrl,
    saleDraftPath(draftId),
    saleDraftReadContract.method,
    200,
    saleDraftReadContract.responses[200],
  );
}

export async function createSaleDraft(
  baseUrl: string,
  body: { readonly idempotencyKey: string },
): Promise<SaleDraft> {
  return await requestJson(
    baseUrl,
    saleDraftsPath(),
    saleDraftCreateContract.method,
    201,
    saleDraftCreateContract.responses[201],
    body,
  );
}

export async function resumeSaleDraft(
  baseUrl: string,
  draftId: string,
  body: {
    readonly expectedVersion: string;
    readonly idempotencyKey: string;
  },
): Promise<SaleDraft> {
  return await requestJson(
    baseUrl,
    saleDraftResumptionsPath(draftId),
    saleDraftResumeContract.method,
    200,
    saleDraftResumeContract.responses[200],
    body,
  );
}

export async function addSaleDraftLine(
  baseUrl: string,
  draftId: string,
  body: SaleDraftLineAddRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftLinesPath(draftId),
    saleDraftLineAddContract,
    body,
  );
}

export async function addSaleDraftMiscLine(
  baseUrl: string,
  draftId: string,
  body: SaleDraftMiscLineAddRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftMiscLinesPath(draftId),
    saleDraftMiscLineAddContract,
    body,
  );
}

export async function changeSaleDraftLine(
  baseUrl: string,
  draftId: string,
  lineId: string,
  body: SaleDraftLineChangeRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftLineChangesPath(draftId, lineId),
    saleDraftLineChangeContract,
    body,
  );
}

export async function overrideSaleDraftLinePrice(
  baseUrl: string,
  draftId: string,
  lineId: string,
  body: SaleDraftLinePriceOverrideRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftLinePriceOverridePath(draftId, lineId),
    saleDraftLinePriceOverrideContract,
    body,
  );
}

export async function removeSaleDraftLine(
  baseUrl: string,
  draftId: string,
  lineId: string,
  body: SaleDraftLineRemoveRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftLineRemovalsPath(draftId, lineId),
    saleDraftLineRemoveContract,
    body,
  );
}

export async function setSaleDraftDiscount(
  baseUrl: string,
  draftId: string,
  body: SaleDraftInvoiceDiscountRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftDiscountPath(draftId),
    saleDraftInvoiceDiscountContract,
    body,
  );
}

export async function clearSaleDraft(
  baseUrl: string,
  draftId: string,
  body: SaleDraftLineRemoveRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftClearPath(draftId),
    saleDraftClearContract,
    body,
  );
}

export async function suspendSaleDraft(
  baseUrl: string,
  draftId: string,
  body: SaleDraftLineRemoveRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftSuspensionsPath(draftId),
    saleDraftSuspendContract,
    body,
  );
}

export async function discardSaleDraft(
  baseUrl: string,
  draftId: string,
  body: SaleDraftLineRemoveRequest,
): Promise<SaleDraft> {
  return await saleDraftCommand(
    baseUrl,
    saleDraftDiscardsPath(draftId),
    saleDraftDiscardContract,
    body,
  );
}

function saleDraftCommand(
  baseUrl: string,
  path: string,
  contract: {
    readonly method: string;
    readonly responses: { readonly 200: PayloadParser<SaleDraft> };
  },
  body: unknown,
): Promise<SaleDraft> {
  return requestJson(
    baseUrl,
    path,
    contract.method,
    200,
    contract.responses[200],
    body,
  );
}

export function newSalesIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function requestJson<T>(
  baseUrl: string,
  requestPath: string,
  method: string,
  successStatus: number,
  parser: PayloadParser<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(new URL(requestPath, baseUrl), {
    ...(body === undefined
      ? {
          cache: "no-store" as const,
          credentials: "omit" as const,
          headers: { Accept: "application/json" },
          method,
        }
      : {
          body: JSON.stringify(body),
          cache: "no-store" as const,
          credentials: "omit" as const,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
          },
          method,
        }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== successStatus)
    throw await denialFromResponse(response);
  return parser.parse(await response.json());
}

async function denialFromResponse(response: Response): Promise<Error> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new Error(`Local API returned status ${String(response.status)}`);
  }
  const sales = salesDenialSchema.safeParse(payload);
  if (sales.success) {
    return new SalesApiDenied(response.status, sales.data);
  }
  const identity = identityDenialSchema.safeParse(payload);
  if (identity.success)
    return new IdentityApiDenied(response.status, identity.data);
  return new Error(`Local API returned status ${String(response.status)}`);
}
