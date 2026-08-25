import { contextBridge } from "electron";

const LOCAL_API_ARGUMENT = "--breev-local-api-url=";

const encodedLocalApiUrl = process.argv
  .find((argument) => argument.startsWith(LOCAL_API_ARGUMENT))
  ?.slice(LOCAL_API_ARGUMENT.length);

if (encodedLocalApiUrl === undefined) {
  throw new Error("The Breev local API URL was not provided to preload");
}

const localApiUrl = decodeURIComponent(encodedLocalApiUrl);

contextBridge.exposeInMainWorld(
  "breevRuntime",
  Object.freeze({
    getLocalApiUrl: async (): Promise<string> => localApiUrl,
  }),
);
