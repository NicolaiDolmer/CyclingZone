import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { ConsentProvider } from "./lib/consent.jsx";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <ConsentProvider>
        <App />
      </ConsentProvider>
    </ThemeProvider>
  </React.StrictMode>
);
