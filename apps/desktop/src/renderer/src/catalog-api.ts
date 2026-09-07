import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  catalogDenialSchema,
  identityDenialSchema,
  licensingDenialSchema,
  barcodePrintHandoffSchema,
  catalogMatchingApprovalContract,
  catalogMatchingApprovalPath,
  catalogMatchingBatchOpenContract,
  catalogMatchingBatchSchema,
  productBarcodeAddContract,
  productBarcodeAddPath,
  productBarcodePrintContract,
  productBarcodePrintPath,
  productBarcodeSuggestContract,
  productBarcodeSuggestPath,
  productBarcodeSuggestionResponseSchema,
  productArchiveContract,
  productArchivePath,
  productCreateContract,
  productEditContract,
  productListContract,
  productMergeContract,
  productMergePath,
  productPath,
  productReadContract,
  productSearchContract,
  productSearchPath,
  productSearchResponseSchema,
  productSchema,
  type CatalogDenial,
  type BarcodePrintHandoff,
  type CatalogMatchingApprovalRequest,
  type CatalogMatchingBatch,
  type CatalogMatchingBatchOpenRequest,
  type Product,
  type ProductBarcodeAddRequest,
  type ProductBarcodePrintRequest,
  type ProductBarcodeSuggestRequest,
  type ProductBarcodeSuggestionResponse,
  type ProductArchiveRequest,
  type ProductCreateRequest,
  type ProductEditRequest,
  type ProductMergeRequest,
  type ProductSearchRequest,
  type ProductSearchResponse,
} from "@breev/contracts/local-rest";

import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

export class CatalogApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: CatalogDenial,
  ) {
    super(denial.code);
    this.name = "CatalogApiDenied";
  }
}

export async function requestProductList(
  baseUrl: string,
): Promise<{ products: Product[] }> {
  return await requestJson(
    baseUrl,
    productListContract.path,
    productListContract.method,
    200,
    productListContract.responses[200],
  );
}

export async function requestProduct(
  baseUrl: string,
  productId: string,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    productPath(productId),
    productReadContract.method,
    200,
    productSchema,
  );
}

export async function createProduct(
  baseUrl: string,
  body: ProductCreateRequest,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    productCreateContract.path,
    productCreateContract.method,
    201,
    productSchema,
    body,
  );
}

export async function editProduct(
  baseUrl: string,
  productId: string,
  body: ProductEditRequest,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    productPath(productId),
    productEditContract.method,
    200,
    productSchema,
    body,
  );
}

export async function archiveProduct(
  baseUrl: string,
  productId: string,
  body: ProductArchiveRequest,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    productArchivePath(productId),
    productArchiveContract.method,
    201,
    productSchema,
    body,
  );
}

export async function mergeProduct(
  baseUrl: string,
  productId: string,
  body: ProductMergeRequest,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    productMergePath(productId),
    productMergeContract.method,
    201,
    productSchema,
    body,
  );
}

export async function searchProducts(
  baseUrl: string,
  input: ProductSearchRequest,
): Promise<ProductSearchResponse> {
  return await requestJson(
    baseUrl,
    productSearchPath({
      query: input.query,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
    productSearchContract.method,
    200,
    productSearchResponseSchema,
  );
}

export async function addProductBarcode(
  baseUrl: string,
  productId: string,
  body: ProductBarcodeAddRequest,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    productBarcodeAddPath(productId),
    productBarcodeAddContract.method,
    201,
    productSchema,
    body,
  );
}

export async function suggestProductBarcode(
  baseUrl: string,
  productId: string,
  body: ProductBarcodeSuggestRequest,
): Promise<ProductBarcodeSuggestionResponse> {
  return await requestJson(
    baseUrl,
    productBarcodeSuggestPath(productId),
    productBarcodeSuggestContract.method,
    201,
    productBarcodeSuggestionResponseSchema,
    body,
  );
}

export async function requestBarcodePrint(
  baseUrl: string,
  productId: string,
  body: ProductBarcodePrintRequest,
): Promise<BarcodePrintHandoff> {
  return await requestJson(
    baseUrl,
    productBarcodePrintPath(productId),
    productBarcodePrintContract.method,
    201,
    barcodePrintHandoffSchema,
    body,
  );
}

export async function openCatalogMatchingBatch(
  baseUrl: string,
  body: CatalogMatchingBatchOpenRequest,
): Promise<CatalogMatchingBatch> {
  return await requestJson(
    baseUrl,
    catalogMatchingBatchOpenContract.path,
    catalogMatchingBatchOpenContract.method,
    201,
    catalogMatchingBatchSchema,
    body,
  );
}

export async function approveCatalogMatchingSuggestion(
  baseUrl: string,
  suggestionId: string,
  body: CatalogMatchingApprovalRequest,
): Promise<Product> {
  return await requestJson(
    baseUrl,
    catalogMatchingApprovalPath(suggestionId),
    catalogMatchingApprovalContract.method,
    201,
    productSchema,
    body,
  );
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  method: string,
  successStatus: number,
  parser: PayloadParser<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    ...(body === undefined
      ? {
          cache: "no-store" as const,
          credentials: "omit" as const,
          headers: { Accept: "application/json" },
          method,
        }
      : mutationInit(method, body)),
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status !== successStatus) {
    throw await denialFromResponse(response);
  }

  return parser.parse(await response.json());
}

function mutationInit(method: string, body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    },
    method,
  };
}

async function denialFromResponse(response: Response): Promise<Error> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new Error(`Local API returned status ${response.status}`);
  }

  const catalog = catalogDenialSchema.safeParse(payload);
  if (catalog.success) {
    return new CatalogApiDenied(response.status, catalog.data);
  }

  const identity = identityDenialSchema.safeParse(payload);
  if (identity.success) {
    return new IdentityApiDenied(response.status, identity.data);
  }

  const licensing = licensingDenialSchema.safeParse(payload);
  if (licensing.success) {
    return new LicensingApiDenied(response.status, licensing.data);
  }

  return new Error(`Local API returned ${response.status}`);
}
