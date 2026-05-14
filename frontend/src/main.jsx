import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { ConsentProvider } from "./lib/consent.jsx";
import { initSentry, SentryBoundary } from "./lib/sentry.jsx";
import { inject } from "@vercel/analytics";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

initSentry();
inject();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SentryBoundary>
      <ThemeProvider>
        <ConsentProvider>
          <App />
        </ConsentProvider>
      </ThemeProvider>
    </SentryBoundary>
  </React.StrictMode>
);
