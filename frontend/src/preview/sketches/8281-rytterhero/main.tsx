// Indgang til skitsesiden (#8281). Kun dev; se index.html i samme mappe.
import { createRoot } from "react-dom/client";
import "../../../index.css";
import "flag-icons/css/flag-icons.min.css";
import { SketchApp } from "./Sketches.tsx";

const el = document.getElementById("root");
if (el) createRoot(el).render(<SketchApp />);
