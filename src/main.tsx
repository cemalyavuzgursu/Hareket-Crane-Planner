import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./ui/i18n";
import { UnitsProvider } from "./ui/units";
import "./ui/theme.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <UnitsProvider>
        <App />
      </UnitsProvider>
    </I18nProvider>
  </React.StrictMode>,
);
