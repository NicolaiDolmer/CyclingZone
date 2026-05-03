import React from "react";
import ReactDOM from "react-dom/client";
import Clarity from "@microsoft/clarity";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import "./index.css";

const clarityProjectId = import.meta.env.VITE_CLARITY_PROJECT_ID;
if (import.meta.env.PROD && clarityProjectId) {
  Clarity.init(clarityProjectId);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
