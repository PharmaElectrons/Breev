import type { LocalHealthResponse } from "@breev/contracts/local-rest";
import {
  localHealthContract,
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
