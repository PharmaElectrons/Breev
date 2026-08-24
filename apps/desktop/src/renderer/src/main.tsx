import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Breev renderer root is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
