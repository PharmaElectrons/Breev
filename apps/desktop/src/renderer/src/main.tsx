import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import {
  BootstrapErrorBoundary,
  createAsyncIncidentCode,
  LocalizedAppErrorBoundary,
} from "./error-boundary";
import { PreferencesProvider } from "./preferences-provider";
import "./styles.css";

window.addEventListener("error", (event) => {
  void window.breevDesktop
    .reportRendererIncident({
      code: createAsyncIncidentCode(event.error),
      source: "global-error",
    })
    .catch(() => undefined);
});
window.addEventListener("unhandledrejection", (event) => {
  void window.breevDesktop
    .reportRendererIncident({
      code: createAsyncIncidentCode(event.reason),
      source: "unhandled-rejection",
    })
    .catch(() => undefined);
});

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Breev renderer root is missing");
}

createRoot(root).render(
  <StrictMode>
    <BootstrapErrorBoundary>
      <PreferencesProvider>
        <LocalizedAppErrorBoundary>
          <App />
        </LocalizedAppErrorBoundary>
      </PreferencesProvider>
    </BootstrapErrorBoundary>
  </StrictMode>,
);
