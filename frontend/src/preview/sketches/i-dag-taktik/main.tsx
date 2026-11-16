// Indgang for skitsen #7535 "I dag" (Planning · Today's tactics vist som faerdig i spillet).
// Aabnes via vite dev paa
//   /src/preview/sketches/i-dag-taktik/index.html?mark=1&cap=1&shot=1440|390|flow
// mark=1: roede rammer + numre (forslag 6-8 og placeringen A). shot=flow: pile for vejen ind.
// cap=1: nummer + een saetning braendt ind oeverst (til PR-billederne). Uden parametre: ren skitse.
// Ingen app-router, ingen backend, intet login.

import { createRoot } from "react-dom/client";
import "flag-icons/css/flag-icons.min.css";
import "../../../index.css";
import "./taktik.css";
import { AppShell } from "./AppShell.tsx";
import { TodayHost } from "./TodayHost.tsx";
import { Caption, FlowArrows, Frames } from "./Marks.tsx";

const q = new URLSearchParams(window.location.search);
const shot = q.get("shot") ?? "";
const flow = shot === "flow";
const CAPTIONS: Record<string, [string, string]> = {
  "1440": ["1", "Forslag A: 'Today' er en visning på Planlægning ved siden af Week board, Race list og Month calendar; dagens løb øverst og det valgte løbs taktik under listen."],
  "390": ["2", "Samme visning på telefon: dagens løb som én række pr. løb, guldknappen i sidehovedet og taktikken for det valgte løb under listen."],
  flow: ["3", "Vejen ind: Planning i sidebaren, derefter 'Today', som viser dagens løb med taktikken under."],
};
const cap = q.get("cap") === "1" ? CAPTIONS[shot] : undefined;
document.documentElement.lang = "en";
if (q.get("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
document.title = "Sketch #7535 · Planning · Today";

createRoot(document.getElementById("root")!).render(
  <>
    {cap && <Caption n={cap[0]} text={cap[1]} />}
    <AppShell>
      <TodayHost details={q.get("orders") === "all"} mopen={q.get("open")} />
    </AppShell>
    <Frames on={q.get("mark") === "1" && !flow} />
    <FlowArrows on={flow} />
  </>,
);
