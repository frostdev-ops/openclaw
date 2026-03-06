import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./theme/global.css";
import "./theme/components.css";
import "./theme/layout.css";

window.addEventListener("error", (event) => {
  console.error("[window-error]", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled-rejection]", event.reason);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Missing root element "#root"');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
