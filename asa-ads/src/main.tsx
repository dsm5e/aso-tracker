// Loaded first on purpose: its .kw-scope resets must lose ties to the keyword
// screens' own class rules (imported later via App).
import "./kw-tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { AppProvider } from "./lib/AppContext.tsx";
import "../../shared/ds.css";
import "./styles.css";
import "./ds-bridge.css";
// Adapty-style polish (no dividers, soft tables, compact headers) — must load last.
import "./polish.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/asa">
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
