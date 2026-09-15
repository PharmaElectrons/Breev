import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  saleDraftCreateContract,
  saleDraftListContract,
  saleDraftPath,
  saleDraftReadContract,
  saleDraftResumeContract,
  saleDraftResumptionsPath,
  saleDraftsPath,
  salesDenialSchema,
  type SaleDraft,
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

export async function readSaleDrafts(
  baseUrl: string,
  query: { readonly status?: "active" } = {},
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
