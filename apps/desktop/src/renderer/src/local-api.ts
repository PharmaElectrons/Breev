import type {
  IdentityDenial,
  LocalHealthResponse,
  LocalProofMutationSuccess,
  LocalSecurityDenial,
} from "@breev/contracts/local-rest";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  localHealthContract,
  localProofMutationContract,
  parseLocalProofMutationResponse,
  parseLocalHealthResponse,
} from "@breev/contracts/local-rest";

export async function requestLocalHealth(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(3_000),
): Promise<LocalHealthResponse> {
  const response = await fetcher(new URL(localHealthContract.path, baseUrl), {
    cache: "no-store",
    headers: { Accept: "application/json" },
    method: localHealthContract.method,
    signal,
  });
  const payload: unknown = await response.json();
  return parseLocalHealthResponse(response.status, payload);
}

export async function requestMainDeviceProofMutation(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(3_000),
): Promise<LocalProofMutationSuccess | LocalSecurityDenial | IdentityDenial> {
  const response = await fetcher(
    new URL(localProofMutationContract.path, baseUrl),
    {
      body: JSON.stringify({ increment: 1 }),
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
      },
      method: localProofMutationContract.method,
      signal,
    },
  );
  const payload: unknown = await response.json();
  return parseLocalProofMutationResponse(response.status, payload);
}
