import type { LocalHealthResponse } from "@breev/contracts/local-rest";
import {
  localHealthContract,
  parseLocalHealthResponse,
} from "@breev/contracts/local-rest";

export async function requestLocalHealth(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<LocalHealthResponse> {
  const response = await fetcher(new URL(localHealthContract.path, baseUrl), {
    method: localHealthContract.method,
  });
  const payload: unknown = await response.json();
  return parseLocalHealthResponse(response.status, payload);
}
