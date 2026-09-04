import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import {
  BootstrapErrorBoundary,
  LocalizedAppErrorBoundary,
} from "./error-boundary";
import { PreferencesProvider } from "./preferences-provider";
import "./styles.css";

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
