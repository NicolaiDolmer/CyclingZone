// Indgang for skitsen #7535 (taktik efter wireframe v6c). Aabnes via vite dev paa
//   /src/preview/sketches/taktik-wireframe/index.html?v=race|plan&orders=all&open=r1&theme=dark
// v=race: loebssiden (hero, etapestribe, faner + panelet). v=plan: planlaegningen (samme panel).
// orders=all: "All orders" valgt som i wireframe-billedet. open=r1: rytter 1's kort aabent paa telefon.
// Ingen app-router, ingen backend, intet login.

import { createRoot } from "react-dom/client";
import "flag-icons/css/flag-icons.min.css";
import "../../../index.css";
import "./taktik.css";
import { PlanHost, RaceHost } from "./Hosts.tsx";

const q = new URLSearchParams(window.location.search);
const view = q.get("v") === "plan" ? "plan" : "race";
const details = q.get("orders") === "all";
const mopen = q.get("open");
document.documentElement.lang = "en";
if (q.get("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
document.title = view === "plan" ? "Sketch #7535 · Planning tactics" : "Sketch #7535 · Race page tactics";

createRoot(document.getElementById("root")!).render(
  view === "plan" ? <PlanHost details={details} mopen={mopen} /> : <RaceHost details={details} mopen={mopen} />,
);
